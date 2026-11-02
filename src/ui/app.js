// App shell: routing between home, decks, game setup, pairing and the game screen.

import { html, render, useState, useEffect, useRef, useToasts, toast } from './h.js';
import { Game } from './game.js';
import { DecksScreen, DeckScreen, ImportScreen, BackupScreen, RestoreScreen } from './decks.js';
import { ShowCode, ReadCode } from './pairing.js';
import { Host } from '../host/host.js';
import { LocalSession, GuestSession } from '../client/session.js';
import { deckSpec, buildHello, checkHello, checkWelcome, tokenDefIds } from '../client/net.js';
import { createOffer, acceptAnswer, answerOffer, unlockLocalNetwork } from '../transport/webrtc.js';
import { ensureFixtures } from '../storage/fixtures.js';
import { listDecks, gamePersistence, listGames, getGame, loadSnapshots, loadLog, deleteGame, getMeta, setMeta } from '../storage/db.js';
import { APP_VERSION } from '../version.js';

import { newGameId, parseGameLink, setGameLink } from './link.js';

// ---------- Pairing flows (shared by first pairing and re-pairing) ----------

function HostPairFlow({ onTransport }) {
  const [step, setStep] = useState('start');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const offer = useRef(null);
  const begin = async (camera) => {
    setErr('');
    setStep('working');
    if (camera) await unlockLocalNetwork();
    try {
      offer.current = await createOffer();
      setCode(offer.current.code);
      setStep('offer');
    } catch (e) { setErr(String(e.message || e)); setStep('start'); }
  };
  const onAnswer = async (ans) => {
    setStep('connecting'); setErr('');
    try { onTransport(await acceptAnswer(offer.current.pc, offer.current.dc, ans)); }
    catch (e) { setErr(String(e.message || e)); setStep('scan'); }
  };
  return html`<div class="pair">
    ${err ? html`<p class="error">${err}</p>` : null}
    ${step === 'start' ? html`<div class="pair-step">
      <p>Both devices must be on the same Wi-Fi or phone hotspot. No internet is needed.</p>
      <p class="muted small">The app asks for the camera first: you need it to scan the guest's code, and it also lets the two devices find each other directly on the local network.</p>
      <button class="btn primary" onClick=${() => begin(true)}>Allow camera and create code</button>
      <button class="btn ghost" onClick=${() => begin(false)}>Create code without camera (text pairing)</button>
    </div>` : null}
    ${step === 'working' ? html`<p>Creating pairing code…</p>` : null}
    ${step === 'offer' ? html`<div class="pair-step">
      <h3>1. On the guest device, choose Join and scan this code</h3>
      <${ShowCode} code=${code} caption="Or copy the text code and paste it on the guest."/>
      <button class="btn primary" onClick=${() => setStep('scan')}>2. Next: scan the guest's code</button>
    </div>` : null}
    ${step === 'scan' ? html`<div class="pair-step">
      <h3>2. Scan the code now showing on the guest device</h3>
      <${ReadCode} onCode=${onAnswer} prompt="Point the camera at the guest's screen, or paste its text code."/>
      <button class="btn ghost" onClick=${() => setStep('offer')}>Back to my code</button>
    </div>` : null}
    ${step === 'connecting' ? html`<p>Connecting…</p>` : null}
  </div>`;
}

function GuestPairFlow({ onTransport }) {
  const [step, setStep] = useState('scan');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const onOffer = async (offerCode) => {
    setErr(''); setStep('working');
    try {
      const a = await answerOffer(offerCode);
      setCode(a.code);
      setStep('answer');
      onTransport(await a.transport);
    } catch (e) { setErr(String(e.message || e)); setStep('scan'); }
  };
  return html`<div class="pair">
    ${err ? html`<p class="error">${err}</p>` : null}
    ${step === 'scan' ? html`<div class="pair-step">
      <h3>1. Scan the code on the host device</h3>
      <${ReadCode} onCode=${onOffer} prompt="Both devices must be on the same Wi-Fi or phone hotspot."/>
    </div>` : null}
    ${step === 'working' ? html`<p>Reading code…</p>` : null}
    ${step === 'answer' ? html`<div class="pair-step">
      <h3>2. Show this code to the host device</h3>
      <${ShowCode} code=${code} caption="The host scans it (or pastes the text). This screen continues once connected."/>
    </div>` : null}
  </div>`;
}

