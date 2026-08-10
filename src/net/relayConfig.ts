/**
 * Where the room relay lives, and whether it is usable from this page.
 *
 * Read in one place because the host and the guest both need it and had started
 * to disagree about the default.
 *
 * Unset means the feature is simply not offered — no Invite affordance, no
 * connection attempt, every page behaving exactly as it did before M4. That is
 * the honest behaviour for a build with no relay behind it, and it is what
 * keeps D-017's promise that a single-player page never touches the network.
 */

const RAW = (process.env.NEXT_PUBLIC_RELAY_URL ?? '').trim();

export const RELAY_URL = RAW;

/**
 * Whether to offer the feature at all. Deliberately a plain constant rather
 * than a check that reads `window`: it decides what renders, so it has to agree
 * between the server and the client or hydration mismatches. The protocol
 * check below runs when a room is actually opened.
 */
export const relayConfigured = RAW.length > 0;

/**
 * A secure page cannot open an insecure WebSocket — the browser blocks it as
 * mixed content, and the only symptom is an Invite button that appears to do
 * nothing. Worth saying out loud, because the misconfiguration is a one
 * character difference and the failure is silent.
 */
export function relayUrlIsUsable(): boolean {
  if (!RAW) return false;
  if (typeof window === 'undefined') return true;
  if (window.location.protocol !== 'https:') return true;
  if (RAW.startsWith('wss://')) return true;
  console.error(
    `[GameBoyStudio] NEXT_PUBLIC_RELAY_URL is "${RAW}", but this page is served ` +
      'over HTTPS. The browser will block an insecure WebSocket, so inviting a ' +
      'player cannot work. Use a wss:// URL.',
  );
  return false;
}
