# MTG Travel Tabletop — Technical Design

Oct 30, 2026 · @Lawrence Tsang

## Scope

This doc describes how the app is built, in enough detail to rebuild it: modules, stack, schemas, engine rules, protocol, storage and the UI's mechanics. What the app does lives in the [PRD](./prd.md); build order and testing live in the [implementation plan](./implementation-plan.md). Where the two docs overlap, the PRD says what the user sees and this doc says how.

**Governing constraint: the engine is pure.** All game logic is a function `apply(state, command) → { state, moved } | { error, detail }` with no I/O, clock or randomness of its own. This one rule makes undo, replay, logging, same-device mode and most testing cheap.

## Architecture

One pure engine runs only on the host; both devices share the same UI and client code, and the guest differs only in sending commands over a transport instead of calling the host directly.

> *Diagram omitted in this export: components on the guest and host devices.*

Commands flow toward the host, which applies them in order through the engine, saves state, and sends the full state back to the guest.

| Module | Files | Owns |
| --- | --- | --- |
| `engine/` | `engine.js`, `view.js` | State shape, `apply`, invariant passes and `checkInvariants`; zone helpers and visibility (`canSeeFace`, `visibleTo`) |
| `host/` | `host.js`, `describe.js`, `replay.js` | The `Host` class (queue, randomness, undo snapshots, log entries, persistence calls); ticker text; log replay |
| `client/` | `session.js`, `net.js` | Sessions the UI talks to (`LocalSession`, `GuestSession`); handshake checks |
| `transport/` | `webrtc.js`, `codec.js`, `qr.js` | WebRTC data-channel transport, pairing codes, QR render and scan |
| `storage/` | `db.js`, `scryfall.js`, `starters.js`, `fixtures.js`, `backup.js`, `sha256.js` | IndexedDB, deck import, built-in lists, sample decks, backup files, SHA-256 fallback |
| `ui/` | `app.js`, `game.js`, `board.js`, `cards.js`, `gestures.js`, `overlays.js`, `decks.js`, `pairing.js`, `link.js`, `files.js`, `h.js` | Screens, the game screen, gestures, game links, file saving, Preact helpers |

Dependencies run one way: `ui → client → host → engine`, and `ui`/`host`/`client` → `storage`. The engine imports nothing but `view.js`.

## Tech stack

Plain JavaScript ES modules, loaded natively by the browser with no bundler or compile step, installed as an offline PWA. Libraries are vendored as ES-module files; types are checked, not compiled.

| Concern | Choice |
| --- | --- |
| Language | Plain JavaScript (ES modules) |
| Types | JSDoc plus `src/types.d.ts`, checked by `tsc -p jsconfig.json` (checkJs, noEmit) |
| Module loading | `<script type="module" src="src/ui/app.js">` and an inline import map in `index.html` |
| UI | Preact + `htm` tagged templates (`src/ui/h.js` exports `html = htm.bind(h)` and the hooks) |
| Gestures | Hand-written on Pointer Events (`src/ui/gestures.js`) |
| Storage | `idb` over IndexedDB; images stored as Blobs |
| Peer connection | Native `RTCPeerConnection` data channel, no STUN or TURN |
| QR | `uqr` to encode (rendered as SVG), `jsQR` to decode camera frames |
| Compression | `fflate` (deflate for pairing codes, zip for backups) |
| Hashing | Web Crypto SHA-256, with a pure-JS fallback (`sha256.js`) because `crypto.subtle` is missing on plain-HTTP pages |
| Tests | Vitest and fast-check (unit), Playwright (browser); dev-only, never served |

**Import map** (in `index.html`): `preact` → `./vendor/preact/preact.js`, `preact/hooks` → `./vendor/preact/hooks.js`, `htm` → `./vendor/htm.js`, `idb` → `./vendor/idb/index.js`, `uqr` → `./vendor/uqr.js`, `jsqr` → `./vendor/jsqr.js`, `fflate` → `./vendor/fflate.js`. The vendored files are the ES-module builds from npm (preact 10, htm 3, idb 8, uqr 0.1, fflate 0.8); jsQR ships no ES module, so `vendor/jsqr.js` wraps its UMD build with `export default`.

**Files**

```
index.html  manifest.json  sw.js  styles.css
src/types.d.ts  src/version.js            APP_VERSION '0.1.0', PROTOCOL_VERSION 1
src/engine/  src/host/  src/client/  src/transport/  src/storage/  src/ui/
vendor/      preact/, htm.js, idb/, uqr.js, jsqr.js, fflate.js
assets/      back.svg (default card back), icon-192.png, icon-512.png, icon-maskable-512.png
tools/gen-sw-list.js
tests/       engine.test.js, net.test.js, link.test.js
```

**Manifest.** name "Travel Tabletop", short_name "Tabletop", start_url `./index.html`, scope `./`, display `standalone`, orientation `any`, background and theme colour `#0d1a15`, the three icons (the 512 maskable one with `purpose: maskable`). `index.html` sets `viewport-fit=cover, user-scalable=no` and the Apple web-app meta tags.

## Offline, service worker and updates

`sw.js` is a cache-first service worker over a fixed list of files.

