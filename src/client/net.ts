// Host/guest handshake on top of a transport, and the guards that check every message that
// arrives from the other device. Each side checks that it has every card image the other
// side's decks need, so both screens can draw every card.

import { getDefs, isGameState, listDecks } from '../storage/db';
import { PROTOCOL_VERSION, APP_VERSION } from '../version';
import type { CardSpec } from '../types/commands';
import type { Deck } from '../types/storage';
import type {
  CommandMessage, DeckSpec, GuestToHost, HelloMessage, HostToGuest, NoticeMessage, RefuseMessage, RejectedMessage,
  StateMessage, WelcomeMessage,
} from '../types/protocol';
import type { Transport } from '../transport/transport';
import type { LocalSession } from './session';

// ---------- Guards ----------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isSpec = (x: unknown): x is CardSpec => isObj(x) && isStr(x.defId) && isStr(x.name) && (x.deckId === null || x.deckId === undefined || isStr(x.deckId));
const isSpecs = (x: unknown): x is CardSpec[] => Array.isArray(x) && x.every(isSpec);
const isPlayer = (x: unknown) => x === 'p1' || x === 'p2';

function isDeckSpec(x: unknown): x is DeckSpec {
  return isObj(x) && isSpecs(x.cards) && (x.commanders === undefined || isSpecs(x.commanders));
}

function isHello(m: Record<string, unknown>): m is HelloMessage & Record<string, unknown> {
  return m.type === 'hello' && isNum(m.protocolVersion) && isStr(m.appVersion) && isStr(m.name) && isDeckSpec(m.spec)
    && (m.deckNames === undefined || isStrArr(m.deckNames)) && (m.tokens === undefined || isStrArr(m.tokens))
    && (m.gameId === null || m.gameId === undefined || isStr(m.gameId));
}

function isRefuse(m: Record<string, unknown>): m is RefuseMessage & Record<string, unknown> {
  return m.type === 'refuse' && isStr(m.reason) && (m.detail === undefined || isStr(m.detail)) && (m.missing === undefined || isStrArr(m.missing));
}

/** A message the host may receive from its guest. Anything else is dropped. */
export function asGuestMessage(x: unknown): GuestToHost | RefuseMessage | null {
  if (!isObj(x)) return null;
  if (x.type === 'command') {
    const c = x.cmd;
    if (isObj(c) && isStr(c.type) && (c.clientSeq === undefined || isNum(c.clientSeq))) return x as unknown as CommandMessage;
    return null;
  }
  if (isHello(x)) return x;
  if (isRefuse(x)) return x;
  return null;
}

/** A message the guest may receive from its host. Anything else is dropped. */
export function asHostMessage(x: unknown): HostToGuest | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'state':
      return isNum(x.version) && isGameState(x.state) ? x as unknown as StateMessage : null;
    case 'welcome':
      return isPlayer(x.player) && isNum(x.version) && isGameState(x.state) && (x.tokens === undefined || isStrArr(x.tokens)) ? x as unknown as WelcomeMessage : null;
    case 'notice':
      return isObj(x.notice) && isStr(x.notice.kind) && isObj(x.notice.payload) ? x as unknown as NoticeMessage : null;
    case 'rejected':
      return isStr(x.reason) ? x as unknown as RejectedMessage : null;
    case 'refuse':
      return isRefuse(x) ? x : null;
    default:
      return null;
  }
}

// ---------- Decks and card checks ----------

/** Card specs for startGame from a set of decks: library cards and commanders. */
export async function deckSpec(decks: readonly Deck[]): Promise<DeckSpec> {
  const ids = decks.flatMap((d) => [...d.cards, ...(d.commanders || [])]);
  const defs = new Map((await getDefs(ids)).map((d) => [d.id, d]));
  const cards: CardSpec[] = [];
  const commanders: CardSpec[] = [];
  for (const d of decks) {
    for (const id of d.cards) cards.push({ defId: id, name: defs.get(id)?.name || '?', deckId: d.id });
    for (const id of d.commanders || []) commanders.push({ defId: id, name: defs.get(id)?.name || '?', deckId: d.id });
  }
  return { cards, commanders };
}

/** Every token definition on this device (from all token decks). */
export async function tokenDefIds(): Promise<string[]> {
  return [...new Set((await listDecks()).filter((d) => d.kind === 'token').flatMap((d) => d.cards))];
}

