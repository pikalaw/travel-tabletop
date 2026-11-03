# v1 regression fixtures

Recorded from v1 (tag `v1`) by `record.py` + `record.js`: one scripted same-device game played through v1's real `Host`, using every state command (26 types), every notice kind (11), five kinds of rejection (stale, and invalid for four reasons), undo, a concession that is undone, and an ended game.

| File | What it is | What v2 must do with it |
| --- | --- | --- |
| `game.jsonl` | The game's exported action log (manifest line, then every entry) | `replay` reaches `final-state.json` exactly; regenerated ticker text equals each entry's `text` |
| `final-state.json` | v1's state at the end of that game | The comparison target |
| `sample-decks.mtgdecks` | A backup of the two sample decks and the built-in token deck (30 card defs, 2 double-faced, 32 images) | Reads and restores |
| `records.json` | The IndexedDB records v1 wrote (decks, defs, games, meta; snapshot keys) | v2's typed readers accept them |

These prove the port behaves like v1. They are not a promise that v2 reads data saved by v1 devices.

To re-record, check out tag `v1`, serve the repository root on port 8767 (`python3 -m http.server 8767`), and run `python3 tests/fixtures/v1/record.py`.
