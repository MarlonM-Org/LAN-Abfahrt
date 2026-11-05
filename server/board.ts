import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardAsk, BoardAward, BoardPrivate, BoardState, BoardStats, DuelPick, ItemKind, MiniKind, MiniTeams, PartyResumeInfo, SkipInfo } from '../shared/types';
import {
  BAR_FIELDS, BOARD_FIELDS, BOARD_KINDS, BOARD_TEAM_CHANCE, BOARD_TIMING, DOUBLE_ROUNDS, DUEL_PENALTY, DUEL_POT, FIELD_COINS, FINALE_COCKTAILS, FINALE_KINDS,
  FIELD_TYPES, ITEM_INFO, ITEM_KINDS, ITEM_MIN_PRICE, KLAU_COINS, LONG_WAY_FIELDS, MINI_INFO, MINI_LENGTH, TEAM_KINDS, UNEVEN_TEAM_KINDS, cocktailPrice, fitsPlayers, miniLabel, teamLabel,
} from '../shared/games';
import { Timers, shuffle } from './minigame';

const {
  STEP_MS, MOVE_LEAD_MS, TAXI_MS, PAUSE_MS, EVENT_PAUSE_MS, INTRO_MS, ROLL_WINDOW_MS, BONUS_DRUM_MS, BONUS_SHOW_MS,
  ASK_BAR_MS, ASK_SHOP_MS, ASK_FORK_MS, DUEL_CHOOSE_MS, DUEL_REVEAL_MS, DUEL_DONE_MS,
} = BOARD_TIMING;

export interface BoardCtx {
  onChange(): void;
  /** `teams`: Team-Minispiel nach Feldfarbe (2 gegen 2, 1 gegen 3), sonst Jeder gegen jeden */
  startMini(kind: MiniKind, teams?: MiniTeams | null): void;
  isConnected(id: string): boolean;
  nameOf(id: string): string;
  connectedCount(): number;
  /** Vom VIP/Laptop entfernt → Züge werden übersprungen */
  isGone?(id: string): boolean;
  /** Wer gerade im Raum ist – wer davon noch nicht auf dem Brett steht, steigt zur nächsten Runde ein */
  present?(): string[];
  /** Party vorbei (nach den Bonus-Cocktails) → Endstand zeigen */
  onFinish(): void;
}

interface PartyEvent {
  text: (name: string) => string;
  apply: (board: Board, id: string) => void;
  /** Pech-Ereignis: das Sonnencreme-Schild hält es ab */
  bad?: boolean;
}

const EVENTS: PartyEvent[] = [
  { text: (n) => `Pool-Party! ${n} bekommt 5 Münzen.`, apply: (b, id) => b.addCoins(id, 5) },
  { text: (n) => `${n} hat Sonnenbrand und kauft teure After-Sun: −4`, apply: (b, id) => b.addCoins(id, -4), bad: true },
  { text: (n) => `Der Nachbar beschwert sich über ${n}: −3`, apply: (b, id) => b.addCoins(id, -3), bad: true },
  { text: (n) => `${n} bringt das Pfand weg: +4`, apply: (b, id) => b.addCoins(id, 4) },
  {
    text: (n) => `${n} schmeißt eine Runde – alle anderen bekommen 1 Münze von ${n}!`,
    apply: (b, id) => {
      for (const o of b.active) if (o !== id && b.state.coins[id] > 0) (b.addCoins(id, -1), b.addCoins(o, 1));
    },
    bad: true,
  },
  {
    text: (n) => `Spülmaschinen-Dienst! ${n} kassiert von allen 1 Münze.`,
    apply: (b, id) => {
      for (const o of b.active) if (o !== id && b.state.coins[o] > 0) (b.addCoins(o, -1), b.addCoins(id, 1));
    },
  },
  {
    text: (n) => `Zimmertausch! ${n} tauscht den Platz mit jemand anderem.`,
    apply: (b, id) => {
      const others = b.active.filter((o) => o !== id);
      if (!others.length) return;
      const o = others[Math.floor(Math.random() * others.length)];
      [b.state.pos[id], b.state.pos[o]] = [b.state.pos[o], b.state.pos[id]];
    },
  },
];

// ------------------------------------------------------------------ Brettstand speichern (data/party.json)

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(dir, '../data/party.json');

/** Gespeicherter Brettstand – wird zu Beginn jeder Runde geschrieben, damit ein Server-Neustart die Party nicht beendet. */
export interface PartySave {
  /** 1 = ohne Items (ältere Stände laden weiterhin), 2 = mit Items */
  v: 1 | 2;
  savedAt: number;
  maxRounds: number;
  longGames: boolean;
  round: number;
  /** Reihenfolge der Spieler (ID + Name; nach einem Neustart werden Spieler über den Namen wiedererkannt) */
  players: { id: string; name: string }[];
  pos: Record<string, number>;
  coins: Record<string, number>;
  cocktails: Record<string, number>;
  stats: Record<string, BoardStats>;
  /** Item im Inventar (ab v2) */
  items: Record<string, ItemKind | null>;
  barField: number;
  lastMini: MiniKind | null;
}

const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const freshStats = (): BoardStats => ({ miniCoins: 0, red: 0, steps: 0, bought: 0 });
const isItem = (v: unknown): v is ItemKind => typeof v === 'string' && (ITEM_KINDS as string[]).includes(v);