- **Cache list.** `tools/gen-sw-list.js` walks `index.html`, `manifest.json`, `styles.css`, `src/`, `vendor/` and `assets/` (skipping `*.d.ts`, `*.map`, `.DS_Store`), hashes their paths and bytes with SHA-256, and rewrites two lines of `sw.js`: `const VERSION = '<APP_VERSION>-<first 10 hex of the hash>'` and `const FILES = ["./", …every file…]`. Run it before every release. A stale list leaves devices on the old app; a list naming a deleted file makes the install fail entirely.
- **Install.** Opens the cache `tabletop-<VERSION>` and `addAll(FILES)`. Any single failure fails the install, and the old version stays.
- **Activate.** Deletes every other cache whose name starts with `tabletop-`, then `clients.claim()`.
- **Fetch.** Same-origin GET only (Scryfall goes straight to the network). Answers from the cache, ignoring the query string; navigations fall back to the cached `index.html`; misses go to the network, and offline misses get a 503.
- **Message.** `'skipWaiting'` makes a waiting worker take over.
- **Page side** (`app.js`). Registers `sw.js`. When a worker reaches `installed` while another controls the page, or one is already waiting, the home screen offers **Update now**, which posts `'skipWaiting'`. On `controllerchange` the page reloads, but only if a controller existed when the page loaded, so a first install never reloads away the page.
- **Build shown.** The home screen reads `caches.keys()`, finds the `tabletop-` cache, and shows its hash suffix as the build.

## State schema

One serializable `GameState` object holds everything; zones are ordered arrays of card ids, and card instances hold everything else about a card.

```typescript
type PlayerId = 'p1' | 'p2';
type Actor = PlayerId | 'table' | 'host';
type ZoneKind = 'library' | 'hand' | 'battlefield' | 'lands' | 'graveyard' | 'exile' | 'command';
type ZoneId = `${PlayerId}.${ZoneKind}` | 'stack';

interface CardInstance {
  id: string;                 // 'c<n>' for deck cards, 't<n>' for tokens, unique per game
  defId: string;              // card definition in storage (images, name)
  name: string;
  deckId: string | null;      // null for tokens
  owner: PlayerId;            // player who selected the deck, or the token's owner
  isToken: boolean;
  tapped: boolean;
  face: 'front' | 'back';     // flip
  faceDown: boolean;          // hidden from everyone but the owner
  revealed: boolean;
  counters: { plus: number; minus: number; labeled: Record<string, number> };
  attachedTo?: string;        // host card id (same battlefield zone, one level)
  attacking?: number;         // attack number 1, 2, … while marked attacking
  blocking?: string[];        // ids of the attackers it blocks
}

interface PlayerState {
  name: string;
  counters: { key: string; value: number }[];  // 'life' is always index 0
  libraryTopFaceUp: boolean;
}

interface GameState {
  schemaVersion: 1;
  gameId: string;
  mode: 'networked' | 'same-device';
  seq: number;                // incremented by every applied command
  turn: number;               // 0 before startGame, then 1, 2, …
  activePlayer: PlayerId;
  nextId: number;             // next numeric suffix for card and token ids
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  zones: Record<ZoneId, string[]>;  // index 0 = top of a pile / left of a row
  result: null | { winner: PlayerId | null; reason: 'concede' | 'ended' };
}
```

- **Zones.** 15 in all: seven kinds per player plus the shared `stack`. "Battlefield zones" are a player's `battlefield` and `lands`. A zone's owner (the part before the dot) is the player whose side it is on, which the app also treats as control.
- **Invariants** (`checkInvariants`, run by the property tests after every command): every card id is in exactly one zone; every zone entry exists in `cards`; the attachment and combat rules below hold.
- **Not in state:** viewer and perspective, open slots, sheets, pointer and combat modes. These are local UI state per device.
- **Card definitions** live in storage; the state carries `defId` and `name` only.

## Commands and engine rules

Every state change is a command the host applies through `apply`. A command names the zone the sender saw the card in; if the card is elsewhere, `apply` returns `{ error: 'stale' }`. Bad input returns `{ error: 'invalid', detail }`, where `detail` is a user-facing sentence for the combat checks. After a game ends (`result` set) only `startGame` is accepted.

```typescript
interface Command { type: string; actor: Actor; clientSeq?: number; payload: any; random?: number[]; }
```

**Catalog** (`STATE_COMMANDS`)

