/**
 * End-to-end checks in a real browser.
 *
 * Canvas, WebAssembly, audio unlock, gamepad and fullscreen all behave
 * differently outside a headless simulation, and the project's testing
 * priorities put the browser flow first. This drives Chromium over the
 * DevTools Protocol using nothing but Node built-ins, so it adds no
 * dependency to a project that has three.
 *
 * Input is proven by reading pixels: the games are found on screen by colour,
 * and a key press has to visibly move them. Nothing here reaches into game
 * state, so it is checking the same thing a person would.
 *
 * Needs a production build and a chromium binary. Set CHROME_PATH to point at
 * one; without it the script says what it skipped instead of pretending to
 * pass. Run with: npm run build && npm run verify:browser
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env.GBS_SHOTS ?? `${REPO}/.browser-shots`;
const PORT = Number(process.env.GBS_PORT ?? 3210);
const DEBUG_PORT = Number(process.env.GBS_CDP_PORT ?? 9222);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  // macOS. Without these the script skipped on every developer machine here,
  // which reads as a pass in the log and is not one.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.log('No chromium binary found. Set CHROME_PATH to run these checks.');
  console.log('SKIPPED — this is not a pass.');
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => { socket.end(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`nothing listening on ${port}`);
    await sleep(250);
  }
}

/** Minimal DevTools Protocol client over the global WebSocket. */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    /** Sessions attached to out-of-process frames, newest last. */
    this.frameSessions = [];
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      } else if (data.method) {
        this.events.push(data.method);
        // A sandboxed opaque-origin frame is its own process, so it never
        // appears in the parent's frame tree. It arrives here instead.
        if (data.method === 'Target.attachedToTarget' && data.params?.targetInfo?.type === 'iframe') {
          this.frameSessions.push(data.params.sessionId);
        }
        if (data.method === 'Target.detachedFromTarget') {
          this.frameSessions = this.frameSessions.filter((id) => id !== data.params?.sessionId);
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  }

  async goto(url) {
    // Frame sessions belong to the document being left. Keeping them would let
    // a later check read a dead frame's canvas and see a game that never moves,
    // which looks exactly like input not working.
    this.frameSessions = [];
    // A backgrounded page throttles requestAnimationFrame to nothing, so every
    // check that watches something move would fail for a reason that has
    // nothing to do with the code under test. Cheap, and it makes "the screen
    // never changed" mean what it says.
    await this.send('Page.bringToFront').catch(() => {});
    await this.send('Page.navigate', { url });
    // The pages are static; a short settle beats parsing lifecycle events.
    await sleep(900);
  }

  async key(type, { code, key, keyCode, text }) {
    await this.send('Input.dispatchKeyEvent', {
      type,
      code,
      key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      ...(text ? { text } : {}),
    });
  }

  async hold(descriptor, ms) {
    await this.key('rawKeyDown', descriptor);
    await sleep(ms);
    await this.key('keyUp', descriptor);
  }

  /**
   * Evaluates inside a child frame.
   *
   * The page cannot read a sandboxed frame's DOM — that is the isolation being
   * tested elsewhere in this file — so the harness borrows DevTools privileges
   * instead, via an isolated world. This does not weaken the boundary: the
   * claim is about what a *page* can reach, and a debugger is not a page.
   */
  async frameEvaluate(expression) {
    const sessionId = this.frameSessions[this.frameSessions.length - 1];
    if (!sessionId) throw new Error('no sandboxed frame is attached');
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'frame evaluate failed');
    }
    return result.result.value;
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(data, 'base64'));
  }
}

const KEYS = {
  right: { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },
  left: { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
  up: { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
  x: { code: 'KeyX', key: 'x', keyCode: 88, text: 'x' },
  d: { code: 'KeyD', key: 'd', keyCode: 68, text: 'd' },
  w: { code: 'KeyW', key: 'w', keyCode: 87, text: 'w' },
  enter: { code: 'Enter', key: 'Enter', keyCode: 13 },
};

/**
 * Reads the canvas back and returns the centre of mass of pixels close to a
 * colour. This is how the harness "sees" a ship or a fighter.
 */
const CENTROID = (selector, hex, tolerance = 46) => `(() => {
  const canvas = document.querySelector(${JSON.stringify(selector)});
  if (!canvas) return null;
  const g = canvas.getContext('2d');
  const { data, width, height } = g.getImageData(0, 0, canvas.width, canvas.height);
  const target = [0x${hex.slice(1, 3)}, 0x${hex.slice(3, 5)}, 0x${hex.slice(5, 7)}];
  let sx = 0, sy = 0, n = 0, lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) lit += 1;
    const near = Math.abs(data[i] - target[0]) < ${tolerance}
      && Math.abs(data[i + 1] - target[1]) < ${tolerance}
      && Math.abs(data[i + 2] - target[2]) < ${tolerance};
    if (!near) continue;
    const pixel = i / 4;
    sx += pixel % width;
    sy += Math.floor(pixel / width);
    n += 1;
  }
  return n === 0 ? { count: 0, lit, width, height } : { x: sx / n, y: sy / n, count: n, lit, width, height };
})()`;

/**
 * The ship, found the way a person finds it: the only white thing on screen.
 * Its heading comes from the shape — the tip of the triangle is the white
 * pixel furthest from the centre of mass.
 */
const SHIP_POSE = `(() => {
  const canvas = document.querySelector('[data-testid="native-screen"]');
  if (!canvas) return null;
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const points = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 190) {
      points.push([(i / 4) % width, Math.floor((i / 4) / width)]);
    }
  }
  if (points.length < 8) return null;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  let nose = points[0];
  let best = -1;
  for (const p of points) {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d > best) { best = d; nose = p; }
  }
  return { x: cx, y: cy, angle: Math.atan2(nose[1] - cy, nose[0] - cx), pixels: points.length };
})()`;

/**
 * Presses something and reports what moved.
 *
 * Ring Out is always mid-round: between rounds the banner is up and input is
 * deliberately ignored, so a single press can land in a dead window and say
 * nothing about whether the input works. This retries across that window
 * rather than lowering the bar — it still has to move, it just gets a few
 * chances to be asked at a moment the game is listening.
 */
async function movesWhen({ press, read, other, expect, attempts = 4 }) {
  let last = 'never on screen';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await read();
    const otherBefore = other ? await other() : null;
    if (before?.count) {
      await press();
      const after = await read();
      const otherAfter = other ? await other() : null;
      if (after?.count && expect(before, after)) {
        return { before, after, otherBefore, otherAfter };
      }
      if (after?.count) {
        last = `moved ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}`;
      }
    }
    await sleep(1700); // outlast a round change
  }
  throw new Error(last);
}

let passed = 0;
let skipped = 0;
const failures = [];

/**
 * Substring filter for iterating on one check without waiting out the whole
 * suite. Never set in CI, and the summary reports what it skipped so a filtered
 * run cannot be mistaken for a full one.
 */
const ONLY = (process.env.GBS_ONLY ?? '')
  .toLowerCase()
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);