function readSave(): PartySave | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<PartySave>;
    if ((raw?.v !== 1 && raw?.v !== 2) || !Array.isArray(raw.players)) return null;
    const players = raw.players.filter((p) => typeof p?.id === 'string' && typeof p?.name === 'string');
    if (!players.length) return null;
    const rec = <T,>(r: Record<string, T> | undefined, def: () => T) => Object.fromEntries(players.map((p) => [p.id, r?.[p.id] ?? def()]));
    const pos = rec(raw.pos, () => 0);
    for (const id of Object.keys(pos)) if (!BOARD_FIELDS[num(pos[id])]) pos[id] = 0;
    const stats = rec(raw.stats, freshStats);
    for (const id of Object.keys(stats)) stats[id] = { ...freshStats(), ...stats[id] };
    const items = rec(raw.items, () => null as ItemKind | null);
    for (const id of Object.keys(items)) if (!isItem(items[id])) items[id] = null;
    const bar = Math.abs(Math.floor(num(raw.barField, 6)));
    return {
      v: 2,
      savedAt: num(raw.savedAt),
      maxRounds: Math.max(1, num(raw.maxRounds, 5)),
      longGames: raw.longGames === true,
      round: Math.max(1, num(raw.round, 1)),
      players,
      pos,
      coins: rec(raw.coins, () => 10),
      cocktails: rec(raw.cocktails, () => 0),
      stats,
      items,
      barField: BAR_FIELDS.includes(bar) ? bar : BAR_FIELDS[0],
      lastMini: typeof raw.lastMini === 'string' && raw.lastMini in MINI_INFO ? (raw.lastMini as MiniKind) : null,
    };
  } catch {
    return null; // keine (lesbare) Party gespeichert
  }
}

let saved: PartySave | null = readSave();

function writeSave(data: PartySave | null) {
  saved = data;
  try {
    if (!data) return fs.rmSync(FILE, { force: true });
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('Konnte den Brettstand nicht speichern:', e);
  }
}

/** Gespeicherte Party (für „Party fortsetzen?“ in der Lobby) */
export function partyResumeInfo(): PartyResumeInfo | null {
  if (!saved) return null;
  return { round: saved.round, maxRounds: saved.maxRounds, names: saved.players.map((p) => p.name), savedAt: saved.savedAt };
}

/** Gespeicherte Party auf die Spieler im Raum abbilden: gleiche ID, sonst gleicher Name. Wer fehlt, fällt raus. */
export function resumeSave(present: { id: string; name: string }[]): PartySave | null {
  if (!saved) return null;
  const free = new Map(present.map((p) => [p.id, p]));
  const map = new Map<string, string>();
  for (const p of saved.players) {
    if (!free.has(p.id)) continue;
    map.set(p.id, p.id);
    free.delete(p.id);
  }
  for (const p of saved.players) {
    if (map.has(p.id)) continue;
    const hit = [...free.values()].find((o) => o.name.toLowerCase() === p.name.toLowerCase());
    if (!hit) continue;
    map.set(p.id, hit.id);
    free.delete(hit.id);
  }
  if (!map.size) return null;
  const re = <T,>(r: Record<string, T>) => Object.fromEntries([...map].map(([from, to]) => [to, r[from]]));
  return {
    ...saved,
    players: saved.players.filter((p) => map.has(p.id)).map((p) => ({ id: map.get(p.id)!, name: p.name })),
    pos: re(saved.pos),
    coins: re(saved.coins),
    cocktails: re(saved.cocktails),
    stats: re(saved.stats),
    items: re(saved.items),
  };
}

/** Ergebniszeile eines Minispiels, wie der Raum sie ans Brett gibt */
export interface BoardMiniRow {
  playerId: string;
  place: number;
  coins: number;
}

/** Laufender Zug im Schnelldurchlauf: wird in Etappen gelaufen (bis zur Bar, zum Laden, zur Gabelung) */
interface Move {
  id: string;
  value: number;
  /** Noch zu laufende Felder */
  left: number;
  /** Bisher gelaufene Felder (alle Etappen) */
  path: number[];
  /** Wahl an der Gabelung (vom Handy oder Server) */
  choice: 'long' | 'short' | null;
  /** Noch kein Würfel-Popup gezeigt */
  first: boolean;
  /** An der Bar vorbeigekommen, ohne kaufen zu können */
  brokeAtBar: boolean;
  taxi: boolean;
}

/**
 * Das Spielbrett im Mario-Party-Stil: Pro Runde würfeln alle gleichzeitig (Würfelfenster), danach laufen die Züge
 * nacheinander im Schnelldurchlauf, dann folgt ein Minispiel. Unterwegs gibt es Entscheidungen am Handy:
 * Cocktail an der Bar kaufen (Preisstaffel 10/15/20), Item im Laden kaufen (Doppelwürfel, Cocktail-Klau, Taxi, Schild),
 * Abkürzung oder langer Weg an der Gabelung, und das Duell „Teilen oder Klauen“ auf dem Duell-Feld.
 * Die letzten Runden zählen doppelt, das Finale bringt Cocktails, am Ende gibt es Bonus-Cocktails
 * (Minispiel-Star, Pechvogel, Wanderer) und erst dann den Endstand.
 */
export class Board {
  state: BoardState;
  private timers = new Timers();
  private lastMini: MiniKind | null = null;
  /** Ist das angesagte Minispiel das Finale? (Sieger bekommen Cocktails) */
  private finaleNow = false;
  private rollDeadline = 0;
  private closing = false;
  private move: Move | null = null;
  private askSeq = 0;
  private askDeadline = 0;
  private duelSeq = 0;
  private duelDeadline = 0;
  /** Geheime Duell-Wahl (geht nur per `private` an den jeweiligen Spieler) */
  private duelPicks: Record<string, DuelPick> = {};

