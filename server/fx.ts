/**
 * Ereignisprotokoll des Abends: Minispiele melden markante Momente über `ctx.log(type, { p, n, o })`
 * (K.O., Eigentor, Selbsttreffer, Rauswurf, Versteckzeit …), der Raum zählt Siege, Serien, Münzen und Wetten dazu.
 * Aus den Summen entstehen die „Titel des Abends“ (`stats()`), die TV und Handy am Ende einer Party,
 * eines Turniers und im Arcade-Ergebnis zeigen.
 */
import type { EveningStats, EveningTitle, FxEvent, MiniKind } from '../shared/types';
import { MINI_INFO } from '../shared/games';

export interface FxData {
  /** Spieler, um den es geht */
  p?: string;
  /** Menge (Standard 1) – bei `hidden` Millisekunden */
  n?: number;
  /** Zweiter Beteiligter (Opfer, Torschütze …) */
  o?: string;
}

interface TitleDef {
  id: string;
  type: string;
  title: string;
  icon: string;
  /** sum = Summe aller Ereignisse, max = höchster Einzelwert (Versteckzeit, Serie) */
  mode: 'sum' | 'max';
  /** Ab diesem Wert wird der Titel vergeben */
  min: number;
  text: (n: number) => string;
}

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min versteckt`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Reihenfolge = Priorität beim Vergeben (höchstens TITLE_MAX Titel, höchstens 2 pro Spieler) */
const TITLES: TitleDef[] = [
  { id: 'kos', type: 'ko', title: 'Meiste K.O.s', icon: '🥊', mode: 'sum', min: 2, text: (n) => plural(n, 'K.O.', 'K.O.s') },
  { id: 'owngoals', type: 'owngoal', title: 'Eigentor-König', icon: '🙈', mode: 'sum', min: 1, text: (n) => plural(n, 'Eigentor', 'Eigentore') },
  { id: 'kamikaze', type: 'selfhit', title: 'Igel-Kamikaze', icon: '🦔', mode: 'sum', min: 1, text: (n) => `${n}× selbst getroffen` },
  { id: 'hidden', type: 'hidden', title: 'Unsichtbar', icon: '🫥', mode: 'max', min: 20_000, text: mmss },
  { id: 'pechvogel', type: 'coinloss', title: 'Pechvogel', icon: '🐦‍⬛', mode: 'sum', min: 3, text: (n) => `${n} Münzen verloren` },
  { id: 'streak', type: 'streak', title: 'Längste Siegesserie', icon: '🔥', mode: 'max', min: 2, text: (n) => `${n} Siege in Folge` },
  { id: 'bets', type: 'bet', title: 'Wett-König', icon: '🎲', mode: 'sum', min: 2, text: (n) => plural(n, 'Wette gewonnen', 'Wetten gewonnen') },
  { id: 'goals', type: 'goal', title: 'Torjäger', icon: '⚽', mode: 'sum', min: 2, text: (n) => plural(n, 'Tor', 'Tore') },
  { id: 'pushes', type: 'out', title: 'Rausschmeißer', icon: '🤼', mode: 'sum', min: 2, text: (n) => `${n}× vom Steg geschubst` },
  { id: 'bomber', type: 'hit', title: 'Bomben-Legende', icon: '💣', mode: 'sum', min: 3, text: (n) => `${n} nass gemacht` },
  { id: 'sniper', type: 'igelhit', title: 'Igel-Scharfschütze', icon: '🎯', mode: 'sum', min: 3, text: (n) => plural(n, 'Treffer', 'Treffer') },
  { id: 'racer', type: 'kartwin', title: 'Pole-Position', icon: '🏎️', mode: 'sum', min: 1, text: (n) => plural(n, 'Rennsieg', 'Rennsiege') },
  { id: 'selfout', type: 'selfout', title: 'Selbst ist der Mann', icon: '🪂', mode: 'sum', min: 2, text: (n) => `${n}× selbst von der Bühne` },
  { id: 'wins', type: 'win', title: 'Seriensieger', icon: '🏆', mode: 'sum', min: 3, text: (n) => plural(n, 'Spiel gewonnen', 'Spiele gewonnen') },
  { id: 'laterne', type: 'last', title: 'Rote Laterne', icon: '🏮', mode: 'sum', min: 3, text: (n) => `${n}× Letzter` },
];
const TITLE_MAX = 5;
const PER_PLAYER_MAX = 2;
/** „Lieblingsspiel der Gruppe“ erst, wenn ein Spiel so oft lief */
const FAVORITE_MIN = 2;

export class FxLog {
  private buf: FxEvent[] = [];
  private seq = 0;
  /** Typ → Spieler → Summe */
  private sums = new Map<string, Map<string, number>>();
  /** Typ → Spieler → Höchstwert */
  private maxes = new Map<string, Map<string, number>>();
  /** Gespielte Minispiele pro Art (Ereignis `play`) */
  private plays = new Map<MiniKind, number>();
  private games = 0;
  private version = 0;
  private cached: { key: string; stats: EveningStats } | null = null;

  constructor(private cap = 512) {}

  push(type: string, data: FxData = {}, kind: MiniKind | null = null, now = Date.now()) {
    const e: FxEvent = { seq: ++this.seq, at: now, type, kind };
    if (data.p !== undefined) e.p = data.p;
    if (data.n !== undefined) e.n = data.n;
    if (data.o !== undefined) e.o = data.o;
    this.buf.push(e);
    if (this.buf.length > this.cap) this.buf.shift();
    this.version += 1;
    if (type === 'play') {
      this.games += 1;
      if (kind) this.plays.set(kind, (this.plays.get(kind) ?? 0) + 1);
      return;
    }
    if (!e.p) return;
    const n = e.n ?? 1;
    const s = this.sums.get(type) ?? new Map<string, number>();
    s.set(e.p, (s.get(e.p) ?? 0) + n);
    this.sums.set(type, s);
    const m = this.maxes.get(type) ?? new Map<string, number>();
    if ((m.get(e.p) ?? -Infinity) < n) m.set(e.p, n);
    this.maxes.set(type, m);
  }

  /** Die letzten Ereignisse (Ringpuffer) */
  get events(): readonly FxEvent[] {
    return this.buf;
  }

  clear() {
    this.buf = [];
    this.sums.clear();
    this.maxes.clear();
    this.plays.clear();
    this.games = 0;
    this.version += 1;
    this.cached = null;
  }

  /** Wer bei einem Typ vorn liegt (Gleichstand: wer den Wert zuerst erreicht hat) – nur unter `known` Spielern */
  best(type: string, mode: 'sum' | 'max' = 'sum', known: (id: string) => boolean = () => true): { p: string; n: number } | null {
    const m = (mode === 'sum' ? this.sums : this.maxes).get(type);
    if (!m) return null;
    let out: { p: string; n: number } | null = null;
    for (const [p, n] of m) if (known(p) && (!out || n > out.n)) out = { p, n };
    return out;
  }

  /**
   * „Titel des Abends“ (höchstens 5, nur mit Daten) – gecacht, solange nichts Neues kam.
   * `known`: welche Spieler noch im Raum sind (wer gegangen ist, bekommt keinen Titel mehr).
   */
  stats(known: string[] = []): EveningStats {
    const key = `${this.version}|${known.join(',')}`;
    if (this.cached?.key === key) return this.cached.stats;
    const knownSet = new Set(known);
    const isKnown = (id: string) => !known.length || knownSet.has(id);
    const titles: EveningTitle[] = [];
    const perPlayer = new Map<string, number>();
    const take = (t: EveningTitle) => {
      if (titles.length >= TITLE_MAX) return;
      if (t.playerId && (perPlayer.get(t.playerId) ?? 0) >= PER_PLAYER_MAX) return;
      titles.push(t);
      if (t.playerId) perPlayer.set(t.playerId, (perPlayer.get(t.playerId) ?? 0) + 1);
    };
    // Lieblingsspiel zuerst in die Mitte der Liste: Titel 1–3 vorher, dann das Spiel, dann der Rest
    const favorite = (() => {
      let best: { kind: MiniKind; n: number } | null = null;
      for (const [kind, n] of this.plays) if (!best || n > best.n) best = { kind, n };
      if (!best || best.n < FAVORITE_MIN) return null;
      return { id: 'favorite', title: 'Lieblingsspiel der Gruppe', icon: MINI_INFO[best.kind].icon, playerId: null, kind: best.kind, value: best.n, text: `${MINI_INFO[best.kind].title} · ${best.n}× gespielt` } satisfies EveningTitle;
    })();
    TITLES.forEach((def, i) => {
      if (i === 3 && favorite) take(favorite);
      const b = this.best(def.type, def.mode, isKnown);
      if (!b || b.n < def.min) return;
      take({ id: def.id, title: def.title, icon: def.icon, playerId: b.p, value: b.n, text: def.text(b.n) });
    });
    if (favorite && !titles.includes(favorite)) take(favorite);
    const stats = { titles, games: this.games };
    this.cached = { key, stats };
    return stats;
  }
}
