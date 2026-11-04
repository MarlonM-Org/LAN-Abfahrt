import type { BoardState, MiniKind } from '../shared/types';
import { BOARD_KINDS, BOARD_SIZE, COCKTAIL_PRICE, FIELD_COINS, FIELD_TYPES, MINI_INFO } from '../shared/games';
import { Timers, shuffle } from './minigame';

const STEP_MS = 280;
const INTRO_MS = 4000;

export interface BoardCtx {
  onChange(): void;
  startMini(kind: MiniKind): void;
  isConnected(id: string): boolean;
  nameOf(id: string): string;
  connectedCount(): number;
}

interface PartyEvent {
  text: (name: string) => string;
  apply: (board: Board, id: string) => void;
}

const EVENTS: PartyEvent[] = [
  { text: (n) => `Pool-Party! ${n} bekommt 5 Münzen.`, apply: (b, id) => b.addCoins(id, 5) },
  { text: (n) => `${n} hat Sonnenbrand und kauft teure After-Sun: −4`, apply: (b, id) => b.addCoins(id, -4) },
  { text: (n) => `Der Nachbar beschwert sich über ${n}: −3`, apply: (b, id) => b.addCoins(id, -3) },
  { text: (n) => `${n} bringt das Pfand weg: +4`, apply: (b, id) => b.addCoins(id, 4) },
  {
    text: (n) => `${n} schmeißt eine Runde – alle anderen bekommen 1 Münze von ${n}!`,
    apply: (b, id) => {
      for (const o of b.state.order) if (o !== id && b.state.coins[id] > 0) (b.addCoins(id, -1), b.addCoins(o, 1));
    },
  },
  {
    text: (n) => `Spülmaschinen-Dienst! ${n} kassiert von allen 1 Münze.`,
    apply: (b, id) => {
      for (const o of b.state.order) if (o !== id && b.state.coins[o] > 0) (b.addCoins(o, -1), b.addCoins(id, 1));
    },
  },
  {
    text: (n) => `Zimmertausch! ${n} tauscht den Platz mit jemand anderem.`,
    apply: (b, id) => {
      const others = b.state.order.filter((o) => o !== id);
      if (!others.length) return;
      const o = others[Math.floor(Math.random() * others.length)];
      [b.state.pos[id], b.state.pos[o]] = [b.state.pos[o], b.state.pos[id]];
    },
  },
];

/**
 * Das Spielbrett im Mario-Party-Stil: Jeder würfelt einmal pro Runde,
 * danach folgt ein Minispiel. Münzen werden an der Cocktailbar gegen Cocktails getauscht.
 */
export class Board {
  state: BoardState;
  private timers = new Timers();
  private lastMini: MiniKind | null = null;

  constructor(
    ids: string[],
    maxRounds: number,
    private ctx: BoardCtx,
  ) {
    this.state = {
      round: 1,
      maxRounds,
      order: shuffle(ids),
      turnIdx: 0,
      sub: 'roll',
      pos: Object.fromEntries(ids.map((id) => [id, 0])),
      coins: Object.fromEntries(ids.map((id) => [id, 10])),
      cocktails: Object.fromEntries(ids.map((id) => [id, 0])),
      barField: 0,
      lastRoll: null,
      message: 'Willkommen im Ferienhaus! Alle starten mit 10 Münzen.',
      messageSeq: 1,
      nextMini: null,
    };
    // Erste Bar in Reichweite der ersten Würfe
    this.state.barField = [5, 6, 7, 8][Math.floor(Math.random() * 4)];
    this.beginTurn();
  }

  get currentPlayer(): string {
    return this.state.order[this.state.turnIdx];
  }

  get finished(): boolean {
    return this.state.round > this.state.maxRounds;
  }

  addCoins(id: string, delta: number) {
    this.state.coins[id] = Math.max(0, (this.state.coins[id] ?? 0) + delta);
  }

