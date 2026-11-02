# MTG Travel Tabletop — Implementation Plan

Oct 30, 2026 · @Lawrence Tsang

## Scope

This plan orders the work in seven milestones, each with a demoable result and an exit test. The networking spike comes first because its outcome finalizes the transport section of the design. Features are defined in the [PRD](./prd.md) and the build is described in the [technical design](./technical-design.md); this doc only sequences and verifies them.

The board works on one device first: same-device mode is the first playable version, and networking is layered on afterwards.

## Phases

Seven milestones in sequence, with four gates. The second gate, a full same-device game, is the first point where the app is usable.

> *Diagram omitted in this export: roadmap · 7 milestones, 4 gates.*

M2 runs alongside M1 because neither depends on the other; every later milestone starts only after the previous one exits.

## Milestone details

Each milestone ends with an exit test; nothing in a later milestone starts until the previous exit test passes, except that M2 can run in parallel with M1.

**M1 — Networking spike** (throwaway code)

- [ ] Bare page: create a peer connection with no STUN, deflate and base64-encode the offer, show it as a QR code and as text
- [ ] Scan or paste the offer and answer; echo messages both ways over a data channel
- [ ] Record the offer size after deflate, and how reliably a QR code scans from a phone screen
- [ ] Run with the Android phone's hotspot and cellular data off, both role assignments (Android host, iPad host)

* Exit: messages flow both ways in both role assignments with no internet. Otherwise, switch the design's transport to Capacitor and repeat with native sockets.

**M2 — Layout mock**

- [ ] Static 5×3 grid and footer with placeholder card images, rows of unequal height, and a wide center column
- [ ] Check on a phone and the iPad, portrait and landscape: card size, tap target size

* [ ] Project skeleton with no bundler: `index.html` with an import map, vendored Preact + htm, `manifest.json`, `sw.js`, `tools/gen-sw-list.js`, and `tsc --checkJs` and Vitest wired into npm scripts

- Exit: a card in your own battlefield can be recognized and tapped reliably on the phone in both orientations.

**M3 — Engine and single-device board**

- [ ] Engine: state types, `apply` for the full command catalog, invariants, `viewFor`
- [ ] Host: command queue, randomness, snapshot undo, log entries, saving to IndexedDB
- [ ] UI: all zones, drag anywhere, open and collapsed slots, tap and untap, full-screen view (flip, face-down, reveal), counters, tokens, player counters, untap all, undo
- [ ] Library basics: draw, mill, shuffle, drop on top or bottom
- [ ] A built-in fixture deck of generated placeholder cards, so no import is needed yet

* Exit: all engine unit and property tests pass, and a scripted 20-command sequence on the board matches the expected state.

**M4 — Same-device mode (first playable)**

- [ ] Blind my hand, unblind to a player, perspective switch, `table` actor, session mode in the log
- [ ] Game lifecycle: new game, deal 7, pass turn, concede, rematch, resume

* Exit: two people play a full game on one device with the fixture decks, and the log replays to the same final state.

**M5 — Decks**

- [ ] Decklist parser, Scryfall lookup and image download, image storage deduplicated by hash, token deck
- [ ] Deck list and deck picker screens; reporting unresolved lines
- [ ] Deck fingerprint

* Exit: import two real 60-card decks and a Commander deck, go offline, and play a same-device game with them.

**M6 — Networked play**

- [ ] Production `Transport` from M1 (or Capacitor), pairing by QR and by text, `hello` / `welcome` / `refuse` handshake with version and deck check
- [ ] Guest client: commands, handling of rejected commands, read-only while disconnected, reconnection
- [ ] Host: rejection of stale commands, full-state broadcast, a guest reconnecting mid-game
- [ ] Wake lock

* Exit: a full networked game on the Android phone and the iPad over a hotspot, including one forced disconnect and resume.

**M7 — Library tools and polish**

- [ ] Peek, reveal top N, search with shuffle on close, top card face-up toggle, alerts to the other player
- [ ] Randomness tools (coin, die, random pick), pointer, latest-action ticker, opponent hand count
- [ ] Log export as JSON Lines

* Exit: the PRD walkthrough checklist passes on devices (see Test strategy).

## Test strategy

Most correctness is tested on the pure engine without a browser; real devices are reserved for what only they can show.

| Layer | Tool | What it checks | When it runs |
| --- | --- | --- | --- |
| Engine unit | Vitest | Each command's effect and rejection cases; `viewFor` visibility for every zone and flag | Every commit |
| Engine property | fast-check | Random command sequences: card conservation (each card in exactly one zone), undo restores the prior state exactly, replaying the log reproduces the final state, no face leaks in `viewFor` for the non-owner | Every commit |
| Host | Vitest | Queue order, stale rejection, randomness filled only by the host, snapshot cap, one save per command | Every commit |
| Protocol | Vitest with an in-memory transport | Handshake, refusal on version or deck mismatch, reconnect with `gameId`, chunking of large messages | Every commit, from M6 |
| End-to-end | Playwright, two browser contexts | Host and guest over a real WebRTC connection on one machine, with text pairing; a scripted game; disconnect and resume | Before each milestone exit, from M6 |
| Device checklist | Manual | Everything in the next list | Each milestone exit on devices |

**Device checklist** (Android phone + iPad)

- [ ] QR pairing over the phone's hotspot with cellular data off, both role assignments
- [ ] Gestures: open a collapsed slot, swipe, tap and untap, long-press, drag a card, drag a counter
- [ ] All four layouts (phone and tablet, portrait and landscape); rotating mid-game
- [ ] Screen stays on for 10 minutes idle in a game
- [ ] Background the guest app for 1 minute, return, reconnect; same for the host
- [ ] Close the host app fully, reopen, resume the game
- [ ] Installed app launches and plays in airplane mode
- [ ] Same-device: blind and unblind with perspective switch, and peek blocked while blinded

**PRD walkthrough.** Before M7 exits, walk every PRD section on devices and tick each behavior. Any mismatch is either fixed in code or corrected in the PRD.

## Dev environment

Develop in a desktop browser; move to devices only for networking, touch feel and mobile platform behavior.

**On desktop**

- Same-device mode in one window.
- Networked mode in two windows (host and guest) over a real WebRTC connection on one machine, paired by pasted text.
- Layouts in Chrome DevTools device mode or Safari Responsive Design Mode, both orientations.

| Area | Desktop browser | Needs real devices |
| --- | --- | --- |
| Board, zones, drags, counters, tokens | Yes | Touch feel only |
| Same-device mode | Yes | — |
| Host and guest sync, undo, stale commands | Yes (two windows, text pairing) | — |
| QR pairing by camera | — | Yes |
| iPad Safari over a phone hotspot | — | Yes (M1) |
| Long-press timing, swipe vs. drag, tap targets | Emulated only | Yes |
| Wake lock, page suspension, PWA install on iOS | — | Yes |

**Serving to phones.** Camera access, service workers and PWA install need HTTPS. `localhost` is exempt on desktop; a phone loading the laptop's IP over plain HTTP is not. Use one of:

- any static file server over HTTPS (for example `npx http-server -S`) with a locally trusted certificate from mkcert, installed as trusted on each device, or
- deploy builds to an HTTPS static host such as GitHub Pages, install once per device, then test and play offline.
