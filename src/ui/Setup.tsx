// The new-game screen: one device, host or join; players' names, decks and starting life.

import { useEffect, useState } from 'preact/hooks';
import { HostPairFlow, GuestPairFlow } from './Pairing';
import { listDecks, getMeta, setMeta } from '../storage/db';
import type { Deck, GameSetup } from '../types/storage';
import type { PlayerId } from '../types/state';
import type { Transport } from '../transport/transport';
import type { Go } from './routes';

/** How the app starts a game; the shell implements it. */
export type StartGame = (opts:
  | { kind: 'same-device'; setup: GameSetup }
  | { kind: 'host'; setup: GameSetup; transport: Transport; onError?: (m: string) => void }
  | { kind: 'guest'; name: string; decks: Deck[]; transport: Transport; gameId?: string | null }
) => Promise<void>;

interface LastSetup { names: Record<PlayerId, string>; pick: Record<PlayerId, string[]>; life: number }

function isLastSetup(x: unknown): x is LastSetup {
  const s = x as Partial<LastSetup> | null;
  return !!s && typeof s === 'object' && !!s.names && !!s.pick && typeof s.life === 'number'
    && Array.isArray(s.pick.p1) && Array.isArray(s.pick.p2) && typeof s.names.p1 === 'string' && typeof s.names.p2 === 'string';
}

const errText = (e: unknown) => String((e as Error | null)?.message || e);

