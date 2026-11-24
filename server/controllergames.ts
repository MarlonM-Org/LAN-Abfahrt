import type { MiniSnapshot, SupBoard, SupState, Team, TidyPlayer, TidyState } from '../shared/types';
import { SUP, TEAM_INFO_SAFE, TIDY } from './cgconst';
import { tidyItemType } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, shuffle, splitTeams } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ================================================================== SUP-Rennen

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
}

type TidyP = TidyPlayer & { sx: number; sy: number; dashUntil: number; dashReady: number };

/** Lage eines Spielers für den Besen: Körpermitte (x, y) und Blickrichtung a */
export interface TidyFrame {
  x: number;
  y: number;
  a: number;
}

/** Weltpunkt in Spieler-Koordinaten: u = nach vorn (Blickrichtung), v = quer dazu */
export function tidyLocal(f: TidyFrame, x: number, y: number) {
  const c = Math.cos(f.a);
  const s = Math.sin(f.a);
  const dx = x - f.x;
  const dy = y - f.y;
  return { u: dx * c + dy * s, v: dy * c - dx * s };
}

function tidyWorld(f: TidyFrame, u: number, v: number) {
  const c = Math.cos(f.a);
  const s = Math.sin(f.a);
  return { x: f.x + u * c - v * s, y: f.y + u * s + v * c };
}

/** Winkel `a` höchstens um `max` (rad) zur Richtung `ziel` drehen – auf dem kurzen Weg, Ergebnis in −π…π */
export function tidyTurn(a: number, ziel: number, max: number) {
  const d = Math.atan2(Math.sin(ziel - a), Math.cos(ziel - a));
  const r = a + clamp(d, -max, max);
  return Math.atan2(Math.sin(r), Math.cos(r));
}

/** So weit darf eine Sache seitlich über das Besenende ragen und wird trotzdem noch gerade geschoben */
const TIDY_TIP = TIDY.BROOM_HALF + TIDY.ITEM_R * 0.6;

/**
 * Besen gegen eine Sache. Die Kante liegt quer vor dem Spieler bei u = BROOM_D (|v| ≤ BROOM_HALF), eine anliegende
 * Sache sitzt bei u = BROOM_D + ITEM_R. Lag sie vorher vor der Kante und wäre jetzt dahinter, sitzt sie wieder genau
 * vor der Kante – mit derselben Querlage wie vorher (Haftreibung). So bleibt sie beim Geradeauslaufen UND im Bogen auf
 * der Geraden vor dem Besen, statt wie an einem runden Körper zur Seite wegzurutschen. Fegt das Besenende beim Drehen
 * seitlich über eine Sache, landet sie ebenfalls vor der Kante. Zieht sich der Besen zurück, bleibt die Sache liegen.
 * `alt`/`neu`: Spieler vor/nach dem Takt, (x0, y0) Sache vor dem Takt, (x1, y1) jetzt.
 * @returns neue Lage (`carried` = vom Besen mitgenommen → bekommt dessen Tempo) oder null ohne Kontakt
 */
export function tidyBroomPush(alt: TidyFrame, neu: TidyFrame, x0: number, y0: number, x1: number, y1: number): { x: number; y: number; carried: boolean } | null {
  const D = TIDY.BROOM_D;
  const front = D + TIDY.ITEM_R;
  const p1 = tidyLocal(neu, x1, y1);
  if (p1.u >= front) return null;
  const p0 = tidyLocal(alt, x0, y0);
  if (p0.u >= D - 1.5 && Math.abs(p0.v) <= TIDY_TIP) return { ...tidyWorld(neu, front, p0.v), carried: true };
  if (p1.u > D - TIDY.ITEM_R && Math.abs(p1.v) <= TIDY_TIP) return { ...tidyWorld(neu, front, p1.v), carried: false };
  return null;
}

/**
 * Eigener Körper gegen eine Sache: kleines Quadrat, das sich mit dem Spieler dreht. Schiebt sie auf kürzestem Weg
 * (senkrecht zu einer Kante) hinaus, ohne Schwung – der Körper schubst nichts mehr in alle Richtungen weg.
 */
