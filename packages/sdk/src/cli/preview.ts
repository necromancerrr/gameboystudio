/**
 * The preview host: the smallest thing that can play a hosted game.
 *
 * It implements the host side of the frame protocol — sandboxed iframe, the
 * handshake, lifecycle, keyboard input, saves in localStorage — so a creator
 * can play their game with nothing installed but the SDK.
 *
 * It is not GameBoyStudio and says so on the page. No library, no rooms, no
 * gamepad slot assignment, no touch deck. Those belong to the product, and a
 * preview that imitated them would teach a creator things that are not true.
 */

import type { GameProject } from './project.js';

export function previewHtml(project: GameProject, framePath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${project.title} — preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0e0f0e; color: #e9eae7;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; }
  iframe { border: 0; background: #000; border-radius: 6px; width: min(90vw, 640px); aspect-ratio: 10/9; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  button { background: #161816; color: #9a9e98; border: 1px solid #282b28;
           border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
  button:hover { color: #e9eae7; border-color: #3a3e39; }
  .note { color: #6c706b; font-size: 12px; max-width: 640px; text-align: center; }
  .state { color: #9bbc0f; font-size: 12px; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <div class="state" id="state">connecting…</div>
  <iframe id="game" sandbox="allow-scripts" allow="autoplay; fullscreen; gamepad" src="${framePath}"></iframe>
  <div class="row">
    <button data-verb="start">Start</button>
    <button data-verb="pause">Pause</button>
    <button data-verb="resume">Resume</button>
    <button data-verb="reset">Reset</button>
    <button id="mute">Mute</button>
  </div>
  <p class="note">
    Arrows or WASD to move, X and Z for A and B, Enter for Start, Shift for Select.
    This is a <strong>preview host</strong>, not GameBoyStudio — no library, no rooms,
    no touch deck. Run <code>gbs check</code> before publishing.
  </p>

<script>
(() => {
  const frame = document.getElementById('game');
  const state = document.getElementById('state');
  const SAVE_KEY = 'gbs.preview.save.' + ${JSON.stringify(project.slug)};
  const post = (m) => frame.contentWindow.postMessage(m, '*');
  let muted = false, loaded = false;

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    KeyX: 'a', KeyZ: 'b', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select',
  };
  const down = new Set();

  addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    const m = event.data;
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') {
      if (loaded) return;
      loaded = true;
      state.textContent = 'protocol v' + m.v + ' · ' + m.width + '×' + m.height;
      post({ t: 'load', v: m.v, players: ${project.players.max}, muted });
      post({ t: 'start' });
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) {
        const bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
        post({ t: 'restore', data: bytes });
      }
    }
    if (m.t === 'error') state.textContent = 'the game reported an error';
    if (m.t === 'saveDirty') post({ t: 'readSave' });
    if (m.t === 'save' && m.data) {
      localStorage.setItem(SAVE_KEY, btoa(String.fromCharCode(...m.data)));
    }
  });

  addEventListener('keydown', (event) => {
    const button = KEYS[event.code];
    if (!button || down.has(button)) return;
    down.add(button);
    post({ t: 'input', player: 0, button, pressed: true });
    if (button === 'up' || button === 'down' || button === 'left' || button === 'right') {
      event.preventDefault();
    }
  });
  addEventListener('keyup', (event) => {
    const button = KEYS[event.code];
    if (!button || !down.delete(button)) return;
    post({ t: 'input', player: 0, button, pressed: false });
  });
  // A window that loses focus mid-press must not leave a button held.
  addEventListener('blur', () => {
    for (const button of down) post({ t: 'input', player: 0, button, pressed: false });
    down.clear();
  });

  for (const button of document.querySelectorAll('[data-verb]')) {
    button.addEventListener('click', () => post({ t: button.dataset.verb }));
  }
  document.getElementById('mute').addEventListener('click', (event) => {
    muted = !muted;
    post({ t: 'mute', muted });
    event.target.textContent = muted ? 'Unmute' : 'Mute';
  });
})();
</script>
</body>
</html>
`;
}