| Command | Payload | Effect and preconditions |
| --- | --- | --- |
| `startGame` | gameId, mode, startingLife (default 20), deal (default 7), first, players: { p1, p2 } each { name, cards: [{defId, name, deckId}], commanders? } | Fresh state; card ids `c1…` in order; each library shuffled with host randomness; top `deal` to hand; commanders to the command zone; turn 1; activePlayer = `first` or p1 |
| `move` | cardId, from, to, toIndex? | See Moving cards |
| `tap` | cardId, from, value? | Sets `tapped` (toggles without value) |
| `untapAll` | player | Untaps that player's battlefield and lands |
| `flip` | cardId, from | Toggles `face` |
| `setFaceDown` | cardId, from, value? | Sets `faceDown` |
| `reveal` | cardId, from, value? | Sets `revealed` (kept for compatibility; the UI uses the `showCard` notice) |
| `addCounter` / `removeCounter` | cardId, from?, kind: plus, minus or label, label?, n? (default 1) | A label's count of 0 deletes it; removing below 0 is invalid |
| `createToken` | defId, name, to, toIndex?, owner? | New card `t<n>`, owner = given or the zone's owner |
| `removeToken` | cardId, from | Only tokens |
| `draw` / `mill` | player, n | Moves up to n from the library top: draw appends to hand, mill puts each on top of the graveyard; clears faceDown, revealed, tapped |
| `shuffle` | zone | Fisher–Yates over the zone with host randomness |
| `setLibraryTopFaceUp` | player, value | |
| `setPlayerCounter` | player, key, value | Rounded to an integer |
| `addPlayerCounter` / `removePlayerCounter` | player, key, value? | Names unique (case-insensitive); `life` cannot be removed |
| `passTurn` | to? | activePlayer = to (default the other); turn + 1; untaps the new active player's battlefield and lands; clears combat marks |
| `concede` | player | result = { winner: other, reason: 'concede' } |
| `endGame` | winner? | result = { winner, reason: 'ended' } |
| `attach` / `detach` | see Attachments | |
| `attack` / `block` / `endCombat` | see Combat marks | |

`undo` is handled by the host, not the engine (see Host). Randomness: `randomNeeded(state, cmd)` returns how many numbers the host must supply (all deck cards for `startGame`, the zone size for `shuffle`, else 0); the engine reads them from `cmd.random`, clamped to [0, 1).

**Moving cards** (`move`). The host card's attachments travel with it when it goes to a battlefield zone (see Attachments); an attached card that moves is detached. The moved cards are removed from `from`. A token whose destination is not a battlefield zone or the stack is deleted. Otherwise each card passes through `changeZone(card, from, to)`:

- same zone: nothing changes;
- leaving the battlefield zones, entering them, or going to any non-battlefield zone: `tapped = false`;
- leaving the battlefield zones: counters cleared and `face = 'front'`;
- any zone change: `faceDown = false`, `revealed = false`.

They are inserted at `toIndex`, clamped to the destination's length; no index means the end. `moved` lists `{ id, from, to, toIndex }` for the log and ticker.

**Attachments.** `attach { cardId, from, toCardId, toZone }`: `toZone` must be a battlefield zone holding `toCardId`. If the target is itself attached, its host becomes the target (one level only). Attaching a card to itself, or to its own attachment, is invalid. A card that has attachments brings them along onto the new host. The group goes through `changeZone` into `toZone` and is inserted just before the host. `detach { cardId, from }` clears the link and moves the card to just after its former host.

After every command `fixAttachments` restores these rules:

1. An attachment sits in its host's zone, which is a battlefield zone; otherwise its link is dropped. This is how a host leaving play frees its attachments where they lie.
2. Links are flattened to the bottom host, and a card that is a host cannot stay attached (this breaks any loop).
3. In every battlefield zone, each host's attachments come immediately before it, in their existing order. A card dropped inside a group therefore lands before that group.

**Combat marks.**

- `attack { cardId, from, value? }`: `from` must be a battlefield zone. Marking on requires `from`'s owner to be the active player; marking off is always allowed. A new attacker gets `attacking = (largest number in use) + 1`, so numbers never change under a blocker and restart once all marks are cleared.
- `block { cardId, from, attackerId, attackerZone, value? }`: both cards must be in battlefield zones, the attacker must be attacking, and a card cannot block itself. Adding a block requires `from`'s owner not to be the active player; removing is always allowed. It toggles `attackerId` in `blocking`, and an empty list is deleted.
- `endCombat` and `passTurn` delete every `attacking` and `blocking`.

`fixCombat` runs after every command, after `fixAttachments`. A card not in a battlefield zone loses both marks. A card off the active player's side loses `attacking`, and a card on the active player's side loses `blocking`, so a change of control removes a creature from combat. A blocker's references to cards no longer attacking are dropped.

**Notices** are logged and broadcast but change no state: `peek` (zone, n), `revealTop` (zone, n, ids), `searchOpen` / `searchClose` (zone), `inspect` (zone), `point` (cardId? zone?), `showCard` (cardId, zone), `coinFlip`, `rollDie` (sides), `randomPick` (zone), `info`. The host fills results: coin `heads` / `tails`; die sides clamped to 2–1000 with result 1…sides; randomPick's `cardId` (an empty zone is invalid). A `searchClose` on a library is followed by a host-issued `shuffle`. Alert notices: peek, revealTop, searchOpen, searchClose, inspect, coinFlip, rollDie, randomPick.

## Visibility

`canSeeFace(state, card, zone, viewer)`, with `viewer` a player or `'nobody'` (one device, blinded):

- library: only the top card, and only when that library's `libraryTopFaceUp` is set;
- hand: when `revealed`, or when the viewer is the zone's owner;
- elsewhere: everyone, unless `faceDown`, in which case only the card's owner.

`visibleTo(state, card, zone)` is the players for whom that holds; the log records it before and after every move. Visibility is enforced only in the UI; both devices hold the full state, which the PRD accepts. The peek, search and inspect trays and the full-screen view of a face-down card you own override it for the viewer.

**Perspective and viewer.** Networked: both are the device's player. One device: unblinding sets both to that player; blinding sets the viewer to `'nobody'` and keeps the perspective. The actor for commands is the viewer, or `'table'` when the viewer is `'nobody'`; the "acting player" is the viewer, or the perspective player when blinded.

