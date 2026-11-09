// Deck screens: list, view, import, rename, delete.

import { useState, useEffect } from 'preact/hooks';
import { useOutsideTap } from './hooks';
import { confirmBox, promptBox } from './Dialogs';
import { listDecks, deleteDeck, putDeck, staleDecks } from '../storage/db';
import { loadArt, artUrl, sizeFor, type Art } from '../storage/art';
import { importCache, importDeck, listSignature, type ImportResult } from '../storage/scryfall';
import { STARTER_PACKS, type StarterPack as Pack, type StarterDeck } from '../storage/starters';
import { exportBackup, readBackup, restoreBackup, companionTokenDecks, requestPersistence, storageStatus, type ReadBackup } from '../storage/backup';
import { saveFile } from './files';
import type { Deck } from '../types/storage';
import type { Go } from './routes';

const errText = (e: unknown) => String((e as Error | null)?.message || e);
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
function StorageLine({ tick }: { tick: unknown }) {
  const [st, setSt] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  useEffect(() => {
    storageStatus().then(setSt);
  }, [tick]);
  if (!st) return null;
  const kept =
    st.persisted === true
      ? 'Kept: the browser will not clear it to free space.'
      : st.persisted === false
        ? 'The browser may clear it if the device runs low on space. Back up decks you care about.'
        : '';
  return (
    <p class="muted small">
      Stored on this device{st.usage != null ? `: ${mb(st.usage)}` : ''}. {kept}
    </p>
  );
}
function StarterPack({ pack, decks, refresh }: { pack: Pack; decks: Deck[]; refresh: () => void }) {
  const have = new Set(decks.map((d) => d.starterId).filter(Boolean));
  const remaining = pack.decks.filter((d) => !have.has(d.starterId));
  const [picked, setPicked] = useState(new Set<string>());
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState('');
  const run = async (todo: StarterDeck[]) => {
    setBusy(true);
    setError('');
    setMissing([]);
    const miss = [];
    // One cache for the whole batch: each card name, token and set of rulings is fetched once.
    const cache = importCache();
    try {
      for (let i = 0; i < todo.length; i++) {
        const d = todo[i]!;
        const r = await importDeck({
          cache,
          name: d.name,
          text: d.text,
          extra: {
            starterId: d.starterId,
          },
          tokens: pack.tokens
            ? {
                deckId: pack.tokens.id,
                name: pack.tokens.name,
                extra: {
                  starterId: pack.tokens.id,
                },
              }
            : null,
          onProgress: (t) => setProgress(`Deck ${i + 1} of ${todo.length} (${d.name}): ${t}`),
        });
        miss.push(...r.missing.map((m) => `${d.name}: ${m}`));
        await refresh();
        requestPersistence();
      }
    } catch (err) {
      setError(navigator.onLine ? errText(err) : 'You are offline. Downloading decks needs internet.');
    } finally {
      setBusy(false);
      setProgress('');
      setMissing(miss);
      setPicked(new Set());
    }
  };
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const groups = [...new Set(pack.decks.map((d) => d.group || ''))];
  return (
    <div class="notice starter">
      <div>
        <b>{pack.name}</b>
      </div>
      <div class="muted small">{pack.blurb}</div>
      {!remaining.length ? (
        <div class="muted small">All {pack.decks.length} decks are on this device.</div>
      ) : pack.pick ? (
        <>
          <div class="starter-actions">
            <button class="btn" disabled={busy} onClick={() => setChoosing(!choosing)}>{choosing ? 'Hide the list' : 'Choose decks'}</button>
            {choosing ? (
              <button class="btn primary" disabled={busy || !picked.size} onClick={() => void run(remaining.filter((d) => picked.has(d.starterId)))}>
                {busy ? 'Downloading…' : `Download ${picked.size} selected`}
              </button>
            ) : null}
            <button class="btn ghost" disabled={busy} onClick={() => void run(remaining)}>
              {have.size ? `Download the remaining ${remaining.length}` : `Download all ${remaining.length}`}
            </button>
          </div>
          {choosing ? (
            <div class="starter-pick">
              {groups.map((g) => (
                <div class="starter-group">
                  {g ? <div class="starter-group-name">{g}</div> : null}
                  <div class="deck-pick">
                    {pack.decks.filter((d) => (d.group || '') === g).map((d) => {
                      const here = have.has(d.starterId);
                      const on = here || picked.has(d.starterId);
                      return (
                        <label class={`deck-check ${on ? 'on' : ''} ${here ? 'here' : ''}`}>
                          <input type="checkbox" checked={on} disabled={here || busy} onChange={() => toggle(d.starterId)} />
                          <span>{d.short || d.name}</span>
                          {here ? <span class="muted small">on this device</span> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <button class="btn primary" disabled={busy} onClick={() => void run(remaining)}>
          {busy ? 'Downloading…' : have.size ? `Download the remaining ${remaining.length}` : `Download all ${remaining.length} decks`}
        </button>
      )}
      {progress ? <p class="muted small">{progress}</p> : null}
      {error ? <p class="error">{error}</p> : null}
      {missing.length ? (
        <>
          <p class="error">Not found ({missing.length}):</p>
          <ul class="small">
            {missing.map((m) => (
              <li>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
export function DecksScreen({ go }: { go: Go }) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());
  const refresh = () => Promise.all([listDecks(), staleDecks()]).then(([ds, st]) => {
    setDecks(ds);
    setStale(new Set(st.map((d) => d.id)));
  });
  useEffect(() => {
    refresh();
  }, []);
  if (!decks)
    return (
      <div class="page">
        <p>Loading…</p>
      </div>
    );
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
        <h1>Decks</h1>
        <button class="btn primary" onClick={() => go('import')}>
          Import a deck
        </button>
        <button class="btn" onClick={() => go('backup')}>
          Back up
        </button>
        <button class="btn" onClick={() => go('restore')}>
          Restore
        </button>
      </header>
      <StorageLine tick={decks.length} />
      <h2>Starter decks</h2>
      {STARTER_PACKS.map((p) => (
        <StarterPack key={p.id} pack={p} decks={decks} refresh={refresh} />
      ))}
      <h2>On this device</h2>
      <ul class="deck-list">
        {decks.map((d) => (
          <li>
            <button class="deck-row" onClick={() => go('deck', d.id)}>
              <span class="deck-name">{d.name}</span>
              <span class="muted">
                {d.kind === 'token' ? 'Tokens' : 'Deck'} · {d.cards.length + (d.commanders?.length || 0)} cards
                {d.builtin ? ' · built in' : ''}
              </span>
              {stale.has(d.id) ? <span class="reimport-tag">needs re-import</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <p class="muted small">
        Import the same decks on both devices before a networked game: each device draws every card from its own copy.
      </p>
    </div>
  );
}
export interface CardView { i: number; back: boolean }

export function DeckScreen({ go, id }: { go: Go; id: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [art, setArt] = useState(new Map<string, Art>());
  const [view, setView] = useState<CardView | null>(null); // { i, back }: the card shown full screen
  useEffect(() => {
    listDecks().then((ds) => {
      const d = ds.find((x) => x.id === id);
      setDeck(d ?? null);
      if (d) loadArt([...d.cards, ...(d.commanders || [])]).then(setArt);
    });
  }, [id]);
  if (!deck)
    return (
      <div class="page">
        <p>Loading…</p>
      </div>
    );
  const counts = new Map();
  for (const c of deck.cards) counts.set(c, (counts.get(c) || 0) + 1);
  const rename = async () => {
    const n = await promptBox({
      title: 'Rename deck',
      value: deck.name,
      ok: 'Rename',
    });
    if (n && n.trim()) {
      const d = {
        ...deck,
        name: n.trim(),
      };
      await putDeck(d);
      setDeck(d ?? null);
    }
  };
  const remove = async () => {
    // A token deck made for other decks: name the decks that still use it.
    const users = deck.kind === 'token' && deck.forDecks?.length ? (await listDecks()).filter((d) => deck.forDecks!.includes(d.id)) : [];
    const body = users.length
      ? `These decks use its tokens:\n${users.map((d) => `• ${d.name}`).join('\n')}\n\nTheir tokens will no longer appear in the Tokens picker.`
      : 'Cards that no other deck or saved game uses are removed from this device.';
    if (
      !(await confirmBox({
        title: `Delete “${deck.name}”?`,
        body,
        ok: 'Delete',
        danger: true,
      }))
    )
      return;
    await deleteDeck(deck.id);
    go('decks');
  };
  const order = [...new Set([...(deck.commanders || []), ...deck.cards])];
  const tile = (defId: string, n: number) => {
    const a = art.get(defId);
    return (
      <figure
        class="deck-card"
        onClick={() =>
          setView({
            i: order.indexOf(defId),
            back: false,
          })
        }
      >
        {a?.front ? (
          <img src={artUrl(a, 'front', sizeFor(168)) ?? undefined} alt={a.name} loading="lazy" />
        ) : (
          <div class="card-face missing">
            <span>{a?.name || '…'}</span>
          </div>
        )}
        <figcaption>
          {n > 1 ? `${n}× ` : ''}
          {a?.name || ''}
        </figcaption>
      </figure>
    );
  };
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('decks')}>
          ← Decks
        </button>
        <h1>{deck.name}</h1>
        <span class="spacer" />
        <button class="btn" onClick={rename}>
          Rename
        </button>
        <button class="btn danger" onClick={remove}>
          Delete
        </button>
      </header>
      {deck.commanders?.length ? (
        <>
          <h2>Commander</h2>
          <div class="deck-grid">{deck.commanders.map((c) => tile(c, 1))}</div>
        </>
      ) : null}
      <h2>
        {deck.kind === 'token' ? 'Tokens' : 'Cards'} ({deck.cards.length})
      </h2>
      <div class="deck-grid">{[...counts].map(([c, n]) => tile(c, n))}</div>
      {view ? <CardViewer art={art} order={order} counts={counts} view={view} setView={setView} /> : null}
    </div>
  );
}

/** Full-screen view of one card in a deck: large image, flip for double-faced cards, previous / next. */
function CardViewer({ art, order, counts, view, setView }: { art: Map<string, Art>; order: string[]; counts: Map<string, number>; view: CardView; setView: (v: CardView | null) => void }) {
  const outside = useOutsideTap(() => setView(null));
  const defId = order[view.i]!;
  const a = art.get(defId);
  const step = (d: number) =>
    setView({
      i: (view.i + d + order.length) % order.length,
      back: false,
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [view.i]);
  const url = a ? artUrl(a, view.back && a.back ? 'back' : 'front', 'large') : null;
  const n = counts.get(defId) || 1;
  return (
    <div
      class="deck-viewer"
      role="dialog"
      aria-label={a?.name || 'Card'}
      {...outside}
    >
      <div class="deck-viewer-img" onClick={() => setView(null)}>
        {url ? (
          <img src={url} alt={a!.name} />
        ) : (
          <div class="card-face missing big">
            <span>{a?.name || '…'}</span>
          </div>
        )}
      </div>
      <div class="deck-viewer-bar">
        <button class="btn" onClick={() => step(-1)} disabled={order.length < 2} aria-label="Previous card">
          ‹
        </button>
        <span class="deck-viewer-name">
          {n > 1 ? `${n}× ` : ''}
          {a?.name || ''}{' '}
          <span class="muted small">
            {view.i + 1} / {order.length}
          </span>
        </span>
        {a?.back ? (
          <button
            class="btn"
            onClick={() =>
              setView({
                ...view,
                back: !view.back,
              })
            }
          >
            Flip
          </button>
        ) : null}
        <button class="btn" onClick={() => step(1)} disabled={order.length < 2} aria-label="Next card">
          ›
        </button>
        <button class="btn primary" onClick={() => setView(null)}>
          Close
        </button>
      </div>
    </div>
  );
}
export function ImportScreen({ go }: { go: Go }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'deck' | 'token'>('deck');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const run = async (e: Event) => {
    e.preventDefault();
    const finalName = name.trim() || 'Imported deck';
    // Warn before importing a deck that is already here (same name, or the same cards).
    const sig = listSignature(text);
    const twins = (await listDecks()).filter(
      (d) => d.kind === kind && (d.name.toLowerCase() === finalName.toLowerCase() || (d.signature && d.signature === sig)),
    );
    if (twins.length) {
      const why = twins.map((d) => `• ${d.name}${d.signature === sig ? ' (same cards)' : ' (same name)'}`).join('\n');
      if (
        !(await confirmBox({
          title: 'Import another copy?',
          body: `You already have:\n${why}`,
          ok: 'Import anyway',
        }))
      )
        return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await importDeck({
        name: finalName,
        kind,
        text,
        onProgress: setProgress,
      });
      setResult(r);
      requestPersistence();
    } catch (err) {
      setError(
        navigator.onLine ? errText(err) : 'You are offline. Deck import needs internet; play works offline afterwards.',
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('decks')}>
          ← Decks
        </button>
        <h1>Import a deck</h1>
      </header>
      <form class="import" onSubmit={run}>
        <label>
          Deck name <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="My deck" />
        </label>
        <div class="seg">
          <button type="button" class={`btn ${kind === 'deck' ? 'on' : 'ghost'}`} onClick={() => setKind('deck')}>
            Deck
          </button>
          <button type="button" class={`btn ${kind === 'token' ? 'on' : 'ghost'}`} onClick={() => setKind('token')}>
            Token deck
          </button>
        </div>
        <label>
          Decklist
          <textarea
            rows={12}
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            placeholder={'4 Lightning Bolt\n1 Delver of Secrets (ISD) 51\n20 Mountain\n\nCommander\n1 Krenko, Mob Boss'}
          />
        </label>
        <p class="muted small">
          Paste a list from Arena, MTGO, Moxfield or Archidekt: one card per line, “count name”, optionally “(SET) number”. A “Commander”
          section goes to the command zone; a “Sideboard” section is ignored. Card data and images come from Scryfall and are stored on this
          device. For tokens, add the set code, e.g. “1 Treasure (TCLB) 22”.
        </p>
        <button class="btn primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        {progress ? <p class="muted">{progress}</p> : null}
        {error ? <p class="error">{error}</p> : null}
        {result ? (
          <div class="notice">
            <p>
              Imported {result.cards} cards
              {result.tokens ? ` and ${result.tokens} token${result.tokens === 1 ? '' : 's'} (saved as a token deck)` : ''}.
            </p>
            {result.missing.length ? (
              <>
                <p class="error">Not found ({result.missing.length}):</p>
                <ul>
                  {result.missing.map((m) => (
                    <li>{m}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <button class="btn" type="button" onClick={() => go('deck', result.deckId)}>
              Open deck
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
export function BackupScreen({ go }: { go: Go }) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [sel, setSel] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Built-in decks are on every device, and token decks made for other decks follow those decks:
  // neither is chosen by hand.
  const ids = new Set((decks || []).map((d) => d.id));
  const linked = (d: Deck) => d.kind === 'token' && (d.forDecks || []).some((id) => ids.has(id));
  const pickable = (d: Deck) => !d.builtin && !linked(d);
  useEffect(() => {
    listDecks().then((ds) => {
      setDecks(ds);
      const have = new Set(ds.map((d) => d.id));
      setSel(
        new Set(ds.filter((d) => !d.builtin && !(d.kind === 'token' && (d.forDecks || []).some((id) => have.has(id)))).map((d) => d.id)),
      );
    });
  }, []);
  if (!decks)
    return (
      <div class="page">
        <p>Loading…</p>
      </div>
    );
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const extra = companionTokenDecks(decks, [...sel]);
  const extraIds = new Set(extra.map((d) => d.id));
  const total = sel.size + extra.length;
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await exportBackup([...sel], setMsg);
      const name = `tabletop-decks-${new Date().toISOString().slice(0, 10)}.mtgdecks`;
      const how = await saveFile(r.blob, name);
      setMsg(
        how === 'cancelled'
          ? 'Cancelled.'
          : `Saved ${r.decks} deck${r.decks === 1 ? '' : 's'}, ${r.cards} cards, ${mb(r.blob.size)} as “${name}”.`,
      );
    } catch (e) {
      setMsg(`Backup failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('decks')}>
          ← Decks
        </button>
        <h1>Back up decks</h1>
      </header>
      <p class="muted small">
        Choose decks to save into one file. Keep the file somewhere safe, or open it on another device under Decks → Restore.
      </p>
      <div class="seg">
        <button class="btn ghost" onClick={() => setSel(new Set(decks.filter(pickable).map((d) => d.id)))}>
          Select all
        </button>
        <button class="btn ghost" onClick={() => setSel(new Set())}>
          Select none
        </button>
      </div>
      <div class="deck-pick tall">
        {decks.map((d) => {
          const can = pickable(d);
          const on = can ? sel.has(d.id) : extraIds.has(d.id);
          const note = d.builtin ? 'built in · on every device' : linked(d) ? (on ? 'included with its decks' : 'follows its decks') : '';
          return (
            <label class={`deck-check ${on ? 'on' : ''} ${can ? '' : 'locked'}`}>
              <input type="checkbox" checked={on} disabled={!can} onChange={() => toggle(d.id)} />
              <span>
                {d.name}
                {note ? <span class="lock-note">{note}</span> : ''}
              </span>
              <span class="muted small">
                {d.kind === 'token' ? 'tokens · ' : ''}
                {d.cards.length + (d.commanders?.length || 0)}
              </span>
            </label>
          );
        })}
      </div>
      <button class="btn primary" disabled={busy || !sel.size} onClick={run}>
        {busy ? 'Packing…' : `Save ${total} deck${total === 1 ? '' : 's'} to a file`}
      </button>
      {msg ? <p class="muted">{msg}</p> : null}
    </div>
  );
}
const STATUS = {
  new: 'New',
  same: 'Already here',
  similar: 'Possible duplicate',
};
export function RestoreScreen({ go }: { go: Go }) {
  const [read, setRead] = useState<ReadBackup | null>(null);
  const [sel, setSel] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const pick = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setError('');
    setMsg('');
    setRead(null);
    try {
      const r = await readBackup(file);
      setRead(r);
      setSel(new Set(r.rows.filter((x) => x.status === 'new').map((x) => x.deck.id)));
    } catch (err) {
      setError(errText(err));
    }
  };
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await restoreBackup(read!, [...sel], setMsg);
      requestPersistence();
      setMsg(
        `Restored ${r.decks} deck${r.decks === 1 ? '' : 's'} (${r.cards} cards).${r.skipped.length ? ` Skipped ${r.skipped.length} card(s) with damaged images: ${r.skipped.join(', ')}.` : ''}`,
      );
      setRead(null);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('decks')}>
          ← Decks
        </button>
        <h1>Restore decks</h1>
      </header>
      <p class="muted small">Open a .mtgdecks backup. Nothing is added until you choose decks and tap Restore. No internet needed.</p>
      <label class="btn file-btn">
        Choose a backup file
        <input type="file" onChange={pick} />
      </label>
      {error ? <p class="error">{error}</p> : null}
      {read ? (
        <>
          <p class="muted small">
            Made {new Date(read.manifest.exportedAt).toLocaleString()}. New decks are selected. Decks already here, or that look like one
            you have, are not; select them to add a copy.
          </p>
          <div class="deck-pick tall">
            {read.rows.map(({ deck, status, like }) => (
              <label class={`deck-check ${sel.has(deck.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.has(deck.id)} onChange={() => toggle(deck.id)} />
                <span>
                  {deck.name}
                  {deck.kind === 'token' ? (
                    <>
                      {' '}
                      <span class="muted small">tokens</span>
                    </>
                  ) : (
                    ''
                  )}
                </span>
                <span class={`status-tag ${status}`}>
                  {STATUS[status]}
                  {like ? `: ${like}` : ''}
                </span>
              </label>
            ))}
          </div>
          <button class="btn primary" disabled={busy || !sel.size} onClick={run}>
            {busy ? 'Restoring…' : `Restore ${sel.size} deck${sel.size === 1 ? '' : 's'}`}
          </button>
        </>
      ) : null}
      {msg ? <p class="muted">{msg}</p> : null}
      {msg && !read ? (
        <button class="btn" onClick={() => go('decks')}>
          Go to decks
        </button>
      ) : null}
    </div>
  );
}
