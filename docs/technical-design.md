# MTG Travel Tabletop — Technical Design

Oct 30, 2026 · @Lawrence Tsang

## Scope

This doc describes how the app is built: components, stack, schemas and protocols. What the app does lives in the [PRD](./prd.md); phasing and testing live in the implementation plan. Each fact lives in one doc; this one links to the PRD instead of restating requirements.

**Governing constraint: the engine is pure.** All game logic is a function `apply(state, command) → { state, events }` with no I/O, clock or randomness of its own. This one rule makes undo, replay, logging, same-device mode and most testing cheap.

The transport section is provisional until the Milestone 1 networking spike.

## Architecture

One pure engine runs only on the host; both devices share the same UI and client code, and the guest differs only in sending commands over a transport instead of calling the host directly.

> *Diagram omitted in this export: components on the guest and host devices.*

Commands flow toward the host, which applies them in order through the engine, saves state, and sends the full state back to every client.

| Module | Owns | Depends on |
| --- | --- | --- |
| `engine/` | State types, `apply`, invariants, `viewFor` | nothing |
| `host/` | Command queue, randomness, snapshots, persistence calls, log writing | engine, storage |
| `transport/` | `Transport` interface, WebRTC implementation, pairing codecs | nothing app-specific |
| `client/` | Latest state, local view state, command dispatch, reject handling | engine (types and `viewFor`) |
| `ui/` | Preact + htm components, Pointer Events gesture handling, footer contexts | client |
| `storage/` | IndexedDB schema, deck import, fingerprint | nothing app-specific |

## Tech stack

Plain JavaScript ES modules, loaded natively by the browser with no bundler or compile step, installed as an offline PWA. Libraries are vendored as ES-module files; types are checked, not compiled.

| Concern | Choice | Why |
| --- | --- | --- |
| Language | Plain JavaScript (ES modules) | Runs as written; no build step |
| Types | JSDoc annotations plus a `types.d.ts` for the schema, checked by `tsc --checkJs --noEmit` | Typed schema and commands without compiling |
| Module loading | Native `<script type="module">` + an import map | Bare imports without a bundler (import maps need Safari 16.4+, from memory) |
| UI | Preact + `htm` (tagged templates, no JSX) | Component model in about 4 KB, no compile |
| Drag and drop | Hand-written, on Pointer Events | dnd-kit is React-only; custom code gives exact control over long-press, swipe and drag thresholds |
| Client state | A small store module (subscribe / notify) | Holds the latest state and local view state; no library needed |
| Offline and install | Hand-written `sw.js` + `manifest.json` | Cache-first service worker over a generated file list |
| Storage | `idb` (small ES-module IndexedDB wrapper) | Promise API over IndexedDB; stores images as Blobs |
| Peer connection | Native `RTCPeerConnection` data channel | No library needed |
| QR generate / scan | Vendored ES-module builds of a QR encoder and decoder (e.g. `qrcode`, `jsQR`), with a small wrapper if a library ships no ES-module build | iOS Safari offers no native BarcodeDetector, as far as I know |
| Compression for pairing | `Vendored fflate (synchronous, identical on every browser)` | Keeps offers small enough for a QR code |
| Hashing | Web Crypto SHA-256 | Deck fingerprints (needs HTTPS or localhost) |
| Tests | Vitest, fast-check, Playwright (dev-only, via npm) | Test tools never ship; they run against the same plain modules |
| Native fallback | Capacitor (only if Milestone 1 fails) | Wraps the same files; still no bundler needed |

**Files and release**

```
index.html        manifest.json        sw.js        importmap (inline in index.html)
src/engine/  src/host/  src/transport/  src/client/  src/ui/  src/storage/
vendor/           preact, htm, idb, qrcode, jsqr, fflate (ES-module builds)
assets/           icons, default card back
tools/gen-sw-list.js   writes the cache list + version into sw.js
```

- **Cache list.** `tools/gen-sw-list.js` walks the shipped files and writes their paths and a content-hash version into `sw.js`. Run it before every release. A stale version string leaves devices on the old app, so this step is part of release, not optional.
- **Updates.** The service worker installs the new version in the background. The app shows "update ready" and applies it only between games, never mid-game.
- **Dev tooling** (npm: tsc, Vitest, fast-check, Playwright) lives in `package.json` devDependencies and is never served.