// ---------- Handshake ----------

/** Host: handle a guest on `transport` for `session`. startNew(hello) starts the game when needed. */
function hostHandshake(session, transport, { startNew, onReady, onError }) {
  session.attach(transport, async (msg) => {
    if (msg.type === 'hello') {
      const refusal = await checkHello(msg);
      if (refusal) { transport.send(refusal); onError(refusal.missing ? `${refusal.detail} Missing: ${refusal.missing.slice(0, 8).join(', ')}${refusal.missing.length > 8 ? '…' : ''}` : refusal.detail); return; }
      const running = session.state.turn > 0 && !session.state.result;
      if (msg.gameId && running && msg.gameId === session.state.gameId) {
        // Reconnect to the running game.
      } else if (running && msg.gameId && msg.gameId !== session.state.gameId) {
        const r = { type: 'refuse', reason: 'game', detail: 'This host is running a different game. Join as a new game instead.' };
        transport.send(r); onError(r.detail); return;
      } else {
        await startNew(msg);
      }
      transport.send({ type: 'welcome', player: session.guestPlayer, state: session.state, version: session.version, tokens: await tokenDefIds() });
      session.sendFullState();
      onReady(msg);
    } else if (msg.type === 'refuse') {
      onError(`The guest cannot join: ${msg.detail || msg.reason}`);
    }
  });
}

/** Guest: send hello and wait for welcome. Resolves with the welcome message. */
function guestHandshake(transport, hello) {
  return new Promise((resolve, reject) => {
    const off = transport.onMessage(async (msg) => {
      if (msg.type === 'welcome') {
        off();
        const missing = await checkWelcome(msg);
        if (missing.length) {
          transport.send({ type: 'refuse', reason: 'cards', detail: `the guest device is missing ${missing.length} card images` });
          reject(new Error(`This device is missing ${missing.length} of the host's cards: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. Import the same decks here first.`));
          return;
        }
        resolve(msg);
      } else if (msg.type === 'refuse') {
        off();
        reject(new Error(msg.missing ? `${msg.detail} Missing: ${msg.missing.slice(0, 8).join(', ')}` : msg.detail));
      }
    });
    transport.send(hello);
  });
}

// ---------- Setup ----------

function DeckPicker({ decks, selected, onToggle }) {
  return html`<div class="deck-pick">
    ${decks.filter((d) => d.kind === 'deck').map((d) => html`<label class="deck-check ${selected.includes(d.id) ? 'on' : ''}">
      <input type="checkbox" checked=${selected.includes(d.id)} onChange=${(e) => onToggle(d.id, e.currentTarget.checked)}/>
      <span>${d.name}</span><span class="muted small">${d.cards.length + (d.commanders?.length || 0)}</span>
    </label>`)}
  </div>`;
}