export function tidyBodyPush(f: TidyFrame, x: number, y: number): { x: number; y: number } | null {
  const H = TIDY.BODY_H + TIDY.ITEM_R;
  const p = tidyLocal(f, x, y);
  const du = H - Math.abs(p.u);
  const dv = H - Math.abs(p.v);
  if (du <= 0 || dv <= 0) return null;
  return du < dv ? tidyWorld(f, p.u >= 0 ? H : -H, p.v) : tidyWorld(f, p.u, p.v >= 0 ? H : -H);
}

/** Ecken des Zimmers: Sachen rollen langsam heraus (sonst kommt man mit dem Besen nie mehr dahinter) */
const TIDY_CORNER = 20;
const TIDY_CORNER_PUSH = 90;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Aufräumen im Ferienhaus: Zwei Teams fegen herumliegende Sachen in ihren Korb. Jeder trägt einen Besen – eine gerade
 * Kante quer vor sich, die sich weich und zügig zur Laufrichtung dreht; geschoben wird mit ihr (der Körper ist nur ein
 * kleines Quadrat und schubst nichts weg). "Sprint": kurz schneller, die Sachen vor dem Besen fliegen geradeaus davon,
 * andere Spieler werden weggeschubst. Physik mit 60 Hz, Snapshot jeden 2. Takt mit dessen Zeit `t` (TV interpoliert).
 * Aufwärmrunde (`ctx.practice`): kein Zeitlimit, ist alles aufgeräumt, liegt neues Chaos herum.
 */
export class TidyGame implements MiniGame {
  readonly kind = 'tidy' as const;
  private players = new Map<string, TidyP>();
  private items: Item[] = [];
  private nextItem = 0;
  private baskets: TidyState['baskets'];
  private score: Record<Team, number> = { A: 0, B: 0 };
  private lastScore: TidyState['lastScore'] = null;
  private seq = 0;
  private sub: TidyState['sub'] = 'countdown';
  private deadline = Date.now() + TIDY.COUNTDOWN_MS;
  private timers = new Timers();
  /** Zeit des letzten Physik-Takts (geht als `t` in den Snapshot) */
  private tickAt = 0;
  private ticks = 0;

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
    // Teams wie in der Aufwärmrunde (sonst zufällig abwechselnd) – Reihenfolge A, B, A, B … für die Startplätze
    const split = splitTeams(ids, ctx.warmTeams);
    const order = Array.from({ length: Math.max(split.A.length, split.B.length) }, (_, k) => [split.A[k], split.B[k]]).flat().filter((id): id is string => !!id);
    order.forEach((id, i) => {
      const team: Team = solo || split.A.includes(id) ? 'A' : 'B';
      this.players.set(id, {
        x: team === 'A' ? A.x + 60 : A.x + A.w - 60,
        y: A.y + (perTeam > 4 ? 20 : 30) + ((i >> 1) % Math.max(4, perTeam)) * gap,
        // Besen zeigt zu Beginn in die Zimmermitte
        a: team === 'A' ? 0 : Math.PI,
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
    this.spawnItems();
    this.timers.later(TIDY.COUNTDOWN_MS, () => this.start());
  }

  private spawnItems() {
    const A = TIDY.AREA;
    for (let i = 0; i < TIDY.ITEMS; i++) {
      this.items.push({ id: this.nextItem++, x: A.x + 80 + Math.random() * (A.w - 160), y: A.y + 14 + Math.random() * (A.h - 28), vx: 0, vy: 0 });
    }
  }

  private start() {
    this.sub = 'play';
    this.deadline = this.ctx.practice ? 0 : Date.now() + TIDY.TIME_MS;
    let last = Date.now();
    this.timers.every(TIDY.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.05, (now - last) / 1000));
      last = now;
    });
    this.ctx.onChange();
  }

