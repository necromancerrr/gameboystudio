/**
 * `gbs check` — is this bundle well-formed?
 *
 * It answers whether the platform will accept a game, and nothing else. D-022
 * draws the line: the contract is checked, the game is not judged. In
 * particular there is no requirement that input produce a visible effect — a
 * turn-based game, a text game, or one that acts on release would each fail
 * such a rule while being perfectly correct. What is checked is that input
 * *arrives and is decoded*, which is universal.
 *
 * The bundle runs in a real browser, in a real sandbox, because that is the
 * only place the sandbox claims can be tested at all.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildProject } from './build.js';
import { manifestEntry, readProject } from './project.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '../protocol.js';

/** A bundle bigger than this is not a small game; it is a warning sign. */
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean) as string[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Report {
  ok: boolean;
  name: string;
  detail?: string;
}

function say(report: Report): void {
  console.log(`  ${report.ok ? 'ok  ' : 'FAIL'} ${report.name}${report.detail ? `\n       ${report.detail}` : ''}`);
}

/**
 * The page that holds the game under test: the same sandbox the platform uses,
 * plus enough of the host protocol to exercise the contract.
 */
const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>gbs check</title></head>
<body style="margin:0;background:#000">
<script>
  window.__log = [];
  window.__loaded = false;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
  frame.style.cssText = 'width:640px;height:576px;border:0';
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    window.__log.push(event.data);
  });
  frame.addEventListener('load', () => { window.__loaded = true; });
  window.__frame = frame;
  window.__post = (message) => frame.contentWindow.postMessage(message, '*');
  window.__start = (src) => { frame.src = src; document.body.appendChild(frame); };
<\/script>
</body></html>`;

/** Serves a directory, so the frame loads from a real origin. */
function serve(dir: string, port: number): http.Server {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/harness.html') {
      // Served from a real origin rather than assembled on about:blank. An
      // about:blank parent has an opaque origin and its document can be
      // replaced underneath a listener, which showed up as a frame that loaded
      // and then never appeared to say anything.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(HARNESS_HTML);
      return;
    }
    const file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/** Minimal DevTools client. Enough to drive one page and no more. */
class Debugger {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event: MessageEvent) => {
      const data = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (!data.id) return;
      const waiting = this.pending.get(data.id);
      if (!waiting) return;
      this.pending.delete(data.id);
      if (data.error) waiting.reject(new Error(data.error.message));
      else waiting.resolve(data.result);
    });
  }

  send(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not answer`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as Record<string, unknown>);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } };
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result?.value as T;
  }
}

/**
 * The verdict, in a shape a program can act on.
 *
 * A generation loop needs to know *which* rule failed so it can feed that back
 * into the next attempt. Prose is for people; this is for the loop.
 */
export interface CheckVerdict {
  slug: string;
  version: string;
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  failed: string[];
}

export async function runCheck(args: string[]): Promise<boolean> {
  const asJson = args.includes('--json');
  const verdict = await check(args);
  if (asJson) console.log(JSON.stringify(verdict, null, 2));
  return verdict.ok;
}

