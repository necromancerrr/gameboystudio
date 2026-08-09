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
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      } else if (data.method) {
        this.events.push(data.method);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
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

let passed = 0;
const failures = [];

async function check(name, body) {
  try {
    await body();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`);
    failures.push(name);
  }
}

const server = spawn('npm', ['run', 'start', '--', '--port', String(PORT)], {
  cwd: REPO,
  stdio: 'ignore',
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

const shutdown = () => {
  server.kill('SIGTERM');
  browser.kill('SIGTERM');
};
process.on('exit', shutdown);

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

  const base = `http://127.0.0.1:${PORT}`;

  console.log('Library:');

  await check('the library lists every game, Originals included', async () => {
    await page.goto(`${base}/`);
    const tiles = await page.evaluate(
      `[...document.querySelectorAll('[data-testid="library-grid"] li h3')].map((h) => h.textContent)`,
    );
    if (tiles.length !== 22) throw new Error(`expected 22 tiles, saw ${tiles.length}`);
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
    if (tiles.join('|') !== 'Drift|Ring Out') throw new Error(`filter showed ${tiles.join(', ')}`);
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

    const at = (name, reading) => {
      if (!reading || !reading.count) throw new Error(`${name} was not on screen`);
      return reading;
    };

    // Short presses on purpose: the floor is slippery and the ring is not
    // wide, so a long hold would just knock the fighter out of the arena.
    const p1Before = at('player one', await green());
    const p2Before = at('player two', await amber());
    await page.hold(KEYS.right, 300);
    const p1After = at('player one', await green());
    const p2After = at('player two', await amber());

    if (!(p1After.x > p1Before.x + 4)) {
      throw new Error(`player one did not move (${p1Before.x.toFixed(0)} -> ${p1After.x.toFixed(0)})`);
    }
    if (Math.abs(p2After.x - p2Before.x) > 2) {
      throw new Error(`player two moved on player one's input (${p2Before.x.toFixed(0)} -> ${p2After.x.toFixed(0)})`);
    }

    await sleep(900); // let the slide settle
    const p2Start = at('player two', await amber());
    await page.hold(KEYS.w, 300);
    const p2End = at('player two', await amber());
    if (!(p2End.y < p2Start.y - 4)) {
      throw new Error(`player two did not respond to W (${p2Start.y.toFixed(0)} -> ${p2End.y.toFixed(0)})`);
    }
    await page.shot('ring-out');
  });

  await check('the couch hint tells you how to get a second player in', async () => {
    const hint = await page.evaluate(
      `document.querySelector('[data-testid="couch-hint"]')?.textContent ?? ''`,
    );
    if (!/two controllers/i.test(hint)) throw new Error(`hint said: ${hint}`);
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
    if (!/two controllers/i.test(note)) throw new Error(`no honest note, saw: ${note}`);
    await page.shot('handheld-ring-out');
  });

  console.log(`\n${passed} browser checks pass`);
  if (failures.length) {
    console.log('failed:', failures.join(', '));
    process.exitCode = 1;
  }
} finally {
  shutdown();
}