/** Names of defs (from a list of {defId, name}) that this device does not have. */
export async function missingDefs(list: readonly { defId: string; name?: string }[]): Promise<string[]> {
  const unique = [...new Map(list.map((x) => [x.defId, x])).values()];
  const have = new Set((await getDefs(unique.map((x) => x.defId))).map((d) => d.id));
  return unique.filter((x) => !have.has(x.defId)).map((x) => x.name || x.defId);
}

/** The guest's hello. */
export async function buildHello({ name, decks, gameId }: { name: string; decks: readonly Deck[]; gameId?: string | null }): Promise<HelloMessage> {
  const spec = await deckSpec(decks);
  return {
    type: 'hello', protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION, name,
    spec, deckNames: decks.map((d) => d.name), tokens: await tokenDefIds(), gameId: gameId || null,
  };
}

/** Host side: check a hello. Returns null if fine, or a refusal message. */
export async function checkHello(hello: HelloMessage): Promise<RefuseMessage | null> {
  if (hello.protocolVersion !== PROTOCOL_VERSION || hello.appVersion !== APP_VERSION) {
    return { type: 'refuse', reason: 'version', detail: `Host runs version ${APP_VERSION}, guest runs ${hello.appVersion}. Update both devices to the same version.` };
  }
  if (!hello.gameId) {
    const need = [...hello.spec.cards, ...(hello.spec.commanders || [])];
    const missing = await missingDefs(need);
    if (missing.length) {
      return { type: 'refuse', reason: 'cards', missing, detail: `The host device is missing ${missing.length} of your cards. Import the same decks on both devices first.` };
    }
  }
  return null;
}

/** Guest side: check the host's welcome against local card images. */
export async function checkWelcome(welcome: WelcomeMessage): Promise<string[]> {
  const need = Object.values(welcome.state.cards).filter((c) => !c.isToken).map((c) => ({ defId: c.defId, name: c.name }));
  return missingDefs(need);
}

const listMissing = (m: readonly string[]) => `${m.slice(0, 8).join(', ')}${m.length > 8 ? '…' : ''}`;

// ---------- Handshakes ----------

/** Host: handle a guest on `transport` for `session`. `startNew(hello)` starts the game when needed. */
export function hostHandshake(session: LocalSession, transport: Transport, { startNew, onReady, onError }: {
  startNew: (hello: HelloMessage) => Promise<void>;
  onReady: (hello: HelloMessage) => void;
  onError: (message: string) => void;
}): void {
  session.attach(transport, async (msg) => {
    if (msg.type === 'hello') {
      const refusal = await checkHello(msg);
      if (refusal) { transport.send(refusal); onError(refusal.missing ? `${refusal.detail} Missing: ${listMissing(refusal.missing)}` : refusal.detail); return; }
      const running = session.state.turn > 0 && !session.state.result;
      if (msg.gameId && running && msg.gameId === session.state.gameId) {
        // Reconnect to the running game.
      } else if (running && msg.gameId && msg.gameId !== session.state.gameId) {
        const r: RefuseMessage = { type: 'refuse', reason: 'game', detail: 'This host is running a different game. Join as a new game instead.' };
        transport.send(r); onError(r.detail); return;
      } else {
        await startNew(msg);
      }
      transport.send({ type: 'welcome', player: session.guestPlayer, state: session.state, version: session.version, tokens: await tokenDefIds() } satisfies WelcomeMessage);
      session.sendFullState();
      onReady(msg);
    } else if (msg.type === 'refuse') {
      onError(`The guest cannot join: ${msg.detail || msg.reason}`);
    }
  });
}

/** Guest: send hello and wait for welcome. Resolves with the welcome message. */
export function guestHandshake(transport: Transport, hello: HelloMessage): Promise<WelcomeMessage> {
  return new Promise((resolve, reject) => {
    const off = transport.onMessage(async (raw) => {
      const msg = asHostMessage(raw);
      if (msg?.type === 'welcome') {
        off();
        const missing = await checkWelcome(msg);
        if (missing.length) {
          transport.send({ type: 'refuse', reason: 'cards', detail: `the guest device is missing ${missing.length} card images` } satisfies RefuseMessage);
          reject(new Error(`This device is missing ${missing.length} of the host's cards: ${listMissing(missing)}. Import the same decks here first.`));
          return;
        }
        resolve(msg);
      } else if (msg?.type === 'refuse') {
        off();
        reject(new Error(msg.missing ? `${msg.detail} Missing: ${msg.missing.slice(0, 8).join(', ')}` : msg.detail));
      }
    });
    transport.send(hello);
  });
}