export async function check(args: string[]): Promise<CheckVerdict> {
  const asJson = args.includes('--json');
  const dir = args.find((value) => !value.startsWith('--')) ?? '.';
  const project = readProject(dir);
  const reports: Report[] = [];

  if (!asJson) console.log(`\nChecking ${project.slug} ${project.version}\n`);

  // --- Things that need no browser -----------------------------------------

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(project.protocol)) {
    reports.push({
      ok: false,
      name: 'the protocol version is one the platform supports',
      detail:
        `built against ${project.protocol}; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}. ` +
        'Rebuild against a current SDK — this would be refused before play, not during it.',
    });
  } else {
    reports.push({ ok: true, name: 'the protocol version is one the platform supports' });
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-check-'));
  const built = await buildProject(project, path.join(staging, 'games'), { minify: false });

  reports.push(
    built.bytes <= MAX_BUNDLE_BYTES
      ? { ok: true, name: `the bundle is a reasonable size (${(built.bytes / 1024).toFixed(0)}KB)` }
      : { ok: false, name: 'the bundle is a reasonable size', detail: `${(built.bytes / 1024).toFixed(0)}KB` },
  );

  // The same validator the platform runs, so a game cannot pass here and be
  // refused there.
  const entry = manifestEntry(project, 'https://hosted.example');
  const { validateEntry } = await import('./manifestRules.js');
  const problem = validateEntry(entry);
  reports.push(
    problem
      ? { ok: false, name: 'the manifest entry is valid', detail: problem }
      : { ok: true, name: 'the manifest entry is valid' },
  );

  // --- Things that need the browser ----------------------------------------

  // The iteration fast path. It skips the browser stage, which is the only slow
  // part, and says so — a run that silently checked less would be worse than a
  // slow one.
  if (args.includes('--quick')) {
    reports.push({ ok: true, name: 'built and bundled (--quick: runtime checks skipped)' });
    if (!asJson) reports.forEach(say);
    return summarise(project.slug, project.version, reports);
  }

  const chrome = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!chrome) {
    reports.push({
      ok: false,
      name: 'a browser is available to run the runtime checks',
      detail: 'no Chrome found; set CHROME_PATH. Skipping is not passing.',
    });
    if (!asJson) reports.forEach(say);
    return summarise(project.slug, project.version, reports);
  }

  const port = 8791;
  const server = serve(staging, port);
  let browser: ChildProcess | null = null;

  try {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-chrome-'));
    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=9333',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    let target: { webSocketDebuggerUrl: string } | null = null;
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      await sleep(250);
      try {
        const response = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' });
        target = (await response.json()) as { webSocketDebuggerUrl: string };
      } catch {
        /* not up yet */
      }
    }
    if (!target) throw new Error('Chrome did not start');

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('could not attach to Chrome')));
    });
    const cdp = new Debugger(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    /**
     * A harness page holding the game in the same sandbox the platform uses,
     * plus enough of the host protocol to exercise the contract.
     */
    const frameUrl = `http://127.0.0.1:${port}/games/${project.slug}/${project.version}/frame.html`;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/harness.html` });
    await sleep(600);
    // The listener is already attached by the harness page, so the game cannot
    // announce itself into a void.
    await cdp.evaluate(`window.__start(${JSON.stringify(frameUrl)})`);

    const waitFor = async <T,>(predicate: string, ms = 10_000): Promise<T | null> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = await cdp.evaluate<T | null>(
          `(() => { const m = window.__log.find((m) => ${predicate}); return m ? JSON.parse(JSON.stringify(m)) : null; })()`,
        );
        if (found) return found;
        await sleep(150);
      }
      return null;
    };

    const hello = await waitFor<{ v: number; width: number; height: number }>(`m && m.t === 'hello'`);
    if (!hello) {
      const diag = await cdp.evaluate<string>(
        `JSON.stringify({ logged: window.__log.length, loaded: window.__loaded === true, src: window.__frame && window.__frame.getAttribute('src') })`,
      );
      console.log(`       [diagnostic] ${diag}`);
    }
    reports.push(
      hello
        ? { ok: true, name: 'it announces itself and keeps announcing until answered' }
        : {
            ok: false,
            name: 'it announces itself and keeps announcing until answered',
            detail: 'no hello arrived — the game never started, or it is not built with the SDK',
          },
    );

    if (hello) {
      reports.push(
        hello.v === project.protocol
          ? { ok: true, name: 'the announced protocol matches the declared one' }
          : {
              ok: false,
              name: 'the announced protocol matches the declared one',
              detail: `declared ${project.protocol}, announced ${hello.v}`,
            },
      );

      await cdp.evaluate(
        `window.__post({ t: 'load', v: ${hello.v}, players: ${project.players.max}, muted: false })`,
      );
      const ready = await waitFor(`m && m.t === 'ready'`);
      reports.push(
        ready
          ? { ok: true, name: 'it loads' }
          : { ok: false, name: 'it loads', detail: 'no ready after load' },
      );

      const probe = async () => {
        await cdp.evaluate(`(() => { window.__log = window.__log.filter((m) => m.t !== 'probeResult'); window.__post({ t: 'probe' }); })()`);
        return waitFor<{
          frames: number;
          running: boolean;
          players: number;
          held: string[];
          pressed: string[];
          canSave: boolean;
        }>(`m && m.t === 'probeResult'`, 4000);
      };

      const loaded = await probe();
      reports.push(
        loaded
          ? { ok: true, name: 'it answers a conformance probe' }
          : {
              ok: false,
              name: 'it answers a conformance probe',
              detail: 'built with an SDK too old to be checked',
            },
      );

      if (loaded) {
        reports.push(
          loaded.players >= project.players.min && loaded.players <= project.players.max
            ? { ok: true, name: 'it runs with a declared number of players' }
            : {
                ok: false,
                name: 'it runs with a declared number of players',
                detail: `declared ${project.players.min}-${project.players.max}, running ${loaded.players}`,
              },
        );

        // Lifecycle: start advances frames, pause stops them, resume continues.
        await cdp.evaluate(`window.__post({ t: 'start' })`);
        await sleep(700);
        const running = await probe();
        await cdp.evaluate(`window.__post({ t: 'pause' })`);
        await sleep(300);
        const pausedA = await probe();
        await sleep(500);
        const pausedB = await probe();
        await cdp.evaluate(`window.__post({ t: 'resume' })`);
        await sleep(600);
        const resumed = await probe();

        reports.push(
          running && running.frames > 0
            ? { ok: true, name: 'start runs the game' }
            : { ok: false, name: 'start runs the game', detail: 'no frames after start' },
        );
        reports.push(
          pausedA && pausedB && pausedA.frames === pausedB.frames
            ? { ok: true, name: 'pause stops it' }
            : { ok: false, name: 'pause stops it', detail: 'frames kept advancing while paused' },
        );
        reports.push(
          resumed && pausedB && resumed.frames > pausedB.frames
            ? { ok: true, name: 'resume continues it' }
            : { ok: false, name: 'resume continues it', detail: 'no frames after resume' },
        );

        /**
         * The input claim, stated the way D-022 requires: what the host sent is
         * what the runtime holds. Nothing about what the game does with it.
         */
        await cdp.evaluate(`window.__post({ t: 'input', player: 0, button: 'a', pressed: true })`);
        await cdp.evaluate(`window.__post({ t: 'input', player: 0, button: 'left', pressed: true })`);
        await sleep(300);
        const holding = await probe();
        await cdp.evaluate(`window.__post({ t: 'input', player: 0, button: 'a', pressed: false })`);
        await cdp.evaluate(`window.__post({ t: 'input', player: 0, button: 'left', pressed: false })`);
        await sleep(300);
        const released = await probe();

        const heldOk =
          holding && holding.held.includes('0:a') && holding.held.includes('0:left');
        reports.push(
          heldOk
            ? { ok: true, name: 'input reaches the game and is decoded correctly' }
            : {
                ok: false,
                name: 'input reaches the game and is decoded correctly',
                detail: `sent a+left, runtime held ${JSON.stringify(holding?.held ?? [])}`,
              },
        );
        reports.push(
          released && released.held.length === 0
            ? { ok: true, name: 'released buttons are released' }
            : {
                ok: false,
                name: 'released buttons are released',
                detail: `still holding ${JSON.stringify(released?.held ?? [])}`,
              },
        );

        // Declared capabilities must be true, so the manifest cannot lie.
        reports.push(
          loaded.canSave === project.saves
            ? { ok: true, name: `it ${project.saves ? 'saves' : 'has no save'}, as declared` }
            : {
                ok: false,
                name: 'declared saves matches reality',
                detail: project.saves
                  ? 'declares saves but supplies no serialize/restore'
                  : 'supplies serialize/restore but declares no saves',
              },
        );

        if (project.saves) {
          await cdp.evaluate(`(() => { window.__log = window.__log.filter((m) => m.t !== 'save'); window.__post({ t: 'readSave' }); })()`);
          const save = await waitFor<{ data: unknown }>(`m && m.t === 'save'`, 3000);
          reports.push(
            save
              ? { ok: true, name: 'a declared save produces bytes' }
              : {
                  ok: false,
                  name: 'a declared save produces bytes',
                  detail: 'readSave returned nothing; a game that declares saves must serialize',
                },
          );
        }

        // Reset and mute must be accepted without falling over.
        await cdp.evaluate(`window.__post({ t: 'reset' })`);
        await cdp.evaluate(`window.__post({ t: 'mute', muted: true })`);
        await sleep(600);
        const afterReset = await probe();
        const errored = await waitFor(`m && m.t === 'error'`, 500);
        reports.push(
          afterReset && !errored
            ? { ok: true, name: 'reset and mute are accepted' }
            : { ok: false, name: 'reset and mute are accepted', detail: 'the game errored' },
        );
      }
    }

    // The sandbox, tested from inside it — the only place it can be tested.
    const escape = await cdp.evaluate<Record<string, string>>(`(() => {
      const frame = window.__frame;
      const out = {};
      try { out.document = frame.contentDocument === null ? 'denied' : 'REACHED'; }
      catch { out.document = 'denied'; }
      try { void frame.contentWindow.localStorage; out.storage = 'REACHED'; }
      catch { out.storage = 'denied'; }
      return out;
    })()`);
    const held = Object.entries(escape).filter(([, value]) => value !== 'denied');
    reports.push(
      held.length === 0
        ? { ok: true, name: 'the sandbox holds' }
        : { ok: false, name: 'the sandbox holds', detail: JSON.stringify(escape) },
    );
  } finally {
    server.close();
    browser?.kill('SIGKILL');
    fs.rmSync(staging, { recursive: true, force: true });
  }

  const bad = reports.filter((report) => !report.ok);
  if (!asJson) {
    reports.forEach(say);
    console.log(
      bad.length === 0
        ? `\n${project.slug} is well-formed. That is not a judgement about whether it is any good.\n`
        : `\n${bad.length} problem${bad.length === 1 ? '' : 's'}. This bundle would not be accepted.\n`,
    );
  }
  return summarise(project.slug, project.version, reports);
}

function summarise(slug: string, version: string, reports: Report[]): CheckVerdict {
  const bad = reports.filter((report) => !report.ok);
  return {
    slug,
    version,
    ok: bad.length === 0,
    checks: reports.map(({ ok, name, detail }) => ({ name, ok, ...(detail ? { detail } : {}) })),
    failed: bad.map((report) => report.name),
  };
}