## Host

`Host` (`host.js`) owns the authoritative state. `dispatch(cmd)`:

1. `undo` → pop the snapshot stack; the popped state becomes current. Logged as `kind: 'undo'` with `undoneSeq`. Nothing to undo is invalid.
2. Notice types → fill results, log, emit `notice`.
3. State commands → fill `random` with `crypto.getRandomValues` (32-bit values ÷ 2³²), `apply`, and on error log a `rejected` entry and return `{ ok: false, error, detail }`.
4. On success: push the prior state as a snapshot (capped at 100; `startGame` clears the stack instead), bump `version`, describe the command for the ticker, and compute `alert` (a `shuffle`, a `move` out of a library, or anything into a library). Write a `command` log entry with per-card `visibleTo`, plus a `snapshot` entry after `startGame`, `passTurn`, `concede` and `endGame`. Persist, then emit `state` with { version, text, alert, actor, clientSeq }.

Persistence is serialized through one promise chain; each commit is one IndexedDB transaction (game record + snapshot push/drops + log entries). `replay(entries)` rebuilds the state from a log by applying the logged commands and undos in `seq` order.

**Ticker text** (`describe.js`). Card names appear only if both players could see the card before or after; otherwise "a card" or "a token". Zones read "their battlefield" for the actor's own, "Claire's graveyard" otherwise, and "the top of" / "the bottom of" a library. Templates: `<who>: <card> → <zone>`, `<who> reordered <zone>`, `<who> tapped|untapped <card>`, `<who> untapped all`, `<who> flipped <card>`, `<who> turned a card face down|up`, `<who> added|removed a <kind> counter on|from <card>`, `<who> created <token>`, `<who> drew|milled <n> card(s)`, `<who> shuffled <zone>`, `<who>: <player> <key> <old> → <new>`, `<who> attached <card> to <host>`, `<who> detached <card>`, `<who>: <card> attacks (⚔n)`, `<who>: <card> blocks <attacker> (⚔n)`, `<who> ended combat`, `Turn <n>: <player>`, `<player> conceded`, `<who> undid the last action`. Notices: `<who> is looking at the top <n> of <zone>`, `revealed the top <n> of`, `is searching`, `finished searching`, `is looking at`, `is pointing`, `revealed <card>`, `flipped a coin: heads`, `rolled a d<s>: <r>`, `picked at random from <zone>`. `<who>` is the player's name, or "Table".

## Sessions, transport and protocol

**Sessions** share one interface for the UI: `state`, `version`, `status`, `subscribe(fn)`, `onNotice(fn)`, `onReject(fn)`, `send(type, payload, actor)`.

- `LocalSession` wraps a `Host`, for one device (`kind: 'same-device'`) or the networked host (`kind: 'host'`, me = p1, guest = p2). It forwards every `state` and `notice` to the attached guest transport; guest `command` messages are dispatched with actor p2, and failures are answered with `rejected`.
- `GuestSession` (`kind: 'guest'`) keeps the last state from the host. `send` posts `{ type: 'command', cmd: { type, payload, clientSeq } }`; while not connected it rejects locally with reason `offline`, and the board goes read-only. A `rejected` message triggers a re-render, so a card snaps back.

**Transport** (`webrtc.js`). One ordered `RTCDataChannel` named `mtg`, `iceServers: []` (LAN only).

- **Pairing.** The host creates the channel and an offer; the guest answers. Each side waits for ICE gathering to complete (timeout 4 s; no trickle) so one code carries every candidate. Before creating a code, the app requests the camera once and stops it at once, because Safari and Chrome hide local IP addresses from WebRTC without camera access. The connection times out after 20 s, or fails at once on `connectionState = 'failed'`.
- **Codes** (`codec.js`). `"MTG1" + ("o" | "a") + base64url(deflate(level 9, slimmed SDP))`. Slimming drops `a=extmap`, `a=rtcp-fb`, `a=ssrc` and `a=msid` lines and srflx, relay and TCP candidates. Decoding ignores whitespace and gives a readable error for a wrong or damaged code. QR codes are encoded with ECC level L and border 2, drawn as SVG. Scanning uses the rear camera at up to 1280 px wide, frames scaled to 800 px, jsQR with `inversionAttempts: 'dontInvert'`, accepting only text starting `MTG1`.
- **Framing.** Each message is JSON `{ t: 'msg', m }`. Text over 15,000 characters is split into `{ t: 'part', id, i, n, d }` chunks and reassembled. `{ t: 'ping' }` goes every 2 s; nothing received for 7 s marks the link `lost`, and traffic on an open channel marks it `open` again.

**Messages**

