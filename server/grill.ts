import type { MiniSnapshot, Team } from '../shared/types';
import { TEAM_INFO } from '../shared/flunky';
import { SHIRTS } from '../shared/avatar';
import {
  GRILL as G,
  GRILL_CRATES,
  GRILL_RECIPES,
  GRILL_RECIPE_IDS,
  type GrillEvent,
  type GrillGeo,
  type GrillItem,
  type GrillKitchen,
  type GrillLayoutId,
  type GrillOrder,
  type GrillPlayer,
  type GrillRecipeId,
  type GrillSlot,
  type GrillState,
  canChop,
  canGrill,
  geoCols,
  geoRows,
  grillGrid,
  grillStarGoals,
  isFloorCh,
  matchRecipe,
  mergeItems,
  newBase,
  newExt,
  newIng,
  nextStep,
  stationOf,
  tileCenter,
  tileCh,
  tileOfPos,
} from '../shared/grill';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hexNum = (s: string) => parseInt(s.slice(1), 16);
const clone = (i: GrillItem | null): GrillItem | null => (i ? { ...i, p: i.p.map((p) => ({ ...p })), g: r2(i.g), u: r2(i.u) } : null);

interface Slot {
  c: number;
  r: number;
  ch: string;
  item: GrillItem | null;
  fire: boolean;
  ext: number;
  /** wer zuletzt etwas auf den Grill gelegt hat (für die Wertung) */
  by: string | null;
}

interface Kitchen extends GrillGeo {
  team: Team | null;
  layout: GrillLayoutId;
  mirror: boolean;
  slots: Map<string, Slot>;
  orders: GrillOrder[];
  nextOrderAt: number;
  score: number;
  served: number;
  expired: number;
  /** Spieler in dieser Küche */
  size: number;
}

interface P {
  id: string;
  k: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  sx: number;
  sy: number;
  moving: boolean;
  held: GrillItem | null;
  actUntil: number;
  working: boolean;
  target: Slot | null;
  color: number;
  no: number;
  served: number;
  chops: number;
  grilled: number;
  rescues: number;
}

/**
 * Grill-Chaos: Gemeinsam Bestellungen der Garten-Grillparty abarbeiten (Overcooked-Prinzip).
 * Bis 6 Spieler eine gemeinsame Küche, ab 7 zwei Teams mit gespiegelten Küchen.
 */
