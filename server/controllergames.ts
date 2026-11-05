import type { MiniSnapshot, SupBoard, SupState, Team, TidyPlayer, TidyState } from '../shared/types';
import { SUP, TEAM_INFO_SAFE, TIDY } from './cgconst';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ================================================================== Paddel-Duell (SUP)

/**
 * Zu zweit auf einem Stand-Up-Paddle-Board: Einer paddelt links, einer rechts.
 * Links paddeln schiebt nach vorn und dreht nach rechts (und umgekehrt).
 * Wer zu oft auf einer Seite paddelt, verliert das Gleichgewicht und fällt ins Wasser.
 */
export class SupGame implements MiniGame {
  readonly kind = 'sup' as const;
  private boards: (SupBoard & { v: number; fallUntil: number })[] = [];
  private obstacles: SupState['obstacles'] = [];
  private sub: SupState['sub'] = 'countdown';
  private deadline = Date.now() + SUP.COUNTDOWN_MS;
  private startedAt = 0;
  private timers = new Timers();
  private lastStroke = new Map<string, number>();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const order = shuffle(ids);
    const pairs: [string, string][] = [];
    for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1] ?? order[i]]);
    const lanes = pairs.length;
    pairs.forEach(([l, r], i) => {
      this.boards.push({
        id: i,
        left: l,
        right: r,
        x: 40,
        y: SUP.TOP + 20 + ((SUP.BOTTOM - SUP.TOP - 40) * (i + 0.5)) / lanes,
        heading: 0,
        balance: 0,
        fallen: false,
        finished: false,
        finishMs: null,
        strokes: { left: 0, right: 0 },
        color: SUP.COLORS[i % SUP.COLORS.length],
        v: 0,
        fallUntil: 0,
      });
    });
    // Hindernisse auf der Strecke verteilen
    const types = ['buoy', 'rock', 'jelly'] as const;
    for (let x = 220; x < SUP.LENGTH - 120; x += 70 + Math.random() * 60) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < count; k++) {
        const t = types[Math.floor(Math.random() * 3)];
        this.obstacles.push({ x: x + Math.random() * 30, y: SUP.TOP + 16 + Math.random() * (SUP.BOTTOM - SUP.TOP - 32), r: t === 'rock' ? 11 : t === 'buoy' ? 6 : 7, type: t });
      }
    }
    this.timers.later(SUP.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'race';
    this.startedAt = Date.now();
    this.deadline = this.startedAt + SUP.TIME_MS;
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, (now - last) / 1000);
      last = now;
    });
    this.ctx.onChange();
  }

  private tick(now: number, dt: number) {
    for (const b of this.boards) {
      if (b.finished) continue;
      if (b.fallen) {
        if (now >= b.fallUntil) {
          b.fallen = false;
          b.balance = 0;
        }
        continue;
      }
      b.v *= Math.pow(SUP.DRAG, dt);
      b.balance *= Math.pow(0.35, dt);
      b.heading = clamp(b.heading * Math.pow(0.7, dt), -1.2, 1.2);
      b.x += Math.cos(b.heading) * b.v * dt;
      b.y += Math.sin(b.heading) * b.v * dt;
      if (b.y < SUP.TOP || b.y > SUP.BOTTOM) {
        b.y = clamp(b.y, SUP.TOP, SUP.BOTTOM);
        b.heading *= -0.5;
        b.v *= 0.6;
      }
      for (const o of this.obstacles) {
        if (o.gone) continue;
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d >= o.r + SUP.BOARD_R) continue;
        if (o.type !== 'rock') {
          // Boje/Qualle: wird weggeschoben bzw. taucht ab – kostet Tempo und Gleichgewicht, aber man bleibt nie hängen
          o.gone = true;
          b.v *= 0.55;
          b.balance += (o.type === 'jelly' ? 0.45 : 0.25) * (Math.sign(b.balance) || 1);
          continue;
        }
        // Stein: zurückprallen und seitlich daran vorbeidrehen, damit man nicht immer wieder hineinfährt
        b.x = o.x + (dx / (d || 1)) * (o.r + SUP.BOARD_R + 1);
        b.y = o.y + (dy / (d || 1)) * (o.r + SUP.BOARD_R + 1);
        b.v *= -0.3;
        b.heading += (dy >= 0 ? 1 : -1) * 0.35;
        b.balance += 0.4 * (Math.sign(b.balance) || 1);
      }
      if (Math.abs(b.balance) > 1) this.fall(b, now);
      if (b.x >= SUP.LENGTH) {
        b.finished = true;
        b.finishMs = now - this.startedAt;
      }
    }
    if (this.boards.every((b) => b.finished) || now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  private fall(b: (typeof this.boards)[number], now: number) {
    b.fallen = true;
    b.fallUntil = now + SUP.FALL_MS;
    b.v = 0;
  }

  input(id: string, action: string, payload: unknown) {
    if (action !== 'paddle' || this.sub !== 'race') return;
    const side = asRecord(payload).side === 'right' ? 'right' : 'left';
    const b = this.boards.find((bb) => (side === 'left' ? bb.left : bb.right) === id);
    if (!b || b.finished || b.fallen) return;
    const key = `${id}-${side}`;
    const now = Date.now();
    if (now - (this.lastStroke.get(key) ?? 0) < 180) return;
    this.lastStroke.set(key, now);
    const dir = side === 'left' ? 1 : -1;
    b.v = Math.min(95, b.v + SUP.STROKE);
    b.heading += dir * SUP.TURN;
    b.balance += dir * SUP.WOBBLE;
    b.strokes[side] += 1;
    if (Math.abs(b.balance) > 1) this.fall(b, now);
    this.ctx.onChange();
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const score = (b: SupBoard) => (b.finished ? 1e6 - (b.finishMs ?? 0) : b.x);
    const byId = new Map<string, number>();
    for (const b of this.boards) {
      byId.set(b.left, score(b));
      byId.set(b.right, score(b));
    }
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => byId.get(id) ?? 0),
        details: Object.fromEntries(
          this.boards.flatMap((b) => {
            const text = b.finished ? `im Ziel nach ${((b.finishMs ?? 0) / 1000).toFixed(1)}s` : `${Math.round((b.x / SUP.LENGTH) * 100)}% der Strecke`;
            return [[b.left, text], [b.right, text]];
          }),
        ),
        subtitle: 'Wer synchron paddelt, kommt weiter!',
      }),
    );
  }

  snapshot(): MiniSnapshot {
    return {
      kind: 'sup',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - Date.now()),
        length: SUP.LENGTH,
        boards: this.boards.map(({ v: _v, fallUntil: _f, ...b }) => b),
        obstacles: this.obstacles,
      },
    };
  }

  playerDisconnected() {}
  dispose() {
    this.timers.clear();
  }
}