| Type | Direction | Contents |
| --- | --- | --- |
| `hello` | guest → host | protocolVersion, appVersion, name, spec { cards, commanders } from the chosen decks, deckNames, tokens (every token defId on the guest), gameId (when reconnecting) |
| `welcome` | host → guest | player ('p2'), state, version, tokens |
| `refuse` | either | reason: `version`, `cards` (with `missing` names), or `game`; detail |
| `command` | guest → host | cmd { type, payload, clientSeq } |
| `state` | host → guest | version, state, text, alert, actor, clientSeq (on the guest's own commands) |
| `rejected` | host → guest | clientSeq, reason, detail |
| `notice` | host → guest | the filled notice { kind, actor, payload, text, alert, seq } |

**Handshake.** The host refuses a different protocol or app version. For a new game it refuses a guest whose cards it lacks (by defId). If a game is running, a hello with that game's id reconnects, a hello with another id is refused (`game`), and a hello with no id starts a new game with the guest's name and spec. The host then sends `welcome` and the full state. The guest checks that it holds every non-token defId in the welcome's state; if not, it refuses and names the missing cards. The guest stores `guestGame` (gameId, host name, its own name and deck ids) for reconnecting.

## Storage

One IndexedDB database `mtg-tabletop`, version 1.

| Store | Key | Contents |
| --- | --- | --- |
| `images` | `hash` | { hash, blob, type }: SHA-256 hex of the bytes; each image stored once |
| `defs` | `id` | CardDef { id, name, front, back, scryfallId?, sizes? } |
| `decks` | `id` | Deck { id, name, kind: 'deck' or 'token', cards (defIds, with repeats), commanders?, builtin?, starterId?, forDecks?, signature?, createdAt } |
| `games` | `id` | { id, state, mode, role, setup, updatedAt, over } |
| `snapshots` | [gameId, key] | { gameId, key, state }; index `gameId` |
| `logs` | [gameId, seq] | LogEntry; index `gameId` |
| `meta` | `key` | `fixtures` (sample-deck version), `lastSetup` { names, pick, life }, `guestGame` |

- **Card ids.** `defId = sha256("name|frontHash|backHash")`, first 20 hex characters (back hash empty when there is none). Identical imports produce identical ids on every device, which is what the handshake compares.
- **Images.** `front` and `back` are the normal-size hashes; `sizes.front` and `sizes.back` hold the small and large hashes. Single-faced cards have `back: null` and are drawn with `assets/back.svg`. Missing sizes fall back to normal.
- **Choosing a size.** `sizeFor(cssHeight)`: with px = cssHeight × devicePixelRatio, small up to 230 px, normal up to 720 px, large above. The full-screen views always use large.
- **Games.** `games.over` is set when `state.result` is. Deleting a game deletes its snapshots and logs. Resuming loads the record, its snapshots (sorted by key) and the last log seq.
- **Persistence request.** `navigator.storage.persist()` after decks are added; `persisted()` and `estimate()` feed the Decks screen's status line.

## Deck import

`importDeck({ name, kind, text, extra, tokens })` in `scryfall.js`. It needs internet; nothing else does.

1. **Parse** (`parseDecklist`). Skip blank lines and lines starting with `//` or `#`, and "Name …" lines. Section headers (an optional trailing colon): Commander(s) → commander; Deck / Main / Mainboard / Main deck → main; Sideboard, Maybeboard, Considering, Companion, Tokens, About → that section. A card line matches `^(\d+)\s*x?\s+(name)(\s+\((SET)\)(\s+number)?)?(\s+\*foil-tag\*)*$`, with a SET of 2–6 letters or digits. A line that doesn't match but starts with a letter is one copy of that name; anything else is an error. Main and commander lines are imported (and tokens-section lines for a token deck); the rest are ignored.
2. **Resolve.** Unique entries (keyed by set and number, or lower-cased name) go to `POST https://api.scryfall.com/cards/collection` in batches of 75. The identifier is { set, collector_number }, { name, set }, or { name }. A result matches an entry by set and number, or by its name or a face's name (case-insensitive), or by a name starting with "\<name> //". Unmatched entries try `GET /cards/named?fuzzy=<name>`. Requests are 120 ms apart; a 429 retries after 1, 2 and 3 s; a 404 is "not found".
3. **Download.** Four at a time. A card already stored with all three sizes (by Scryfall id) is reused. Image URLs come from `image_uris`, or from `card_faces[0]` and `[1]` for double-faced cards; for each face the small (146×204), normal (488×680) and large (672×936) images are fetched, stored, and the CardDef written.
4. **Write the deck.** `deck-<base36 time>-<5 random base36>`, with `cards` and `commanders` expanded by count, `signature = listSignature(text)`, and `extra` merged (for example `starterId`).
5. **Tokens** (kind 'deck' only). Every `all_parts` entry with `component: 'token'` (except the card itself) is fetched through the collection endpoint by id and stored the same way. They go into token deck `tokens.deckId`, or `<deckId>-tokens` named "\<deck> · tokens". The cards are merged without duplicates, and the new deck's id is added to `forDecks`.
6. Unresolved lines and cards without images are returned as `missing`; the rest still imports.

`listSignature(text)` is the sorted list of "count name" (commanders prefixed `c:`) for duplicate warnings. The Import screen warns when a deck of the same kind has the same name (case-insensitive) or the same signature.

**Starter packs** (`starters.js`). One pack, id `tla-beginner-box`, "Avatar: The Last Airbender Beginner Box". Its token deck is `tla-bb-tokens`, "Avatar BB: Tokens". It has ten decks; each line without a count gets "1 ", and every line gets " (TLA)". Each deck is named "Avatar BB: \<name>" with `starterId` `tla-bb-<name, lower-case, non-letters → '-'>`. The Decks screen imports only the decks whose `starterId` is missing. The lists are in the appendix.

**Sample decks** (`fixtures.js`). Created once per fixture version (2, stored in `meta.fixtures`) as SVG cards drawn in code (630×880, a coloured frame, name, cost, art, type line, wrapped rules text, power/toughness box, and "Sample card · placeholder art"). The decks are `sample-ember` "Sample: Ember (red)", `sample-grove` "Sample: Grove (green)" and the token deck `builtin-tokens` "Basic tokens", all `builtin: true`. Contents are in the appendix.

## Backup files

`backup.js`. A zip built with fflate, extension `.mtgdecks`, named `tabletop-decks-<YYYY-MM-DD>.mtgdecks`.

- `manifest.json`: { format: `travel-tabletop-decks`, version: 1, exportedAt, decks, defs, images: { hash → extension } }.
- `images/<sha256>.<ext>`: each image every def refers to (both faces, all sizes), stored without recompression; extensions jpg, png, svg, webp from the MIME type.
- Token decks whose `forDecks` include a chosen deck are added automatically.
- **Reading** compares each deck with the device: `same` when its id exists; `similar` when a deck of the same kind has the same name (case-insensitive), signature or `starterId`; otherwise `new`. A wrong format is refused, and so is a newer `version`.
- **Restoring** the chosen decks writes only defs whose every image is present and matches its hash, and lists the cards skipped. A deck whose id exists is added as a copy, `<id>-copy-<5 random>` named "\<name> (copy)", without its `starterId`. `forDecks` is remapped and `builtin` cleared.
- Files reach the user through `navigator.share({ files })` on touch devices (`pointer: coarse`) when sharing is supported, otherwise as a download. The file picker accepts any file, because iOS may not recognise the extension.

## UI

**Shell** (`app.js`). On start: create the sample decks if needed, register the service worker, then open the game link in the URL or the home screen. Routes: home, decks, deck, import, backup, restore, setup, rejoin, game. Toasts show at the top, at most four at once, for 3.5 s by default; kinds are info, warn and big (dice).

**Setup.** One device: two player forms (name and a deck checklist); start requires a deck each. Host: one form, then the host pairing flow. Join: one form, then the guest pairing flow. Starting life buttons 20 / 30 / 40 plus a number field. `lastSetup` is saved. Game ids come from `newGameId()`: the ISO date, "-", and 16 Crockford base32 characters (alphabet `0123456789abcdefghjkmnpqrstvwxyz`) from 10 random bytes.

**Game links** (`link.js`). The game screen keeps `#game=<id>` in the address bar with `history.replaceState` and clears it on leaving. On startup and on `hashchange` (when no game is open), `#game=<id>` (id matching `[0-9A-Za-z-]{1,64}`) is resolved in order:

1. a saved game that isn't over and has `turn > 0` is resumed;
2. an id matching `meta.guestGame` opens the reconnect screen;
3. otherwise the home screen shows "That game has ended." (a record exists) or "That game isn't saved on this device…".

During a game, a changed hash is put back.

**Board** (`board.js`). A CSS grid, 3 px gaps. Columns are `minmax(54px, 16%) 1fr minmax(54px, 16%)` (11% and 58 px in landscape). Rows are `0.75fr 1.05fr 1.45fr 0.85fr 1.15fr`. Cells for perspective P and other player O:

| Row | Column 1 | Column 2 | Column 3 |
| --- | --- | --- | --- |
| 1 | O.exile | O.lands (+ "O: n in hand", right-aligned) | O.graveyard |
| 2 | O.command | O.battlefield | O.library |
| 3 | P.command | P.battlefield | P.library |
| 4 | P.exile | P.lands | P.graveyard |
| 5 | player counters | P.hand | stack |

Row zones are drawn by `Row`, piles by `Pile` (the top card, with a library split into Top and Bottom drop halves). The board's class is `my-turn` or `their-turn`. Its background is a vertical gradient: red `rgba(214,64,52,.38)` at the active player's edge to `.12` at 42%, then blue `rgba(60,110,220,.12)` at 58% to `.38` at the far edge. Cells are translucent, so the gradient shows through. Names follow the same roles: the turn label, the active player's name in the counters cell and the hand label's name (when the perspective player is active) use `--hot` `#ff7b5f` (classes `role-atk`); the defender's name uses `--cool` `#7aa7ff` (`role-def`).

**Rows** (`cards.js`). Card height = slot height − 14 px; width = height × 63/88 (a tapped card's box is square, and its image is rotated 90°).

- **Units.** Groups (a host and its attachments) are units. Inside a group, each later card overlaps the previous by 75% of its width (PEEK 0.25). Between units the gap is 4 px.
- **Collapsed.** If the natural width exceeds the slot width − 8 px and there is more than one unit, the row collapses, the overlap spread evenly between units, unless the slot is open.
- **Open.** The row scrolls sideways. If it holds groups, they fan out: 3 px inside a group, 14 px between groups.
- **Overlays.** The label and the open-slot outline sit outside the scroller so they don't scroll. Data attributes on the row (`data-collapsed`, `data-groups`, `data-fanned`) drive the tap logic.

**Cards.** Each card element carries `data-card`, `data-zone`, `data-card-target` and `data-attached-to`. Marks sit at the visible top-left corner, outside the rotated image, offset down by (height − width) / 2 when tapped:

- "+N" attachments (gold)
- ⚔n attacking (red) and 🛡n per blocked attacker (blue), both draggable
- T token, FD face down, R revealed, ↻ back face

Counter badges (+n, −n, label n) sit at the bottom centre, draggable, with an invisible 8 px margin for fingers. Tucked attachments hide their badges.

**Gestures** (`gestures.js`). One handler on the game root.

- **Sources:** `[data-card]`, `[data-counter]` (footer tags), `[data-badge]` (marks and counters on cards), `[data-token-def]`, `[data-tap]`. **Drop targets:** `[data-drop]` (with `data-layout` row, pile, library or tray), `[data-card-target]` for counters and tags, `[data-trash]` (the Tokens button).
- **Thresholds:** a movement over 8 px starts a drag; holding a card 480 ms is a long-press (with a 15 ms vibration).
- **Scrollers:** the footer bar and open rows use `touch-action: none` and are panned in code. A mostly horizontal movement in a scroller pans it and swallows the next click for 400 ms; it ends with a fling that decays by 0.95 per 16 ms. Counter and mark drags never pan.
- **Drag:** a ghost copy follows the finger, and the hovered target is highlighted. **Drops:** a counter onto a card target; anything else onto a slot. The row index is the number of cards whose centre is left of the drop point, excluding the dragged card and its attachments, plus the tray offset. A library drop goes to the top or bottom by half. A drop outside every target reports `nowhere`, with the card under the finger.
- **Taps** on a mark or counter on the board act on its card.

**Game screen** (`game.js`). Local state: viewer, perspective, open slots (a list), library footer and N, sheet, full-view card, reveal screen, confirm dialog, pointer mode, combat mode with the pending blocker, attach mode, the label name, art map, the log lines (last 200), and the pointer ring.

- **Tap:** attach mode, then combat mode, then pointer mode take a tap first. Otherwise a token tap creates the token on the acting player's battlefield, and a card tap follows the PRD's table (a tucked strip in a row that isn't fanned means its host).
- **Long-press:** opens the full view if the viewer can see the face. For a battlefield group, the view lists the host and then its attachments, closest first; a sideways swipe of 50 px moves through them.
- **Drop rules:** counters and marks dropped off their card are removed (in the full view any drag removes one); the Attack tag requires the active player's side; tokens are created at the drop index; cards move.
- **Combat mode:** a tap on the active player's side toggles attacking, or completes a pending block when that card is attacking; a tap on the other side picks or unpicks the pending blocker.
- **Alerts:** in two-device games, alerts from the other player and all dice results show as toasts. On one device, alerts are collected per player and shown as "While \<name> was away" on unblinding.
- **Pointer:** the ring is drawn around the card, or else its slot, for 3 s in the pointer's colour.
- **Other:** the screen wake lock is requested during play and re-requested when the page becomes visible. A guest that isn't connected is shown greyed.
- **Sheets** (`overlays.js`) cover the top 36–44% of the board: zone viewer (with Random card), peek, reveal, search and inspect trays, Player counters, Recent actions (with Export log), Tokens, Dice and random, Menu, While you were away, Re-pair.

**Exporting the log.** One JSON Lines file `mtg-game-<gameId>.jsonl`: a manifest line { kind: 'manifest', gameId, mode, players, exportedAt, schemaVersion }, then every log entry. On one device it is refused before the game ends; on a guest it is refused.

## Action log

Every host action writes log entries with a per-game increasing `seq`.

```typescript
interface LogEntry {
  gameId: string; seq: number; ts: string; mode: 'networked' | 'same-device'; turn: number;
  kind: 'command' | 'notice' | 'rejected' | 'undo' | 'snapshot';
  actor: Actor; schemaVersion: number;
  command?: Command;          // as applied, with random filled in
  notice?: Notice;            // as filled in by the host
  text?: string;              // the ticker text
  cards?: { id; defId; name; from?; to?; toIndex?; visibleTo: { before: PlayerId[]; after: PlayerId[] } }[];
  undoneSeq?: number;         // kind 'undo': the state seq that was reverted
  reason?: string;            // kind 'rejected'
  state?: GameState;          // kind 'snapshot'
}
```

## Technical risks and open decisions

| Risk or decision | Status | Resolution path |
| --- | --- | --- |
| iPadOS Safari may not form a direct LAN connection | Open | Real-device test. If it fails, a Capacitor-wrapped native socket transport behind the same transport interface. The camera-access unlock is documented only in 2017–18 WebKit sources ([bug 176157](https://bugs.webkit.org/show_bug.cgi?id=176157), [r226804](https://trac.webkit.org/r226804)) |
| Phone hotspot may not start or route without cellular data | Open | Real-device test with cellular data off |
| Offer may be too dense for a reliable screen-to-camera QR scan | Mitigated | SDP slimming and deflate (offers measured about 500 characters in desktop tests); text pairing as fallback |
| Scryfall rate limits and terms of use | Unreviewed | 120 ms spacing follows Scryfall's published guidance; the terms themselves have not been reviewed |
| Snapshot memory on low-end phones | Low | Lower the cap, or store diffs instead of full snapshots |
| Full state on both devices exposes hidden cards to a modified client | Accepted | PRD tradeoff |

## Appendix: built-in lists

**Avatar: The Last Airbender Beginner Box** ([source](https://magic.wizards.com/en/news/announcements/avatar-the-last-airbender-beginner-box-contents)). One copy of each card unless a count is given; each list totals 20.

| Deck | Cards |
| --- | --- |
| Aang Tutorial | 8 Plains, Aardvark Sloth, Razor Rings, Path to Redemption, Appa, Aang's Companion, Sledding Otter-Penguin, Aang, Air Nomad, Katara, Heroic Healer, Momo, Rambunctious Rascal, Aang's Defense, Sokka, Wolf Cove's Protector, Tundra Wall, Wolf Cove Villager |
| Zuko Tutorial | 8 Mountain, Dragon Moose, Explosive Shot, Run Amok, Fire Nation's Conquest, Komodo Rhino, Zuko, Avatar Hunter, Zhao, the Seething Flame, Iroh, Firebending Instructor, Zuko's Offense, Fire Nation Soldier, Capital Guard, Warship Scout |
| Allies | 7 Plains, Kyoshi Warrior Guard, Jeong Jeong's Deserters, Glider Kids, Avatar Enthusiasts, Allied Teamwork, Aang, the Last Airbender, Suki, Kyoshi Warrior, Rabaroo Troop, Master Piandao, Mechanical Glider, Path to Redemption, Airbending Lesson, Thriving Heath |
| Waterbending | 7 Island, Flying Dolphin-Fish, Otter-Penguin, Katara, Bending Prodigy, Sokka, Lateral Strategist, Cat-Owl, Flexible Waterbender, Giant Koi, The Terror of Serpent's Pass, Watery Grasp, Bender's Waterskin, Deny Entry, Waterbending Lesson, Thriving Isle |
| Spells | 7 Island, First-Time Flyer, Master Pakku, Rowdy Snowballers, Iguana Parrot, Turtle-Seals, Geyser Leaper, Serpent of the Pass, Barrels of Blasting Jelly, Abandon Attachments, It'll Quench Ya!, Lost in the Spirit World, Water Whip, Thriving Isle |
| Attacking | 7 Swamp, Purple Pentapus, Corrupt Court Official, Merchant of Many Hats, Pretending Poxbearers, Fire Nation Ambushers, Hei Bai, Spirit of Balance, Lion Vulture, Beetle-Headed Merchants, Cat-gator, Heartless Act, Epic Downfall, Dai Li Indoctrination, Thriving Moor |
| Counters | 7 Swamp, Gilacorn, Elephant-Rat, Long Feng, Grand Secretariat, Dai Li Indoctrination, Fire Nation Engineer, Earth Village Ruffians, Hog-Monkey, Buzzard-Wasp Colony, Fire Nation Sentinels, Azula Always Lies, Feed the Swarm, Ozai's Cruelty, Thriving Moor |
| Firebending | 7 Mountain, Deserter's Disciple, Fire Sages, Yuyan Archers, Vindictive Warden, Loyal Fire Sage, Zuko, Exiled Prince, Fire Nation Archers, Rough Rhino Cavalry, Mongoose Lizard, Lightning Strike, How to Start a Riot, Roku's Mastery, Thriving Bluff |
| Big Creatures | 7 Forest, Turtle-Duck, Raucous Audience, Frog-Squirrels, Ostrich-Horse, Match the Odds, Eel-Hounds, Hippo-Cows, Saber-Tooth Moose-Lion, Flopsie, Bumi's Buddy, Mechanical Glider, Hog-Monkey Rampage, Seismic Tutelage, Thriving Grove |
| Earthbending | 7 Forest, Rebellious Captives, Haru, Hidden Talent, Earth Village Ruffians, Toph, the Blind Bandit, Earth Kingdom Soldier, Earthbending Lesson, Badgermole, Bumi, Eclectic Earthbender, Rocky Rebuke, Explore, Pillar Launch, Earth Rumble, Thriving Grove |

Card names containing commas (for example "Aang, Air Nomad") are single cards; in the source each card is on its own line.

**Sample decks** (placeholder cards, original text).

| Deck | Cards |
| --- | --- |
| Sample: Ember (red) | 16 Mountain; 4 Cinder Pup (1/1, haste); 4 Ashfang Raider (3/2, deals 1 on entering); 3 Kiln Brute (4/3, trample); 4 Spark Volley (instant, 3 damage); 3 Flare Up (sorcery, two 1/1 Goblins); 2 Forge Warden (planeswalker, loyalty 3); 2 Molten Sentinel // Molten Colossus (double-faced, 2/3 and 6/5); 2 Scry Ember (sorcery, look at top three) |
| Sample: Grove (green) | 16 Forest; 4 Mossback Hound (2/2, vigilance); 4 Thornwood Elk (3/3, reach); 3 Grovekeeper Elder (2/4, tap: +1/+1 counter); 4 Rampant Bloom (sorcery, fetch a basic land); 3 Wild Surge (instant, +3/+3); 2 Elder of the Grove (planeswalker, loyalty 4); 2 Hollow Sapling // Ancient Hollow (double-faced, 0/3 and 7/7); 2 Seedling Surveyor (1/2, look at any library's top card) |
| Basic tokens | Goblin 1/1, Soldier 1/1, Wolf 2/2, Beast 3/3, Zombie 2/2, Spirit 1/1 flying, Angel 4/4 flying, Plant 0/1 defender, Treasure, Clue, Food, Copy |