function Setup({ go, startGame }) {
  const [mode, setMode] = useState('same');
  const [decks, setDecks] = useState([]);
  const [names, setNames] = useState({ p1: 'Player 1', p2: 'Player 2' });
  const [pick, setPick] = useState({ p1: [], p2: [] });
  const [life, setLife] = useState(20);
  const [stage, setStage] = useState('form');
  const [err, setErr] = useState('');
  useEffect(() => {
    listDecks().then((ds) => {
      setDecks(ds);
      const d = ds.filter((x) => x.kind === 'deck');
      getMeta('lastSetup').then((s) => {
        if (s) { setNames(s.names); setPick(s.pick); setLife(s.life); }
        else setPick({ p1: d[0] ? [d[0].id] : [], p2: d[1] ? [d[1].id] : d[0] ? [d[0].id] : [] });
      });
    });
  }, []);
  const decksOf = (ids) => ids.map((id) => decks.find((d) => d.id === id)).filter(Boolean);
  const saveSetup = () => setMeta('lastSetup', { names, pick, life });

  const startSame = async () => {
    if (!pick.p1.length || !pick.p2.length) { setErr('Each player needs at least one deck.'); return; }
    await saveSetup();
    const setup = { p1: { name: names.p1, deckIds: pick.p1 }, p2: { name: names.p2, deckIds: pick.p2 }, life };
    await startGame({ kind: 'same-device', setup });
  };

  if (stage === 'host') {
    return html`<div class="page">
      <header class="page-head"><button class="btn ghost" onClick=${() => setStage('form')}>← Back</button><h1>Host a game</h1></header>
      ${err ? html`<p class="error">${err}</p>` : null}
      <${HostPairFlow} onTransport=${async (t) => {
        const setup = { p1: { name: names.p1, deckIds: pick.p1 }, life };
        try { await startGame({ kind: 'host', setup, transport: t, onError: setErr }); } catch (e) { setErr(String(e.message || e)); }
      }}/>
    </div>`;
  }
  if (stage === 'join') {
    return html`<div class="page">
      <header class="page-head"><button class="btn ghost" onClick=${() => setStage('form')}>← Back</button><h1>Join a game</h1></header>
      ${err ? html`<p class="error">${err}</p>` : null}
      <${GuestPairFlow} onTransport=${async (t) => {
        try { await startGame({ kind: 'guest', name: names.p1, decks: decksOf(pick.p1), transport: t }); }
        catch (e) { setErr(String(e.message || e)); t.close?.(); }
      }}/>
    </div>`;
  }

  const playerForm = (pl, title) => html`<fieldset class="player-form">
    <legend>${title}</legend>
    <label>Name <input value=${names[pl]} onInput=${(e) => setNames({ ...names, [pl]: e.currentTarget.value })}/></label>
    <div class="muted small">Decks: pick one or more. Cards from all chosen decks are shuffled into one library. Both players may pick the same deck.</div>
    <${DeckPicker} decks=${decks} selected=${pick[pl]} onToggle=${(id, on) => setPick((prev) => ({ ...prev, [pl]: on ? [...prev[pl].filter((x) => x !== id), id] : prev[pl].filter((x) => x !== id) }))}/>
  </fieldset>`;

  return html`<div class="page">
    <header class="page-head"><button class="btn ghost" onClick=${() => go('home')}>← Home</button><h1>New game</h1></header>
    <div class="seg big">
      <button class="btn ${mode === 'same' ? 'on' : 'ghost'}" onClick=${() => setMode('same')}>One device</button>
      <button class="btn ${mode === 'host' ? 'on' : 'ghost'}" onClick=${() => setMode('host')}>Host (two devices)</button>
      <button class="btn ${mode === 'join' ? 'on' : 'ghost'}" onClick=${() => setMode('join')}>Join (two devices)</button>
    </div>
    ${err ? html`<p class="error">${err}</p>` : null}
    <div class="setup-grid">
      ${playerForm('p1', mode === 'same' ? 'Player 1' : 'You')}
      ${mode === 'same' ? playerForm('p2', 'Player 2') : null}
    </div>
    ${mode !== 'join' ? html`<div class="life-pick">Starting life
      ${[20, 30, 40].map((v) => html`<button class="btn ${life === v ? 'on' : 'ghost'}" onClick=${() => setLife(v)}>${v}</button>`)}
      <input type="number" value=${life} onInput=${(e) => setLife(parseInt(e.currentTarget.value, 10) || 20)}/>
    </div>` : null}
    <div class="actions">
      ${mode === 'same' ? html`<button class="btn primary big" onClick=${startSame}>Start game</button>` : null}
      ${mode === 'host' ? html`<button class="btn primary big" onClick=${async () => { if (!pick.p1.length) { setErr('Choose at least one deck.'); return; } await saveSetup(); setErr(''); setStage('host'); }}>Next: pair the guest</button>` : null}
      ${mode === 'join' ? html`<button class="btn primary big" onClick=${async () => { if (!pick.p1.length) { setErr('Choose at least one deck.'); return; } await saveSetup(); setErr(''); setStage('join'); }}>Next: scan the host's code</button>` : null}
    </div>
    ${mode === 'same' ? html`<p class="muted small">Hands start blinded. Use “Unblind to …” and your code to see your hand; the board switches to that player's side. Each player should type their own code without the other watching.</p>` : null}
  </div>`;
}

// ---------- Home ----------

function Home({ go, resume, rejoin, update, notice }) {
  const [games, setGames] = useState([]);
  const [guestGame, setGuestGame] = useState(null);
  const [build, setBuild] = useState('');
  useEffect(() => { // the installed build is the service worker's cache name, e.g. tabletop-0.1.0-8db24fb974
    try { caches.keys().then((ks) => setBuild((ks.find((k) => k.startsWith('tabletop-')) || '').split('-').pop() || '')).catch(() => {}); } catch {}
  }, []);
  const refresh = () => { listGames().then((gs) => setGames(gs.filter((g) => !g.over && g.state?.turn > 0))); getMeta('guestGame').then(setGuestGame); };
  useEffect(() => { refresh(); }, []);
  return html`<div class="page home">
    <div class="hero">
      <h1>Travel Tabletop</h1>
      <p class="muted">A rules-free Magic playmat for one or two devices. Works offline.</p>
    </div>
    ${notice ? html`<div class="notice warn">${notice}</div>` : null}
    ${update ? html`<div class="notice">A new version is ready. <button class="btn primary" onClick=${update}>Update now</button></div>` : null}
    <div class="home-actions">
      <button class="btn primary big" onClick=${() => go('setup')}>New game</button>
      <button class="btn big" onClick=${() => go('decks')}>Decks</button>
    </div>
    ${games.length ? html`<h2>Games in progress</h2>
      <ul class="game-list">${games.map((g) => html`<li>
        <span>${g.state.players.p1.name} vs ${g.state.players.p2.name} · ${g.mode === 'networked' ? 'two devices' : 'one device'} · turn ${g.state.turn} · ${new Date(g.updatedAt).toLocaleString()}</span>
        <button class="btn" onClick=${() => resume(g.id)}>Resume</button>
        <button class="btn ghost" onClick=${async () => { if (confirm('Delete this saved game and its log?')) { await deleteGame(g.id); refresh(); } }}>Delete</button>
      </li>`)}</ul>` : null}
    ${guestGame ? html`<h2>Joined game</h2><ul class="game-list"><li>
      <span>Guest in ${guestGame.hostName}'s game</span>
      <button class="btn" onClick=${() => rejoin(guestGame)}>Reconnect</button>
      <button class="btn ghost" onClick=${async () => { await setMeta('guestGame', null); refresh(); }}>Forget</button>
    </li></ul>` : null}
    <p class="muted small foot">Version ${APP_VERSION}${build ? ` (build ${build})` : ''}. Card images you import come from Scryfall; sample cards are placeholders.</p>
  </div>`;
}

// ---------- App ----------

function App() {
  const [route, setRoute] = useState({ name: 'loading' });
  const [game, setGame] = useState(null);   // { session, rematch, pairing }
  const [update, setUpdate] = useState(null);
  const gameRef = useRef(null);
  gameRef.current = game;
  const toasts = useToasts();
  const go = (name, arg) => setRoute({ name, arg });

  useEffect(() => {
    ensureFixtures().catch((e) => toast(`Could not set up sample decks: ${e.message}`, 'warn')).finally(() => openLink(location.hash));
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        const offer = (w) => setUpdate(() => () => { w.postMessage('skipWaiting'); });
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
        });
      }).catch(() => {});
      // Reload when an update takes over, but not on the very first visit, when the first install
      // takes control of a page that is already running the same files.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
    }
  }, []);

  // A game link (#game=<id>) reopens that game if this device has it.
  async function openLink(hash) {
    const id = parseGameLink(hash);
    if (!id) { go('home'); return; }
    const rec = await getGame(id).catch(() => null);
    if (rec && !rec.over && rec.state?.turn > 0) { await resume(id); return; }
    const guest = await getMeta('guestGame').catch(() => null);
    if (guest?.gameId === id) { setGameLink(null); await rejoin(guest); return; }
    setGameLink(null);
    go('home', {
      notice: rec ? 'That game has ended.'
        : 'That game isn’t saved on this device. A game is kept only on the device that hosts it, so open the link there.',
    });
  }
  useEffect(() => {
    const onHash = () => { if (!gameRef.current) openLink(location.hash); else setGameLink(gameRef.current.session.state.gameId); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Host-side game construction.
  async function makeHost(meta, state, snapshots, logSeq) {
    return new Host({ state, snapshots, logSeq, persist: gamePersistence(meta) });
  }

  async function startPayload(setup, gameId, mode, guest) {
    const allDecks = await listDecks();
    const pick = (ids) => ids.map((id) => allDecks.find((d) => d.id === id)).filter(Boolean);
    const p1 = await deckSpec(pick(setup.p1.deckIds));
    const p2 = guest ? guest.spec : await deckSpec(pick(setup.p2.deckIds));
    return {
      gameId, mode, startingLife: setup.life,
      players: {
        p1: { name: setup.p1.name, cards: p1.cards, commanders: p1.commanders },
        p2: { name: guest ? guest.name : setup.p2.name, cards: p2.cards, commanders: p2.commanders },
      },
    };
  }

  async function startGame(opts) {
    if (opts.kind === 'same-device') {
      const meta = { mode: 'same-device', role: 'host', setup: opts.setup };
      const host = await makeHost(meta);
      const payload = await startPayload(opts.setup, newGameId(), 'same-device');
      host.dispatch({ type: 'startGame', actor: 'host', payload });
      const session = new LocalSession(host, { mode: 'same-device' });
      openGame(session, meta);
      return;
    }
    if (opts.kind === 'host') {
      const meta = { mode: 'networked', role: 'host', setup: opts.setup };
      const host = await makeHost(meta);
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
    if (opts.kind === 'guest') {
      const hello = await buildHello({ name: opts.name, decks: opts.decks, gameId: opts.gameId });
      const welcome = await guestHandshake(opts.transport, hello);
      const session = new GuestSession(opts.transport, { me: welcome.player, state: welcome.state, version: welcome.version });
      await setMeta('guestGame', { gameId: welcome.state.gameId, hostName: welcome.state.players.p1.name, name: opts.name, deckIds: opts.decks.map((d) => d.id) });
      session.subscribe(() => { if (session.state.gameId) setMeta('guestGame', { gameId: session.state.gameId, hostName: session.state.players.p1.name, name: opts.name, deckIds: opts.decks.map((d) => d.id) }); });
      openGame(session, null, { name: opts.name, decks: opts.decks });
    }
  }

  function openGame(session, meta, guestInfo) {
    let pairing = null;
    if (session.kind === 'host') {
      pairing = {
        render: (done) => html`<${HostPairFlow} onTransport=${(t) => hostHandshake(session, t, {
          startNew: async () => {},
          onReady: () => { toast('Guest reconnected.', 'info'); done(); },
          onError: (m) => toast(m, 'warn', 8000),
        })}/>`,
      };
    } else if (session.kind === 'guest') {
      pairing = {
        render: (done) => html`<${GuestPairFlow} onTransport=${async (t) => {
          try {
            const hello = await buildHello({ name: guestInfo.name, decks: guestInfo.decks, gameId: session.state.gameId });
            const welcome = await guestHandshake(t, hello);
            session.attach(t);
            session.state = welcome.state;
            session.version = welcome.version;
            session.changed({ version: welcome.version });
            toast('Reconnected.', 'info');
            done();
          } catch (e) { toast(String(e.message || e), 'warn', 8000); }
        }}/>`,
      };
    }
    const rematch = session.kind !== 'guest' && meta ? async () => {
      const payload = await startPayload(meta.setup, newGameId(), session.state.mode, meta.setup.p2?.spec ? { name: meta.setup.p2.name, spec: meta.setup.p2.spec } : null);
      session.host.dispatch({ type: 'startGame', actor: 'host', payload });
    } : null;
    setGame({ session, rematch, pairing });
    go('game');
  }

  async function resume(id) {
    const rec = await getGame(id);
    if (!rec) return;
    const snaps = await loadSnapshots(id);
    const log = await loadLog(id);
    const meta = { mode: rec.mode, role: rec.role, setup: rec.setup };
    const host = await makeHost(meta, rec.state, snaps, log.length ? log[log.length - 1].seq : 0);
    const session = new LocalSession(host, { mode: rec.mode === 'networked' ? 'host' : 'same-device', me: 'p1' });
    openGame(session, meta);
  }

  async function rejoin(g) {
    const allDecks = await listDecks();
    const decks = (g.deckIds || []).map((id) => allDecks.find((d) => d.id === id)).filter(Boolean);
    setRoute({ name: 'rejoin', arg: { ...g, decks } });
  }

  const exitGame = () => {
    const s = game?.session;
    if (s?.transport) s.transport.close?.();
    setGame(null);
    go('home');
  };

  let screen;
  switch (route.name) {
    case 'loading': screen = html`<div class="page"><p>Getting the table ready…</p></div>`; break;
    case 'home': screen = html`<${Home} go=${go} resume=${resume} rejoin=${rejoin} update=${update} notice=${route.arg?.notice}/>`; break;
    case 'decks': screen = html`<${DecksScreen} go=${go}/>`; break;
    case 'deck': screen = html`<${DeckScreen} go=${go} id=${route.arg}/>`; break;
    case 'import': screen = html`<${ImportScreen} go=${go}/>`; break;
    case 'backup': screen = html`<${BackupScreen} go=${go}/>`; break;
    case 'restore': screen = html`<${RestoreScreen} go=${go}/>`; break;
    case 'setup': screen = html`<${Setup} go=${go} startGame=${startGame}/>`; break;
    case 'rejoin': screen = html`<div class="page">
      <header class="page-head"><button class="btn ghost" onClick=${() => go('home')}>← Home</button><h1>Reconnect to ${route.arg.hostName}</h1></header>
      <p class="muted">On the host device, open the game menu and choose “Re-pair the guest device”.</p>
      <${GuestPairFlow} onTransport=${async (t) => {
        try { await startGame({ kind: 'guest', name: route.arg.name, decks: route.arg.decks, transport: t, gameId: route.arg.gameId }); }
        catch (e) { toast(String(e.message || e), 'warn', 8000); }
      }}/>
    </div>`; break;
    case 'game': screen = game ? html`<${Game} key=${game.session.state.gameId} session=${game.session} onExit=${exitGame} onRematch=${game.rematch} pairing=${game.pairing}/>` : null; break;
    default: screen = null;
  }
  return html`${screen}
    <div class="toasts" aria-live="polite">${toasts.map((t) => html`<div class="toast ${t.kind}">${t.text}</div>`)}</div>`;
}

render(html`<${App}/>`, document.getElementById('app'));