// ================================================================== Aufräumen

interface Item {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
}

/**
 * Aufräumen im Ferienhaus: Zwei Teams schieben per Joystick herumliegende Sachen
 * in ihren Korb. Mit "Sprint" kann man kurz schneller laufen (und andere wegschubsen).
 */
export class TidyGame implements MiniGame {
  readonly kind = 'tidy' as const;
  private players = new Map<string, TidyPlayer & { sx: number; sy: number; dashUntil: number; dashReady: number }>();
  private items: Item[] = [];
  private baskets: TidyState['baskets'];
  private score: Record<Team, number> = { A: 0, B: 0 };
  private lastScore: TidyState['lastScore'] = null;
  private seq = 0;
  private sub: TidyState['sub'] = 'countdown';
  private deadline = Date.now() + TIDY.COUNTDOWN_MS;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const A = TIDY.AREA;
    const solo = ids.length === 1;
    this.baskets = [
      { team: 'A', x: A.x + 24, y: A.y + A.h / 2, r: 16 },
      ...(solo ? [] : [{ team: 'B' as Team, x: A.x + A.w - 24, y: A.y + A.h / 2, r: 16 }]),
    ];
    // Ab 5 Spielern pro Team (bis 12 Spieler) enger stapeln, damit niemand auf demselben Startplatz steht
    const perTeam = Math.ceil(ids.length / 2);
    const gap = perTeam > 4 ? (A.h - 40) / (perTeam - 1) : 45;
    shuffle(ids).forEach((id, i) => {
      const team: Team = solo || i % 2 === 0 ? 'A' : 'B';
      this.players.set(id, {
        x: team === 'A' ? A.x + 60 : A.x + A.w - 60,
        y: A.y + (perTeam > 4 ? 20 : 30) + ((i >> 1) % Math.max(4, perTeam)) * gap,
        team,
        dir: team === 'A' ? 1 : -1,
        moving: false,
        dashLeft: 0,
        sx: 0,
        sy: 0,
        dashUntil: 0,
        dashReady: 0,
      });
    });
    for (let i = 0; i < TIDY.ITEMS; i++) {
      this.items.push({
        id: i,
        x: A.x + 80 + Math.random() * (A.w - 160),
        y: A.y + 14 + Math.random() * (A.h - 28),
        vx: 0,
        vy: 0,
        type: TIDY.ITEM_TYPES[i % TIDY.ITEM_TYPES.length],
      });
    }
    this.timers.later(TIDY.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'play';
    this.deadline = Date.now() + TIDY.TIME_MS;
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, (now - last) / 1000);
      last = now;
    });
    this.ctx.onChange();
  }

  private tick(now: number, dt: number) {
    const A = TIDY.AREA;
    // Spieler bewegen
    for (const p of this.players.values()) {
      const speed = now < p.dashUntil ? TIDY.DASH_SPEED : TIDY.SPEED;
      const len = Math.hypot(p.sx, p.sy);
      p.moving = len > 0.15;
      if (p.moving) {
        p.x = clamp(p.x + (p.sx / Math.max(1, len)) * speed * dt * Math.min(1, len), A.x + TIDY.PLAYER_R, A.x + A.w - TIDY.PLAYER_R);
        p.y = clamp(p.y + (p.sy / Math.max(1, len)) * speed * dt * Math.min(1, len), A.y + TIDY.PLAYER_R, A.y + A.h - TIDY.PLAYER_R);
        if (Math.abs(p.sx) > 0.2) p.dir = p.sx > 0 ? 1 : -1;
      }
      p.dashLeft = Math.max(0, p.dashReady - now);
    }
    // Spieler untereinander (Schubsen)
    const list = [...this.players.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = TIDY.PLAYER_R * 2;
        if (d < min) {
          // Wer gerade sprintet, schubst stärker
          const wa = now < a.dashUntil ? 0.2 : 1;
          const wb = now < b.dashUntil ? 0.2 : 1;
          const push = min - d;
          a.x -= (dx / d) * push * (wa / (wa + wb));
          a.y -= (dy / d) * push * (wa / (wa + wb));
          b.x += (dx / d) * push * (wb / (wa + wb));
          b.y += (dy / d) * push * (wb / (wa + wb));
        }
      }
    }
    // Sachen schieben
    for (const it of this.items) {
      for (const p of this.players.values()) {
        const dx = it.x - p.x;
        const dy = it.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = TIDY.PLAYER_R + TIDY.ITEM_R;
        if (d < min) {
          it.x = p.x + (dx / d) * min;
          it.y = p.y + (dy / d) * min;
          const speed = now < p.dashUntil ? TIDY.DASH_SPEED : TIDY.SPEED;
          it.vx = (dx / d) * speed * 1.1;
          it.vy = (dy / d) * speed * 1.1;
        }
      }
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.vx *= Math.pow(0.02, dt);
      it.vy *= Math.pow(0.02, dt);
      if (it.x < A.x + TIDY.ITEM_R || it.x > A.x + A.w - TIDY.ITEM_R) it.vx *= -0.5;
      if (it.y < A.y + TIDY.ITEM_R || it.y > A.y + A.h - TIDY.ITEM_R) it.vy *= -0.5;
      it.x = clamp(it.x, A.x + TIDY.ITEM_R, A.x + A.w - TIDY.ITEM_R);
      it.y = clamp(it.y, A.y + TIDY.ITEM_R, A.y + A.h - TIDY.ITEM_R);
    }
    // Körbe
    this.items = this.items.filter((it) => {
      const b = this.baskets.find((bk) => Math.hypot(bk.x - it.x, bk.y - it.y) < bk.r - 2);
      if (!b) return true;
      this.score[b.team] += 1;
      this.lastScore = { team: b.team, type: it.type, seq: ++this.seq };
      return false;
    });
    if (!this.items.length || now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    if (action === 'stick') {
      const pl = asRecord(payload);
      p.sx = clamp(Number(pl.x) || 0, -1, 1);
      p.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'dash' && this.sub === 'play') {
      const now = Date.now();
      if (now < p.dashReady) return;
      p.dashUntil = now + TIDY.DASH_MS;
      p.dashReady = now + TIDY.DASH_COOLDOWN;
    }
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    this.ctx.onChange();
    const solo = this.baskets.length === 1;
    const teamOf = (id: string) => this.players.get(id)!.team;
    const win: Team | null = solo ? 'A' : this.score.A === this.score.B ? null : this.score.A > this.score.B ? 'A' : 'B';
    this.timers.later(2500, () =>
      this.ctx.finish({
        groups: win ? groupByScore(this.ids, (id) => (teamOf(id) === win ? 1 : 0)) : [this.ids],
        details: Object.fromEntries(this.ids.map((id) => [id, `${TEAM_INFO_SAFE[teamOf(id)]}: ${this.score[teamOf(id)]} Teile`])),
        subtitle: solo ? `${this.score.A} Teile aufgeräumt!` : win ? `${TEAM_INFO_SAFE[win]} hat am meisten aufgeräumt!` : 'Unentschieden – beide gleich ordentlich!',
        coins: win ? [10, 3] : [6],
      }),
    );
  }

  snapshot(): MiniSnapshot {
    return {
      kind: 'tidy',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - Date.now()),
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, { x, y, team, dir, moving, dashLeft }]) => [id, { x, y, team, dir, moving, dashLeft }]),
        ),
        items: this.items.map(({ id, x, y, type }) => ({ id, x, y, type })),
        baskets: this.baskets,
        score: this.score,
        lastScore: this.lastScore,
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) p.sx = p.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