function DeckPicker({ decks, selected, onToggle }: { decks: Deck[]; selected: string[]; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div class="deck-pick">
      {decks.filter((d) => d.kind === 'deck').map((d) => (
        <label class={`deck-check ${selected.includes(d.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={selected.includes(d.id)} onChange={(e) => onToggle(d.id, e.currentTarget.checked)} />
          <span>{d.name}</span><span class="muted small">{d.cards.length + (d.commanders?.length || 0)}</span>
        </label>
      ))}
    </div>
  );
}

export function Setup({ go, startGame }: { go: Go; startGame: StartGame }) {
  const [mode, setMode] = useState<'same' | 'host' | 'join'>('same');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [names, setNames] = useState<Record<PlayerId, string>>({ p1: 'Player 1', p2: 'Player 2' });
  const [pick, setPick] = useState<Record<PlayerId, string[]>>({ p1: [], p2: [] });
  const [life, setLife] = useState(20);
  const [gameName, setGameName] = useState('');
  const [stage, setStage] = useState<'form' | 'host' | 'join'>('form');
  const [err, setErr] = useState('');
  useEffect(() => {
    // Decks and the last setup arrive together, so the checklist never shows before its picks
    // (a late reset would undo a choice made in between).
    void Promise.all([listDecks(), getMeta('lastSetup')]).then(([ds, s]) => {
      const d = ds.filter((x) => x.kind === 'deck');
      if (isLastSetup(s)) { setNames(s.names); setPick(s.pick); setLife(s.life); }
      else setPick({ p1: d[0] ? [d[0].id] : [], p2: d[1] ? [d[1].id] : d[0] ? [d[0].id] : [] });
      setDecks(ds);
    });
  }, []);
  const decksOf = (ids: string[]) => ids.map((id) => decks.find((d) => d.id === id)).filter((d): d is Deck => !!d);
  const saveSetup = () => setMeta('lastSetup', { names, pick, life } satisfies LastSetup);
  const named = (s: GameSetup): GameSetup => (gameName.trim() ? { ...s, name: gameName.trim() } : s);

  const startSame = async () => {
    if (!pick.p1.length || !pick.p2.length) { setErr('Each player needs at least one deck.'); return; }
    await saveSetup();
    const setup = named({ p1: { name: names.p1, deckIds: pick.p1 }, p2: { name: names.p2, deckIds: pick.p2 }, life });
    await startGame({ kind: 'same-device', setup });
  };

  if (stage === 'host') {
    return (
      <div class="page">
        <header class="page-head"><button class="btn ghost" onClick={() => setStage('form')}>← Back</button><h1>Host a game</h1></header>
        {err ? <p class="error">{err}</p> : null}
        <HostPairFlow onTransport={async (t) => {
          const setup = named({ p1: { name: names.p1, deckIds: pick.p1 }, life });
          try { await startGame({ kind: 'host', setup, transport: t, onError: setErr }); } catch (e) { setErr(errText(e)); }
        }} />
      </div>
    );
  }
  if (stage === 'join') {
    return (
      <div class="page">
        <header class="page-head"><button class="btn ghost" onClick={() => setStage('form')}>← Back</button><h1>Join a game</h1></header>
        {err ? <p class="error">{err}</p> : null}
        <GuestPairFlow onTransport={async (t) => {
          try { await startGame({ kind: 'guest', name: names.p1, decks: decksOf(pick.p1), transport: t }); }
          catch (e) { setErr(errText(e)); t.close(); }
        }} />
      </div>
    );
  }

  const playerForm = (pl: PlayerId, title: string) => (
    <fieldset class="player-form">
      <legend>{title}</legend>
      <label>Name <input value={names[pl]} onInput={(e) => setNames({ ...names, [pl]: e.currentTarget.value })} /></label>
      <div class="muted small">Decks: pick one or more. Cards from all chosen decks are shuffled into one library. Both players may pick the same deck.</div>
      <DeckPicker decks={decks} selected={pick[pl]}
        onToggle={(id, on) => setPick((prev) => ({ ...prev, [pl]: on ? [...prev[pl].filter((x) => x !== id), id] : prev[pl].filter((x) => x !== id) }))} />
    </fieldset>
  );

  return (
    <div class="page">
      <header class="page-head"><button class="btn ghost" onClick={() => go('home')}>← Home</button><h1>New game</h1></header>
      <div class="seg big">
        <button class={`btn ${mode === 'same' ? 'on' : 'ghost'}`} onClick={() => setMode('same')}>One device</button>
        <button class={`btn ${mode === 'host' ? 'on' : 'ghost'}`} onClick={() => setMode('host')}>Host (two devices)</button>
        <button class={`btn ${mode === 'join' ? 'on' : 'ghost'}`} onClick={() => setMode('join')}>Join (two devices)</button>
      </div>
      {err ? <p class="error">{err}</p> : null}
      {mode !== 'join' ? (
        <label class="game-name">Game name <span class="muted small">(optional)</span>
          <input value={gameName} maxLength={60} placeholder={mode === 'same' ? `${names.p1} vs ${names.p2}` : `${names.p1} vs …`}
            onInput={(e) => setGameName(e.currentTarget.value)} />
        </label>
      ) : null}
      <div class="setup-grid">
        {playerForm('p1', mode === 'same' ? 'Player 1' : 'You')}
        {mode === 'same' ? playerForm('p2', 'Player 2') : null}
      </div>
      {mode !== 'join' ? (
        <div class="life-pick">Starting life
          {[20, 30, 40].map((v) => <button class={`btn ${life === v ? 'on' : 'ghost'}`} onClick={() => setLife(v)}>{v}</button>)}
          <input type="number" value={life} onInput={(e) => setLife(parseInt(e.currentTarget.value, 10) || 20)} />
        </div>
      ) : null}
      <div class="actions">
        {mode === 'same' ? <button class="btn primary big" onClick={() => void startSame()}>Start game</button> : null}
        {mode === 'host' ? <button class="btn primary big" onClick={async () => { if (!pick.p1.length) { setErr('Choose at least one deck.'); return; } await saveSetup(); setErr(''); setStage('host'); }}>Next: pair the guest</button> : null}
        {mode === 'join' ? <button class="btn primary big" onClick={async () => { if (!pick.p1.length) { setErr('Choose at least one deck.'); return; } await saveSetup(); setErr(''); setStage('join'); }}>Next: scan the host's code</button> : null}
      </div>
      {mode === 'same' ? <p class="muted small">Hands start blinded. Tap the eye in the footer and pick your name to see your hand; the board switches to that player's side.</p> : null}
    </div>
  );
}
