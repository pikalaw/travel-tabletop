// The home screen: new game, decks, games in progress, a joined game, and updates.

import { useEffect, useState } from 'preact/hooks';
import { confirmBox } from './Dialogs';
import { listGames, deleteGame, getMeta, setMeta, staleDecks } from '../storage/db';
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
  const [games, setGames] = useState<GameRecord[]>([]);
  const [guestGame, setGuestGame] = useState<GuestGameMeta | null>(null);
  const [stale, setStale] = useState<Deck[]>([]);
  const refresh = () => {
    void staleDecks().then(setStale);
    void listGames().then((gs) => setGames(gs.filter((g) => !g.over && g.state.turn > 0)));
    void getMeta('guestGame').then((g) => setGuestGame(isGuestGame(g) ? g : null));
  };
  useEffect(() => { refresh(); }, []);
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
      {games.length ? (
        <>
          <h2>Games in progress</h2>
          <ul class="game-list">{games.map((g) => (
            <li>
              <span>{g.state.players.p1.name} vs {g.state.players.p2.name} · {g.mode === 'networked' ? 'two devices' : 'one device'} · turn {g.state.turn} · {new Date(g.updatedAt).toLocaleString()}</span>
              <button class="btn" onClick={() => resume(g.id)}>Resume</button>
              <button class="btn ghost" onClick={async () => { if (await confirmBox({ title: 'Delete this game?', body: 'The saved game and its action log are removed from this device.', ok: 'Delete', danger: true })) { await deleteGame(g.id); refresh(); } }}>Delete</button>
            </li>
          ))}</ul>
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