  private tick(now: number, dt: number) {
    this.tickAt = now;
    const list = [...this.players.values()];
    const before: TidyFrame[] = list.map(({ x, y, a }) => ({ x, y, a }));
    // Spieler: Besen weich zur Stick-Richtung drehen, laufen in Stick-Richtung (die Steuerung bleibt direkt).
    // Sprint ohne Stick: kurzer Ausfallschritt in Besen-Richtung.
    for (const p of list) {
      p.dash = now < p.dashUntil;
      const len = Math.hypot(p.sx, p.sy);
      p.moving = len > 0.15;
      if (p.moving) {
        p.a = tidyTurn(p.a, Math.atan2(p.sy, p.sx), TIDY.TURN * dt);
        const speed = (p.dash ? TIDY.DASH_SPEED : TIDY.SPEED) * Math.min(1, len);
        p.x += (p.sx / len) * speed * dt;
        p.y += (p.sy / len) * speed * dt;
      } else if (p.dash) {
        p.x += Math.cos(p.a) * TIDY.DASH_SPEED * dt;
        p.y += Math.sin(p.a) * TIDY.DASH_SPEED * dt;
      }
      const c = Math.cos(p.a);
      if (c > 0.3) p.dir = 1;
      else if (c < -0.3) p.dir = -1;
      p.dashLeft = Math.max(0, p.dashReady - now);
    }
    this.pushPlayers(list);
    for (const p of list) this.keepInside(p);
    const after: TidyFrame[] = list.map(({ x, y, a }) => ({ x, y, a }));
    // Sachen: gleiten (Reibung), dann Körper und Besen aller Spieler
    const glide = Math.pow(0.02, dt);
    for (const it of this.items) {
      const x0 = it.x;
      const y0 = it.y;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.vx *= glide;
      it.vy *= glide;
      list.forEach((p, i) => {
        const body = tidyBodyPush(after[i], it.x, it.y);
        if (body) {
          it.x = body.x;
          it.y = body.y;
          it.vx *= 0.5;
          it.vy *= 0.5;
        }
        const hit = tidyBroomPush(before[i], after[i], x0, y0, it.x, it.y);
        if (!hit) return;
        it.x = hit.x;
        it.y = hit.y;
        if (!hit.carried) return;
        if (p.dash) {
          it.vx = Math.cos(p.a) * TIDY.DASH_SHOT;
          it.vy = Math.sin(p.a) * TIDY.DASH_SHOT;
        } else if (dt > 0) {
          it.vx = ((hit.x - x0) / dt) * TIDY.CARRY_KEEP;
          it.vy = ((hit.y - y0) / dt) * TIDY.CARRY_KEEP;
        }
      });
    }
    this.separateItems();
    for (const it of this.items) this.keepItemInside(it, dt);
    // Körbe
    this.items = this.items.filter((it) => {
      const b = this.baskets.find((bk) => Math.hypot(bk.x - it.x, bk.y - it.y) < bk.r - 2);
      if (!b) return true;
      this.score[b.team] += 1;
      this.lastScore = { team: b.team, type: tidyItemType(it.id), seq: ++this.seq };
      return false;
    });
    if (!this.items.length && this.ctx.practice) this.spawnItems();
    if (!this.items.length || (this.deadline && now >= this.deadline)) return this.end();
    if (++this.ticks % TIDY.SEND_EVERY === 0) this.ctx.onChange();
  }

