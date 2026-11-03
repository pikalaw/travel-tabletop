# MTG Travel Tabletop — Implementation Plan

Oct 30, 2026 · @Lawrence Tsang

## Scope

This plan orders the work in seven milestones, records where each stands, and says how the app is tested and released. Features are defined in the [PRD](./prd.md) and the build is described in the [Technical Design v1](./technical-design-v1.md) (the code today) and the [Technical Design v2](./technical-design-v2.md) (the rewrite); this doc only sequences and verifies them.

The board works on one device first: same-device mode is the first playable version, and networking is layered on afterwards.

**Status (Nov 2, 2026).** Milestones 2–7 are built and deployed at https://pikalaw.github.io/travel-tabletop/. Two things are still open: the networking spike on real devices (Milestone 1), and a live Scryfall import, since every import test so far ran against a mocked Scryfall.

## Phases

Seven milestones in sequence, with four gates. The second gate, a full same-device game, is the first point where the app is usable.

> *Diagram omitted in this export: roadmap · 7 milestones, 4 gates.*

M2 runs alongside M1 because neither depends on the other; every later milestone starts only after the previous one exits.

| Milestone | Status | Exit test |
| --- | --- | --- |
| M1 Networking spike | Open: desktop browsers connect; the phone hotspot with an iPad is untested | Messages flow both ways, in both role assignments, with no internet |
| M2 Layout mock | Done | A card in your own battlefield can be recognised and tapped on a phone in both orientations |
| M3 Engine and single-device board | Done | Engine unit and property tests pass; a scripted command sequence on the board gives the expected state |
| M4 Same-device mode | Done | Two people play a full game on one device, and the log replays to the same final state |
| M5 Decks | Done, except a live Scryfall run | Import real decks, go offline, play a same-device game with them |
| M6 Networked play | Done on desktop browsers | A full networked game on the Android phone and the iPad over a hotspot, including a forced disconnect and resume |
| M7 Library tools and polish | Done | The PRD walkthrough passes on devices |

## Milestone details

Each milestone ends with an exit test; nothing in a later milestone starts until the previous exit test passes, except that M2 can run in parallel with M1.

**M1 — Networking spike**

- [x] Peer connection with no STUN; offer deflated and base64url-encoded; shown as a QR code and as text
- [x] Scan or paste the offer and answer; messages echo both ways over a data channel
- [x] Offer size after deflate and SDP slimming: about 500 characters on desktop Chromium
- [ ] How reliably the QR code scans from a phone screen
- [ ] Run with the Android phone's hotspot and cellular data off, in both role assignments (Android host, iPad host)

If the last item fails, switch the transport to a Capacitor-wrapped native socket behind the same transport interface, and repeat.

**M2 — Layout mock**

- [x] 5×3 grid and footer; rows of unequal height; a wide centre column
- [x] Checked on a phone in portrait; tablet and landscape checked in desktop emulation only
- [x] Project skeleton with no bundler: `index.html` with an import map, vendored Preact + htm, `manifest.json`, `sw.js`, `tools/gen-sw-list.js`, and `tsc` and Vitest wired into npm scripts

**M3 — Engine and single-device board**

- [x] Engine: state shape, `apply` for the full command catalog, invariant passes, visibility
- [x] Host: command queue, randomness, snapshot undo, log entries, saving to IndexedDB
- [x] UI: all zones, drag anywhere, open and collapsed slots, tap and untap, full-screen view (flip, face-down, reveal), counters, tokens, player counters, untap all, undo
- [x] Library basics: draw, mill, shuffle, drop on top or bottom
- [x] Built-in sample decks of generated placeholder cards

**M4 — Same-device mode**

- [x] Blind and unblind with a per-player confirmation, perspective switch, `table` actor, session mode in the log
- [x] Game lifecycle: new game, deal 7, pass turn (with confirmation), concede, rematch, resume, game links

**M5 — Decks**

- [x] Decklist parser, Scryfall lookup and image download in three sizes, images deduplicated by hash, token decks
- [x] Starter pack download (Avatar Beginner Box), duplicate warnings, deck page with full-screen viewer
- [x] Backup and restore files; persistent-storage request and status line
- [x] Card-set check at pairing (replaces a deck fingerprint)
- [ ] One live import against the real Scryfall API