  roll(playerId: string) {
    const s = this.state;
    if (s.sub !== 'roll' || playerId !== this.currentPlayer) return;
    this.timers.clear();
    const value = 1 + Math.floor(Math.random() * 6);
    const start = s.pos[playerId];
    const path = Array.from({ length: value }, (_, i) => (start + i + 1) % BOARD_SIZE);
    s.lastRoll = { seq: (s.lastRoll?.seq ?? 0) + 1, playerId, value, path };
    s.sub = 'moving';
    this.ctx.onChange();
    this.timers.later(900 + value * STEP_MS, () => this.land(playerId, path));
  }

  /** Nach einem Minispiel: Münzen gutschreiben, nächste Runde. */
  afterMini(coins: Record<string, number>) {
    for (const [id, c] of Object.entries(coins)) if (id in this.state.coins) this.addCoins(id, c);
    const s = this.state;
    s.round += 1;
    s.turnIdx = 0;
    s.nextMini = null;
    if (this.finished) return;
    this.say(`Runde ${s.round} von ${s.maxRounds}!`);
    this.beginTurn();
  }

  dispose() {
    this.timers.clear();
  }

  private land(id: string, path: number[]) {
    const s = this.state;
    const name = this.ctx.nameOf(id);
    const msgs: string[] = [];

    // Cocktailbar: Kauf beim Vorbeilaufen oder Landen
    if (path.includes(s.barField)) {
      if (s.coins[id] >= COCKTAIL_PRICE) {
        this.addCoins(id, -COCKTAIL_PRICE);
        s.cocktails[id] += 1;
        msgs.push(`${name} kauft einen Cocktail!`);
        this.moveBar();
      } else {
        msgs.push(`${name} kommt an der Bar vorbei, hat aber keine ${COCKTAIL_PRICE} Münzen.`);
      }
    }

    s.pos[id] = path[path.length - 1];
    const type = FIELD_TYPES[s.pos[id]];
    if (type === 'blue' || type === 'start') {
      this.addCoins(id, FIELD_COINS.blue);
      msgs.push(`${name}: +${FIELD_COINS.blue} Münzen`);
    } else if (type === 'red') {
      this.addCoins(id, FIELD_COINS.red);
      msgs.push(`${name}: ${FIELD_COINS.red} Münzen`);
    } else if (type === 'event') {
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      ev.apply(this, id);
      msgs.push(ev.text(name));
    }
    this.say(msgs.join(' '));

    s.turnIdx += 1;
    if (s.turnIdx >= s.order.length) {
      this.timers.later(2200, () => this.intro());
    } else {
      this.timers.later(1800, () => this.beginTurn());
    }
    this.ctx.onChange();
  }

  private beginTurn() {
    const s = this.state;
    s.sub = 'roll';
    this.ctx.onChange();
    // Wer nicht verbunden ist, würfelt automatisch
    const id = this.currentPlayer;
    if (!this.ctx.isConnected(id)) this.timers.later(1500, () => this.roll(id));
  }

  private intro() {
    const s = this.state;
    const isFinale = s.round === s.maxRounds && this.ctx.connectedCount() >= MINI_INFO.murder.minPlayers;
    // Nur Spiele, für die genug Leute da sind (z. B. Urlaubs-Fangen ab 3)
    const players = this.ctx.connectedCount();
    const pool: MiniKind[] = BOARD_KINDS.filter((k) => k !== this.lastMini && MINI_INFO[k].minPlayers <= players);
    const kind: MiniKind = isFinale ? 'murder' : pool[Math.floor(Math.random() * pool.length)];
    this.lastMini = kind;
    s.sub = 'intro';
    s.nextMini = kind;
    this.say(isFinale ? `FINALE: ${MINI_INFO[kind].title}!` : `Minispiel: ${MINI_INFO[kind].title}!`);
    this.ctx.onChange();
    this.timers.later(INTRO_MS, () => this.ctx.startMini(kind));
  }

  private moveBar() {
    const candidates = FIELD_TYPES.map((t, i) => (t === 'blue' ? i : -1)).filter(
      (i) => i >= 0 && i !== this.state.barField && !Object.values(this.state.pos).includes(i),
    );
    this.state.barField = candidates[Math.floor(Math.random() * candidates.length)] ?? 1;
  }

  private say(msg: string) {
    this.state.message = msg;
    this.state.messageSeq += 1;
  }
}
