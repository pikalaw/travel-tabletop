// The home screen: new game, decks, games in progress, a joined game, and updates.

import { useEffect, useState } from 'preact/hooks';
import { confirmBox } from './Dialogs';
import { listGames, deleteGame, deleteGames, getMeta, setMeta, staleDecks, FINISHED_KEEP } from '../storage/db';
import { APP_VERSION, BUILD_ID } from '../version';
import type { Deck, GameRecord, GuestGameMeta } from '../types/storage';
import type { Go } from './routes';

function isGuestGame(x: unknown): x is GuestGameMeta {
  const g = x as Partial<GuestGameMeta> | null;
  return !!g && typeof g === 'object' && typeof g.gameId === 'string' && typeof g.hostName === 'string' && typeof g.name === 'string' && Array.isArray(g.deckIds);
}

export interface HomeProps {
  go: Go;
  resume: (id: string) => void;
  rejoin: (g: GuestGameMeta) => void;
  /** Set when a new version is waiting: activates it and reloads. */
  update: (() => void) | null;
  notice?: string | undefined;
}

export function Home({ go, resume, rejoin, update, notice }: HomeProps) {
  const [games, setGames] = useState<GameRecord[]>([]); // most recently opened first
  const [guestGame, setGuestGame] = useState<GuestGameMeta | null>(null);
  const [stale, setStale] = useState<Deck[]>([]);
  const refresh = () => {
    void staleDecks().then(setStale);
    void listGames().then((gs) => setGames(gs.filter((g) => g.state.turn > 0)));
    void getMeta('guestGame').then((g) => setGuestGame(isGuestGame(g) ? g : null));
  };
  useEffect(() => { refresh(); }, []);
  const playing = games.filter((g) => !g.over), finished = games.filter((g) => g.over);
  async function remove(g: GameRecord) {
    if (!(await confirmBox({ title: 'Delete this game?', body: 'The saved game and its action log are removed from this device.', ok: 'Delete', danger: true }))) return;
    await deleteGame(g.id);
    refresh();
  }
  async function removeAll() {
    const n = finished.length;
    if (!(await confirmBox({ title: `Delete ${n === 1 ? 'the finished game' : `all ${n} finished games`}?`, body: 'Their boards and action logs are removed from this device. Export any logs you want to keep first.', ok: 'Delete all', danger: true }))) return;
    await deleteGames(finished.map((g) => g.id));
    refresh();
  }
  return (
    <div class="page home">
      <div class="hero">
        <h1>Travel Tabletop</h1>
        <p class="muted">A rules-free Magic playmat for one or two devices. Works offline.</p>
      </div>
      {notice ? <div class="notice warn">{notice}</div> : null}
      {update ? <div class="notice">A new version is ready. <button class="btn primary" onClick={update}>Update now</button></div> : null}
      {stale.length ? (
        <div class="notice warn">
          {stale.length === 1 ? '1 deck was' : `${stale.length} decks were`} imported before card text was saved: {stale.map((d) => d.name).join(', ')}.
          Delete and re-import {stale.length === 1 ? 'it' : 'them'} to get rules text and rulings. <button class="btn" onClick={() => go('decks')}>Decks</button>
        </div>
      ) : null}
      <div class="home-actions">
        <button class="btn primary big" onClick={() => go('setup')}>New game</button>
        <button class="btn big" onClick={() => go('decks')}>Decks</button>
      </div>
      {playing.length ? (
        <>
          <h2>Games in progress</h2>
          <ul class="game-list">{playing.map((g) => (
            <GameRow g={g} detail={`turn ${g.state.turn}`} open="Resume" onOpen={() => resume(g.id)} onDelete={() => remove(g)} />
          ))}</ul>
        </>
      ) : null}
      {finished.length ? (
        <>
          <div class="section-head">
            <h2>Finished games</h2>
            <button class="btn ghost" onClick={() => void removeAll()}>Delete all</button>
          </div>
          <ul class="game-list">{finished.map((g) => (
            <GameRow g={g} detail={`${resultText(g)} · ${g.state.turn} ${g.state.turn === 1 ? 'turn' : 'turns'}`} open="Open" onOpen={() => resume(g.id)} onDelete={() => remove(g)} />
          ))}</ul>
          <p class="muted small">The last {FINISHED_KEEP} finished games are kept; older ones are deleted with their logs.</p>
        </>
      ) : null}
      {guestGame ? (
        <>
          <h2>Joined game</h2>
          <ul class="game-list"><li>
            <span>Guest in {guestGame.hostName}'s game</span>
            <button class="btn" onClick={() => rejoin(guestGame)}>Reconnect</button>
            <button class="btn ghost" onClick={async () => { await setMeta('guestGame', null); refresh(); }}>Forget</button>
          </li></ul>
        </>
      ) : null}
      <p class="muted small foot">Version {APP_VERSION} (build {BUILD_ID}). Card images you import come from Scryfall; sample cards are placeholders.</p>
    </div>
  );
}

/** "Claire won (concession)", or "Game over" when a game was ended with no winner. */
function resultText(g: GameRecord): string {
  const r = g.state.result;
  if (!r?.winner) return 'Game over';
  return `${g.state.players[r.winner].name} won${r.reason === 'concede' ? ' (concession)' : ''}`;
}

function GameRow({ g, detail, open, onOpen, onDelete }: { g: GameRecord; detail: string; open: string; onOpen: () => void; onDelete: () => void }) {
  return (
    <li>
      <span>{g.state.players.p1.name} vs {g.state.players.p2.name} · {g.mode === 'networked' ? 'two devices' : 'one device'} · {detail} · {new Date(g.openedAt ?? g.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
      <button class="btn" onClick={onOpen}>{open}</button>
      <button class="btn ghost" onClick={onDelete}>Delete</button>
    </li>
  );
}