## State schema

One serializable `GameState` object holds everything; zones are ordered arrays of card ids, and card instances hold everything else about a card.

```typescript
type PlayerId = 'p1' | 'p2';
type ZoneKind = 'library' | 'hand' | 'battlefield' | 'lands' | 'graveyard' | 'exile' | 'command';
type ZoneId = `${PlayerId}.${ZoneKind}` | 'stack';

interface CardInstance {
  id: string;                 // unique per game
  defId: string;              // card definition: front/back image refs, name
  deckId: string | null;      // null for tokens
  owner: PlayerId;            // player who selected the deck, or creator of a token
  isToken: boolean;
  tapped: boolean;
  face: 'front' | 'back';     // flip
  faceDown: boolean;          // hidden from non-owner
  revealed: boolean;          // owner showed it from a private zone
  attachedTo?: string;        // card it is attached to (same battlefield zone, one level)
  counters: { plus: number; minus: number; labeled: Record<string, number> };
}

interface PlayerState {
  name: string;
  counters: { key: string; value: number }[];  // 'life' is always index 0
  libraryTopFaceUp: boolean;
}

interface GameState {
  schemaVersion: number;
  gameId: string;
  mode: 'networked' | 'same-device';
  seq: number;                // last applied command number
  turn: number;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  zones: Record<ZoneId, string[]>;  // index 0 = top of a pile / left of a row
  result: null | { winner: PlayerId | null; reason: 'concede' | 'ended' };
}
```

These declarations live in `src/types.d.ts`. They are used only by `tsc --checkJs`; the shipped JavaScript references them through JSDoc `@typedef {import('./types').GameState}` comments.

- **Invariant:** every card id appears in exactly one zone; every zone entry exists in `cards`. Property tests check this after every command.
- **Counters:** +1/+1 and −1/−1 are stored separately and never cancelled automatically, because the app does not apply rules.
- **Not in state:** view and blind status, open or collapsed slots, and the peek tray. These are local UI state per device.
- **Card definitions** (images, names) live in storage, not in the game state; the state carries only `defId`.

**Attachments.** `attachedTo` links a card to its host. After every command the engine's `fixAttachments` pass restores four rules:

- An attachment sits in its host's zone, and that zone is a battlefield or lands zone. Otherwise the link is dropped, which is how a host leaving play frees its attachments where they lie.
- Hosts are never attached themselves: attaching to an attached card targets its host.
- A host's attachments come immediately before it in the zone array, so DOM order matches the drawn left-to-right order (strips peek out to the host's left).
- A card dropped inside a group lands before the group.

`move` of a host to a battlefield or lands zone carries its attachments as a block; `toIndex` is counted without them, and the client's drop index skips them too. `move` of an attached card detaches it. Attach and detach are ordinary commands, so undo, the log, replay and sync need nothing new. `checkInvariants` checks all of this, and the property tests now generate attach and detach.

**Game links** (`src/ui/link.js`). `newGameId()` is the ISO date plus 16 Crockford base32 characters from `crypto.getRandomValues` (80 bits; it works on plain-HTTP pages, unlike `crypto.subtle`). The game screen keeps `#game=<id>` in the address bar with `history.replaceState`, and clears it on leaving. At startup and on `hashchange`, the app looks the id up in the `games` store and resumes it, opens the guest reconnect flow when it matches the stored `guestGame`, or shows that the game isn't on this device. During a game, a changed hash is put back. The service worker's `controllerchange` reload only happens when a controller already existed, so the first install doesn't reload away the link or the message.

## Commands and engine rules

Every state change is a command applied by the host through the pure engine; notices are logged events that change nothing.

**Envelope**

```typescript
interface Command<T extends string, P> {
  type: T;
  actor: PlayerId | 'table';
  clientSeq: number;      // sender's counter, for matching rejections
  payload: P;
  random?: number[];      // filled in by the host before apply, never by clients
}
```

**Catalog**

