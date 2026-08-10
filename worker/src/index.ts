/**
 * The room relay.
 *
 * This is the project's first server-side component, ratified in D-017 on the
 * promise that it stays ephemeral, payload-blind and impossible to grow into a
 * social backend by accident. It holds no database, issues no identities and
 * remembers nothing after a room empties.
 *
 * All the actual room logic lives in `src/net/RoomServer.ts`, shared with the
 * browser tests, so what runs here is what `npm run verify:net` exercised.
 * This file is the Cloudflare-shaped shell around it: routing, the WebSocket
 * upgrade, and the alarm that eventually sweeps an abandoned room.
 */

import { RoomDurableObject } from './RoomObject';
import { CODE_ALPHABET, CODE_LENGTH, isRoomCode } from '../../src/net/protocol';

export { RoomDurableObject };

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma-separated origins allowed to open rooms. */
  ALLOWED_ORIGINS?: string;
}

/**
 * Codes come from the Worker rather than from the room, because the code IS the
 * room's address: `idFromName(code)` is how a guest's socket reaches the same
 * object as the host's. Generating it inside the room would require knowing the
 * room before you could name it.
 */
function makeCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // Unconfigured means local development; a deployment sets the variable.
  if (allowed.length === 0) return true;
  const origin = request.headers.get('Origin');
  return origin !== null && allowed.includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    if (!originAllowed(request, env)) {
      return new Response('Origin not allowed.', { status: 403 });
    }

    // /host — the screen. A fresh code, and therefore a fresh room.
    if (url.pathname === '/host') {
      const code = makeCode();
      return forward(env, code, request, 'host');
    }

    // /join?code=XXXXXX — a controller looking for that screen.
    if (url.pathname === '/join') {
      const code = url.searchParams.get('code')?.toUpperCase() ?? '';
      if (!isRoomCode(code)) return new Response('Bad room code.', { status: 400 });
      return forward(env, code, request, 'guest');
    }

    return new Response('Not found.', { status: 404 });
  },
};

function forward(env: Env, code: string, request: Request, role: 'host' | 'guest'): Promise<Response> {
  const id = env.ROOMS.idFromName(code);
  const room = env.ROOMS.get(id);
  const forwarded = new URL(request.url);
  forwarded.pathname = '/connect';
  forwarded.searchParams.set('code', code);
  forwarded.searchParams.set('role', role);
  return room.fetch(new Request(forwarded, request));
}
