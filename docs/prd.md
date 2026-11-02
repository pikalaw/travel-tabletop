# MTG Travel Tabletop — PRD (Phase 1)

Oct 30, 2026 · @Lawrence Tsang

## Overview

Phase 1 is a two-player, offline, rules-free Magic: The Gathering tabletop for two devices on the same local network. The app only moves card images around a shared board; the players enforce every rule themselves.

**Goals**

- Two players on two devices, or sharing one device (phone or tablet, any mix of iOS and Android), with no internet needed during play.
- Any card can be dragged to any slot; each slot has its own display and actions.
- The app knows nothing about card text or rules. A card is a front image and a back image.
- Honesty comes from visible notices and a shared action log, not enforcement.

**Non-goals for Phase 1**

- More than two players.
- Rules enforcement, card-text parsing, legality checks, deck-size or card-type limits.
- Play over the internet.
- Bluetooth transport.

## Platform and connection

The app installs from a web link onto phones and tablets and works fully offline after install. Two devices connect over a shared local network, such as one phone's hotspot, with no internet.

- **Devices.** iPhone, iPad, and Android phones and tablets, in any mix. It also runs in desktop browsers.
- **Host and guest.** One device hosts the game and holds the authoritative board; the other joins as guest. Either device can host.
- **Pairing.** The host shows a QR code; the guest scans it and shows one back for the host to scan. Copying and pasting a text code works instead of scanning.
- **Compatibility check.** Both devices must run the same app version and hold the same selected decks. Otherwise pairing stops with an error naming what differs.
- **Screen stays on** during a game.

## Board layout

Each player sees the same 5×3 grid from their own side: rows 1–2 are the opponent's, rows 3–5 are their own, and a footer sits below. Row 1 is the top, column 1 the left.

> *Diagram omitted in this export: board layout · 5×3 grid plus footer, one player's view.*

- **Shared zone.** The stack (5,3) is one shared zone shown identically on both devices.
- **Not shown.** The opponent's hand. Its card count appears in the footer.
- **Orientation.** Any device, portrait or landscape, one responsive layout. Rotating changes only the layout, never game state.
- **Sizing.** Rows have unequal heights: the player's battlefield and hand are tallest, the opponent's lands shortest, the footer thin. Columns 1 and 3 are narrow; column 2 takes the remaining width. Extra space on larger screens enlarges the rows.
- **Phone readability.** On phones the board shows card art only; reading a card means a long-press.

**Footer.** Its contents depend on context. Always present: undo, untap all, counter icons (+1/+1, −1/−1, labeled), token icon, randomness tools, pointer, opponent's hand count, and the latest-action ticker. Context buttons appear as described in the sections below.

## Zones and interactions

Any card can be dragged from any slot to any slot, including the opponent's slots; each slot differs only in how it displays cards and which actions it offers.

| Slot | Display | Tap on a card (slot open) |
| --- | --- | --- |
| Battlefield, lands | Face up, free row; overlaps when full | Tap or untap |
| Hand | Owner sees faces, side by side; overlaps when full | — |
| Library | Face down, only the top card shown | — (tap the slot for library actions) |
| Graveyard | Face up, ordered, top card shown | — |
| Exile | Face up unless set face-down | — |
| Commander | Face up | — |
| Stack | Shared, face up, ordered | — |

**Gestures**

1. A slot with overlapping cards is **collapsed**. A tap opens it; nothing else works until it is open.
2. In an **open** slot, cards do not overlap. The user can swipe to scroll, tap to tap or untap (battlefield and lands), long-press to view a card full screen, and drag cards or counters.
3. A slot whose cards fit without overlapping behaves as open.

**Full-screen card view** (long-press)

- Shows the card large. Counters can be dragged onto or off it.
- Footer buttons: **flip** (shows the other face to both players), **face-down** (only the owner sees the face), **reveal** (shows a hand card to the opponent). With two devices, the card pops up full screen on the opponent's device. With one device, the hand is blinded first, then an opaque screen shows only that card. A reveal is a one-time, logged event, not a lasting card state: the card is hidden again once the reveal screen closes, and revealing again shows it again. The full-screen view is opaque, so the board never shows behind it.
- Flip and face-down work on any card. The app does not check whether it makes sense.