  constructor(
    ids: string[],
    maxRounds: number,
    private ctx: BoardCtx,
    /** VIP-Option „Lange Spiele“: auch Minispiele über 4 min ziehen (sonst nur kurz + mittel) */
    private longGames = false,
    /** Gespeicherten Stand fortsetzen (IDs schon auf die Spieler im Raum abgebildet, siehe resumeSave) */
    from?: PartySave,
  ) {
    const order = from ? from.players.map((p) => p.id) : shuffle(ids);
    const each = <T,>(make: (id: string) => T) => Object.fromEntries(order.map((id) => [id, make(id)]));
    this.state = {
      round: from?.round ?? 1,
      maxRounds: from?.maxRounds ?? maxRounds,
      order,
      turnIdx: 0,
      sub: 'roll',
      pos: from ? { ...from.pos } : each(() => 0),
      coins: from ? { ...from.coins } : each(() => 10),
      cocktails: from ? { ...from.cocktails } : each(() => 0),
      items: each((id) => from?.items?.[id] ?? null),
      using: {},
      barField: from?.barField ?? 0,
      lastRoll: null,
      ask: null,
      duel: null,
      rolls: {},
      rollMs: 0,
      double: false,
      timeOfDay: 0,
      stats: each((id) => ({ ...freshStats(), ...from?.stats[id] })),
      bonus: null,
      joined: [],
      message: from ? `Weiter geht's – Runde ${from.round} von ${from.maxRounds}!` : 'Willkommen im Ferienhaus! Alle starten mit 10 Münzen.',
      messageSeq: 1,
      nextMini: null,
    };
    if (from) {
      this.longGames = from.longGames;
      this.lastMini = from.lastMini;
    } else {
      // Erste Bar in Reichweite der ersten Würfe
      this.state.barField = [5, 7, 8][Math.floor(Math.random() * 3)];
    }
    this.beginRound();
  }

  get finished(): boolean {
    return this.state.round > this.state.maxRounds;
  }

  /** Spieler auf dem Brett, die nicht entfernt wurden */
  get active(): string[] {
    return this.state.order.filter((id) => !this.gone(id));
  }

  addCoins(id: string, delta: number) {
    this.state.coins[id] = Math.max(0, (this.state.coins[id] ?? 0) + delta);
  }

  /** Geheime Infos (Duell-Wahl) für den Event `private` */
  privateFor(id: string): BoardPrivate | null {
    const d = this.state.duel;
    if (!d || (d.a !== id && d.b !== id)) return null;
    return { duelPick: this.duelPicks[id] ?? null };
  }

  /** Würfeln im Würfelfenster (jeder einmal pro Runde) */
  roll(playerId: string) {
    const s = this.state;
    if (s.sub !== 'roll' || !(playerId in s.pos) || playerId in s.rolls || this.gone(playerId)) return;
    s.rolls[playerId] = this.rollValue(playerId);
    this.ctx.onChange();
    this.checkAllRolled();
  }

  /** Item vor dem Würfeln einsetzen (Doppelwürfel, Cocktail-Klau, Taxi) – das Schild wirkt von allein */
  useItem(playerId: string) {
    const s = this.state;
    const item = s.items[playerId];
    if (s.sub !== 'roll' || !item || !ITEM_INFO[item].active || playerId in s.rolls || playerId in s.using || this.gone(playerId)) return;
    s.using[playerId] = item;
    s.items[playerId] = null;
    if (item === 'taxi') {
      // Taxi statt Würfel: der Zug ist damit „gewürfelt“
      s.rolls[playerId] = 0;
      this.ctx.onChange();
      this.checkAllRolled();
    } else this.ctx.onChange();
  }

  /** Antwort auf eine offene Entscheidung (Bar: ja/nein, Laden: Item oder null, Gabelung: long/short) */
  answer(playerId: string, seq: number, choice: unknown) {
    const a = this.state.ask;
    if (!a || a.playerId !== playerId || a.seq !== seq) return;
    if (a.kind === 'bar') this.resolveAsk(choice === true || choice === 'yes');
    else if (a.kind === 'shop') this.resolveAsk(isItem(choice) && a.offer?.includes(choice) ? choice : null);
    else this.resolveAsk(choice === 'short' ? 'short' : choice === 'long' ? 'long' : this.defaultAnswer());
  }

  /** Duell: geheime Wahl */
  duelPick(playerId: string, seq: number, pick: unknown) {
    const d = this.state.duel;
    if (!d || d.sub !== 'choose' || d.seq !== seq || (d.a !== playerId && d.b !== playerId) || this.duelPicks[playerId]) return;
    if (pick !== 'share' && pick !== 'steal') return;
    this.duelPicks[playerId] = pick;
    d.chosen = [...d.chosen, playerId];
    this.ctx.onChange();
    if (d.chosen.length >= 2) this.timers.later(500, () => this.revealDuel());
  }