  /** Spieler untereinander: Kreise, wer gerade sprintet, schubst stärker */
  private pushPlayers(list: TidyP[]) {
    const min = TIDY.PLAYER_R * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d >= min) continue;
        const wa = a.dash ? 0.2 : 1;
        const wb = b.dash ? 0.2 : 1;
        const push = min - d;
        a.x -= (dx / d) * push * (wa / (wa + wb));
        a.y -= (dy / d) * push * (wa / (wa + wb));
        b.x += (dx / d) * push * (wb / (wa + wb));
        b.y += (dy / d) * push * (wb / (wa + wb));
      }
    }
  }

  /**
   * Spieler im Zimmer halten – den Besen auch: Vor der Kante bleibt an der Wand Platz für eine Sache (sonst säße sie
   * halb unter dem Besen), die Besenenden stoßen nicht durch die Wand. Dreht man sich zur Wand, rückt man sanft ab.
   */
  private keepInside(p: TidyP) {
    const A = TIDY.AREA;
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    const bx = p.x + c * TIDY.BROOM_D;
    const by = p.y + s * TIDY.BROOM_D;
    const B = TIDY.BROOM_HALF;
    const pts: [number, number, number][] = [
      [p.x, p.y, TIDY.PLAYER_R],
      [bx, by, TIDY.ITEM_R * 2],
      [bx - s * B, by + c * B, 1],
      [bx + s * B, by - c * B, 1],
    ];
    let lx = 0;
    let hx = 0;
    let ly = 0;
    let hy = 0;
    for (const [x, y, m] of pts) {
      lx = Math.max(lx, A.x + m - x);
      hx = Math.min(hx, A.x + A.w - m - x);
      ly = Math.max(ly, A.y + m - y);
      hy = Math.min(hy, A.y + A.h - m - y);
    }
    p.x += lx + hx;
    p.y += ly + hy;
  }

  /** Sachen untereinander: nur auseinanderschieben (eine Reihe vor dem Besen schiebt sich gegenseitig mit) */
  private separateItems() {
    const min = TIDY.ITEM_R * 2;
    const its = this.items;
    for (let i = 0; i < its.length; i++) {
      for (let j = i + 1; j < its.length; j++) {
        const a = its[i];
        const b = its[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 0.001 ? dx / d : 1;
        const ny = d > 0.001 ? dy / d : 0;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  private keepItemInside(it: Item, dt: number) {
    const A = TIDY.AREA;
    const R = TIDY.ITEM_R;
    if (it.x < A.x + R || it.x > A.x + A.w - R) it.vx *= -0.3;
    if (it.y < A.y + R || it.y > A.y + A.h - R) it.vy *= -0.3;
    it.x = clamp(it.x, A.x + R, A.x + A.w - R);
    it.y = clamp(it.y, A.y + R, A.y + A.h - R);
    const cx = it.x - A.x < TIDY_CORNER ? 1 : A.x + A.w - it.x < TIDY_CORNER ? -1 : 0;
    const cy = it.y - A.y < TIDY_CORNER ? 1 : A.y + A.h - it.y < TIDY_CORNER ? -1 : 0;
    if (cx && cy) {
      it.vx += cx * TIDY_CORNER_PUSH * dt;
      it.vy += cy * TIDY_CORNER_PUSH * dt;
    }
  }

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    if (action === 'stick') {
      const pl = asRecord(payload);
      p.sx = clamp(Number(pl.x) || 0, -1, 1);
      p.sy = clamp(Number(pl.y) || 0, -1, 1);
    } else if (action === 'dash' && this.sub === 'play') this.dash(p, Date.now());
  }

  private dash(p: TidyP, now: number) {
    if (now < p.dashReady) return;
    p.dashUntil = now + TIDY.DASH_MS;
    p.dashReady = now + TIDY.DASH_COOLDOWN;
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
        t: this.tickAt || Date.now(),
        endsIn: endsIn(this.deadline),
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, p]) => [
            id,
            { x: r1(p.x), y: r1(p.y), a: Math.round(p.a * 100) / 100, team: p.team, dir: p.dir, moving: p.moving, ...(p.dash ? { dash: true } : {}), dashLeft: Math.ceil(p.dashLeft / 100) * 100 },
          ]),
        ),
        items: this.items.map(({ id, x, y }) => ({ id, x: r1(x), y: r1(y) })),
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

  /** Nur für `scripts/test-aufraeumen.ts`: Spiel ohne Timer steuern (Uhr und Takte von außen) */
  testApi() {
    const g = this;
    let t = Date.now();
    return {
      /** Spiel läuft sofort ohne Zeitlimit; Spieler an feste Plätze, Sachen (null = zufällige behalten) */
      begin(at: Record<string, TidyFrame>, items: { x: number; y: number }[] | null) {
        g.timers.clear();
        g.sub = 'play';
        g.deadline = 0;
        for (const [id, p] of g.players) {
          if (at[id]) Object.assign(p, at[id]);
          p.sx = p.sy = 0;
          p.dashUntil = p.dashReady = 0;
        }
        if (items) g.items = items.map((it, i) => ({ id: i, x: it.x, y: it.y, vx: 0, vy: 0 }));
      },
      stick: (id: string, x: number, y: number) => g.input(id, 'stick', { x, y }),
      dash: (id: string) => g.dash(g.players.get(id)!, t),
      /** n Takte à TICK_MS */
      step(n = 1) {
        for (let k = 0; k < n && g.sub === 'play'; k++) {
          t += TIDY.TICK_MS;
          g.tick(t, TIDY.TICK_MS / 1000);
        }
      },
      player: (id: string) => g.players.get(id)!,
      items: () => g.items,
      score: () => g.score,
      state: () => {
        const s = g.snapshot();
        return s.kind === 'tidy' ? s.state : null;
      },
      over: () => g.sub === 'over',
    };
  }
}