| Command | Payload | Precondition (else rejected) |
| --- | --- | --- |
| `move` | cardId, from, to, toIndex | card is in `from` |
| `tap` / `untap` | cardId, from | card is in `from` |
| `untapAll` | player | — |
| `flip` | cardId, from | card is in `from` |
| `setFaceDown` | cardId, from, value | card is in `from` |
| `reveal` | cardId, from | card is in `from` |
| `addCounter` / `removeCounter` | cardId, kind (plus, minus, or label) | card exists; count above 0 to remove |
| `createToken` | defId, to, toIndex | — |
| `draw` / `mill` | player, n | library is not empty (moves as many as exist) |
| `revealTop` | player, n | — |
| `shuffle` | zone | — (host supplies the permutation) |
| `setLibraryTopFaceUp` | player, value | — |
| `setPlayerCounter` | player, key, value | — |
| `addPlayerCounter` / `removePlayerCounter` | player, key | `life` cannot be removed |
| `coinFlip` / `rollDie` | sides | — (host supplies the result) |
| `randomPick` | zone | zone is not empty (host supplies the index) |
| `passTurn` | player | — (untaps that player's permanents and increments `turn`) |
| `startGame` | decks per player, starting life | — (host supplies the shuffles; deals 7) |
| `concede` | player | game not over |
| `undo` | — | a snapshot exists |
| `attach` | cardId, from, toCardId, toZone | card is in from; target is in toZone, a battlefield or lands zone; not itself |
| `detach` | cardId, from | card is in from and attached |

**Notices** (logged, broadcast, not state): `peek` (player, n), `searchOpen`, `searchClose`, `point` (target card or zone), showCard (a hand card revealed once; the opponent's device shows it full screen; replaces the lasting `reveal` flag in the UI), and `inspectLibrary`. A `searchClose` is followed by a host-issued `shuffle`.

**Rules**

1. **Stale commands.** Any command naming a card also names the zone the sender saw it in. If the card is elsewhere, the host rejects the command; the client re-renders from current state, so the card snaps back.
2. **Randomness.** The host fills `random` with `crypto.getRandomValues` output before applying; the engine reads only `random`. The log stores the filled command, so replaying the log reproduces the game exactly.
3. **Undo.** Before applying each command, the host pushes the prior state onto a snapshot stack. `undo` pops it and becomes the new state. The undo command and the command it reverted are both logged. The stack is capped at 100 snapshots; that cap is my choice, not a PRD requirement.
4. **Ordering.** The host has one command queue, applied strictly in arrival order. Its own UI's commands enter the same queue.

## Views

The UI never renders `GameState` directly; it renders `viewFor(state, perspective, viewer)`, a pure function that maps zones to grid cells and decides which card faces each viewer may see.

```typescript
type Viewer = PlayerId | 'nobody';   // 'nobody' = same-device mode, hands blinded
function viewFor(state: GameState, perspective: PlayerId, viewer: Viewer): BoardView;
```

- **Perspective** decides layout: the perspective player's zones fill rows 3–5, the other player's fill rows 1–2, and the stack sits at (5,3).
- **Viewer** decides visibility. A face is shown when the card is in a public zone and not face-down, or when the viewer owns a card in their own hand, or a face-down card, or the card is revealed. Libraries show backs except the top card when `libraryTopFaceUp` is set.
- **Networked mode:** perspective = viewer = the device's player.
- **Same-device mode:** unblinding sets both perspective and viewer to that player. Blinding sets viewer to `'nobody'` and keeps the perspective. The actor for commands is the viewer, or `'table'` when the viewer is `'nobody'`.
- **Peek and search trays** read the library from local state and render only when viewer = that library's owner, or the inspecting player in networked mode.
- Visibility is enforced only in the view. Both devices hold the full state, which the PRD accepts.

**Unblind codes** (`src/client/lock.js`). At setup, each player's 4-digit code is hashed as SHA-256 of `salt:player:code` with a random per-game salt; only `pins` and `pinSalt` are stored, on the game record, so resume and rematch keep them. Unblind checks the hash before changing the viewer. A reset verifies the other player's code, replaces the hash, and saves the record at once. With 10,000 possible codes and the hashes on the device, this deters a casual peek; it does not stop someone who opens the browser's storage.

## Transport, pairing and protocol

Host and guest exchange JSON messages over one reliable, ordered WebRTC data channel; pairing exchanges one offer and one answer by QR code or pasted text. Provisional until Milestone 1.

**Transport interface.** The rest of the app sees only this, so a Capacitor socket transport can replace WebRTC without touching the engine or UI:

```typescript
interface Transport {
  send(msg: Message): void;
  onMessage(fn: (msg: Message) => void): void;
  onStatus(fn: (s: 'connecting' | 'open' | 'lost') => void): void;
  close(): void;
}
```

Same-device mode uses no transport; the UI calls the host directly.

**Pairing**

1. Host creates an `RTCPeerConnection` with no STUN or TURN servers and a data channel, creates an offer, and waits for ICE gathering to finish (no trickle), so one blob holds everything.
2. Host deflates the SDP, base64url-encodes it, and shows it as a QR code and as copyable text.
3. Guest requests the camera (which also unlocks local ICE candidates on Safari), scans or pastes the offer, creates an answer the same way, and shows it.
4. Host scans or pastes the answer. The data channel opens and the handshake begins.

**Messages**

| Type | Direction | Contents |
| --- | --- | --- |
| `hello` | guest → host | protocolVersion, appVersion, deckFingerprint, playerName, gameId (if reconnecting) |
| `welcome` | host → guest | assigned player, full state, recent log |
| `refuse` | host → guest | reason: version or deck mismatch, with details |
| `command` | guest → host | a command envelope |
| `state` | host → guest | seq, full state, the event just applied |
| `rejected` | host → guest | clientSeq, reason (stale or invalid) |
| `notice` | both ways | peek, search, point, inspect |
| `ping` / `pong` | both ways | every 2 s; 3 missed = connection lost |

- **Full state on every change** is the simplest design. A game state should be tens of KB, which a local link carries easily. Chunk any message over 64 KB, since data-channel message size limits vary by browser; I have not checked current limits.
- **Reconnect:** the guest goes read-only on `lost`. Pairing runs again, and the guest's `hello` carries the `gameId`; the host answers with `welcome` and the current state.

## Persistence, deck import and fingerprint

Everything lives in one IndexedDB database. Images are stored once by content hash, and the host writes the game after every command.

| Store | Key | Contents |
| --- | --- | --- |
| `images` | SHA-256 of bytes | Blob (shared card backs stored once) |
| `cardDefs` | defId | name, front and back image hashes at normal size, `sizes` holding the small and large hashes per face, Scryfall id |
| `decks` | deckId | name, ordered defIds (with repeats), kind: normal or token |
| `games` | gameId | current state, snapshot stack, mode, players, updatedAt |
| `logs` | gameId + seq | one log entry per row (see Action log) |

**Deck import** (online only)

1. Parse the pasted list: one line per entry, `<count> <name> [(<set>) <number>]`.
2. Resolve the cards in batches through Scryfall's card-collection endpoint. Double-faced cards take both face images; single-faced cards get the shared default back.
3. Download each face in three sizes (small 146×204, normal 488×680, large 672×936), hash it, and store it in `images` if new. Then write `cardDefs` and the deck.
4. Report unresolved lines to the user rather than failing the whole import.

**Choosing a size.** A card drawn h CSS pixels tall on a screen with device pixel ratio r needs about h × r image pixels. The UI uses small up to 230 px, normal up to 720 px, and large above that; the full-screen view always uses large. The defId derives from the normal images only, so a card imported with sizes matches one imported earlier without them, and missing sizes fall back to normal. Sample cards are SVG and use one image for every size.

**Reuse and starter packs.** Before downloading, the importer checks stored definitions by Scryfall id and reuses any that already have all three sizes, so a card shared by several decks downloads once. Starter packs (`src/storage/starters.js`) are built-in decklist text run through the same importer; each resulting deck records a `starterId`, so the Decks screen downloads only the ones missing. Beginner Box lines carry `(TLA)` to prefer the Avatar printing, and fall back to a name-only match.

**Token import.** After a deck's cards resolve, the importer collects every `all_parts` entry with `component: "token"`, looks those cards up by Scryfall id through the collection endpoint, and stores them like any card. They go into a token deck: `<deck>-tokens` by default, or a shared id passed by the caller (the Beginner Box uses `tla-bb-tokens`), merged without duplicates. Token decks record `forDecks`, the decks whose cards create them; the in-game picker uses it to list this game's tokens first. The data is used only to find images; no token rules are applied.

**Backup file** (`src/storage/backup.js`). A zip (extension `.mtgdecks`) built with fflate: `manifest.json` holds `format: "travel-tabletop-decks"`, `version: 1`, `exportedAt`, the decks, their card definitions, and an image-extension map; `images/<sha256>.<ext>` holds each image, stored without recompression. Token decks whose `forDecks` include a chosen deck are added automatically. Restore checks each image against its file name's hash, skips cards with a bad image, imports decks whose id already exists as renamed copies, and remaps `forDecks`. A newer `version` is refused. The file picker accepts any file, since iOS may not recognise the extension. Files are handed to the user through the share sheet on touch devices (`navigator.share`), otherwise as a download.

**Persistence.** `navigator.storage.persist()` is requested after any deck is added; `persisted()` and `estimate()` feed the status line on the Decks screen.

Follow Scryfall's published rate-limit and usage guidance; its current terms have not been reviewed.

**Deck fingerprint** replaced in the build by a card-set check: a defId is derived from the card's name and image hashes, so identical imports produce identical ids on both devices. The guest's hello lists its cards; the host refuses if it lacks any. The welcome carries the game state; the guest refuses if it lacks any. Errors name the missing cards, which a single hash could not.

**Snapshots.** Kept in memory and saved with the game. At a few tens of KB each, a 100-deep stack is a few MB; that's an estimate, not measured.

**Writes.** One IndexedDB transaction per command (state + snapshot + log entry) before the host sends `state`, so a host crash never loses a move the guest has already seen.

## Action log

The log is the stream of commands the host actually applied (randomness filled in), plus notices, rejections and snapshots. Replaying it from `startGame` reproduces the game exactly.

```typescript
interface LogEntry {
  gameId: string;
  seq: number;
  ts: string;                       // ISO 8601
  mode: 'networked' | 'same-device';
  turn: number;
  kind: 'command' | 'notice' | 'rejected' | 'undo' | 'snapshot';
  actor: PlayerId | 'table' | 'host';
  command?: Command<string, unknown>;   // as applied, incl. random
  cards?: { id: string; defId: string; name: string;
            from?: ZoneId; to?: ZoneId; toIndex?: number;
            visibleTo: { before: PlayerId[]; after: PlayerId[] } }[];
  undoneSeq?: number;
  state?: GameState;                // kind = 'snapshot' only
}
```

- A `snapshot` entry is written at `startGame`, at every `passTurn`, and at game end.
- `visibleTo` is computed with the same visibility rules as `viewFor`, so the training data records what each player could see.
- Export: one JSON Lines file per game, plus a manifest of the decks used and their card names.
- Schema changes bump `schemaVersion`; exporters write the version into each file.

## Technical risks and open decisions

| Risk or decision | Status | Resolution path |
| --- | --- | --- |
| iPadOS Safari may not form a direct LAN connection | Open | Milestone 1 spike. If it fails, Capacitor transport. Camera-access unlock is documented only in 2017–18 WebKit sources ([bug 176157](https://bugs.webkit.org/show_bug.cgi?id=176157), [r226804](https://trac.webkit.org/r226804)) |
| Phone hotspot may not start or route without cellular data | Open | Milestone 1, run with cellular data off |
| Offer may be too dense for a reliable screen-to-camera QR scan | Open | Measure the deflated size in Milestone 1. Fall back to stripping unused SDP lines, or to text pairing |
| Data-channel message size limits | Open | Chunk messages over 64 KB, or check current browser limits |
| Scryfall rate limits and terms of use | Unreviewed | Read the current API docs before Milestone 5 |
| Snapshot memory on low-end phones | Low | Lower the cap, or store diffs instead of full snapshots |
| Full state on both devices exposes hidden cards to a modified client | Accepted | PRD tradeoff |