  /** VIP/Laptop: für alle würfeln, die noch nicht gewürfelt haben – bzw. Entscheidung/Duell auflösen, Minispiel-Ansage überspringen */
  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub === 'roll') return { label: 'Für alle würfeln' };
    if (s.sub === 'moving' && s.ask) return { label: `Für ${this.ctx.nameOf(s.ask.playerId)} entscheiden` };
    if (s.sub === 'moving' && s.duel?.sub === 'choose') return { label: 'Duell auflösen' };
    if (s.sub === 'intro' && s.nextMini) return { label: 'Minispiel starten', info: true };
    return null;
  }

  skip() {
    const s = this.state;
    if (s.sub === 'roll') return this.closeWindow();
    if (s.sub === 'moving' && s.ask) return this.resolveAsk(this.defaultAnswer());
    if (s.sub === 'moving' && s.duel?.sub === 'choose') return this.revealDuel();
    if (s.sub === 'intro' && s.nextMini) {
      this.timers.clear();
      this.ctx.startMini(s.nextMini, s.teams);
    }
  }

  /** Handy weg (gesperrt, App gewechselt): nicht auf ihn warten – am Ende des Fensters würfelt der Server */
  playerDisconnected(id: string) {
    this.checkAllRolled();
    this.withoutPlayer(id);
  }

  /** Spieler entfernt: Würfelfenster wartet nicht auf ihn, seine Züge werden übersprungen */
  playerGone(id: string) {
    this.checkAllRolled();
    this.withoutPlayer(id);
  }

  /** Offene Entscheidung/Duell-Wahl eines Spielers, der weg ist, sofort auflösen */
  private withoutPlayer(id: string) {
    const s = this.state;
    if (s.ask?.playerId === id) this.resolveAsk(this.defaultAnswer());
    const d = s.duel;
    if (d?.sub === 'choose' && (d.a === id || d.b === id) && !this.duelPicks[id]) {
      this.duelPicks[id] = 'share';
      d.chosen = [...d.chosen, id];
      this.ctx.onChange();
      if (d.chosen.length >= 2) this.timers.later(500, () => this.revealDuel());
    }
  }

  /** Party-Finale: so viele Cocktails bekommen die Sieger dieses Minispiels (0 = kein Finale) */
  finaleCocktails(kind: MiniKind): number {
    return this.finaleNow && this.state.nextMini === kind ? FINALE_COCKTAILS : 0;
  }

  /** Nach einem Minispiel: Münzen gutschreiben (Finale: Sieger bekommen Cocktails), nächste Runde bzw. Bonus-Cocktails. */
  afterMini(rows: BoardMiniRow[]) {
    const s = this.state;
    const finale = this.finaleNow ? FINALE_COCKTAILS : 0;
    const champs: string[] = [];
    for (const row of rows) {
      if (!(row.playerId in s.coins)) continue;
      this.addCoins(row.playerId, row.coins);
      s.stats[row.playerId].miniCoins += Math.max(0, row.coins);
      if (finale && row.place === 1) {
        s.cocktails[row.playerId] += finale;
        champs.push(row.playerId);
      }
    }
    this.finaleNow = false;
    s.round += 1;
    // Startspieler rotiert: wer diese Runde als Erster gelaufen ist, läuft nächste Runde als Letzter.
    // So kommt nicht immer dieselbe Person zuerst an die Bar.
    if (s.order.length > 1) s.order = [...s.order.slice(1), s.order[0]];
    s.turnIdx = 0;
    s.nextMini = null;
    if (this.finished) {
      this.say(champs.length ? `Finale gewonnen: ${champs.map((id) => this.ctx.nameOf(id)).join(', ')} – je ${finale} Cocktails!` : 'Die Party ist vorbei!');
      return this.startBonus();
    }
    this.say(`Runde ${s.round} von ${s.maxRounds}!`);
    this.beginRound();
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Runde: Würfelfenster → Schnelldurchlauf

  private gone(id: string) {
    return !!this.ctx.isGone?.(id);
  }

  private rollValue(id: string) {
    const d6 = () => 1 + Math.floor(Math.random() * 6);
    return this.state.using[id] === 'dice2' ? d6() + d6() : d6();
  }

  private beginRound() {
    const s = this.state;
    this.timers.clear();
    this.closing = false;
    this.move = null;
    s.ask = null;
    s.duel = null;
    s.using = {};
    this.duelPicks = {};
    s.joined = this.addLatecomers();
    s.sub = 'roll';
    s.rolls = {};
    s.turnIdx = 0;
    s.teams = null;
    s.double = s.maxRounds >= 3 && s.round > s.maxRounds - DOUBLE_ROUNDS;
    s.timeOfDay = this.dayTime();
    if (s.double) this.say(`${s.message} ${s.round === s.maxRounds ? 'Letzte Runde' : 'Endspurt'}: Blaue und rote Felder zählen doppelt!`);
    if (s.joined.length) {
      const names = s.joined.map((id) => this.ctx.nameOf(id)).join(', ');
      this.say(`${s.message} ${names} ${s.joined.length > 1 ? 'steigen' : 'steigt'} mit ${s.coins[s.joined[0]]} Münzen ein!`);
    }
    this.persist();
    this.rollDeadline = Date.now() + ROLL_WINDOW_MS;
    s.rollMs = ROLL_WINDOW_MS;
    // Restzeit ~1×/s an TV und Handys (die zählen dazwischen selbst runter)
    this.timers.every(1000, () => {
      s.rollMs = Math.max(0, this.rollDeadline - Date.now());
      if (s.rollMs <= 300) this.closeWindow();
      else this.ctx.onChange();
    });
    this.ctx.onChange();
    this.checkAllRolled();
  }

  /** Nachzügler: Wer im Raum ist, aber noch nicht auf dem Brett steht, steigt am Start mit dem Median der Münzen ein */
  private addLatecomers(): string[] {
    const s = this.state;
    const late = (this.ctx.present?.() ?? []).filter((id) => !(id in s.pos) && !this.gone(id));
    if (!late.length) return [];
    const coins = this.active.map((id) => s.coins[id]).sort((a, b) => a - b);
    const mid = coins.length >> 1;
    const median = !coins.length ? 10 : coins.length % 2 ? coins[mid] : Math.round((coins[mid - 1] + coins[mid]) / 2);
    for (const id of late) {
      s.order.push(id);
      s.pos[id] = 0;
      s.coins[id] = median;
      s.cocktails[id] = 0;
      s.items[id] = null;
      s.stats[id] = freshStats();
    }
    return late;
  }

  /** Haben alle, die da sind, gewürfelt? → Fenster kurz danach schließen */
  private checkAllRolled() {
    const s = this.state;
    if (s.sub !== 'roll' || this.closing) return;
    const here = this.active.filter((id) => this.ctx.isConnected(id));
    if (here.some((id) => !(id in s.rolls))) return;
    this.closing = true;
    this.timers.later(here.length ? 700 : 1500, () => this.closeWindow());
  }

  /** Würfelfenster zu: Für alle, die nicht gewürfelt haben, würfelt der Server – dann laufen die Züge nacheinander */
  private closeWindow() {
    const s = this.state;
    if (s.sub !== 'roll') return;
    this.timers.clear();
    for (const id of this.active) if (!(id in s.rolls)) s.rolls[id] = this.rollValue(id);
    s.sub = 'moving';
    s.rollMs = 0;
    s.turnIdx = -1;
    this.nextMove();
  }

  private nextMove() {
    const s = this.state;
    this.move = null;
    s.ask = null;
    s.duel = null;
    s.turnIdx += 1;
    while (s.turnIdx < s.order.length && (this.gone(s.order[s.turnIdx]) || !(s.order[s.turnIdx] in s.rolls))) s.turnIdx += 1;
    if (s.turnIdx >= s.order.length) {
      s.turnIdx = s.order.length - 1;
      this.ctx.onChange();
      this.timers.later(900, () => this.intro());
      return;
    }
    const id = s.order[s.turnIdx];
    const value = s.rolls[id];
    const using = s.using[id];
    this.move = { id, value, left: value, path: [], choice: null, first: true, brokeAtBar: false, taxi: using === 'taxi' };
    if (using === 'klau') {
      // Cocktail-Klau: erst der Streich, dann laufen
      this.klau(id);
      this.ctx.onChange();
      this.timers.later(EVENT_PAUSE_MS, () => this.segment());
      return;
    }
    this.segment();
  }

  /** Cocktail vom Führenden klauen – hat niemand einen, gibt es Münzen aus der Bank */
  private klau(id: string) {
    const s = this.state;
    const name = this.ctx.nameOf(id);
    const victims = this.active.filter((o) => o !== id && s.cocktails[o] > 0).sort((a, b) => s.cocktails[b] - s.cocktails[a] || s.coins[b] - s.coins[a]);
    if (!victims.length) {
      this.addCoins(id, KLAU_COINS);
      return this.say(`${name} schickt den Papagei los – aber niemand hat einen Cocktail. Trostpreis: +${KLAU_COINS} Münzen!`);
    }
    const v = victims[0];
    s.cocktails[v] -= 1;
    s.cocktails[id] += 1;
    this.say(`${name}s Papagei klaut ${this.ctx.nameOf(v)} einen Cocktail!`);
  }

  /**
   * Eine Etappe des Zugs laufen: bis zur Gabelung (Wahl), zur Bar oder zum Laden (Kauf-Frage) oder bis zum Ziel.
   * Danach fragt das Handy bzw. `land()` wertet das Zielfeld aus.
   */
  private segment() {
    const s = this.state;
    const m = this.move!;
    const path: number[] = [];
    let stop: BoardAsk['kind'] | null = null;
    let cur = m.path.length ? m.path[m.path.length - 1] : s.pos[m.id];
    if (m.taxi && m.first) {
      path.push(s.barField);
      m.left = 0;
      if (s.coins[m.id] >= this.price(m.id)) stop = 'bar';
      else m.brokeAtBar = true;
    }
    while (m.left > 0) {
      const nexts = BOARD_FIELDS[cur].next;
      let nxt = nexts[0];
      if (nexts.length > 1) {
        if (!m.choice) {
          stop = 'fork';
          break;
        }
        nxt = m.choice === 'short' ? nexts[1] : nexts[0];
        m.choice = null;
      }
      path.push(nxt);
      cur = nxt;
      m.left -= 1;
      if (nxt === s.barField) {
        if (s.coins[m.id] >= this.price(m.id)) {
          stop = 'bar';
          break;
        }
        m.brokeAtBar = true;
      } else if (BOARD_FIELDS[nxt].type === 'shop' && !s.items[m.id] && s.coins[m.id] >= ITEM_MIN_PRICE) {
        stop = 'shop';
        break;
      }
    }
    m.path.push(...path);
    const go = () => (stop ? this.ask(stop) : this.land());
    if (!path.length) return go();
    const kind = m.taxi && m.first ? 'taxi' : m.first ? 'roll' : 'cont';
    s.lastRoll = { seq: (s.lastRoll?.seq ?? 0) + 1, playerId: m.id, value: m.value, path, kind };
    m.first = false;
    this.ctx.onChange();
    this.timers.later(kind === 'taxi' ? TAXI_MS : (kind === 'roll' ? MOVE_LEAD_MS : 0) + path.length * STEP_MS, go);
  }

  private price(id: string) {
    return cocktailPrice(this.state.stats[id]?.bought ?? 0);
  }

  // ---------------------------------------------------------------- Entscheidungen am Handy

  private ask(kind: BoardAsk['kind']) {
    const s = this.state;
    const m = this.move!;
    const name = this.ctx.nameOf(m.id);
    const ms = kind === 'bar' ? ASK_BAR_MS : kind === 'shop' ? ASK_SHOP_MS : ASK_FORK_MS;
    const a: BoardAsk = { seq: ++this.askSeq, playerId: m.id, kind, ms };
    if (kind === 'bar') {
      a.price = this.price(m.id);
      this.say(`${name} steht an der Bar – Cocktail für ${a.price} Münzen?`);
    } else if (kind === 'shop') {
      a.offer = ITEM_KINDS.filter((k) => ITEM_INFO[k].price <= s.coins[m.id]);
      this.say(`${name} stöbert im Strandladen …`);
    } else {
      a.barOnLong = LONG_WAY_FIELDS.includes(s.barField);
      this.say(`${name} an der Gabelung: Abkürzung oder langer Weg?`);
    }
    s.ask = a;
    this.ctx.onChange();
    if (!this.ctx.isConnected(m.id)) return this.resolveAsk(this.defaultAnswer());
    this.askDeadline = Date.now() + ms;
    this.timers.every(1000, () => {
      a.ms = Math.max(0, this.askDeadline - Date.now());
      if (a.ms <= 300) this.resolveAsk(this.defaultAnswer());
      else this.ctx.onChange();
    });
  }

  /** Was der Server wählt, wenn das Handy nicht antwortet */
  private defaultAnswer(): unknown {
    const s = this.state;
    const a = s.ask;
    if (!a) return null;
    if (a.kind === 'bar') return true;
    if (a.kind === 'shop') return null;
    // Gabelung: zur Bar, wenn sie am langen Weg steht und der Cocktail bezahlbar ist, sonst Zufall
    if (a.barOnLong && s.coins[a.playerId] >= this.price(a.playerId)) return 'long';
    return Math.random() < 0.5 ? 'long' : 'short';
  }

  private resolveAsk(choice: unknown) {
    const s = this.state;
    const a = s.ask;
    const m = this.move;
    if (!a || !m) return;
    this.timers.clear();
    s.ask = null;
    const name = this.ctx.nameOf(m.id);
    let pause = EVENT_PAUSE_MS;
    if (a.kind === 'bar') {
      const price = a.price ?? this.price(m.id);
      if (choice === true && s.coins[m.id] >= price) {
        this.addCoins(m.id, -price);
        s.cocktails[m.id] += 1;
        s.stats[m.id].bought += 1;
        this.say(`${name} kauft einen Cocktail für ${price} Münzen!`);
        this.moveBar();
      } else this.say(`${name} spart lieber – kein Cocktail.`);
    } else if (a.kind === 'shop') {
      if (isItem(choice) && !s.items[m.id] && s.coins[m.id] >= ITEM_INFO[choice].price) {
        this.addCoins(m.id, -ITEM_INFO[choice].price);
        s.items[m.id] = choice;
        this.say(`${name} kauft: ${ITEM_INFO[choice].icon} ${ITEM_INFO[choice].title}!`);
      } else {
        this.say(`${name} kauft nichts.`);
        pause = PAUSE_MS;
      }
    } else {
      m.choice = choice === 'short' ? 'short' : 'long';
      this.say(m.choice === 'short' ? `${name} nimmt die Abkürzung!` : `${name} nimmt den langen Weg.`);
      pause = 350;
    }
    this.ctx.onChange();
    this.timers.later(pause, () => this.segment());
  }

  // ---------------------------------------------------------------- Zielfeld

  private land() {
    const s = this.state;
    const m = this.move!;
    const id = m.id;
    const name = this.ctx.nameOf(id);
    const msgs: string[] = [];
    let slow = false;
    s.stats[id].steps += m.taxi ? 0 : m.path.length;
    if (m.brokeAtBar) msgs.push(`${name} kommt an der Bar vorbei, hat aber keine ${this.price(id)} Münzen.`);

    if (m.path.length) s.pos[id] = m.path[m.path.length - 1];
    const field = BOARD_FIELDS[s.pos[id]];
    const mult = s.double ? 2 : 1;
    const shield = s.items[id] === 'schild';
    if (field.type === 'blue' || field.type === 'start' || field.type === 'shop') {
      this.addCoins(id, FIELD_COINS.blue * mult);
      msgs.push(`${name}: +${FIELD_COINS.blue * mult} Münzen`);
    } else if (field.type === 'red') {
      if (shield) {
        s.items[id] = null;
        msgs.push(`${name} ist eingecremt – das rote Feld prallt ab!`);
        slow = true;
      } else {
        this.addCoins(id, FIELD_COINS.red * mult);
        s.stats[id].red += 1;
        msgs.push(`${name}: ${FIELD_COINS.red * mult} Münzen`);
      }
    } else if (field.type === 'event') {
      slow = true;
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      if (ev.bad && shield) {
        s.items[id] = null;
        msgs.push(`Pech-Ereignis – aber ${name} ist eingecremt. Nichts passiert!`);
      } else {
        ev.apply(this, id);
        msgs.push(ev.text(name));
      }
    } else if (field.type === 'duel') {
      const opp = this.pickOpponent(id);
      if (opp) {
        msgs.push(`${name} fordert ${this.ctx.nameOf(opp)} zum Duell: Teilen oder Klauen?`);
        this.say(msgs.join(' '));
        this.ctx.onChange();
        return this.timers.later(EVENT_PAUSE_MS, () => this.startDuel(id, opp));
      }
      msgs.push(`${name} findet niemanden fürs Duell.`);
    }
    this.say(msgs.join(' '));
    this.ctx.onChange();
    this.timers.later(slow ? EVENT_PAUSE_MS : PAUSE_MS, () => this.nextMove());
  }

  // ---------------------------------------------------------------- Duell „Teilen oder Klauen“

  /** Gegner: meist der Führende (Cocktails, dann Münzen), sonst jemand Zufälliges */
  private pickOpponent(id: string): string | null {
    const s = this.state;
    const others = this.active.filter((o) => o !== id);
    if (!others.length) return null;
    const sorted = [...others].sort((a, b) => s.cocktails[b] - s.cocktails[a] || s.coins[b] - s.coins[a]);
    return Math.random() < 0.65 ? sorted[0] : others[Math.floor(Math.random() * others.length)];
  }

  private startDuel(a: string, b: string) {
    const s = this.state;
    this.duelPicks = {};
    s.duel = { seq: ++this.duelSeq, a, b, pot: DUEL_POT, sub: 'choose', ms: DUEL_CHOOSE_MS, chosen: [] };
    this.say(`Duell um ${DUEL_POT} Münzen: ${this.ctx.nameOf(a)} gegen ${this.ctx.nameOf(b)} – beide wählen geheim!`);
    this.ctx.onChange();
    this.duelDeadline = Date.now() + DUEL_CHOOSE_MS;
    this.timers.every(1000, () => {
      const d = s.duel;
      if (!d || d.sub !== 'choose') return;
      d.ms = Math.max(0, this.duelDeadline - Date.now());
      if (d.ms <= 300) this.revealDuel();
      else this.ctx.onChange();
    });
    for (const id of [a, b]) if (!this.ctx.isConnected(id)) this.withoutPlayer(id);
  }

  /** Beide haben gewählt (oder die Zeit ist um): Karten aufdecken – der TV dreht sie nacheinander um */
  private revealDuel() {
    const s = this.state;
    const d = s.duel;
    if (!d || d.sub !== 'choose') return;
    this.timers.clear();
    const picks: Record<string, DuelPick> = { [d.a]: this.duelPicks[d.a] ?? 'share', [d.b]: this.duelPicks[d.b] ?? 'share' };
    d.sub = 'reveal';
    d.ms = 0;
    d.picks = picks;
    d.chosen = [d.a, d.b];
    this.say('Die Karten werden aufgedeckt …');
    this.ctx.onChange();
    this.timers.later(DUEL_REVEAL_MS, () => this.finishDuel());
  }

  private finishDuel() {
    const s = this.state;
    const d = s.duel;
    if (!d || d.sub !== 'reveal' || !d.picks) return;
    const na = this.ctx.nameOf(d.a), nb = this.ctx.nameOf(d.b);
    const pa = d.picks[d.a], pb = d.picks[d.b];
    if (pa === 'share' && pb === 'share') {
      this.addCoins(d.a, d.pot / 2);
      this.addCoins(d.b, d.pot / 2);
      d.result = `Beide teilen: je ${d.pot / 2} Münzen!`;
    } else if (pa === 'steal' && pb === 'steal') {
      this.addCoins(d.a, -DUEL_PENALTY);
      this.addCoins(d.b, -DUEL_PENALTY);
      d.result = `Beide klauen – der Pott ist weg, und beide zahlen ${DUEL_PENALTY} Münzen Strafe!`;
    } else {
      const thief = pa === 'steal' ? d.a : d.b;
      this.addCoins(thief, d.pot);
      d.result = `${thief === d.a ? na : nb} klaut – und kassiert alle ${d.pot} Münzen!`;
    }
    d.sub = 'done';
    this.say(d.result);
    this.ctx.onChange();
    this.timers.later(DUEL_DONE_MS, () => this.nextMove());
  }

  // ---------------------------------------------------------------- Minispiel-Ansage

  /** 0 = Morgen … 0.8 = Sonnenuntergang (letzte Runde) … 1 = Nacht (Finale, Bonus) */
  private dayTime() {
    const s = this.state;
    if (s.round > s.maxRounds) return 1;
    if (s.maxRounds <= 1) return 0.8;
    return Math.round(((0.8 * (s.round - 1)) / (s.maxRounds - 1)) * 100) / 100;
  }

  private intro() {
    const s = this.state;
    this.move = null;
    s.ask = null;
    s.duel = null;
    // Finale: eines der Versteckte-Rollen-Spiele (Mord oder Verräter)
    const n = this.ctx.connectedCount();
    const finales = FINALE_KINDS.filter((k) => fitsPlayers(k, n));
    const isFinale = s.round === s.maxRounds && finales.length > 0;
    // Nur Spiele, die zur Spielerzahl passen (z. B. Urlaubs-Fangen ab 3, max. 8 Spieler)
    // … und standardmäßig nur kurze/mittlere (≤ 4 min), damit die Party nicht stockt
    const fitsAll = BOARD_KINDS.filter((k) => fitsPlayers(k, n));
    const short = fitsAll.filter((k) => MINI_LENGTH[k] !== 'lang');
    const fitting = this.longGames || !short.length ? fitsAll : short;
    const pool: MiniKind[] = fitting.filter((k) => k !== this.lastMini);
    if (!pool.length) pool.push(...(fitting.length ? fitting : BOARD_KINDS));
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    // Team-Minispiel nach Feldfarbe (Rot gegen Blau): nur Spiele, die zu den Teamgrößen passen und gerade dran sein dürfen
    let teams = isFinale || Math.random() >= BOARD_TEAM_CHANCE ? null : this.teamsByField();
    const teamPool = teams ? (teams.A.length === teams.B.length ? TEAM_KINDS : UNEVEN_TEAM_KINDS).filter((k) => pool.includes(k)) : [];
    if (!teamPool.length) teams = null;
    // Fallback, falls zu wenige übrig sind (z. B. nach Entfernen von Spielern)
    const kind: MiniKind = (isFinale ? pick(finales) : teams ? pick(teamPool) : pick(pool)) ?? 'sprint';
    this.lastMini = kind;
    this.finaleNow = isFinale;
    s.sub = 'intro';
    s.nextMini = kind;
    s.teams = teams;
    if (isFinale) s.timeOfDay = 1;
    this.say(
      isFinale
        ? `FINALE: ${miniLabel(kind)}! Die Sieger bekommen ${FINALE_COCKTAILS} Cocktails.`
        : teams
          ? `${teams.label} nach Feldfarbe – Rot (Team Sonne) gegen Blau (Team Meer): ${miniLabel(kind)}!`
          : `Minispiel: ${miniLabel(kind)}!`,
    );
    this.ctx.onChange();
    this.timers.later(INTRO_MS, () => this.ctx.startMini(kind, teams));
  }

  /**
   * Teams nach Feldfarbe (Mario-Party-Prinzip): Rot = Team Sonne (A), Blau/Start = Team Meer (B), auf einem neutralen (Ereignis, Laden, Duell)
   * Ereignisfeld kommt man in die kleinere Seite (bei Gleichstand per Los). Null, wenn weniger als 4 Spieler
   * auf dem Brett stehen oder eine Seite leer bliebe – dann wie bisher Jeder gegen jeden.
   */
  teamsByField(): MiniTeams | null {
    const s = this.state;
    const ids = this.active;
    if (ids.length < 4) return null;
    const A: string[] = [];
    const B: string[] = [];
    const undecided: string[] = [];
    for (const id of ids) {
      const t = FIELD_TYPES[s.pos[id]];
      if (t === 'red') A.push(id);
      else if (t === 'event' || t === 'shop' || t === 'duel') undecided.push(id); // neutrale Felder: kleinere Seite
      else B.push(id);
    }
    for (const id of shuffle(undecided)) (A.length < B.length || (A.length === B.length && Math.random() < 0.5) ? A : B).push(id);
    if (!A.length || !B.length) return null;
    return { A, B, label: teamLabel(A.length, B.length) };
  }

  // ---------------------------------------------------------------- Bonus-Cocktails am Ende

  /**
   * Die drei Bonus-Karten. Gleichstand beim Bestwert: der Cocktail geht an den, der in der Wertung (Cocktails, dann Münzen)
   * am weitesten hinten liegt – Aufholhilfe; steht auch das gleich, entscheidet die aktuelle Startreihenfolge.
   * `tied` nennt alle mit dem Bestwert, damit der TV den Gleichstand zeigen kann.
   */
  private awards(): BoardAward[] {
    const s = this.state;
    const ids = this.active;
    const behind = (a: string, b: string) => s.cocktails[a] - s.cocktails[b] || s.coins[a] - s.coins[b] || s.order.indexOf(a) - s.order.indexOf(b);
    const make = (key: BoardAward['key'], title: string, desc: string, unit: string, val: (st: BoardStats) => number): BoardAward | null => {
      const max = Math.max(0, ...ids.map((id) => val(s.stats[id])));
      if (max <= 0) return null;
      const tied = ids.filter((id) => val(s.stats[id]) === max);
      const winner = [...tied].sort(behind)[0];
      return { key, title, desc, unit, value: max, winners: [winner], tied: tied.length > 1 ? tied : undefined };
    };
    return [
      make('star', 'Minispiel-Star', 'Meiste Münzen aus Minispielen', 'Münzen', (st) => st.miniCoins),
      make('pech', 'Pechvogel', 'Am öftesten auf Rot gelandet', 'rote Felder', (st) => st.red),
      make('wander', 'Wanderer', 'Die meisten Felder gelaufen', 'Felder', (st) => st.steps),
    ].filter((a): a is BoardAward => !!a);
  }

  /** Nach dem Finale: drei Bonus-Karten nacheinander (Trommelwirbel → Gewinner, je +1 Cocktail), dann der Endstand */
  private startBonus() {
    const s = this.state;
    this.timers.clear();
    s.sub = 'bonus';
    s.timeOfDay = 1;
    s.rolls = {};
    s.rollMs = 0;
    s.ask = null;
    s.duel = null;
    s.bonus = { awards: this.awards(), shown: 0, revealed: false };
    // Die Party ist durch – nichts mehr fortzusetzen
    writeSave(null);
    this.ctx.onChange();
    this.timers.later(2400, () => this.bonusStep());
  }

  private bonusStep() {
    const s = this.state;
    const b = s.bonus!;
    if (b.shown > 0 && !b.revealed) {
      b.revealed = true;
      const a = b.awards[b.shown - 1];
      for (const id of a.winners) s.cocktails[id] += 1;
      this.say(`${a.title}: ${a.winners.map((id) => this.ctx.nameOf(id)).join(', ')} – +1 Cocktail!`);
      this.ctx.onChange();
      this.timers.later(BONUS_SHOW_MS, () => this.bonusStep());
    } else if (b.shown < b.awards.length) {
      b.shown += 1;
      b.revealed = false;
      this.say(`Bonus-Cocktail: ${b.awards[b.shown - 1].title} …`);
      this.ctx.onChange();
      this.timers.later(BONUS_DRUM_MS, () => this.bonusStep());
    } else {
      this.ctx.onFinish();
    }
  }

  // ---------------------------------------------------------------- Helfer

  /** Brettstand zu Rundenbeginn sichern (data/party.json) */
  private persist() {
    const s = this.state;
    writeSave({
      v: 2,
      savedAt: Date.now(),
      maxRounds: s.maxRounds,
      longGames: this.longGames,
      round: s.round,
      players: this.active.map((id) => ({ id, name: this.ctx.nameOf(id) })),
      pos: s.pos,
      coins: s.coins,
      cocktails: s.cocktails,
      stats: s.stats,
      items: s.items,
      barField: s.barField,
      lastMini: this.lastMini,
    });
  }

  /** Bar wandert nach einem Kauf auf ein anderes blaues Feld des Rundwegs – der lange Weg ist doppelt so wahrscheinlich */
  private moveBar() {
    const taken = new Set(Object.values(this.state.pos));
    const free = BAR_FIELDS.filter((i) => i !== this.state.barField && !taken.has(i));
    const pool = free.length ? free : BAR_FIELDS.filter((i) => i !== this.state.barField);
    const weighted = pool.flatMap((i) => (LONG_WAY_FIELDS.includes(i) ? [i, i] : [i]));
    this.state.barField = weighted[Math.floor(Math.random() * weighted.length)] ?? BAR_FIELDS[0];
  }

  private say(msg: string) {
    this.state.message = msg;
    this.state.messageSeq += 1;
  }
}