export class GrillGame implements MiniGame {
  readonly kind = 'grill' as const;
  private players = new Map<string, P>();
  private kitchens: Kitchen[] = [];
  private events: (GrillEvent & { at: number })[] = [];
  private seq = 0;
  private orderSeq = 0;
  private sub: GrillState['sub'] = 'countdown';
  private deadline = Date.now() + G.COUNTDOWN_MS;
  private startedAt = 0;
  private timers = new Timers();
  private readonly teams: boolean;
  private readonly goals: [number, number, number];
  private stars = 0;
  private winner: Team | null = null;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const n = ids.length;
    this.teams = n >= 7;
    this.goals = grillStarGoals(n);
    if (this.teams) {
      this.kitchens.push(this.makeKitchen('small', false, 6, 'A'));
      this.kitchens.push(this.makeKitchen('small', true, 240, 'B'));
    } else if (n <= 3) {
      this.kitchens.push(this.makeKitchen('small', false, Math.round((480 - 13 * G.TILE) / 2), null));
    } else {
      this.kitchens.push(this.makeKitchen('wide', false, 6, null));
    }
    const order = shuffle(ids);
    order.forEach((id, i) => {
      const k = this.teams ? i % 2 : 0;
      const kit = this.kitchens[k];
      kit.size++;
      const look = ctx.lookOf?.(id);
      this.players.set(id, {
        id,
        k,
        x: 0,
        y: 0,
        fx: 0,
        fy: 1,
        sx: 0,
        sy: 0,
        moving: false,
        held: null,
        actUntil: 0,
        working: false,
        target: null,
        color: kit.team ? TEAM_INFO[kit.team].colorNum : hexNum(SHIRTS[look?.shirt ?? i % SHIRTS.length] ?? '#f2c33a'),
        no: 0,
        served: 0,
        chops: 0,
        grilled: 0,
        rescues: 0,
      });
    });
    // Startplätze: über den Boden verteilt
    for (let k = 0; k < this.kitchens.length; k++) {
      const kit = this.kitchens[k];
      const ps = [...this.players.values()].filter((p) => p.k === k);
      const floor: { c: number; r: number }[] = [];
      for (let r = 2; r < geoRows(kit) - 2; r += 2) for (let c = 2; c < geoCols(kit) - 1; c += 2) if (isFloorCh(tileCh(kit, c, r))) floor.push({ c, r });
      const step = Math.max(1, Math.floor(floor.length / Math.max(1, ps.length)));
      ps.forEach((p, i) => {
        const t = floor[(i * step + Math.floor(step / 2)) % floor.length];
        const pos = tileCenter(kit, t.c, t.r);
        p.x = pos.x;
        p.y = pos.y;
      });
    }
    this.timers.later(G.COUNTDOWN_MS, () => this.start());
  }

  private makeKitchen(layout: GrillLayoutId, mirror: boolean, x0: number, team: Team | null): Kitchen {
    const grid = grillGrid(layout, mirror);
    const kit: Kitchen = { x0, y0: G.KY, grid, team, layout, mirror, slots: new Map(), orders: [], nextOrderAt: 0, score: 0, served: 0, expired: 0, size: 0 };
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const ch = grid[r][c];
        if (isFloorCh(ch)) continue;
        kit.slots.set(`${c},${r}`, { c, r, ch, item: ch === 'F' ? newExt() : null, fire: false, ext: 0, by: null });
      }
    }
    return kit;
  }

  private start() {
    this.sub = 'play';
    const now = Date.now();
    this.startedAt = now;
    this.deadline = now + G.TIME_MS;
    for (const k of this.kitchens) {
      this.addOrder(k, now);
      k.nextOrderAt = now + 6000;
    }
    let last = now;
    this.timers.every(TICK_MS, () => {
      const t = Date.now();
      this.tick(t, Math.min(0.2, (t - last) / 1000));
      last = t;
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Bestellungen

  private maxOrders(k: Kitchen) {
    return this.teams ? 3 : Math.min(6, 1 + Math.max(2, k.size));
  }

  private addOrder(k: Kitchen, now: number) {
    const easyPhase = now - this.startedAt < G.EASY_MS;
    let pool = GRILL_RECIPE_IDS.filter((r) => !easyPhase || GRILL_RECIPES[r].easy);
    // nicht dreimal dasselbe hintereinander
    const lastTwo = k.orders.slice(-2).map((o) => o.r);
    if (lastTwo.length === 2 && lastTwo[0] === lastTwo[1]) pool = pool.filter((r) => r !== lastTwo[0]);
    const r: GrillRecipeId = pool[Math.floor(Math.random() * pool.length)];
    // kleine Gruppen bekommen etwas mehr Zeit
    const slack = k.size <= 2 ? 1.25 : k.size <= 3 ? 1.1 : 1;
    const dur = Math.round(GRILL_RECIPES[r].ms * slack);
    k.orders.push({ id: ++this.orderSeq, r, left: dur, dur });
  }

  private orderEvery(k: Kitchen) {
    return G.ORDER_EVERY_MS / (0.65 + 0.14 * Math.max(2, k.size));
  }

  // ---------------------------------------------------------------- Tick

  private tick(now: number, dt: number) {
    for (const p of this.players.values()) this.moveAndAct(p, now, dt);
    this.separate();

    for (let ki = 0; ki < this.kitchens.length; ki++) {
      const k = this.kitchens[ki];
      // Grills
      for (const s of k.slots.values()) {
        if (s.ch !== 'G' || !s.item || s.fire) continue;
        const it = s.item;
        if (it.p.every((p) => nextStep(p) === 'grill')) {
          it.g += (dt * 1000) / G.COOK_MS;
          if (it.g >= 1) {
            for (const p of it.p) p.s = 'grill';
            it.g = 0;
            it.u = 0;
            const by = s.by ? this.players.get(s.by) : null;
            if (by) by.grilled += it.p.length;
          }
        } else if (it.p.every((p) => p.s === 'grill')) {
          it.u += (dt * 1000) / G.BURN_MS;
          if (it.u >= 1) {
            for (const p of it.p) p.s = 'burnt';
            it.u = 1;
            s.fire = true;
            s.ext = 0;
            this.event(ki, 'fire', s);
          }
        }
      }
      // Bestellungen laufen ab
      for (const o of k.orders) o.left -= dt * 1000;
      const gone = k.orders.filter((o) => o.left <= 0);
      if (gone.length) {
        k.orders = k.orders.filter((o) => o.left > 0);
        for (const o of gone) {
          k.score = Math.max(0, k.score - G.EXPIRE_PENALTY);
          k.expired++;
          this.events.push({ seq: ++this.seq, k: ki, kind: 'expire', x: 0, y: 0, r: o.r, pts: -G.EXPIRE_PENALTY, at: now });
        }
      }
      // Neue Bestellungen
      if (k.orders.length < this.maxOrders(k) && (now >= k.nextOrderAt || k.orders.length < 2)) {
        this.addOrder(k, now);
        k.nextOrderAt = now + this.orderEvery(k) * (0.8 + Math.random() * 0.4);
      }
    }
    this.events = this.events.filter((e) => now - e.at < 3000);

    if (now >= this.deadline) this.end();
    else this.ctx.onChange();
  }

  private moveAndAct(p: P, now: number, dt: number) {
    const k = this.kitchens[p.k];
    const len = Math.hypot(p.sx, p.sy);
    p.moving = len > 0.15;
    if (len > 0.15) {
      p.fx = p.sx / len;
      p.fy = p.sy / len;
    }
    if (len > 0.3) {
      const speed = G.SPEED * Math.min(1, len);
      p.x += p.fx * speed * dt;
      p.y += p.fy * speed * dt;
    } else p.moving = false;
    this.collide(p, k);
    p.target = this.targetOf(p, k);

    // AKTION halten: schneiden bzw. löschen
    p.working = false;
    if (now > p.actUntil || this.sub !== 'play') return;
    const t = p.target;
    if (!t) return;
    if (t.ch === 'K' && t.item && canChop(t.item) && !p.held?.x) {
      p.working = true;
      t.item.g += (dt * 1000) / G.CHOP_MS;
      if (t.item.g >= 1) {
        t.item.p[0].s = 'chop';
        t.item.g = 0;
        p.chops++;
      }
    } else if (t.fire && p.held?.x) {
      p.working = true;
      t.ext += (dt * 1000) / G.EXT_MS;
      if (t.ext >= 1) {
        t.fire = false;
        t.ext = 0;
        p.rescues++;
        this.event(p.k, 'out', t);
      }
    }
  }

  /** Spieler aus Theken schieben und in der Küche halten */
  private collide(p: P, k: Kitchen) {
    const R = G.PLAYER_R;
    const T = G.TILE;
    for (let pass = 0; pass < 2; pass++) {
      const { c: pc, r: pr } = tileOfPos(k, p.x, p.y);
      for (let r = pr - 1; r <= pr + 1; r++) {
        for (let c = pc - 1; c <= pc + 1; c++) {
          if (isFloorCh(tileCh(k, c, r))) continue;
          const x0 = k.x0 + c * T;
          const y0 = k.y0 + r * T;
          const cx = clamp(p.x, x0, x0 + T);
          const cy = clamp(p.y, y0, y0 + T);
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy);
          if (d >= R) continue;
          if (d > 0.001) {
            p.x = cx + (dx / d) * R;
            p.y = cy + (dy / d) * R;
          } else {
            const opts = [
              { x: x0 - R, y: p.y, cost: p.x - x0 },
              { x: x0 + T + R, y: p.y, cost: x0 + T - p.x },
              { x: p.x, y: y0 - R, cost: p.y - y0 },
              { x: p.x, y: y0 + T + R, cost: y0 + T - p.y },
            ].sort((a, b) => a.cost - b.cost)[0];
            p.x = opts.x;
            p.y = opts.y;
          }
        }
      }
    }
    p.x = clamp(p.x, k.x0 + T + R, k.x0 + (geoCols(k) - 1) * T - R);
    p.y = clamp(p.y, k.y0 + T + R, k.y0 + (geoRows(k) - 1) * T - R);
  }

  /** Spieler drängeln sich leicht auseinander */
  private separate() {
    const ps = [...this.players.values()];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        if (a.k !== b.k) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = G.PLAYER_R * 2 - 1;
        if (d >= min) continue;
        const push = (min - d) / 2;
        const ux = d > 0.01 ? dx / d : Math.random() - 0.5;
        const uy = d > 0.01 ? dy / d : Math.random() - 0.5;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        this.collide(a, this.kitchens[a.k]);
        this.collide(b, this.kitchens[b.k]);
      }
    }
  }

  /** Station in Blickrichtung (bzw. die nächste in Reichweite) */
  private targetOf(p: P, k: Kitchen): Slot | null {
    const T = G.TILE;
    const hx = p.x + p.fx * 10;
    const hy = p.y + p.fy * 10;
    const { c: pc, r: pr } = tileOfPos(k, p.x, p.y);
    let best: Slot | null = null;
    let bestD = Infinity;
    for (let r = pr - 1; r <= pr + 1; r++) {
      for (let c = pc - 1; c <= pc + 1; c++) {
        const s = k.slots.get(`${c},${r}`);
        if (!s) continue;
        const x0 = k.x0 + c * T;
        const y0 = k.y0 + r * T;
        const dp = Math.hypot(p.x - clamp(p.x, x0, x0 + T), p.y - clamp(p.y, y0, y0 + T));
        if (dp > G.REACH) continue;
        const dh = Math.hypot(hx - clamp(hx, x0, x0 + T), hy - clamp(hy, y0, y0 + T));
        // Diagonale Kacheln nur, wenn wirklich nichts Gerades da ist
        const diag = c !== pc && r !== pr ? 6 : 0;
        const score = dh + diag;
        if (score < bestD) {
          bestD = score;
          best = s;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    if (action === 'stick') {
      let x = clamp(Number(pl.x) || 0, -1, 1);
      let y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      p.sx = x;
      p.sy = y;
    } else if (action === 'act') {
      p.actUntil = pl.down ? Date.now() + G.ACT_LATCH_MS : 0;
    } else if (action === 'grab') {
      if (this.sub !== 'play') return;
      const k = this.kitchens[p.k];
      p.target = this.targetOf(p, k);
      if (!this.grab(p, k)) p.no++;
      this.ctx.onChange();
    }
  }

  /** NEHMEN / ABLEGEN / KOMBINIEREN – true, wenn etwas passiert ist */
  private grab(p: P, k: Kitchen): boolean {
    const s = p.target;
    if (!s) return false;
    const kind = stationOf(s.ch);
    const H = p.held;
    const ki = this.kitchens.indexOf(k);

    if (!H) {
      if (kind === 'crate') return !!(p.held = newIng(GRILL_CRATES[s.ch]));
      if (kind === 'plates') return !!(p.held = newBase('plate'));
      if (kind === 'glasses') return !!(p.held = newBase('glass'));
      if (kind === 'serve' || kind === 'trash') return false;
      if (!s.item || s.fire) return false;
      p.held = s.item;
      s.item = null;
      return true;
    }

    switch (kind) {
      case 'trash':
        if (H.x) return false;
        this.event(ki, 'trash', s);
        if (H.b) H.p = [];
        else p.held = null;
        return true;
      case 'serve': {
        const r = matchRecipe(H);
        if (!r) return false;
        const cand = k.orders.filter((o) => o.r === r).sort((a, b) => a.left - b.left)[0];
        if (!cand) return false;
        k.orders = k.orders.filter((o) => o !== cand);
        const tip = Math.round(G.TIP_MAX * clamp(cand.left / cand.dur, 0, 1));
        const pts = GRILL_RECIPES[r].points + tip;
        k.score += pts;
        k.served++;
        p.served++;
        p.held = null;
        const c = tileCenter(k, s.c, s.r);
        this.events.push({ seq: ++this.seq, k: ki, kind: 'serve', x: Math.round(c.x), y: Math.round(c.y), pts, tip, r, at: Date.now() });
        // gleich die nächste Bestellung, damit niemand Däumchen dreht
        if (!k.orders.length) k.nextOrderAt = Date.now();
        return true;
      }
      case 'crate':
      case 'plates':
      case 'glasses': {
        const other = kind === 'crate' ? newIng(GRILL_CRATES[s.ch]) : newBase(kind === 'plates' ? 'plate' : 'glass');
        const m = mergeItems(H, other);
        if (!m) return false;
        p.held = m;
        return true;
      }
      default: {
        if (s.fire) return false;
        if (!s.item) {
          if (s.ch === 'G' && !canGrill(H)) return false;
          if (H.x && s.ch !== '#' && s.ch !== 'F') return false;
          s.item = H;
          p.held = null;
          if (s.ch === 'G') s.by = p.id;
          return true;
        }
        const m = mergeItems(H, s.item);
        if (!m) return false;
        if (H.b) {
          p.held = m;
          s.item = null;
        } else if (s.item.b) {
          s.item = m;
          p.held = null;
        } else {
          if (s.ch === 'G' && !canGrill(m)) return false;
          s.item = m;
          p.held = null;
          if (s.ch === 'G') s.by = p.id;
        }
        return true;
      }
    }
  }

  private event(k: number, kind: GrillEvent['kind'], s: Slot) {
    const kit = this.kitchens[k];
    const c = tileCenter(kit, s.c, s.r);
    this.events.push({ seq: ++this.seq, k, kind, x: Math.round(c.x), y: Math.round(c.y), at: Date.now() });
  }

  // ---------------------------------------------------------------- Ende

  private contrib(p: P) {
    return p.served * 10 + p.grilled * 3 + p.chops * 2 + p.rescues * 8;
  }

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.timers.clear();
    for (const p of this.players.values()) {
      p.sx = p.sy = 0;
      p.actUntil = 0;
      p.moving = p.working = false;
    }
    const ps = [...this.players.values()];
    const details = Object.fromEntries(ps.map((p) => [p.id, `${p.served}× serviert · ${p.chops}× geschnippelt`]));
    let result: Parameters<MiniCtx['finish']>[0];
    if (!this.teams) {
      const k = this.kitchens[0];
      this.stars = this.goals.filter((g) => k.score >= g).length;
      const groups = groupByScore(this.ids, (id) => this.contrib(this.players.get(id)!));
      const starTxt = this.stars === 0 ? 'Leider kein Stern' : this.stars === 1 ? '1 Stern' : `${this.stars} Sterne`;
      result = {
        groups,
        details,
        subtitle: `${k.score} Punkte, ${k.served} Gerichte – ${starTxt}!`,
        coins: groups.map((_, i) => Math.max(1, 3 + this.stars * 2 - i * 2)),
      };
    } else {
      const [A, B] = this.kitchens;
      const val = (k: Kitchen) => k.score * 1000 + k.served;
      this.winner = val(A) === val(B) ? null : val(A) > val(B) ? 'A' : 'B';
      const win = this.winner;
      const teamOf = (id: string) => this.kitchens[this.players.get(id)!.k].team;
      const score = { A: A.score, B: B.score };
      result = {
        groups: win ? groupByScore(this.ids, (id) => (teamOf(id) === win ? 1 : 0)) : [this.ids],
        details,
        subtitle: win
          ? `${TEAM_INFO[win].name} gewinnt ${score[win]}:${score[win === 'A' ? 'B' : 'A']}${A.score === B.score ? ' (mehr Gerichte)' : ''}!`
          : `Unentschieden – ${A.score}:${B.score}!`,
        coins: win ? [10, 3] : [6],
      };
    }
    this.ctx.onChange();
    this.timers.later(3500, () => this.ctx.finish(result));
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, GrillPlayer> = {};
    for (const p of this.players.values()) {
      players[p.id] = {
        x: r1(p.x),
        y: r1(p.y),
        k: p.k,
        fx: r2(p.fx),
        fy: r2(p.fy),
        m: p.moving,
        h: clone(p.held),
        w: p.working,
        tc: p.target?.c ?? -1,
        tr: p.target?.r ?? -1,
        c: p.color,
        no: p.no,
        sv: p.served,
        ch: p.chops,
        gr: p.grilled,
        rs: p.rescues,
      };
    }
    const kitchens: GrillKitchen[] = this.kitchens.map((k) => {
      const slots: GrillSlot[] = [];
      for (const s of k.slots.values()) {
        if (!s.item && !s.fire) continue;
        const slot: GrillSlot = { c: s.c, r: s.r, i: clone(s.item) };
        if (s.fire) {
          slot.f = 1;
          slot.e = r2(s.ext);
        }
        slots.push(slot);
      }
      return {
        team: k.team,
        layout: k.layout,
        mirror: k.mirror,
        x0: k.x0,
        y0: k.y0,
        orders: k.orders.map((o) => ({ ...o, left: Math.max(0, Math.round(o.left)) })),
        score: k.score,
        served: k.served,
        expired: k.expired,
        slots,
      };
    });
    return {
      kind: 'grill',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        teams: this.teams,
        kitchens,
        players,
        goals: this.goals,
        stars: this.stars,
        winner: this.winner,
        events: this.events.map(({ at: _at, ...e }) => e),
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) {
      p.sx = p.sy = 0;
      p.actUntil = 0;
    }
  }

  dispose() {
    this.timers.clear();
  }
}
