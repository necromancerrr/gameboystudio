# M4_RELEASE.md — deploying the relay and testing on a real phone

Everything in M4 is verified headlessly and in Chromium. **No physical phone has
scanned the QR code yet**, and that is the one test that matters before merging.

Two of these steps need a Cloudflare account, so they are yours to run.

---

## 1. Deploy the relay

```bash
npx wrangler login
npm run relay:deploy
```

`worker/wrangler.toml` already carries the production allowlist:

```toml
ALLOWED_ORIGINS = "https://gameboy-jet.vercel.app"
```

Deploy prints the Worker URL, something like
`https://gameboystudio-rooms.<your-subdomain>.workers.dev`.

### Verify the origin gate on the deployed Worker

This is the whole security model, so check it against the running thing rather
than the config file:

```bash
npm run verify:relay -- https://gameboystudio-rooms.<your-subdomain>.workers.dev
```

Expected — and confirmed against a local Worker carrying the production value:

```
  ok   the production site                        101 (wanted 101)
  ok   a Vercel preview deployment                403 (wanted 403)
  ok   someone else entirely                      403 (wanted 403)
  ok   no Origin header (a non-browser client)    403 (wanted 403)
```

If everything returns 101, the allowlist did not apply and the relay is open to
any page on the internet. Do not continue.

### Measure real latency

```bash
npm run measure:latency -- wss://gameboystudio-rooms.<your-subdomain>.workers.dev
```

This sends no `Origin`, so it is refused by the production allowlist. To get a
number, either run it against `npm run relay:dev`, or temporarily add your own
origin. Locally the relay costs about **1ms one way**; the deployed figure is
that plus the trip to the nearest Cloudflare edge, and it is the number the
WebRTC decision depends on.

---

## 2. Point the site at it

In the Vercel project (`gameboy`), add an environment variable:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_RELAY_URL` | `wss://gameboystudio-rooms.<your-subdomain>.workers.dev` |

**`wss://`, not `ws://`.** The site is HTTPS, and a browser blocks an insecure
WebSocket from a secure page. The only symptom would be an Invite button that
appears to do nothing, so the app logs a specific console error for exactly this
mistake rather than failing silently.

It is read at build time, so **redeploy after adding it**. Without it, no Invite
affordance renders at all and every page behaves exactly as it did before M4.

Note: Vercel preview deployments have their own generated origins and are not on
the allowlist, so **rooms only work on the production URL** until you add a
preview origin to `ALLOWED_ORIGINS`.

---

## 3. The real-device test

You need a laptop and one physical phone, **not** on the same Wi-Fi necessarily
— the relay is on the internet, so this works either way.

### Setup

1. On the laptop, open `https://gameboy-jet.vercel.app/games/ring-out`.
2. Wait for the game to appear. Below the screen you should see two seats:
   **P1 Keyboard** and **P2 Keyboard**, both filled — a shared keyboard covers
   both seats, which is the M3 behaviour and should be unchanged.

### Invite

3. Click **Invite a player**.
4. Within a second or so a panel appears with a QR code, a six-character code in
   large spaced type, a **Copy link** button, and the line *"Waiting for someone
   to join"*.
   - The code uses no vowels and no lookalike characters, so it is safe to read
     aloud across a room.
   - *If nothing appears:* open the browser console. A message about
     `NEXT_PUBLIC_RELAY_URL` and HTTPS means step 2 used `ws://`.

### Join from the phone

5. Point the phone's camera at the QR code and open the link.
6. The phone should go straight into controller mode — **no typing**. Expect:
   - a green **P1** badge (or amber **P2**), the title *Ring Out*, and a small
     green connection dot in the header
   - the full control deck filling the rest of the screen: A and B on the left,
     D-pad on the right, Start and Select below
7. On the laptop, the seat panel should now read **P1 Keyboard + Phone**, and
   the invite panel should say *"1 player joined"*.

**The seat number on the phone must match the fighter it controls** — P1 is
green, P2 is amber, the same colours as the badge.

### Play a round

8. With the phone, press right. On the laptop screen, **that player's fighter
   should move right, and the other should not move at all.**
9. Play a full round: shove the other fighter off the platform. The other player
   is whoever is at the laptop keyboard (WASD and H for P2).
10. What to feel for, not just see:
    - presses register on touch-down, not on release
    - sliding a thumb across the D-pad changes direction without a dead moment
    - rolling from A to B works without lifting

### Background and lock the phone — the important one

11. Mid-round, **press and hold a direction on the phone, then immediately lock
    the phone** (side button) while still holding it.
12. On the laptop: the fighter must **stop moving**. A stuck direction here is
    the failure this step exists to catch.
13. Wait about ten seconds.
14. Unlock the phone and return to the controller page.
    - If the socket survived, the connection dot is green and buttons work
      immediately.
    - If it dropped, the page returns to the join screen. **The code is still in
      the URL**, so simply reloading rejoins without retyping it. It may take
      the seat back, or take the other seat if the first was reallocated.
15. Press a direction again and confirm it moves the fighter.

### Close the room

16. On the laptop, click **Close room**.
17. The phone should show *"The game ended."* rather than silently freezing.

---

## What counts as a pass

- [ ] The QR scans first time and lands in controller mode with no typing
- [ ] The phone's seat badge matches the fighter it moves
- [ ] The phone moves only its own fighter
- [ ] A round is playable start to finish
- [ ] Locking the phone mid-press leaves **no** stuck direction
- [ ] Returning to the phone gets control back, by reload if necessary
- [ ] Closing the room tells the phone, rather than leaving it dead

## If something fails

Report which step, and what the phone's header showed (badge colour, connection
dot). The `verify:net` suite covers the disconnect and release paths directly,
so a failure at step 12 would mean the browser or network behaved differently
from the modelled socket close — worth knowing precisely.

## Known, and deliberately not fixed here

Two pre-existing browser-harness failures on macOS, both present on `main` and
untouched by M4: `keyboard input changes what a Game Boy game draws`, and a hang
in `a retro game responds to the touch deck`. Neither involves rooms. They
predate this milestone and were left alone on purpose.