**Viewing vs. changing.** Viewing (opening a slot, scrolling, zooming) affects only your own screen. Every change to the board appears on both screens.

**Pointer.** A footer pointer button lets a player highlight a card or slot on both screens, so "this card" over voice is unambiguous.

1. Tap the pointer button, then tap any visible card or slot. One tap; pointer mode then ends.
2. Both devices show a pulsing highlight on that card or slot for about 3 seconds, colored by who pointed.
3. Pointing never changes state and is not undoable. It is recorded in the action log, so a future voice recording can be matched to the card.

## Libraries

Both players can inspect and move cards into and out of either library; every inspection and every non-routine library move alerts the other player. Tapping a library opens its actions in the footer, along with both players' library counts.

| Action | What it does | Alert to the other player |
| --- | --- | --- |
| Draw N | Top N to hand | No (logged quietly) |
| Mill N | Top N to graveyard | No (logged quietly) |
| Peek top N | Private tray of the top N; drag each to top, bottom, hand, graveyard or anywhere | Yes |
| Reveal top N | Same tray, visible to both players | Yes |
| Search | Browse the whole library; shuffles when closed | Yes |
| Shuffle | Shuffles at random | Yes |
| Drop on top or bottom | Drag a card onto the library's top or bottom | Yes |
| Top card face-up | Toggle: the top card stays visible to both | Yes, when toggled |

- Peek covers scry, surveil, Ponder-style effects and explore without special code.
- Inspecting a library changes nothing on the board, is recorded in the action log, and cannot be undone.
- Shuffles and random picks are fair and identical on both devices.

## Counters, tokens and footer tools

Card counters, tokens, player counters and randomness are all manual tools; the app never interprets them.

**Card counters.** Three footer icons: +1/+1, −1/−1, and a labeled counter named when dropped (loyalty, lore, charge, time, shield and so on). Drag one onto a card to add it, or off a card to remove it. Works on the board or in the full-screen view.

**Tokens.** The footer token icon opens the token deck, a deck of token images. Dragging one onto a battlefield creates a copy. Dragging a token back to the footer removes it. A token that leaves the battlefield disappears.

**Player counters.** Cell (5,1) holds two key:value lists, one per player.

- `life` is a fixed entry for both players, with + and − buttons.
- Players can add arbitrary entries such as poison, energy or commander damage.
- Either player can change any counter in either list.

**Randomness tools.** Coin flip, a die with any number of sides, and "pick a random card from a zone" for discard at random. Results are identical on both devices and recorded in the action log.

**Untap all.** Untaps all of the acting player's permanents in one tap.

**Undo.** Reverts the most recent action in the game, whoever took it. See Sync, undo and reconnection.

## Sync, undo and reconnection

Both screens always show the same board. When both players act at once, the host's order decides.

- **Conflicting moves.** If both players move the same card at the same moment, the first move wins and the other player's card snaps back.
- **Undo** reverts the most recent action in the game, whoever took it. Both players see what was undone. Shuffles and random results are undone too.
- **Hidden information.** Both devices receive the whole game, including hands and library order; the app hides what a player should not see. A tampered app could reveal it. This is accepted for play between friends.
- **Survives interruptions.** A game survives the host app closing or the device restarting, and can be resumed.
- **Disconnects.** If the connection drops, the guest's board becomes read-only with a "reconnecting" banner while the host keeps playing. Re-pairing restores the current game.

## Same-device mode

Both players can share one device: the board stays visible to both, and only hands are hidden behind a blind toggle.

**Blind and unblind**

- A footer **blind my hand** button hides the hand. While blinded, both hands show as card backs with their counts.
- While blinded, the footer adds **unblind to \<player 1 name>** and **unblind to \<player 2 name>**.
- Unblinding to a player also switches the board to that player's perspective: their rows move to the bottom and their hand fills (5,2). Switching perspective is only a re-render; state does not change.
- Blinding keeps the board in the last perspective, so both players can work out blocks on one shared view.
- Only one hand is ever unblinded at a time. Each player sets a hidden 4-digit code on the setup screen; unblinding asks for that player's code. A forgotten code is reset by entering the other player's code, then a new one. The action log export is unavailable until the game ends, because the log shows both hands. Codes deter a casual peek; they are not strong security.

