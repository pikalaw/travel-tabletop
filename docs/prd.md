# MTG Travel Tabletop — PRD (Phase 1)

Oct 30, 2026 · @Lawrence Tsang

## Overview

Phase 1 is a two-player, offline, rules-free Magic: The Gathering tabletop, played on two devices over a local network or on one shared device. The app only moves card images around a shared board; the players enforce every rule themselves.

**Goals**

- Two players on two devices, or sharing one device (phone or tablet, any mix of iOS and Android), with no internet needed during play.
- Any card can be dragged to any slot; each slot has its own display and actions.
- The app knows nothing about card text or rules. A card is a front image and a back image.
- Honesty comes from visible notices and a shared action log, not enforcement.

**Non-goals for Phase 1**

- More than two players.
- Rules enforcement, card-text parsing, legality checks, deck-size or card-type limits. The one exception is combat marks (see Combat marks).
- A matchmaking or signalling server: over the internet, players exchange the pairing codes themselves (by message).
- Bluetooth transport.
- A deck editor.

## Platform and connection

The app installs from a web link onto phones and tablets and works fully offline after the first visit. Two devices connect over a shared local network, with no internet. The device that shares a hotspot can't be one of the two players (see the v2 design's risks), so a hotspot must come from a third device or a travel router.

When both devices have internet access, they can also connect when they aren't on one network, or when the network keeps its devices apart (hotel and café Wi-Fi often do): the connection then goes through a free public relay (Open Relay, by Metered). The local network is always tried first, so a game on one Wi-Fi never uses the relay. The relay passes the game's messages along encrypted and can't read them; a whole game is well under a megabyte. Players in different places paste the pairing codes into a message instead of scanning them. The relay is a free, best-effort service with no guarantee it stays up; a relay of our own is planned for later.

- **Devices.** iPhone, iPad, and Android phones and tablets, in any mix. It also runs in desktop browsers.
- **Modes.** One device shared by both players, or two devices (one hosts, one joins).
- **Host and guest.** One device hosts the game and holds the authoritative board; the other joins as guest. Either device can host.
- **Pairing.** The host shows a QR code; the guest scans it and shows one back for the host to scan. Copying and pasting a text code works instead of scanning. The app asks for the camera first, because it needs it to scan and because it lets the two devices find each other on the local network. The pairing details say how the code can be reached: direct (local) addresses, internet addresses, and relay addresses.
- **Compatibility check.** Both devices must run the same app version. Each device must also hold the card images the other side's decks use: the host checks the guest's decks, and the guest checks the cards in the host's game. Otherwise pairing stops with an error naming the missing cards.
- **Screen stays on** during a game.
- **Offline and updates.** After the first visit the whole app is stored on the device; the first time that finishes, a one-time message says "Ready to play offline" (from v2). A new version downloads in the background the next time the app opens online. The home screen then shows "A new version is ready" with **Update now**; the update never applies during a game. The home screen footer shows the version and installed build.

## Board layout

Each player sees the same 5×3 grid from their own side: rows 1–2 are the opponent's, rows 3–5 are their own, and a footer sits below. Row 1 is the top, column 1 the left.

> *Diagram omitted in this export: board layout · 5×3 grid plus footer, one player's view.*

- **Shared zone.** The stack (5,3) is one shared zone shown identically on both devices.
- **Labels.** Each slot is labelled at its top left with its name and card count, e.g. "Claire · battlefield 7". Battlefield and lands slots carry the owner's name.
- **Opponent's hand.** Never shown. Its card count appears right-aligned on the opponent's lands row ("Claire: 5 in hand"). While a card is being dragged, that count becomes a drop target: dropping a card on it puts the card at the end of the opponent's hand (for example, a creature bounced to its owner's hand).
- **Own hand.** Labelled with its owner, "Lawrence's hand", or "Lawrence's hand (hidden)" while blinded, which also shows whose view the board is in.
- **Whose turn.** The player-counter cell (5,1) is labelled "Turn N · name" and lists that player first. Wherever a player's name appears on the board (the turn label, the counters cell, the hand count and every row label such as "Claire · lands" or "Lawrence's hand"), the attacking (active) player's name is in a hot coral; the defending player's is in a cool blue. These swap when the turn passes. A clear wash covers the active (attacking) player's rows in red and the defender's rows in blue, each strongest at its own edge of the screen. The colour changes exactly where one player's rows meet the other's, wherever that falls on the screen, and flips when the turn passes.
- **Player colours.** A player's colour is their role this turn, not their seat: red for the player whose turn it is, blue for the other, so it changes every turn. It is used everywhere a player is shown: the board's names and tint, changed marks, the unblind chooser, the pointer ring and the Player counters sheet. Where both players are listed, the player whose turn it is comes first.
- **Orientation.** Any device, portrait or landscape, one responsive layout. Rotating changes only the layout, never game state.
- **Sizing.** The two battlefields get the most height, since both players decide attacks there, and are the same height. The hand is shorter than the battlefields and taller than the lands. The two lands rows are the shortest and the same height, with a floor that keeps land cards big enough to tap on a phone held sideways. Columns 1 and 3 are narrow; column 2 takes the remaining width. Extra space on larger screens enlarges the rows.
- **Phone readability.** On phones the board shows card art only; reading a card means a long-press.