**M6 — Networked play**

- [x] Production transport, pairing by QR and by text, `hello` / `welcome` / `refuse` handshake with version and card checks
- [x] Guest client: commands, rejected commands, read-only while disconnected, reconnection
- [x] Host: stale-command rejection, full-state broadcast, a guest reconnecting mid-game
- [x] Wake lock
- [ ] The same on real devices over a hotspot (see M1)

**M7 — Library tools and polish**

- [x] Peek, reveal top N, search with shuffle on close, look through the other library, top card face-up toggle, alerts to the other player
- [x] Dice and random pick, pointer, ticker and recent actions, opponent hand count
- [x] Log export as JSON Lines
- [x] Added after the original plan: attachments, combat marks, multiple open slots, touch scrolling handled in code, turn label and turn gradient, names coloured by combat role, combat cards in the full view, matchup highlight

## Rewrite to TypeScript + Vite (v2)

The rewrite follows the [Technical Design v2](./technical-design-v2.md); the [Technical Design v1](./technical-design-v1.md) describes the code until v2 ships. The PRD doesn't change. The app isn't in production, so v2 replaces v1's code directly on `main`: no parallel branch, no rollback path, no cross-version pairing.

**No new work on v1.** From R0 on, features go into v2 only; a v1 bug found meanwhile is fixed in the v2 port, not in v1.

| Step | Work | Exit test |
| --- | --- | --- |
| R0 Prepare | Record the v1 regression fixtures (a game log using every command, a backup file). Convert the Python browser scripts to `@playwright/test` specs and run them against **v1** first. Then remove v1's code and set up Vite, strict TypeScript, ESLint, Vitest and a CI workflow that checks but doesn't deploy | Every converted spec passed against v1 before v1 was removed, so the specs are proven before they judge v2 |
| R1 Types and engine | `src/types/`, then `engine.ts` and `view.ts`, with the unit and property suites | All 43 tests pass; the v1 game log replays to the same final state |
| R2 Host, sessions, transport, storage | `host/`, `client/`, `transport/`, `storage/`, with trust-boundary guards | Protocol tests pass; the v1 backup restores |
| R3 UI | Components in TSX, the `UiState` reducer, gestures, dialogs, the stylesheet | Every browser spec passes against v2 |
| R4 Offline and deploy | `src/sw.ts`, the PWA plugin, the update prompt, the deploy workflow; switch the Pages source to GitHub Actions | The offline and update specs pass; the site serves v2 |
| R5 Devices | Update the installed app on the Android phone and the iPad, then run the device checklist | Each device took the update with its decks and saved games intact; checklist ticked |

