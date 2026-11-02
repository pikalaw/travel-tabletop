# Travel Tabletop

A rules-free Magic: The Gathering playmat that runs as an offline web app (PWA) on phones,
tablets and desktop browsers. Two players share one device, or play on two devices connected
over a local Wi-Fi network or phone hotspot. No internet is needed during play.

Plain JavaScript ES modules, no bundler, no build step. Preact + htm for the UI.

## Run it

Any static file server works. Camera access, the service worker and installing as an app all
need HTTPS, or `localhost` on the same machine.

```sh
python3 -m http.server 8080        # then open http://localhost:8080
```

### On phones and tablets

A phone loading your laptop's IP over plain HTTP gets no camera or offline mode. Use one of these:

- **Static HTTPS host (simplest).** Push this folder to GitHub Pages (or Netlify, Cloudflare
  Pages), open the URL on each device once, then choose Add to Home Screen. From then on it runs
  offline.
- **Local HTTPS.** `mkcert -install && mkcert 192.168.1.20`, serve with any static server over
  HTTPS, and install mkcert's root certificate on each device.

Requirements: iOS / iPadOS 16.4 or later (for import maps), or a current Chrome on Android.

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
     codes works too. Both devices must be on the same network; a phone hotspot is fine, and
     cellular data can be off.
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
   replays to the exact game (see `src/host/replay.js`).

## Develop

```sh
npm install          # dev tools only: vitest, fast-check, typescript, plus library sources
npm test             # engine, host, protocol, codec and parser tests (property-based included)
npm run typecheck    # tsc --checkJs over the engine, host and codec
npm run sw-list      # REQUIRED before every release: writes the file list + version into sw.js
```

Libraries are vendored as ES modules in `vendor/` and mapped by the import map in
`index.html`. To update one, copy its ES-module build from `node_modules` into `vendor/`.

Layout:

| Path | What it is |
| --- | --- |
| `src/engine/` | Pure game engine `apply(state, command)` and visibility rules |
| `src/host/` | Command queue, randomness, undo snapshots, action log, replay |
| `src/client/` | Sessions (same-device, host, guest) and the pairing handshake |
| `src/transport/` | WebRTC data channel, pairing codes, QR render and scan |
| `src/storage/` | IndexedDB, Scryfall import, built-in sample cards |
| `src/ui/` | Preact + htm screens, board, gestures, overlays |
| `tests/` | Vitest suites |

## Notes

- Sample cards and their art are original placeholders. Imported card images are © Wizards of
  the Coast and served by Scryfall. This is unofficial fan content, not approved or endorsed by
  Wizards of the Coast.
- Both devices receive the full game state, including hidden cards. The interface hides what a
  player should not see, but a modified app could read it. This is fine for play between
  friends.
