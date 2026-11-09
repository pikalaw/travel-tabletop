// App shell: routing between home, decks, game setup, pairing and the game screen.

import { useEffect, useRef, useState } from 'preact/hooks';
import { toast, useToasts } from './toast';
import { Dialogs } from './Dialogs';
import { Game, type PairingControl } from './Game';
import { Home } from './Home';
import { Setup, type StartGame } from './Setup';
import { DecksScreen, DeckScreen, ImportScreen, BackupScreen, RestoreScreen } from './Decks';
import { HostPairFlow, GuestPairFlow } from './Pairing';
import { newGameId, parseGameLink, setGameLink } from './link';
import type { Go, Route, RouteArgs } from './routes';
import { Host } from '../host/host';
import { LocalSession, GuestSession, type Session } from '../client/session';
import { deckSpec, buildHello, guestHandshake, hostHandshake } from '../client/net';
import { ensureFixtures } from '../storage/fixtures';
import { listDecks, gamePersistence, getGame, loadSnapshots, loadLog, getMeta, setMeta } from '../storage/db';
import type { Deck, GameRecord, GameSetup, GuestGameMeta } from '../types/storage';
import type { GameMode, GameState } from '../types/state';
import type { DeckSpec } from '../types/protocol';
import type { StatePayloads } from '../types/commands';

const errText = (e: unknown) => String((e as Error | null)?.message || e);

type GameMeta = Pick<GameRecord, 'mode' | 'role' | 'setup'>;
interface OpenGame { session: Session; rematch: (() => void) | undefined; pairing: PairingControl | null }

/** Set from main.tsx once the service worker reports a waiting update (step 4.1). */
export interface AppProps { update?: (() => void) | null }