**Before R4:** decide whether v2 adds the in-game **Update** item and the "Ready to play offline" toast (listed in the v2 design's open decisions); if yes, the PRD gets those two lines.

## Test strategy

Most correctness is tested on the pure engine without a browser; real devices are reserved for what only they can show.

| Layer | Tool | What it checks | When it runs |
| --- | --- | --- | --- |
| Engine unit | Vitest | Each command's effect and rejection cases; visibility for every zone and flag; attachments; combat marks and sides | Every commit (`npm test`) |
| Engine property | fast-check | Random sequences of every command, including attach, block and undo: card conservation and all invariants; undo restores the prior state exactly; replaying the log reproduces the final state; no hand faces leak to the non-owner; snapshot cap | Every commit |
| Protocol | Vitest with an in-memory transport | Guest commands apply with the guest as actor; stale commands are rejected and reported; notices reach the other side; pairing codec round-trip; decklist parser; SHA-256 fallback; list signature; game ids and links | Every commit |
| Types | `tsc -p jsconfig.json` | JSDoc types against `src/types.d.ts` | Every commit (`npm run typecheck`) |
| Browser | Playwright (Python), headless Chromium, phone-sized viewports, mouse and emulated touch | The scenarios below | Before each release |
| Device checklist | Manual | The list below | Each milestone exit on devices |

The unit suites are 43 tests in `tests/engine.test.js`, `tests/net.test.js` and `tests/link.test.js`. The browser scenarios are scripts kept outside the repo so far. Each serves the app over local HTTP, mocks Scryfall where it imports, and prints the values it checks:

- **Smoke:** start a game, unblind with the confirmation, drag cards, create and remove tokens, change life.
- **Two devices:** two browser contexts paired by text codes, with guest commands, a peek alert, pointing, undo and dice. Reconnecting, resume after reload, persisted snapshots and log export.
- **Reveal:** on one device and on two.
- **Decks:** import with mocked Scryfall (collection calls, three images per face, token deck); starter-pack download; duplicate warning; requiring a deck per player; image size choice; plain-HTTP SHA-256 fallback.
- **Backup:** export, restore, duplicate statuses, a damaged file.
- **Offline:** the page is controlled by the service worker and a game starts with the network cut.
- **Touch:** footer and open-row scrolling, fling, swallowed click after a pan, card drag still works.
- **Attachments:** attach from hand, onto a strip, group viewer, fan out, detach, host moves and leaves play, undo.
- **Counters:** removal by drag on the board and in the full view (mouse and touch); − and + buttons.
- **Dialogs:** every in-app dialog (pass turn, end combat, concede, labeled counter, counter value, delete game, rename and delete deck, duplicate import) with OK, Cancel, a backdrop tap, Enter and Escape; no browser dialog opens.
- **Full view and matchup:** combat cards in the thumbnail row (attacker and blocker views), marks and counters below the card in both orientations, matchup highlight and clearing it, dropping a card on the opponent's hand count.
- **Combat:** marking in combat mode, tags, marks on tapped cards, several open slots, End combat, Pass turn confirmation, side enforcement, the Attack tag only for the active player.
- **Labels:** turn label and order, hand label, opponent hand count, turn gradient, TAP TO CLOSE.
- **Game links:** same device, another device, a finished game, a malformed link, a link changed mid-game.

**Device checklist** (Android phone + iPad)

- [ ] QR pairing over the phone's hotspot with cellular data off, both role assignments
- [ ] Gestures: open a collapsed slot, swipe, tap and untap, long-press, drag a card, drag a counter
- [ ] All four layouts (phone and tablet, portrait and landscape); rotating mid-game
- [ ] Screen stays on for 10 minutes idle in a game
- [ ] Background the guest app for 1 minute, return, reconnect; same for the host
- [ ] Close the host app fully, reopen, resume the game
- [ ] Installed app launches and plays in airplane mode
- [ ] Same-device: blind and unblind with perspective switch, and peek blocked while blinded

So far the Pixel has been used for same-device play in Chrome (scrolling, counters, combat, labels), with fixes made from what it showed; the checklist above has not been run end to end.

**PRD walkthrough.** Before M7 exits on devices, walk every PRD section on devices and tick each behaviour. Any mismatch is either fixed in code or corrected in the PRD.

## Release

1. `npm test` and `npm run typecheck`.
2. Run the browser scenarios against a local server.
3. `node tools/gen-sw-list.js`, which rewrites the file list and version in `sw.js`. Never skip it: a stale list leaves devices on the old app, and a list naming a deleted file breaks the offline install.
4. Commit and push to `main` of github.com/pikalaw/travel-tabletop; GitHub Pages serves the repository root.
5. On a device, open the app online, leave any game, and tap Update now (or reopen the app). The home screen footer shows the build.

## Dev environment

Develop in a desktop browser; move to devices only for networking, touch feel and mobile platform behaviour.

**On desktop**

- `npm install` once (dev tools only; the vendored files are already in `vendor/`), then serve the folder over HTTP, e.g. `python3 -m http.server 8080`.
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

**Serving to phones.** Camera access, service workers and PWA install need HTTPS; `localhost` is exempt on desktop, but a phone loading the laptop's IP over plain HTTP is not. On plain HTTP the app still runs (the SHA-256 fallback covers missing Web Crypto), but it won't install or work offline. Use one of:

- the GitHub Pages deployment (the current setup); install once per device, then test and play offline; or
- any static file server over HTTPS (for example `npx http-server -S`) with a locally trusted certificate from mkcert, installed as trusted on each device. A laptop firewall that blocks incoming connections rules this out, which is why Pages is used.