**Private views.** Peek, reveal-to-self and library search open only while the acting player's hand is unblinded, so private cards never show on a blinded screen.

**Logging.** Actions taken while unblinded are logged with that player as actor. Actions taken while blinded are logged with actor `table`. Every log entry records the session mode (`networked` or `same-device`) so same-device data can be filtered later.

## Decks, import and game lifecycle

A deck is a named group of cards, each a front and back image; both devices must hold the same decks before a game starts.

**Image sizes.** Each card face is stored in three sizes so it stays sharp without wasting memory. The board picks the size that fits each card on screen. On phones that is usually small; on tablets, normal. The full-screen view uses large. Card data beyond the images is ignored; the app stays rules-free.

**Starter decks.** The Decks screen offers one-tap download of the ten Avatar: The Last Airbender Beginner Box decks (20 cards each), from lists built into the app. Images download from Scryfall on first use, so this needs internet once. Moving cards between decks is out of scope for now.

**Tokens with every deck.** Importing a deck also downloads the tokens its cards create and saves them as a token deck named after it. The ten Beginner Box decks share one token deck. In a game, the Tokens picker lists the token decks for the decks in play first, then all others.

**Safety checks.** Importing a list whose name or cards match an existing deck asks before adding another copy. Starter decks already on the device are skipped. Deleting any deck asks first; deleting a token deck also names the decks that use its tokens.

**Back up and restore.** Any set of decks can be saved to one backup file, with their token decks and every image size, and restored on any device and browser without internet. Before restoring, each deck in the file is shown as new, already here, or a possible duplicate (same name or cards as a deck on the device); only new decks are selected by default. After decks are added, the app asks the browser to keep its storage rather than clear it when space runs low, and the Decks screen shows whether it agreed and how much space is used.

**Viewing a deck.** Tapping a card on a deck's page shows it full screen in the large size, with previous and next buttons, a flip button for double-faced cards, and the card's count in the deck. Tapping the card or Close returns to the deck.

**Decks**

- Each card belongs to exactly one deck. In a game, the player who selected a deck owns its cards, and cards return to their deck after the game.
- Many cards share one back image; it is stored once.
- No limits on deck size or card types.
- A token deck holds token images for the footer token icon.
- Later: an editor to move cards between decks.

**Import** (needs internet; done before travel)

1. Paste a decklist.
2. The app downloads each card's images from Scryfall.
3. Images and deck definitions are stored locally.

The same decks must be imported on both devices.

**Deck fingerprint.** At pairing, each device computes a fingerprint of the selected decks' card lists and images. A mismatch blocks the game with an error naming the deck that differs.

**Lifecycle**

- **New game:** pick roles, pair, each player selects one or more decks (no upper limit), and both players may pick the same deck; all of a player's chosen decks are shuffled into one library, set starting life (default 20; 40 for Commander). The app shuffles each library and deals 7 cards to each hand. Mulligans are manual.
- **Pass turn:** hands the turn to the other player, untaps that player's permanents, and logs a turn marker.
- **Concede** ends the game, and the log records the result.
- **Rematch** starts a new game with the same decks.
- **Resume:** the host can reopen its saved game and re-pair with the guest.

## Action log

Every game produces a complete record of what happened, kept for review and as future LLM training data. The footer ticker shows the latest action.

For every action the record captures:

- who did it (`table` in same-device mode while hands are blinded)
- what the action was
- which card, and where it moved from and to
- what each player could see before and after
- when it happened

It also records turn boundaries and periodic full snapshots of the board. Undos are recorded, never erased. Each game can be exported as a file.

## Related docs

- [Technical design](./technical-design.md): architecture, stack, schemas, protocol
- [Implementation plan](./implementation-plan.md): milestones, testing, dev environment