export function App({ update = null }: AppProps) {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [game, setGame] = useState<OpenGame | null>(null);
  const gameRef = useRef<OpenGame | null>(null);
  gameRef.current = game;
  const toasts = useToasts();
  const go: Go = (name, arg) => setRoute({ name, arg } as Route);

  useEffect(() => {
    void ensureFixtures().catch((e: unknown) => toast(`Could not set up sample decks: ${errText(e)}`, 'warn')).finally(() => void openLink(location.hash));
  }, []);

  // A game link (#game=<id>) reopens that game if this device has it.
  async function openLink(hash: string) {
    const id = parseGameLink(hash);
    if (!id) { go('home'); return; }
    const rec = await getGame(id).catch(() => undefined);
    if (rec && !rec.over && rec.state.turn > 0) { await resume(id); return; }
    const guest = (await getMeta('guestGame').catch(() => null)) as GuestGameMeta | null;
    if (guest?.gameId === id) { setGameLink(null); await rejoin(guest); return; }
    setGameLink(null);
    go('home', {
      notice: rec ? 'That game has ended.'
        : 'That game isn’t saved on this device. A game is kept only on the device that hosts it, so open the link there.',
    });
  }
  useEffect(() => {
    const onHash = () => { if (!gameRef.current) void openLink(location.hash); else setGameLink(gameRef.current.session.state.gameId); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Host-side game construction.
  function makeHost(meta: GameMeta, state?: GameState, snapshots?: { key: number; state: GameState }[], logSeq?: number) {
    return new Host({
      ...(state ? { state } : {}), ...(snapshots ? { snapshots } : {}), ...(logSeq !== undefined ? { logSeq } : {}),
      persist: gamePersistence(meta),
    });
  }

  async function startPayload(setup: GameSetup, gameId: string, mode: GameMode, guest?: { name: string; spec: DeckSpec } | null): Promise<StatePayloads['startGame']> {
    const allDecks = await listDecks();
    const pick = (ids: string[] | undefined) => (ids || []).map((id) => allDecks.find((d) => d.id === id)).filter((d): d is Deck => !!d);
    const p1 = await deckSpec(pick(setup.p1?.deckIds));
    const p2 = guest ? guest.spec : await deckSpec(pick(setup.p2?.deckIds));
    return {
      gameId, mode, startingLife: setup.life ?? 20,
      players: {
        p1: { name: setup.p1?.name || 'Player 1', cards: p1.cards, commanders: p1.commanders || [] },
        p2: { name: guest ? guest.name : setup.p2?.name || 'Player 2', cards: p2.cards, commanders: p2.commanders || [] },
      },
    };
  }

  const startGame: StartGame = async (opts) => {
    if (opts.kind === 'same-device') {
      const meta: GameMeta = { mode: 'same-device', role: 'host', setup: opts.setup };
      const host = makeHost(meta);
      const payload = await startPayload(opts.setup, newGameId(), 'same-device');
      host.dispatch({ type: 'startGame', actor: 'host', payload });
      const session = new LocalSession(host, { mode: 'same-device' });
      openGame(session, meta);
      return;
    }
    if (opts.kind === 'host') {
      const meta: GameMeta = { mode: 'networked', role: 'host', setup: opts.setup };
      const host = makeHost(meta);
      const session = new LocalSession(host, { mode: 'host', me: 'p1' });
      hostHandshake(session, opts.transport, {
        startNew: async (hello) => {
          meta.setup = { ...opts.setup, p2: { name: hello.name, spec: hello.spec } };
          const payload = await startPayload(opts.setup, newGameId(), 'networked', hello);
          host.dispatch({ type: 'startGame', actor: 'host', payload });
        },
        onReady: () => openGame(session, meta),
        onError: (m) => { toast(m, 'warn', 8000); opts.onError?.(m); },
      });
      return;
    }
    const hello = await buildHello({ name: opts.name, decks: opts.decks, gameId: opts.gameId ?? null });
    const welcome = await guestHandshake(opts.transport, hello);
    const session = new GuestSession(opts.transport, { me: welcome.player, state: welcome.state, version: welcome.version });
    const note = (): GuestGameMeta => ({ gameId: session.state.gameId, hostName: session.state.players.p1.name, name: opts.name, deckIds: opts.decks.map((d) => d.id) });
    await setMeta('guestGame', note());
    session.subscribe(() => { if (session.state.gameId) void setMeta('guestGame', note()); });
    openGame(session, null, { name: opts.name, decks: opts.decks });
  };

  function openGame(session: LocalSession | GuestSession, meta: GameMeta | null, guestInfo?: { name: string; decks: Deck[] }) {
    let pairing: PairingControl | null = null;
    if (session instanceof LocalSession && session.kind === 'host') {
      pairing = {
        render: (done) => <HostPairFlow onTransport={(t) => hostHandshake(session, t, {
          startNew: async () => {},
          onReady: () => { toast('Guest reconnected.', 'info'); done(); },
          onError: (m) => toast(m, 'warn', 8000),
        })} />,
      };
    } else if (session instanceof GuestSession && guestInfo) {
      pairing = {
        render: (done) => <GuestPairFlow onTransport={async (t) => {
          try {
            const hello = await buildHello({ name: guestInfo.name, decks: guestInfo.decks, gameId: session.state.gameId });
            const welcome = await guestHandshake(t, hello);
            session.attach(t);
            session.resync(welcome.state, welcome.version);
            toast('Reconnected.', 'info');
            done();
          } catch (e) { toast(errText(e), 'warn', 8000); }
        }} />,
      };
    }
    const rematch = session instanceof LocalSession && meta ? async () => {
      const p2 = meta.setup.p2;
      const payload = await startPayload(meta.setup, newGameId(), session.state.mode, p2?.spec ? { name: p2.name, spec: { cards: p2.spec.cards, commanders: p2.spec.commanders || [] } } : null);
      session.host.dispatch({ type: 'startGame', actor: 'host', payload });
    } : undefined;
    setGame({ session, rematch: rematch ? () => void rematch() : undefined, pairing });
    go('game');
  }

  async function resume(id: string) {
    const rec = await getGame(id);
    if (!rec) return;
    const snaps = await loadSnapshots(id);
    const log = await loadLog(id);
    const meta: GameMeta = { mode: rec.mode, role: rec.role, setup: rec.setup };
    const host = makeHost(meta, rec.state, snaps, log.length ? log[log.length - 1]!.seq : 0);
    const session = new LocalSession(host, { mode: rec.mode === 'networked' ? 'host' : 'same-device', me: 'p1' });
    openGame(session, meta);
  }

  async function rejoin(g: GuestGameMeta) {
    const allDecks = await listDecks();
    const decks = (g.deckIds || []).map((id) => allDecks.find((d) => d.id === id)).filter((d): d is Deck => !!d);
    setRoute({ name: 'rejoin', arg: { ...g, decks } });
  }

  const exitGame = () => {
    const s = game?.session;
    if (s instanceof LocalSession || s instanceof GuestSession) s.close();
    setGame(null);
    go('home');
  };

  let screen = null;
  switch (route.name) {
    case 'loading': screen = <div class="page"><p>Getting the table ready…</p></div>; break;
    case 'home': screen = <Home go={go} resume={(id) => void resume(id)} rejoin={(g) => void rejoin(g)} update={update} notice={route.arg?.notice} />; break;
    case 'decks': screen = <DecksScreen go={go} />; break;
    case 'deck': screen = route.arg ? <DeckScreen go={go} id={route.arg} /> : null; break;
    case 'import': screen = <ImportScreen go={go} />; break;
    case 'backup': screen = <BackupScreen go={go} />; break;
    case 'restore': screen = <RestoreScreen go={go} />; break;
    case 'setup': screen = <Setup go={go} startGame={startGame} />; break;
    case 'rejoin': {
      const arg = route.arg as RouteArgs['rejoin'];
      screen = (
        <div class="page">
          <header class="page-head"><button class="btn ghost" onClick={() => go('home')}>← Home</button><h1>Reconnect to {arg.hostName}</h1></header>
          <p class="muted">On the host device, open the game menu and choose “Re-pair the guest device”.</p>
          <GuestPairFlow onTransport={async (t) => {
            try { await startGame({ kind: 'guest', name: arg.name, decks: arg.decks, transport: t, gameId: arg.gameId }); }
            catch (e) { toast(errText(e), 'warn', 8000); }
          }} />
        </div>
      );
      break;
    }
    case 'game':
      screen = game ? <Game key={game.session.state.gameId} session={game.session} onExit={exitGame} onRematch={game.rematch} pairing={game.pairing} /> : null;
      break;
  }
  return (
    <>
      {screen}
      <div class="toasts" aria-live="polite">{toasts.map((t) => <div class={`toast ${t.kind}`}>{t.text}</div>)}</div>
      <Dialogs />
    </>
  );
}