**Footer.** Two rows.

1. **Ticker row.** The latest action in words ("Claire tapped Aang"); tapping it opens Recent actions. In two-device games it also shows the connection status (Connected, or a button to re-pair).
2. **Button bar.** Scrolls sideways when it doesn't fit. Its contents depend on context:

| Context | Buttons, in order |
| --- | --- |
| Normal | Most used first, as icons where a symbol is clear (each keeps a spoken label): ↶ Undo, set apart at the left edge by a gap (there is no redo, so a stray tap costs an action) · eye: Blind my hand (struck-through eye) or Unblind (open eye, gold) (one device) · crossed swords: Combat · hourglass: Pass turn, in the turn colour · then, only while needed, End combat · Clear highlight · Close slot(s) (words; they come after the hourglass so the everyday buttons never move) · +1/+1, −1/−1 and a labeled counter tag (no ⚔ Attack tag: attackers are marked in combat mode) · pawn: Tokens (also where a token is dropped to remove it) · die: Dice · finger: Point (lit while waiting for the tap) · a sideways dashed card behind an upright one: Untap all (no arrow, so it can't be read as Undo) · ☰ menu |
| Full-screen card | Flip · Face down / Face up · Reveal (hand cards) · Tap / Untap (battlefield and lands) · Attack / Stop attacking (active player's side) or Block (other side) · Attach or Detach (not in a library) · Make lead (an attached card) · Detach all (a card in a group) · the counter tags, with the ⚔ Attack tag only for the player whose turn it is or while hands are blinded · Close |
| Library | both libraries' counts · a 1–99 stepper N · Draw N (own library only) · Mill N · Look at top N · Reveal top N · Search (own) or Look through (other's) · Shuffle · Top face up · Done |
| Combat mode | a hint, or the chosen blocker's name · Vigilance · End combat · Pause |
| Attach mode | "Attach \<card>: tap the card to attach it to" · Cancel |

**Menu** (☰): Blind my hand (one device), Pass the turn, Export action log (two devices, or one device once the game is over), Re-pair the guest device (host) or Reconnect to the host (guest), Concede (one per player on one device), Rematch with the same decks (not on the guest), Leave to home screen.

## Zones and interactions

Any card can be dragged from any slot to any slot, including the opponent's slots; each slot differs only in how it displays cards and which actions it offers. Each slot's label names the zone and gives its count; on a narrow screen the name is shortened ("LIB… 33"), never the count.

| Slot | Display | Tap on a card | Tap on the slot |
| --- | --- | --- | --- |
| Battlefield, lands | Face up, a row; overlaps when full. A tapped card turns a quarter to the right, as in paper Magic | Tap or untap | Open or close it |
| Hand | Owner sees faces; others see backs; overlaps when full | — | Open or close it |
| Library | Pile, face down; the top card shows face up only with "Top face up" (the face-up card is the only sign; no label tag) | — | Library actions in the footer |
| Graveyard | Pile, face up, top card shown | — | A sheet listing the whole zone |
| Exile | Pile, face up unless set face-down | — | A sheet listing the zone |
| Command | Pile, face up | — | A sheet listing the zone |
| Stack | Shared pile, face up; the newest card is on top | — | The full view on the top item, captioned "Stack 1 of 3 · resolves first"; swipes step down the stack |

**Gestures**

1. **Tap** acts as in the table. **Long-press** (about half a second) opens the full-screen view of a card whose face you can see. **Drag** moves a card, a counter or a tag.
   - In the full-screen view, a **sideways swipe** on the card goes to the previous or next card in the same slot. A group counts as one stop, and the stop is always its lead (right-most) card, so swiping through a slot shows each group's lead in turn; the thumbnails reach the attachments. Cards whose face you can't see are skipped, and in a library tray only the tray's cards count. Faint **←** and **→** signs at the sides show when there is a card that way; they are signs, not buttons. The arrow keys do the same on a keyboard.
   - **Dragging the card up** in the full-screen view returns to the board with the card's whole group under the finger, to drop on any slot. **Swiping it down** just closes the view, the same as Close.
   - **Two-finger spread** (the zoom-in gesture) on the board opens the full-screen view, like a long-press. On a collapsed slot it opens the slot's first card (the lead card of its first group); on an open slot, or a slot whose cards fit, it opens the card under the fingers.
2. A row whose cards don't fit is **collapsed**: the cards overlap and "TAP TO OPEN" shows at its top right. The same label shows on a battlefield or lands row holding a card with attachments tucked behind it, since a tap fans the group out. A tap anywhere on it opens it; a tap on a card in a collapsed row only opens the row.
3. An **open** row lays the cards side by side and scrolls sideways; "TAP TO CLOSE" shows in the same place. A mostly sideways swipe scrolls (with a fling); any other movement on a card drags it. Tapping the empty part of the slot closes it.
4. A row whose cards fit is always laid out side by side.
5. This works the same in combat and attach modes: a tap on "TAP TO OPEN" / "TAP TO CLOSE" or a slot's empty part opens or closes it, and a tap on a card in a collapsed slot only opens the slot, so the next tap marks or picks the card meant.
6. Several slots can be open at once; each stays open until tapped again, and **Close slots** closes them all.
7. **Drop positions.** Dropping into a row inserts the card where it lands. Dropping on a library inserts it on top (upper half) or at the bottom (lower half). Dropping on another pile puts the card on top.
8. A sideways swipe on the footer bar scrolls it without pressing a button.

**What a move resets.** A card that changes zone turns face up and loses any revealed mark. A card that leaves the battlefield or lands also untaps, loses its counters and turns back to its front face. A card moving between battlefields stays tapped and keeps its counters. A token that leaves the battlefield, lands or stack disappears.

**Full-screen card view** (long-press)

- Shows the card large on an opaque screen, so the board never shows behind it. Its name, zone and state (tapped, face down, revealed, back face, token, double-faced) are listed beside it.
- **Tapped cards stay upright here**, so their text can be read; a **↷ Tapped** badge under the card says it is tapped. A tap on a card in play taps or untaps it.
- Combat marks and counters show in a strip below the card image, never over it, so the card's text stays readable. Counters have − and + buttons. Dragging a counter tag from the footer onto the card adds one; dragging a counter or mark away removes one.
- **Flip** shows the other face to both players. **Face down** hides the face from everyone but the owner. Both work on any card; the app does not check whether it makes sense.
- **Reveal** shows a hand card to the opponent once. With two devices, the card pops up full screen on the opponent's device. With one device, the hand is blinded first, then an opaque screen shows only that card; tapping it closes it. A reveal is a logged event, not a lasting state: revealing again shows it again.
- Combat and attachment buttons are described in their sections.

**Viewing vs. changing.** Viewing (opening a slot, scrolling, the full-screen view) affects only your own screen. Every change to the board appears on both screens.

**Questions the app asks** (passing the turn, ending combat, conceding, a rematch, deleting a game or deck, importing a duplicate deck, renaming a deck or the labeled counter, typing a counter's value) appear in the app's own dialog, never the browser's, which would show the site's address ("pikalaw.github.io says") and block the page. The dialog has a short title, a line of detail, and buttons named for what they do; deleting and conceding use a red button. Tapping outside the box or pressing Escape cancels; Enter answers the main button.

**Pointer.** The footer **Point** button lets a player highlight a card or slot on both screens, so "this card" over voice is unambiguous.

1. Tap Point, then tap any visible card or slot. One tap; pointer mode then ends.
2. Both devices show a highlight ring on that card or slot for about 3 seconds, coloured by who pointed.
3. Pointing never changes state and is not undoable. It is recorded in the action log, so a future voice recording can be matched to the card.

## Libraries

Both players can inspect and move cards into and out of either library; every inspection and every non-routine library move alerts the other player. Tapping a library opens its actions in the footer, along with both players' library counts.

| Action | What it does | Alert to the other player |
| --- | --- | --- |
| Draw N | Top N to hand (only from your own library) | No (logged quietly) |
| Drag the top card to its owner's hand | A draw, the same as Draw 1 | No (logged quietly) |
| Mill N | Top N to graveyard | No (logged quietly) |
| Look at top N | Private tray of the top N; drag each to top, bottom, hand, graveyard or anywhere; drop back in the tray to reorder | Yes |
| Reveal top N | The same tray, opened on both devices | Yes |
| Search | Browse your whole library; shuffles when closed | Yes, on opening and closing |
| Look through | Browse the other player's library | Yes |
| Shuffle | Shuffles at random | Yes |
| Drop on top or bottom | Drag a card onto the library's upper or lower half | Yes |
| Any other move out of a library | e.g. a card other than the top one, or to another zone | Yes |
| Top face up | Toggle: the top card stays visible to both | No (logged) |

- Peek covers scry, surveil, Ponder-style effects and explore without special code.
- Inspecting a library changes nothing on the board, is recorded in the action log, and cannot be undone.
- Shuffles and random picks are fair and identical on both devices.
- On one device, Look at top N, Search and Look through work only while a hand is unblinded.

## Attaching cards

A card can be attached to another card on the battlefield or lands, such as an Aura or Equipment on a creature. Attachment is only a visual and grouping link; the app never checks whether it is legal.

- **Attach.** In the full-screen view, tap **Attach**, then tap the card to attach it to. The card can come from any zone except a library, and can go onto either player's card. It moves into that card's zone but keeps its owner. Attaching to a card that is itself attached goes onto the card at the bottom of the group (one level only). A card that carries attachments brings them along. A new attachment goes to the left end of the group, farthest from the card it is attached to. Tapping the card itself cancels.
- **How it looks.** Attached cards tuck behind their card, each peeking out to its left by a quarter of a card. The card shows a gold "+N" mark at its top left. A tap on a tucked strip acts on the card it is attached to.
- **Inspect.** Long-press the card, or a strip, to open the group in the full-screen view (a strip opens on that attached card, the lead card on the lead): a thumbnail row shows the card and each attachment (closest first), plus its combat cards when it is in combat (see Combat marks), and a thumbnail tap moves between them. A sideways swipe goes to the next group or card in the slot. Actions in the footer apply to the card shown. Tapping the slot fans every group out, each card shown in full with wider gaps between groups; a gold bar joins each attached card to the next card of its group.
- **Moving and tapping.** Dragging any card of a group moves the whole group, to any battlefield or lands; the whole group follows the finger while dragging. Tapping the card taps only that card. Only **Detach**, in an attached card's full-screen view, splits a group, just as Attach makes one; Detach puts the card just right of its former card. **Detach all**, in the full-screen view of any card in a group, asks "Detach all?" and then frees every attached card in one step (one Undo brings them all back), each just right of the card, nearest first.
- **Make lead.** The card a group is attached to is its **lead**: it sits right-most, carries the group's combat marks, and is what a tap on a tucked strip taps. In an attached card's full-screen view, **Make lead** makes that card the lead instead. It swaps places with the old lead, the rest of the group attaches to it, and the group's attack or block marks move to it. Tapped state and counters stay on their own cards. This fixes a group built the wrong way round (an Aura first, then the creature attached to it) without the app knowing card types, so bestow, reconfigure and other unusual attachments still work.
- **Leaving play.** When the card leaves the battlefield, its attachments detach and stay where they are; the players move them as the rules say.
- **Not covered:** cards exiled "under" another card, and merged cards (mutate).

## Combat marks

Players can mark attackers and blockers so both can see who blocks what. The marks are a record only; the app works out no damage. It enforces one thing: only the active player's creatures can be marked attacking, and only the other player's can block. Which side a creature is on is the battlefield or lands row it sits in. Either player may do the marking.

- **Combat mode.** Tap **Combat** in the footer. On one device this blinds the hand first, so both players can look at the board together while marking attackers and blockers; a player who wants to play a trick taps **Pause** and unblinds as usual. Tapping a creature on the active player's side marks it attacking and taps it, as declaring an attacker does (tap again to unmark and untap, for a mistaken mark). For a creature with vigilance, tap **Vigilance** first: it lights up, the next tap marks an attacker without tapping it, and it then turns off whatever that tap did (tap it again to turn it off unused; Pause and End combat turn it off too); attackers are numbered ⚔1, ⚔2… in the order declared, and the numbers restart once all marks are cleared. Tapping a creature on the other side picks it as a blocker (a blue outline); then tapping an attacker pairs them, and the blocker shows 🛡 with that attacker's number. Several blockers can block one attacker, and one blocker can block several (🛡1 🛡2). Repeating a pair removes it. A blocker is never tapped; a tap on the life counters still opens them, since combat damage changes life. **Pause** returns to normal play and keeps the marks (Combat comes back to marking; End combat clears them). It is named Pause, not Done, because combat isn't over.
- **Tags.** The marks behave like counter tags. The full view's ⚔ Attack tag can be dragged onto its creature to mark it attacking, which taps it (the main footer has none: combat mode is where attackers are marked). Dragging a ⚔ or 🛡 mark off a card removes it (a 🛡 removes that one pairing) and leaves the creature tapped, since that is tidying up after damage. End combat and passing the turn don't untap either; the next player's untap does. Marks sit at the card's visible top-left corner, also when it is tapped, and the full-screen view shows them as tags ("⚔1 attacking", "🛡 blocks ⚔1").
- **Full-screen view.** A creature on the active player's side has **Attack** / **Stop attacking**, which tap and untap it like a tap in combat mode; one on the other side has **Block**, which opens combat mode with it picked as the blocker. The thumbnail row under the card shows its group (the creature and its attachments) and, after a thin divider, its combat cards: an attacker's blockers, or the attackers a blocker blocks. Each combat thumbnail carries its ⚔ or 🛡 mark and a gold "+N" when it has attachments. The caption reads, for example, "1 attached · blocked by 2", "unblocked" or "blocking ⚔1". Opening the view on any card shows that card; tapping a thumbnail or swiping moves through the row, which stays as it was when the view opened.
- **Matchup highlight.** Closing the full-screen view of a card in combat highlights its matchup on the board: the attacker, its blockers and all their attachments are outlined, and the other cards on both battlefields dim (hands and other zones stay bright, so instants can still be played). Tapping those cards keeps the highlight; any other tap, **Clear highlight** in the footer, or the end of combat clears it. Everything on the board stays visible and usable, because cards outside a matchup (anthems, removal, death triggers) often matter.
- **Clearing.** **End combat** (in combat mode, and in the footer whenever marks exist) clears every mark, after a confirmation that counts them ("End combat? This clears 2 attackers and 1 block.", with **Keep fighting** and **Clear marks**). With no marks it just leaves combat mode. Passing the turn clears them too. A creature that leaves the battlefield, or moves to the other player's side (a change of control, which removes it from combat), loses its marks. An attacker that stops attacking frees its blockers.
- A refused mark explains itself, e.g. "Only Claire's creatures can attack this turn."
- No lines are drawn between cards; the numbered marks stay readable in collapsed or scrolled slots and after a perspective switch.

## Changed cards

A card in play that a player just changed carries a coloured **left border**, so the other player can see at a glance what was done. It is red for the active (attacking) player's changes and blue for the defending player's, the same colours as their names, so a player's marks turn from red to blue when the turn passes to the other player.

- **What marks a card:** putting it into play (battlefield or lands), tapping or untapping it, a counter added or removed, attaching, detaching or Make lead, flipping, turning face down, a combat mark, and creating a token. Changing a card on either side counts, for whoever made the change.
- **What does not:** the untap when a turn passes, **Untap all**, ending combat, reordering a row, and anything in a hand, library or other pile. A card that leaves play loses its border.
- **Tapped cards** show the border on their left too, along the turned card.
- **When they clear:** the previous turn's borders stay up until the active player's first change of the new turn, so the next player sees what was just done, even after drawing. Changes the defender makes during the turn (a block, an instant) are this turn's and stay. Borders more than one turn old clear when the turn passes. Undo brings cleared borders back.

## Counters, tokens and footer tools

Card counters, tokens, player counters and randomness are all manual tools; the app never interprets them.

**Card counters.** Three footer tags: +1/+1, −1/−1, and a labeled counter (default "loyalty"; tap it to rename, e.g. lore, charge, time, shield). Drag one onto a card to add it. Counters show as small tags at the bottom of the card; drag one off the card to remove one. +1/+1 and −1/−1 are kept separately and never cancel each other. In the full-screen view the counters sit below the card, each with − and + buttons, and any drag of a counter removes one.

**Tokens.** The footer **Tokens** button opens the token picker: one list, sorted by name, of the tokens made for the decks in this game (each token once, from every token deck made for a deck in play; the built-in basic tokens belong to the sample decks). Long-press a token, or spread two fingers on it, to see it full screen (the same viewer as the deck page, in the same frame as the game's full view). There it takes the full view's gestures: swipe sideways for the previous or next token, swipe down to close, and drag it up to go back to the board with the token under your finger and drop it on a slot. Drag a token onto any battlefield or slot to create it there; a tap only shows that hint, so a token is never created by mistake. Dragging a token onto the Tokens button removes it. A token that leaves the battlefield disappears. Only tokens can be removed this way.

**Player counters.** Cell (5,1) holds two key:value lists, one per player, under the "Turn N · name" label; the player whose turn it is is listed first. Tapping the cell opens Player counters.

- `life` is a fixed entry for both players.
- Each entry has − and + buttons, and tapping its value lets you type a new one.
- Players can add arbitrary entries such as poison, energy or commander damage, and remove them (not life).
- Either player can change any counter in either list. The cell shows life and up to three more entries per player.

**Dice and random** (footer **Dice**). Flip a coin; roll a d4, d6, d8, d10, d12, d20, or a die with any number of sides from 2 to 1000; pick a random card from your hand, the opponent's hand, your graveyard, or either battlefield (for discard at random). Results pop up on both devices, the picked card is highlighted, and every result is recorded in the action log. A zone sheet (graveyard, exile, command, stack) also has a Random card button.

**Untap all.** Untaps all of the acting player's battlefield and lands in one tap.

**Undo.** Reverts the most recent action in the game, whoever took it. See Sync, undo and reconnection.

## Sync, undo and reconnection

Both screens always show the same board. When both players act at once, the host's order decides.

- **Conflicting moves.** If both players move the same card at the same moment, the first move wins and the other player's card snaps back with a short message.
- **Undo** reverts the most recent action in the game, whoever took it, up to 100 actions back. Both players see what was undone. Shuffles and random results are undone too. Undo can also reopen a game that was just conceded.
- **Alerts.** Library inspections, library moves, shuffles, dice and random picks are alerts. With two devices, the other player's alerts pop up as messages; dice and coin results pop up for both.
- **Hidden information.** Both devices receive the whole game, including hands and library order; the app hides what a player should not see. A tampered app could reveal it. This is accepted for play between friends.
- **Survives interruptions.** A game survives the host app closing or the device restarting, and can be resumed.
- **Disconnects.** If the connection drops, the guest's board becomes read-only (greyed) while the host keeps playing. Re-pairing restores the current game.

## Same-device mode

Both players can share one device: the board stays visible to both, and only hands are hidden behind a blind toggle.

**Blind and unblind**

- A game starts blinded. While blinded, the hand slot shows card backs, labelled "(hidden)".
- **Blind my hand** (footer or menu) hides the hand again, and so does **Pass turn**.
- While blinded, the footer shows one **Unblind** button.
- It opens "Who are you?" with two large buttons: on top, in red, the player whose turn it is ("Taking turn 7"); below, in blue, the other player ("Defending"); and Cancel. Picking a name unblinds to that player at once, so it is still two taps, and each player is reminded of their role before their hand shows. Tapping outside the box cancels. There are no codes: a blinded hand can still be dragged onto the board, so a code would protect nothing; players rely on trust and on the ticker, which shows such moves.
- Unblinding to a player also switches the board to that player's perspective: their rows move to the bottom and their hand fills (5,2). Switching perspective is only a re-render; state does not change.
- While the hands are blinded, the board faces the active player. So passing the turn turns the board to the next player, ready for them before they unblind, and undoing a pass turns it back. Actions taken while blinded count as the active player's.
- Only one hand is ever unblinded at a time.
- **While you were away.** On unblinding, a sheet lists every action anyone else took since this player last looked, in the ticker's wording (which never names a card the player couldn't have seen). Alerts (library looks, shuffles, dice and so on) are highlighted. Pointing is left out.

**Private views.** Peek, search and look-through open only while a hand is unblinded, so private cards never show on a blinded screen.

**Logging.** Actions taken while unblinded are logged with that player as actor. Actions taken while blinded are logged with actor `table`. Every log entry records the session mode (`networked` or `same-device`) so same-device data can be filtered later. The action log export is unavailable until the game ends, because the log shows both hands.

## Decks, import and game lifecycle

A deck is a named group of cards, each a front and back image. Before a two-device game, both devices need the cards the other side will play.

**Built-in decks.** Two sample decks of placeholder cards (Ember, red, and Grove, green, 40 cards each) and a Basic tokens deck ship with the app, so it is playable before any import.

**Starter decks.** The Decks screen offers one-tap download of the ten Avatar: The Last Airbender Beginner Box decks (20 cards each), from lists built into the app. Images download from Scryfall, so this needs internet once. Only the decks not yet on the device are downloaded. It also offers the 66 Avatar: The Last Airbender Jumpstart half-decks (46 themes of 20 cards; 20 themes have two versions): **Choose decks** lists them by colour to tick and download, or all can be downloaded at once. A player picks two half-decks at setup to make one deck.

**Import** (needs internet; done before travel)

1. On the Import screen, give a deck name and choose Deck or Token deck.
2. Paste a decklist from Arena, MTGO, Moxfield or Archidekt: one card per line, "count name", optionally "(SET) number". A "Commander" section goes to the command zone; sideboard and maybeboard sections are ignored; a line with only a name counts as one copy.
3. The app looks each card up on Scryfall, downloads its images, and stores the images and the deck on the device. Unresolved lines are listed at the end; the rest imports.

**Image sizes.** Each card face is stored in three sizes so it stays sharp without wasting memory. The board picks the size that fits each card on screen; on phones that is usually small, on tablets normal. The full-screen view uses large. Card data beyond the name and images is ignored; the app stays rules-free.

**Tokens with every deck.** Importing a deck also downloads the tokens its cards create and saves them as a token deck named after it ("\<deck> · tokens"). The ten Beginner Box decks share one token deck, and the Jumpstart half-decks share another. In a game, the Tokens picker lists the token decks for the decks in play first, then all others.

**Safety checks.** Importing a list whose name or cards match an existing deck of the same kind asks before adding another copy. Deleting any deck asks first; deleting a token deck also names the decks that use its tokens. Deleting a deck also removes its cards, images and rulings, unless another deck or a saved game still uses them.

**Delete all decks.** At the bottom of the Decks screen, one button deletes every deck except the built-in ones (the sample decks and basic tokens), after a confirmation that names how many go, for a clean start before re-importing. Cards a saved game still uses stay until that game is deleted.

**Deck page.** Shows the deck's cards as a grid with counts (commanders first), with Rename and Delete. Tapping a card shows it full screen in the large size, drawn like the game's full view: the ← and → signs at the sides show where a swipe leads, and right under the card, centred, "Rulings (n)" for a card with rulings, which opens the same rulings panel as in a game (Escape or Back closes the panel first). Below that, a caption gives its name, its count in the deck, its position ("3 of 12"), and Flip for a double-faced card. A sideways swipe or an arrow key goes to the previous or next card, stopping at the ends; a swipe down, a tap on the card, a tap outside it or Escape returns to the deck.

**Back up and restore.** Any set of decks can be saved to one backup file, with their token decks, every image size, each card's rules text and its rulings, and restored on any device and browser without internet.

- On the Backup screen, built-in decks are greyed out ("built in · on every device"), and token decks made for other decks follow those decks ("included with its decks").
- Before restoring, each deck in the file is shown as New, Will update (the same deck is on the device), Built in here, or Possible duplicate (same name or cards as a deck on the device, under another id). New and Will update decks are selected by default. Restoring a deck that is already here replaces it with the backup's: its name, cards, rules text and rulings (whichever rulings were fetched more recently are kept). A token deck is merged instead, keeping the tokens and decks this device's copy already has, since one token deck serves many decks. Built-in decks are never changed. A possible duplicate is added as a separate deck only if selected. Saved games are not affected.
- After decks are added, the app asks the browser to keep its storage rather than clear it when space runs low. The Decks screen shows whether it agreed and how much space is used.

**Decks**

- In a game, the player who selected a deck owns its cards.
- Many cards share one back image; it is stored once.
- No limits on deck size or card types.

**Lifecycle**

- **New game.** Choose One device, Host (two devices) or Join (two devices). Enter names (the guest enters only their own), and pick one or more decks per player; both players may pick the same deck, and every player needs at least one. Set starting life: 20, 30, 40 or any number. The last setup is remembered. The app shuffles each library and deals 7 cards to each hand; player 1 goes first. Mulligans are manual.
- **Pass turn.** Only the active player has it, in the footer and the menu (on one device, also while the hands are blinded, so the attacker need not unblind to pass). After a confirmation ("End Lawrence's turn?", with **Pass to Claire**), hands the turn to the other player, untaps that player's battlefield and lands, clears combat marks, and logs a turn marker. On one device it also blinds the hand, so the next player unblinds to their own side.
- **Concede** ends the game; a banner names the winner, and the log records the result.
- **Rematch** starts a new game with the same decks.
- **Resume.** The home screen lists games in progress on this device, and a joined game (on a guest device). Tapping a row opens it (resume, or reconnect for a joined game); a trash icon deletes it (or forgets a joined game), after asking. Each row shows the game's name, or "\<player 1> vs \<player 2>", then the players (when named), one or two devices, the turn or the result, and when it was last played. The host reopens its saved game and re-pairs with the guest.
- **Finished games.** Below the games in progress, the home screen lists finished games with the result ("**Claire** won (concession)", the winner's name in gold, or "Game over" with no winner) and the number of turns, opened and deleted the same way, and a **Delete all** button that asks first. Open shows the game as it ended: the board, the result, the whole log and Export log. Undo there continues the game, which goes back to the games in progress (only that one step: a finished game keeps just its last undo). The 20 most recently played finished games are kept; older ones are deleted with their logs.
- **Order.** Both lists put the most recently played game first. Playing means changing the game (a move or an undo); opening a game, pointing, dice or looking at a library don't count, so opening a game by mistake doesn't move it.
- **Game name.** New game has an optional Game name field (one device and host). Without one, the game is called "\<player 1> vs \<player 2>". It is not remembered for the next game; a rematch keeps it.
- **Game links.** During a game the address bar holds a link to it (#game=\<id>). Opening that link, or reloading the page, reopens the game on the device that has it, with hands blinded on one device. On a guest device it opens the reconnect screen. Any other device says the game isn't saved there, since a game is kept only on its host. A finished game's link opens that finished game. Game ids carry the date plus 80 random bits, so ids from different devices never clash in practice.

## Action log

Every game produces a complete record of what happened, kept for review and as future LLM training data. The footer ticker shows the latest action, and Recent actions lists every line since the game began, newest first, with times, including after the game is resumed (on the device that hosts it). Lines are numbered by turn and action (7.1, 7.2…). Each turn's start ("Turn 7: Lawrence", and the new game line) is unnumbered and stands out as a light band with dark text; alerts are in the warning colour.

For every action the record captures:

- who did it (`table` in same-device mode while hands are blinded)
- what the action was, and its description as shown in the ticker
- which card, and where it moved from and to
- what each player could see before and after
- when it happened

It also records rejected actions, turn boundaries, and full snapshots of the board at the start, at every turn and at the end. Undos are recorded, never erased. Each game can be exported as a JSON Lines file from Recent actions or the menu (on the host; on one device once the game is over).

## Related docs

- [Technical Design v2 (TypeScript + Vite)](./technical-design-v2.md): the rewrite in progress; architecture, stack, schemas, protocol. The [Technical Design v1](./technical-design-v1.md) describes the code until v2 ships
- [Implementation plan](./implementation-plan.md): milestones, testing, dev environment
