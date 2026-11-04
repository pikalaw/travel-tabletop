# Travel Tabletop

A rules-free Magic: The Gathering playmat that runs as an offline web app (PWA) on phones,
tablets and desktop browsers. Two players share one device, or play on two devices connected
over the same local Wi-Fi network. No internet is needed during play.

Strict TypeScript, built with Vite; Preact for the UI.

> **Being rewritten.** Version 2 (TypeScript + Vite) is in progress on `main`; see
> `docs/implementation-plan.md`. Until it goes live, the site serves nothing. The plain-JavaScript
> version 1 is kept at the git tag `v1`.

## Run it

```sh
npm install
npm run dev          # development server with hot reload
npm run build        # type check, then build into dist/
npm run preview      # serve dist/ at http://localhost:4173/travel-tabletop/, as GitHub Pages will
```

Camera access, the service worker and installing as an app need HTTPS, or `localhost` on the same
machine. On phones and tablets, use the GitHub Pages site: open it once, then Add to Home Screen.
From then on it runs offline. Requirements: a current Safari on iOS / iPadOS, or Chrome on Android.

## Play

1. **Decks.** Two sample decks and a token deck are built in. Import real decks under
   Decks → Import, by pasting a list from Arena, MTGO, Moxfield or Archidekt. Card data and
   images come from Scryfall and are stored on the device. Import needs internet; play does not.
   For a two-device game, import the same decks on both devices.
2. **New game.**
   - **One device:** pick decks for both players. Hands start blinded; tap
     “Unblind to …” to see your hand, and the board turns to that player's side.
   - **Two devices:** one device picks Host, the other picks Join. The host shows a QR code and
     the guest scans it. The guest then shows a code and the host scans that. Pasting the text
     codes works too. Both devices must be on the same Wi-Fi, and the network must let its devices
     reach each other. A phone hotspot works only from a third device: the phone sharing
     the hotspot can't also play, because Android Chrome leaves the tethering network out of
     WebRTC's connection candidates.
3. **Controls.**
   - **Drag** any card anywhere. On a library, drop on the top half for the top, the bottom half
     for the bottom.
   - **Tap** a battlefield or land card to tap or untap it. Tap an overlapped row to open it,
     then swipe it sideways.
   - **Long-press** a card, or right-click it on desktop, for the full-screen view: flip, face
     down, reveal, counters.
   - **Tap a library** for draw, mill, look at the top N, reveal, search and shuffle. Looking at
     or searching any library alerts the other player.
   - **Footer:** undo (reverts the last action, whoever took it), untap all, pass turn, counters
     (drag +1/+1, −1/−1 or a labeled counter onto a card; drag one off to remove it), tokens
     (drag onto a battlefield; drag a token onto the Tokens button to remove it), dice and random
     picks, and point (tap a card to highlight it on both screens).
   - **Player counters:** tap the bottom-left cell. Life is fixed; add poison, energy, commander
     damage and so on.
4. **Log.** Every action is recorded on the host. Menu → Export action log downloads a JSON
   Lines file: a manifest line, then one entry per command, notice, undo and snapshot. The file
   replays to the exact game (see `src/host/replay.ts`).

## Develop

```sh
npm run typecheck    # TypeScript 7 (tsc --noEmit)
npm run lint         # ESLint, including the module-boundary rules
npm test             # Vitest unit and property tests
npm run e2e          # Playwright browser scenarios against a fresh build under vite preview
```

TypeScript 7 does the type check. ESLint's TypeScript parser doesn't support TypeScript 7 yet, so
the `typescript` package is 6.0 (for ESLint) and TypeScript 7 is installed as `typescript-7`.

The browser scenarios can also run against any other server: `E2E_BASE_URL=http://localhost:8771/
npx playwright test`. To check version 1, check out the tag in a worktree
(`git worktree add ../v1 v1`) and serve that folder with `python3 -m http.server 8771`.

Layout (see `docs/technical-design-v2.md`):

| Path | What it is |
| --- | --- |
| `src/types/` | Shared types: state, commands, protocol, storage |
| `src/engine/` | Pure game engine `apply(state, command)` and visibility rules |
| `src/host/` | Command queue, randomness, undo snapshots, action log, replay |
| `src/client/` | Sessions (same-device, host, guest) and the pairing handshake |
| `src/transport/` | WebRTC data channel, pairing codes, QR render and scan |
| `src/storage/` | IndexedDB, Scryfall import, built-in sample cards, backups |
| `src/ui/` | Preact screens, board, gestures, overlays |
| `tests/` | Vitest suites; `tests/fixtures/v1/` holds a game and a backup recorded from version 1 |
| `e2e/` | Playwright browser scenarios |

Dependency rules, enforced by ESLint: `ui → client → host → engine`; `ui`, `host` and `client` may
use `storage`; `client` uses `transport`; everything may use `types`. The engine touches no browser
API, timer or clock.

## Notes

- Sample cards and their art are original placeholders. Imported card images are © Wizards of
  the Coast and served by Scryfall. This is unofficial fan content, not approved or endorsed by
  Wizards of the Coast.
- Both devices receive the full game state, including hidden cards. The interface hides what a
  player should not see, but a modified app could read it. This is fine for play between
  friends.