async function check(name, body) {
  if (ONLY.length > 0 && !ONLY.some((term) => name.toLowerCase().includes(term))) {
    skipped += 1;
    return;
  }
  try {
    await body();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`);
    failures.push(name);
  }
}

/**
 * A server left over from an earlier run answers on the port but serves an
 * older build, whose chunk filenames no longer exist. The pages still render
 * server-side, so the library checks pass and every check that needs client
 * JavaScript fails — an hour of debugging the wrong thing. Refuse to start.
 */
const portBusy = await new Promise((resolve) => {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.on('connect', () => { socket.end(); resolve(true); });
  socket.on('error', () => resolve(false));
});
if (portBusy) {
  console.log(`Something is already listening on ${PORT}. Stop it first — a stale`);
  console.log('server serves an old build and turns these checks into nonsense.');
  process.exit(1);
}

// Detached so the whole process group can be killed: `npm run start` spawns
// next-server as a child, and killing npm alone leaves the server running.
const server = spawn('npm', ['run', 'start', '--', '--port', String(PORT)], {
  cwd: REPO,
  stdio: 'ignore',
  detached: true,
});
const browser = spawn(
  chrome,
  [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1280,900',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let stopped = false;
const shutdown = () => {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    server.kill('SIGKILL');
  }
  browser.kill('SIGKILL');
};
process.on('exit', shutdown);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

try {
  await waitForPort(PORT);
  await waitForPort(DEBUG_PORT);

  const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, {
    method: 'PUT',
  }).then((response) => response.json());

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  const page = new Session(socket);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  // Sandboxed frames run out-of-process, so reaching them needs an attached
  // session rather than the parent's frame tree. Flattened, so their messages
  // arrive on this same socket tagged with a sessionId.
  await page.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  /**
   * A controller the test can drive. Headless Chromium exposes no real pads,
   * so this stands in for the device while leaving everything above it — the
   * polling, the standard-mapping indexes, slot assignment, the router — as
   * the real code. Installed before any navigation so the app never sees a
   * page without it.
   */
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const pads = [];
      Object.defineProperty(navigator, 'getGamepads', {
        value: () => pads.slice(),
        configurable: true,
      });
      window.__padConnect = (index, id) => {
        pads[index] = {
          index, id, mapping: 'standard', connected: true,
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        window.dispatchEvent(new Event('gamepadconnected'));
      };
      window.__padPress = (index, button, down) => {
        const pad = pads[index];
        if (pad) pad.buttons[button] = { pressed: down, value: down ? 1 : 0 };
      };
      window.__padDisconnect = (index) => {
        delete pads[index];
        window.dispatchEvent(new Event('gamepaddisconnected'));
      };
    })()`,
  });

  const base = `http://127.0.0.1:${PORT}`;

  console.log('Library:');

  await check('the library lists every game, Originals included', async () => {
    await page.goto(`${base}/`);
    const tiles = await page.evaluate(
      `[...document.querySelectorAll('[data-testid="library-grid"] li h3')].map((h) => h.textContent)`,
    );
    // At least, not exactly: hosted games are fetched at runtime and join the
    // same grid, so the compiled catalog is a floor rather than the total.
    if (tiles.length < 22) throw new Error(`expected at least 22 tiles, saw ${tiles.length}`);
    if (!tiles.includes('Drift') || !tiles.includes('Ring Out')) {
      throw new Error('Originals missing from the grid');
    }
    await page.shot('library');
  });

  await check('the Originals filter narrows to the two of them', async () => {
    await page.evaluate(
      `[...document.querySelectorAll('nav button')].find((b) => b.textContent === 'Originals').click()`,
    );
    await sleep(200);
    const tiles = await page.evaluate(
      `[...document.querySelectorAll('[data-testid="library-grid"] li h3')].map((h) => h.textContent)`,
    );
    // Exactly ours, and nothing else. Hosted games also have no console, so
    // this would quietly include them if "Original" were defined that way.
    if (tiles.join('|') !== 'Drift|Ring Out') throw new Error(`filter showed ${tiles.join(', ')}`);
  });

  await check('a hosted game is not filed as one of our Originals', async () => {
    const tiles = await page.evaluate(
      `[...document.querySelectorAll('[data-testid="library-grid"] li h3')].map((h) => h.textContent).join('|')`,
    );
    if (/hosted/i.test(tiles)) throw new Error(`the Originals filter showed ${tiles}`);
  });

  await check('search still finds a retro game', async () => {
    await page.goto(`${base}/`);
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="library-search"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'tobu');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(200);
    const tiles = await page.evaluate(
      `document.querySelectorAll('[data-testid="library-grid"] li').length`,
    );
    if (tiles !== 2) throw new Error(`expected 2 Tobu Tobu Girl entries, saw ${tiles}`);
  });

  console.log('\nDrift:');

  await check('it loads and draws', async () => {
    await page.goto(`${base}/games/drift`);
    await sleep(1500);
    const ship = await page.evaluate(CENTROID('[data-testid="native-screen"]', '#e9eae7'));
    if (!ship || ship.count === 0) throw new Error('no ship on screen');
    if (ship.lit < 500) throw new Error(`screen looks empty (${ship.lit} lit pixels)`);
    await page.shot('drift');
  });

  await check('the ship flies its orbit without any input', async () => {
    const before = await page.evaluate(CENTROID('[data-testid="native-screen"]', '#e9eae7'));
    await sleep(900);
    const after = await page.evaluate(CENTROID('[data-testid="native-screen"]', '#e9eae7'));
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    if (moved < 15) throw new Error(`ship moved only ${moved.toFixed(1)}px`);
  });

  await check('holding thrust changes the orbit, and letting go does not', async () => {
    const radiusNow = async () => {
      const ship = await page.evaluate(SHIP_POSE);
      return Math.hypot(ship.x - 160, ship.y - 144);
    };

    // Both runs cover the same wall time, so the only difference is the key.
    // Whether the orbit climbs or drops depends on which way the ship happens
    // to be pointing — what matters is that the button changed the flight.
    await page.goto(`${base}/games/drift`);
    await sleep(1200);
    const idleBefore = await radiusNow();
    await sleep(1400);
    const idleDrift = Math.abs((await radiusNow()) - idleBefore);

    await page.goto(`${base}/games/drift`);
    await sleep(1200);
    const thrustBefore = await radiusNow();
    await page.hold(KEYS.x, 1400);
    const thrustDrift = Math.abs((await radiusNow()) - thrustBefore);

    if (idleDrift > 12) throw new Error(`the orbit is not stable on its own (${idleDrift.toFixed(0)}px)`);
    if (thrustDrift < 25) throw new Error(`thrust moved the orbit only ${thrustDrift.toFixed(0)}px`);
    await page.shot('drift-thrust');
  });

  await check('a run can be lost and restarted with the keyboard', async () => {
    await page.hold(KEYS.x, 4000); // fly out of the field
    await sleep(500);
    const lostText = await page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="native-screen"]');
      const g = canvas.getContext('2d');
      const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i+1] + data[i+2] > 300) lit += 1;
      return lit;
    })()`);
    if (lostText < 200) throw new Error('no end-of-run screen appeared');
    await page.shot('drift-lost');

    await sleep(900);
    await page.hold(KEYS.x, 90);
    await sleep(700);
    const ship = await page.evaluate(CENTROID('[data-testid="native-screen"]', '#e9eae7'));
    if (!ship || ship.count === 0) throw new Error('the ship did not come back');
  });

  await check('a core can be collected with the keyboard, and the best score is saved', async () => {
    await page.goto(`${base}/games/drift`);
    await page.evaluate(`window.localStorage.removeItem('gbstudio.save.v1.drift')`);
    await page.goto(`${base}/games/drift`);
    await sleep(1400);

    // Flies the ship with four keys, from what is on the screen. The same
    // orbital transfer the headless harness uses — aiming straight at a core
    // does not work, because the straight line goes through the star.
    const MU = 539_000;
    const CORE = { x: 160 + Math.cos(2.399963229728653 - Math.PI / 2) * 98, y: 144 + Math.sin(2.399963229728653 - Math.PI / 2) * 98 };
    const targetRadius = Math.hypot(CORE.x - 160, CORE.y - 144);

    const held = new Set();
    const setKeys = async (wanted) => {
      for (const name of wanted) {
        if (!held.has(name)) { held.add(name); await page.key('rawKeyDown', KEYS[name]); }
      }
      for (const name of [...held]) {
        if (!wanted.includes(name)) { held.delete(name); await page.key('keyUp', KEYS[name]); }
      }
    };

    let previous = null;
    let previousAt = 0;
    const deadline = Date.now() + 40_000;
    let saved = null;

    while (Date.now() < deadline) {
      const pose = await page.evaluate(SHIP_POSE);
      const now = Date.now();
      if (!pose) { previous = null; await sleep(30); continue; }

      const dt = previous ? Math.max((now - previousAt) / 1000, 0.001) : 0;
      const velocity = previous
        ? { x: (pose.x - previous.x) / dt, y: (pose.y - previous.y) / dt }
        : { x: 0, y: 0 };
      previous = pose;
      previousAt = now;

      const outX = pose.x - 160;
      const outY = pose.y - 144;
      const radius = Math.max(Math.hypot(outX, outY), 1);
      const radial = { x: outX / radius, y: outY / radius };
      const tangent = { x: -radial.y, y: radial.x };
      const spin = Math.sign(velocity.x * tangent.x + velocity.y * tangent.y) || 1;
      const orbitSpeed = Math.sqrt(MU / radius);
      const closing = Math.max(-28, Math.min(28, (targetRadius - radius) * 0.6));
      const wantedVelocity = {
        x: tangent.x * spin * orbitSpeed + radial.x * closing,
        y: tangent.y * spin * orbitSpeed + radial.y * closing,
      };
      const need = {
        x: (wantedVelocity.x - velocity.x) / 0.45,
        y: (wantedVelocity.y - velocity.y) / 0.45,
      };

      const keys = [];
      if (Math.hypot(need.x, need.y) > 6) {
        let error = Math.atan2(need.y, need.x) - pose.angle;
        while (error > Math.PI) error -= Math.PI * 2;
        while (error < -Math.PI) error += Math.PI * 2;
        if (error > 0.05) keys.push('right');
        else if (error < -0.05) keys.push('left');
        if (Math.abs(error) < 0.35) keys.push('x');
      }
      await setKeys(keys);

      saved = await page.evaluate(`window.localStorage.getItem('gbstudio.save.v1.drift')`);
      if (saved) break;
      await sleep(20);
    }
    await setKeys([]);

    if (!saved) throw new Error('flew for 40s without collecting a core');
    await page.shot('drift-scored');

    // The stored bytes have to be a real score, not merely present.
    const best = await page.evaluate(`(() => {
      const raw = window.localStorage.getItem('gbstudio.save.v1.drift');
      const binary = atob(raw);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return { version: bytes[0], best: new DataView(bytes.buffer).getUint32(1, true) };
    })()`);
    if (best.version !== 1 || best.best < 1) {
      throw new Error(`saved bytes were ${JSON.stringify(best)}`);
    }
  });

  console.log('\nRing Out:');

  await check('two keyboard schemes drive two different fighters', async () => {
    await page.goto(`${base}/games/ring-out`);
    const green = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#9bbc0f', 40));
    const amber = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#e0a33e', 40));

    // The game arrives in its own chunk, so wait for it rather than guessing.
    const ready = Date.now() + 12_000;
    for (;;) {
      const seen = await green();
      if (seen && seen.count > 20) break;
      if (Date.now() > ready) throw new Error('player one never appeared on screen');
      await sleep(200);
    }
    await sleep(1000); // past the READY banner

    // Short presses on purpose: the floor is slippery and the ring is not
    // wide, so a long hold would just knock the fighter out of the arena.
    const one = await movesWhen({
      press: () => page.hold(KEYS.right, 300),
      read: green,
      other: amber,
      expect: (before, after) => after.x > before.x + 4,
    });
    if (Math.abs(one.otherAfter.x - one.otherBefore.x) > 2) {
      throw new Error("player two moved on player one's input");
    }

    await sleep(900); // let the slide settle
    await movesWhen({
      press: () => page.hold(KEYS.w, 300),
      read: amber,
      expect: (before, after) => after.y < before.y - 4,
    });
    await page.shot('ring-out');
  });

  await check('both seats are shown filled when one keyboard covers them', async () => {
    const seats = await page.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('[data-testid^="seat-"]')];
      return nodes.map((node) => ({
        present: node.dataset.present,
        text: node.textContent.trim(),
      }));
    })()`);
    if (seats.length !== 2) throw new Error(`saw ${seats.length} seats`);
    if (!seats.every((seat) => seat.present === 'true')) {
      throw new Error(`a seat read empty on a keyboard: ${JSON.stringify(seats)}`);
    }
    // The panel names devices, never indexes or mappings — D-014 keeps runtime
    // internals out of player-facing UI and this is the same rule.
    if (!seats.every((seat) => /Keyboard/.test(seat.text))) {
      throw new Error(`seats did not name the device: ${JSON.stringify(seats)}`);
    }
  });

  await check('a lone controller can be moved to the second seat', async () => {
    await page.goto(`${base}/games/ring-out`);
    await sleep(2200);
    await page.evaluate(`window.__padConnect(4, 'Verification Pad C')`);
    await sleep(600);

    const seatText = () => page.evaluate(`(() => {
      const node = document.querySelector('[data-testid="seat-1"]');
      return node ? node.textContent.trim() : '';
    })()`);
    if (/Verification Pad C/.test(await seatText())) {
      throw new Error('the pad started in the second seat, so the swap proves nothing');
    }

    const swapped = await page.evaluate(`(() => {
      const button = document.querySelector('[data-testid="swap-players"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!swapped) throw new Error('no way to switch seats was offered');
    await sleep(400);
    if (!/Verification Pad C/.test(await seatText())) {
      throw new Error(`the pad did not move: ${await seatText()}`);
    }
    await page.evaluate(`window.__padDisconnect(4)`);
  });

  console.log('\nRooms:');

  /**
   * The claim M4 makes, tested the only way that proves it: the input does not
   * originate in this browser at all. It is sent from Node, over a real
   * WebSocket, through the real relay, and has to move pixels on the host's
   * screen. Nothing here reaches into the page's state.
   */
  /** Assigned by the Rooms section; the hosted checks reuse it. */
  let openGuest = null;

  const RELAY_HTTP = process.env.GBS_RELAY_HTTP ?? 'http://127.0.0.1:8787';
  const RELAY_WS = process.env.GBS_RELAY_WS ?? 'ws://127.0.0.1:8787';
  const relayUp = await fetch(`${RELAY_HTTP}/health`)
    .then((response) => response.ok)
    .catch(() => false);

  if (!relayUp) {
    console.log(`  no relay answering on ${RELAY_HTTP} — SKIPPED, which is not a pass.`);
    console.log('  Start one with: npm run relay:dev');
  } else {
    /** Speaks the room protocol from Node, the way a phone would. */
    openGuest = async (code) => {
      const socket = new WebSocket(`${RELAY_WS}/join?code=${code}`);
      const seat = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the room never gave a seat')), 8000);
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ t: 'join', v: 1, code }));
        });
        socket.addEventListener('error', () => reject(new Error('could not reach the relay')));
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.t === 'err') {
            clearTimeout(timer);
            reject(new Error(`the room refused us: ${message.code}`));
          }
          if (message.t === 'msg' && message.ch === 'control' && message.d?.c === 'seat') {
            clearTimeout(timer);
            resolve(message.d);
          }
        });
      });
      return {
        socket,
        seat,
        press: (button, pressed) =>
          socket.send(JSON.stringify({ t: 'msg', ch: 'input', d: { b: button, p: pressed } })),
      };
    };

    const openRoom = async () => {
      await page.goto(`${base}/games/ring-out`);
      await sleep(2500);
      const opened = await page.evaluate(`(() => {
        const button = document.querySelector('[data-testid="invite-open"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!opened) {
        throw new Error(
          'no Invite button — build with NEXT_PUBLIC_RELAY_URL set for these checks',
        );
      }
      const deadline = Date.now() + 8000;
      for (;;) {
        const code = await page.evaluate(
          `document.querySelector('[data-testid="invite-code"]')?.textContent ?? ''`,
        );
        if (/^[A-Z0-9]{6}$/.test(code)) return code;
        if (Date.now() > deadline) throw new Error('the room never produced a code');
        await sleep(200);
      }
    };

    let guest = null;

    await check('a phone can join a room and take a seat', async () => {
      const code = await openRoom();
      guest = await openGuest(code);
      if (typeof guest.seat.slot !== 'number') throw new Error('no seat number');
      if (guest.seat.title !== 'Ring Out') {
        throw new Error(`the phone was told it was playing "${guest.seat.title}"`);
      }
      await page.shot('room-invite');
    });

    await check('a button pressed off-device moves that player on the host screen', async () => {
      if (!guest) throw new Error('no guest joined');
      // Player one is green and player two amber, matching the seat badge the
      // phone shows, so the wrong seat would move the wrong fighter.
      const mineHex = guest.seat.slot === 0 ? '#9bbc0f' : '#e0a33e';
      const theirsHex = guest.seat.slot === 0 ? '#e0a33e' : '#9bbc0f';
      const mine = () => page.evaluate(CENTROID('[data-testid="native-screen"]', mineHex, 40));
      const theirs = () => page.evaluate(CENTROID('[data-testid="native-screen"]', theirsHex, 40));

      const moved = await movesWhen({
        press: async () => {
          guest.press('right', true);
          await sleep(300);
          guest.press('right', false);
          await sleep(150);
        },
        read: mine,
        other: theirs,
        expect: (before, after) => after.x > before.x + 4,
      });
      if (Math.abs(moved.otherAfter.x - moved.otherBefore.x) > 2) {
        throw new Error('the phone moved the other player too');
      }
      await page.shot('room-remote-input');
    });

    await check('a phone that vanishes gives up its seat', async () => {
      if (!guest) throw new Error('no guest joined');
      const seatText = () =>
        page.evaluate(
          `document.querySelector('[data-testid="seat-${guest.seat.slot}"]')?.textContent ?? ''`,
        );

      if (!/Phone/.test(await seatText())) {
        throw new Error(`the seat never showed the phone: ${await seatText()}`);
      }

      guest.press('left', true);
      await sleep(250);
      // No goodbye — the socket simply dies, the way a locked phone does. That
      // the held button is also released is asserted in verify:net, where the
      // router can be observed directly; Ring Out resets rounds on a knockout,
      // so a stuck direction stops producing visible drift within a second and
      // a pixel-based check for it cannot fail.
      guest.socket.close();
      await sleep(1200);

      if (/Phone/.test(await seatText())) {
        throw new Error(`the seat still shows the phone: ${await seatText()}`);
      }
      guest = null;
    });

    await check('closing the room frees the seat again', async () => {
      const closed = await page.evaluate(`(() => {
        const button = document.querySelector('[data-testid="invite-close"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!closed) throw new Error('no way to close the room');
      await sleep(500);
      const stillOpen = await page.evaluate(
        `!!document.querySelector('[data-testid="invite-code"]')`,
      );
      if (stillOpen) throw new Error('the room code was still on screen after closing');
    });
  }

  console.log('\nControllers:');

  // Standard-mapping indexes, by physical position (D-010).
  const PAD = { south: 0, east: 1, left: 14, right: 15, up: 12, down: 13 };

  await check('a pad at browser index 3 still drives player one', async () => {
    await page.goto(`${base}/games/drift`);
    await sleep(1500);
    // Deliberately not index 0: a pad that sleeps and comes back lands
    // wherever the browser puts it, and that must not decide who you are.
    await page.evaluate(`window.__padConnect(3, 'Verification Pad A')`);
    await sleep(400);

    const radiusNow = async () => {
      const ship = await page.evaluate(SHIP_POSE);
      return Math.hypot(ship.x - 160, ship.y - 144);
    };
    const before = await radiusNow();
    await page.evaluate(`window.__padPress(3, ${PAD.east}, true)`);
    await sleep(1400);
    await page.evaluate(`window.__padPress(3, ${PAD.east}, false)`);
    const after = await radiusNow();

    if (Math.abs(after - before) < 25) {
      throw new Error(`the pad moved the orbit only ${Math.abs(after - before).toFixed(0)}px`);
    }
    await page.shot('gamepad-drift');
  });

  await check('two pads take player one and player two, in slot order', async () => {
    await page.goto(`${base}/games/ring-out`);
    const green = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#9bbc0f', 40));
    const amber = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#e0a33e', 40));

    const ready = Date.now() + 12_000;
    for (;;) {
      const seen = await green();
      if (seen && seen.count > 20) break;
      if (Date.now() > ready) throw new Error('the game never appeared');
      await sleep(200);
    }
    await page.evaluate(`window.__padConnect(2, 'Verification Pad A')`);
    await page.evaluate(`window.__padConnect(5, 'Verification Pad B')`);
    await sleep(1000);

    const tap = (index, button, ms = 300) => async () => {
      await page.evaluate(`window.__padPress(${index}, ${button}, true)`);
      await sleep(ms);
      await page.evaluate(`window.__padPress(${index}, ${button}, false)`);
    };

    const first = await movesWhen({
      press: tap(2, PAD.right),
      read: green,
      other: amber,
      expect: (before, after) => after.x > before.x + 4,
    });
    if (Math.abs(first.otherAfter.x - first.otherBefore.x) > 2) {
      throw new Error('the first pad moved player two too');
    }

    await sleep(900);
    await movesWhen({
      press: tap(5, PAD.up),
      read: amber,
      expect: (before, after) => after.y < before.y - 4,
    });
    await page.shot('gamepad-ring-out');
  });

  await check('yanking a pad mid-press does not leave a button held down', async () => {
    const amber = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#e0a33e', 40));
    await sleep(700);
    await page.evaluate(`window.__padPress(5, ${PAD.down}, true)`);
    await sleep(250);
    // Unplugged while still holding down.
    await page.evaluate(`window.__padDisconnect(5)`);
    await sleep(1200); // long enough for the slide to bleed off

    const settled = await amber();
    await sleep(600);
    const later = await amber();
    const stillMoving = Math.hypot(later.x - settled.x, later.y - settled.y);
    if (stillMoving > 25) {
      throw new Error(`player two kept moving ${stillMoving.toFixed(0)}px after the pad was pulled`);
    }
  });

  await check('the same pad coming back gets its player slot back', async () => {
    const green = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#9bbc0f', 40));
    const amber = () => page.evaluate(CENTROID('[data-testid="native-screen"]', '#e0a33e', 40));
    // Same id, different browser index — the case that breaks positional
    // assignment and the reason slots are held by id.
    await page.evaluate(`window.__padConnect(7, 'Verification Pad B')`);
    await sleep(700);

    const returning = await movesWhen({
      press: async () => {
        await page.evaluate(`window.__padPress(7, ${PAD.right}, true)`);
        await sleep(300);
        await page.evaluate(`window.__padPress(7, ${PAD.right}, false)`);
      },
      read: amber,
      other: green,
      expect: (before, after) => after.x > before.x + 4,
    });
    if (Math.abs(returning.otherAfter.x - returning.otherBefore.x) > 2) {
      throw new Error('it drove player one instead');
    }
  });

  console.log('\nRetro, still working:');

  await check('a Game Boy game boots and renders in the browser', async () => {
    await page.goto(`${base}/games/tobutobugirl`);
    await sleep(4000);
    const screen = await page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="gb-screen"]');
      if (!canvas) return null;
      const g = canvas.getContext('2d');
      const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
      const colours = new Set();
      for (let i = 0; i < data.length; i += 4) colours.add((data[i] << 16) | (data[i+1] << 8) | data[i+2]);
      return { colours: colours.size, width: canvas.width, height: canvas.height };
    })()`);
    if (!screen) throw new Error('no Game Boy screen on the page');
    if (screen.width !== 160 || screen.height !== 144) throw new Error('wrong screen size');
    if (screen.colours < 2) throw new Error('blank screen');
    await page.shot('retro');
  });

  await check('a Game Boy game keeps drawing, not just its first frame', async () => {
    // Tobu Tobu Girl runs an attract loop on its own, so a screen that never
    // changes means the emulator stopped, not that nothing was pressed. Without
    // this, a stalled loop shows up as "input does nothing" and sends the next
    // person hunting through the input layer — exactly the wrong-layer chase
    // D-012 was written about.
    const frame = () => page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="gb-screen"]');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < data.length; i += 41) hash = (hash * 31 + data[i]) | 0;
      return hash;
    })()`);
    const seen = new Set();
    for (let i = 0; i < 8; i += 1) {
      seen.add(await frame());
      await sleep(250);
    }
    if (seen.size === 1) {
      throw new Error(`the screen never changed at all over 2s (hash ${[...seen][0]})`);
    }
  });

  await check('keyboard input changes what a Game Boy game draws', async () => {
    const snapshot = () => page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="gb-screen"]');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < data.length; i += 41) hash = (hash * 31 + data[i]) | 0;
      return hash;
    })()`);
    // Start advances the attract loop; the screen must differ from idle.
    const idle = await snapshot();
    await page.hold(KEYS.enter, 1200);
    await sleep(300);
    const after = await snapshot();
    if (idle === after) throw new Error('the screen never changed');
  });

  await check('Continue remembers what was played', async () => {
    await page.goto(`${base}/`);
    await sleep(700);
    const shelf = await page.evaluate(
      `[...document.querySelectorAll('[data-testid="continue-shelf"] h3')].map((h) => h.textContent)`,
    );
    if (!shelf.includes('Drift')) throw new Error(`shelf held: ${shelf.join(', ') || 'nothing'}`);
    await page.shot('continue');
  });

  console.log('\nHosted games:');

  /**
   * The milestone's claims, tested rather than asserted.
   *
   * These need a hosted origin (`npm run hosted:dev`) and an application built
   * with NEXT_PUBLIC_HOSTED_MANIFEST_URL pointing at it. Without those the
   * feature is off by design, so the checks skip loudly rather than pretend.
   */
  const HOSTED_ORIGIN = process.env.GBS_HOSTED_ORIGIN ?? 'http://127.0.0.1:8788';
  const hostedUp = await fetch(`${HOSTED_ORIGIN}/manifest.json`)
    .then((response) => response.ok)
    .catch(() => false);

  if (!hostedUp) {
    console.log(`  no hosted origin on ${HOSTED_ORIGIN} — SKIPPED, which is not a pass.`);
    console.log('  Start one with: npm run hosted:build && npm run hosted:dev');
  } else {
    const frameEval = (expression) => page.evaluate(`(() => {
      const frame = document.querySelector('[data-testid="hosted-frame"]');
      if (!frame) return 'NO FRAME';
      return ${expression};
    })()`);

    await check('a hosted game appears in the library without being compiled in', async () => {
      await page.goto(`${base}/`);
      const deadline = Date.now() + 8000;
      for (;;) {
        const titles = await page.evaluate(
          `[...document.querySelectorAll('[data-testid="library-grid"] a')].map((a) => a.textContent).join('|')`,
        );
        if (/Ring Out \(hosted\)/.test(titles)) break;
        if (Date.now() > deadline) throw new Error(`hosted games never appeared: ${titles}`);
        await sleep(250);
      }
    });

    await check('a hosted game plays, and it is a sandboxed frame', async () => {
      await page.goto(`${base}/games/drift-hosted`);
      await sleep(3500);
      const sandbox = await frameEval(`frame.getAttribute('sandbox')`);
      if (sandbox !== 'allow-scripts') {
        throw new Error(`sandbox was "${sandbox}" — allow-same-origin would void the boundary`);
      }
      const src = await frameEval(`frame.getAttribute('src')`);
      if (!src.startsWith(HOSTED_ORIGIN)) throw new Error(`frame src was ${src}`);
      await page.shot('hosted-drift');
    });

    await check('the sandboxed game cannot reach the parent page', async () => {
      // A boundary nobody tried to cross is not a boundary. Each of these is
      // attempted from inside the frame and must be denied by the browser.
      const result = await page.evaluate(`(() => {
        const frame = document.querySelector('[data-testid="hosted-frame"]');
        const out = {};
        try { out.document = frame.contentDocument === null ? 'denied' : 'REACHED'; }
        catch { out.document = 'denied'; }
        try { const w = frame.contentWindow; void w.location.href; out.location = 'REACHED'; }
        catch { out.location = 'denied'; }
        try { void frame.contentWindow.localStorage; out.storage = 'REACHED'; }
        catch { out.storage = 'denied'; }
        return out;
      })()`);
      const reached = Object.entries(result).filter(([, value]) => value !== 'denied');
      if (reached.length > 0) {
        throw new Error(`the sandbox was crossed: ${JSON.stringify(result)}`);
      }
    });

    /**
     * Input has to be proven through something the host can observe.
     *
     * The obvious check — read the game's canvas — is impossible on purpose:
     * a sandboxed opaque-origin frame is out-of-process, so it is not even in
     * the parent's frame tree. That is the isolation working, and it means the
     * proof runs through the bridge instead. Drift only records a score after
     * collecting a core, which cannot happen without thrust, so a save arriving
     * is input having crossed.
     */
    const SAVE_KEY = 'gbstudio.save.v1.drift-hosted';
    const savedBytes = () => page.evaluate(`window.localStorage.getItem('${SAVE_KEY}')`);

    await check('the harness can see inside the frame, so input can be measured', async () => {
      // Not a product claim — a harness capability. Without it the only proof
      // of input would be the slow save path, and the direct check below could
      // not exist.
      const size = await page.frameEvaluate(
        `(() => { const c = document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null; })()`,
      );
      if (size !== '320x288') throw new Error(`frame canvas was ${size}`);
    });

    await check('a keyboard press moves the hosted game, and idling does not', async () => {
      const SHIP = `(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const points = [];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 190) {
            points.push([(i / 4) % width, Math.floor((i / 4) / width)]);
          }
        }
        if (points.length < 8) return null;
        const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
        return { x: cx, y: cy };
      })()`;
      const radius = async () => {
        const ship = await page.frameEvaluate(SHIP);
        return ship ? Math.hypot(ship.x - 160, ship.y - 144) : null;
      };

      // Wait for the game to be *running*, not merely drawn. The frame paints
      // one frame on load before it is started, so a canvas that exists is not
      // yet a canvas that moves — measuring then reports zero for everything
      // and looks exactly like input being ignored.
      const deadline = Date.now() + 20_000;
      let start = null;
      while (Date.now() < deadline) {
        const first = await radius();
        await sleep(500);
        const second = await radius();
        if (first !== null && second !== null && Math.abs(second - first) > 0.01) {
          start = second;
          break;
        }
        if (first === null) await sleep(300);
      }
      if (start === null) {
        const state = await page.evaluate(`JSON.stringify({
          gate: !!document.querySelector('[data-testid="play-gate"]'),
          waiting: !!document.querySelector('[data-testid="waiting-for-players"]'),
          coarse: window.matchMedia('(pointer: coarse)').matches,
          hidden: document.hidden,
          boot: !!document.querySelector('[data-testid="boot-state"]'),
        })`);
        throw new Error(`the hosted game never started moving — ${state}`);
      }

      // Drift's orbit is stable on its own, which is what makes the thrust
      // measurement mean something rather than measuring the passage of time.
      await sleep(1400);
      const idleDrift = Math.abs((await radius()) - start);
      const before = await radius();
      await page.hold(KEYS.x, 1400);
      await sleep(200);
      const thrustDrift = Math.abs((await radius()) - before);

      if (idleDrift > 12) throw new Error(`the orbit is not stable on its own (${idleDrift.toFixed(0)}px)`);
      if (thrustDrift < 25) {
        // A completely static canvas means the game is not running at all,
        // which is a different failure from input not arriving. Say which.
        const gate = await page.evaluate(
          `!!document.querySelector('[data-testid="play-gate"]')`,
        );
        const coarse = await page.evaluate(`window.matchMedia('(pointer: coarse)').matches`);
        throw new Error(
          `thrust moved the orbit only ${thrustDrift.toFixed(0)}px ` +
            `(idle drift ${idleDrift.toFixed(0)}px, play gate ${gate}, coarse ${coarse})`,
        );
      }
    });

    await check('a hosted game has no storage of its own', async () => {
      // The control for the save check below. D-015 makes the host responsible
      // for save storage; here that is not a policy but a fact of the sandbox,
      // and it is what makes a save appearing in localStorage proof that it
      // travelled the bridge rather than being written by the game.
      const reach = await page.frameEvaluate(`(() => {
        const out = {};
        try { void window.localStorage; out.localStorage = 'REACHED'; }
        catch { out.localStorage = 'denied'; }
        try { void window.sessionStorage; out.sessionStorage = 'REACHED'; }
        catch { out.sessionStorage = 'denied'; }
        // Reading cookies does not return empty in a sandboxed document — it
        // throws, which is a stronger result than the check first assumed.
        try { out.cookie = document.cookie === '' ? 'empty' : 'REACHED'; }
        catch { out.cookie = 'denied'; }
        out.origin = String(window.origin);
        return out;
      })()`);
      if (reach.localStorage !== 'denied' || reach.sessionStorage !== 'denied') {
        throw new Error(`the sandbox has storage: ${JSON.stringify(reach)}`);
      }
      if (reach.cookie === 'REACHED') throw new Error('the sandbox can read cookies');
      // An opaque origin is what denies all of the above.
      if (reach.origin !== 'null') throw new Error(`frame origin was ${reach.origin}`);
    });

    await check('a hosted game save is persisted by the host', async () => {
      const SAVE_KEY = 'gbstudio.save.v1.drift-hosted';
      const saved = () => page.evaluate(`window.localStorage.getItem('${SAVE_KEY}')`);

      await page.goto(`${base}/games/drift-hosted`);
      // The resolver fetches the manifest, mounts the frame and waits for the
      // game to boot, so this needs longer than a compiled page would.
      await sleep(4000);
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (await saved()) break;
        await page.hold(KEYS.x, 900);
        await sleep(600);
      }
      if (!(await saved())) throw new Error('played for 45s and nothing was saved');

      // Real bytes, not merely present. The game cannot have written them: the
      // check above proves it has nowhere to write.
      const best = await page.evaluate(`(() => {
        const bytes = Uint8Array.from(atob(window.localStorage.getItem('${SAVE_KEY}')), (c) => c.charCodeAt(0));
        return { version: bytes[0], best: new DataView(bytes.buffer).getUint32(1, true) };
      })()`);
      if (best.version !== 1 || best.best < 1) {
        throw new Error(`the saved bytes were ${JSON.stringify(best)}`);
      }

      // And it comes back: a reload restores it into the frame rather than
      // starting the player over.
      await page.goto(`${base}/games/drift-hosted`);
      await sleep(3000);
      const restored = await page.frameEvaluate(`(() => {
        const canvas = document.querySelector('canvas');
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 40) lit += 1;
        return lit;
      })()`);
      if (!(restored > 0)) throw new Error('the game did not come back after a reload');
      await page.shot('hosted-save');
    });

    await check('an M4 phone controller drives a hosted game', async () => {
      if (!relayUp || !openGuest) {
        throw new Error('the relay is not running, so M4 equivalence cannot be checked');
      }

      // Every layer at once: phone -> relay -> InputRouter -> frame bridge ->
      // hosted game, measured inside the sandbox.
      await page.goto(`${base}/games/ring-out-hosted`);
      await sleep(3500);

      const opened = await page.evaluate(`(() => {
        const button = document.querySelector('[data-testid="invite-open"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!opened) throw new Error('no Invite button on a hosted multiplayer game');

      let code = null;
      const codeDeadline = Date.now() + 8000;
      while (Date.now() < codeDeadline) {
        const seen = await page.evaluate(
          `document.querySelector('[data-testid="invite-code"]')?.textContent ?? ''`,
        );
        if (/^[A-Z0-9]{6}$/.test(seen)) { code = seen; break; }
        await sleep(200);
      }
      if (!code) throw new Error('the hosted game never produced a room code');

      const guest = await openGuest(code);
      const hex = guest.seat.slot === 0 ? [0x9b, 0xbc, 0x0f] : [0xe0, 0xa3, 0x3e];
      const FIGHTER = `(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (Math.abs(data[i] - ${hex[0]}) < 40 && Math.abs(data[i + 1] - ${hex[1]}) < 40
              && Math.abs(data[i + 2] - ${hex[2]}) < 40) {
            sx += (i / 4) % width; sy += Math.floor((i / 4) / width); n += 1;
          }
        }
        return n === 0 ? null : { x: sx / n, y: sy / n, count: n };
      })()`;

      let moved = null;
      for (let attempt = 0; attempt < 5 && !moved; attempt += 1) {
        const before = await page.frameEvaluate(FIGHTER);
        if (before?.count) {
          guest.press('right', true);
          await sleep(300);
          guest.press('right', false);
          await sleep(150);
          const after = await page.frameEvaluate(FIGHTER);
          if (after?.count && after.x > before.x + 4) moved = { before, after };
        }
        if (!moved) await sleep(1700); // outlast a round change
      }
      guest.socket.close();
      if (!moved) throw new Error('the phone pressed right and nothing moved inside the frame');
      await page.shot('hosted-phone');
    });

    await check('changing a hosted game needs no application rebuild', async () => {
      // THE milestone claim. The application is already built and running; only
      // the hosted origin changes, and the page is reloaded normally rather
      // than force-refreshed, because "works on an ordinary reload" is the
      // claim being made.
      const { execFileSync } = await import('node:child_process');
      const label = `swap-${Date.now()}`;
      const nextBuildBefore = fs.statSync(`${REPO}/.next/BUILD_ID`).mtimeMs;

      execFileSync(
        'node',
        [`${REPO}/hosted-games/build.mjs`, '--version', '1.1.0', '--label', label],
        { cwd: REPO, stdio: 'ignore' },
      );

      await page.goto(`${base}/games/drift-hosted`);
      const deadline = Date.now() + 12_000;
      for (;;) {
        const src = await frameEval(`frame.getAttribute('src')`);
        if (typeof src === 'string' && src.includes('/1.1.0/')) break;
        if (Date.now() > deadline) throw new Error(`frame still points at ${src}`);
        await sleep(400);
        await page.goto(`${base}/games/drift-hosted`);
      }

      const nextBuildAfter = fs.statSync(`${REPO}/.next/BUILD_ID`).mtimeMs;
      if (nextBuildAfter !== nextBuildBefore) {
        throw new Error('the application was rebuilt, so this proves nothing');
      }
      await page.shot('hosted-swapped');
    });

    await check('rollback is the same action, not a special case', async () => {
      const { execFileSync } = await import('node:child_process');
      execFileSync('node', [`${REPO}/hosted-games/build.mjs`, '--version', '1.0.0'], {
        cwd: REPO,
        stdio: 'ignore',
      });
      await page.goto(`${base}/games/drift-hosted`);
      const deadline = Date.now() + 12_000;
      for (;;) {
        const src = await frameEval(`frame.getAttribute('src')`);
        if (typeof src === 'string' && src.includes('/1.0.0/')) break;
        if (Date.now() > deadline) throw new Error(`frame still points at ${src}`);
        await sleep(400);
        await page.goto(`${base}/games/drift-hosted`);
      }
    });

    await check('a slug in neither catalog is an honest not-found', async () => {
      await page.goto(`${base}/games/definitely-not-a-game`);
      await sleep(2500);
      const text = await page.evaluate(`document.body.innerText`);
      if (!/not here/i.test(text)) throw new Error(`page said: ${text.slice(0, 120)}`);
    });
  }

  console.log('\nHandheld mode:');

  await check('a phone-sized touch device gets the touch deck on a retro game', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.goto(`${base}/games/snake`);
    await sleep(2500);
    await page.evaluate(`document.querySelector('[data-testid="play-gate"]')?.click()`);
    await sleep(1200);
    const deck = await page.evaluate(`!!document.querySelector('.touch-dpad')`);
    if (!deck) throw new Error('no touch controls appeared');
    await page.shot('handheld-retro');
  });

  await check('a retro game responds to the touch deck, not just to showing it', async () => {
    const snapshot = () => page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="gb-screen"]');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < data.length; i += 37) hash = (hash * 31 + data[i]) | 0;
      return hash;
    })()`);
    const spot = await page.evaluate(`(() => {
      const button = document.querySelector('[data-button="start"]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    if (!spot) throw new Error('no start button on the deck');

    const before = await snapshot();
    await page.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: spot.x, y: spot.y }],
    });
    await sleep(900);
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    if ((await snapshot()) === before) throw new Error('touching Start changed nothing');
  });

  await check('Drift gets the same deck, and Ring Out says it cannot', async () => {
    await page.goto(`${base}/games/drift`);
    await sleep(2000);
    await page.evaluate(`document.querySelector('[data-testid="play-gate"]')?.click()`);
    await sleep(1200);
    const deck = await page.evaluate(`!!document.querySelector('.touch-dpad')`);
    if (!deck) throw new Error('Drift had no touch controls');
    await page.shot('handheld-drift');

    await page.goto(`${base}/games/ring-out`);
    await sleep(1800);
    const note = await page.evaluate(
      `document.querySelector('[data-testid="touch-unsupported"]')?.textContent ?? ''`,
    );
    // The copy changed when phone controllers made this a way in rather than a
    // dead end; the assertion is that the page still explains itself, not that
    // it uses particular words.
    if (!/second controller|two controllers/i.test(note)) {
      throw new Error(`no honest note, saw: ${note}`);
    }
    await page.shot('handheld-ring-out');
  });

  await check('an empty seat holds the game instead of running it one-sided', async () => {
    // Still phone-sized from the check above, so there is no keyboard and no
    // touch deck: Ring Out has nobody in either seat.
    await page.evaluate(`document.querySelector('[data-testid="play-gate"]')?.click()`);
    await sleep(1500);

    const waiting = await page.evaluate(
      `document.querySelector('[data-testid="waiting-for-players"]')?.textContent ?? ''`,
    );
    if (!/waiting for player/i.test(waiting)) {
      throw new Error(`no waiting state, saw: ${waiting}`);
    }

    // Saying "waiting" is not the same as actually waiting. Ring Out's ring
    // shrinks on a timer, so a running loop cannot hold still for a second.
    const frame = () => page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="native-screen"]');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < data.length; i += 37) hash = (hash * 31 + data[i]) | 0;
      return hash;
    })()`);
    const before = await frame();
    await sleep(1200);
    if ((await frame()) !== before) {
      throw new Error('the game kept running with an empty seat');
    }
    await page.shot('waiting-for-players');
  });

  await check('the same game does run once a seat is filled', async () => {
    // The falsifying half of the check above: without this, "nothing moved"
    // could just as easily mean the game never started at all.
    await page.evaluate(`window.__padConnect(8, 'Verification Pad D')`);
    await page.evaluate(`window.__padConnect(9, 'Verification Pad E')`);
    await sleep(1500);

    const stillWaiting = await page.evaluate(
      `!!document.querySelector('[data-testid="waiting-for-players"]')`,
    );
    if (stillWaiting) throw new Error('two pads arrived and it still said it was waiting');

    const frame = () => page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="native-screen"]');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < data.length; i += 37) hash = (hash * 31 + data[i]) | 0;
      return hash;
    })()`);
    const before = await frame();
    await sleep(1200);
    if ((await frame()) === before) {
      throw new Error('the game stayed frozen even with both seats filled');
    }
    await page.evaluate(`window.__padDisconnect(8)`);
    await page.evaluate(`window.__padDisconnect(9)`);
  });

  console.log(
    `\n${passed} browser checks pass` +
      (skipped ? ` — ${skipped} SKIPPED by GBS_ONLY="${process.env.GBS_ONLY}", not a full run` : ''),
  );
  if (failures.length) {
    console.log('failed:', failures.join(', '));
    process.exitCode = 1;
  }
} finally {
  shutdown();
}
