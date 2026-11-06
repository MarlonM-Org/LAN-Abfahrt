import type { MiniSnapshot, Point, Team } from '../shared/types';
import { TEAM_INFO } from '../shared/flunky';
import { teamHandicap } from '../shared/games';
import {
  WASSER as W,
  WASSER_BASE,
  WASSER_BLOCKERS,
  WASSER_HOSE,
  WASSER_PISTOL_SPOTS,
  type WasserBalloon,
  type WasserPlayer,
  type WasserSplash,
  type WasserState,
  coverBetween,
  flightMs,
  throwLanding,
  throwTarget,
} from '../shared/wasser';
import { playerColor } from '../shared/players';
import { type MiniCtx, type MiniGame, OFFLINE_OUT_MS, Timers, asRecord, groupByScore, splitTeams } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

interface P {
  id: string;
  x: number;
  y: number;
  team: Team | null;
  color: number;
  wet: number;
  ammo: number;
  status: WasserPlayer['s'];
  dir: 1 | -1;
  moving: boolean;
  sx: number;
  sy: number;
  ax: number;
  ay: number;
  pistolUntil: number;
  /** wann klatschnass geworden (für das automatische Hintragen zum Handtuch) */
  soakedAt: number;
  dryStart: number;
  /** Verbindung weg (nach der Gnadenfrist des Raums): eingefroren + unverwundbar */
  away: boolean;
  shieldUntil: number;
  lastHitAt: number;
  lastHitBy: string | null;
  lastThrow: number;
  refillAt: number;
  /** Dauer der laufenden Nachfüll-Bombe (Eimer bzw. Schlauch) – für den Fortschritt im Snapshot */
  refillMs: number;
  refillHose: boolean;
  hits: number;
  soaked: number;
  soaks: number;
  /** Wasserpistole: wann zuletzt ein Treffer gezählt wurde (pro Opfer) */
  streamHit: Map<string, number>;
}

interface Balloon {
  id: number;
  owner: string;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  start: number;
  dur: number;
  color: number;
}

/**
 * Wasserbomben-Schlacht im Garten vom Ferienhaus: Zwei Teams (bei 3 Spielern Jeder gegen jeden)
 * werfen Wasserbomben per Zwei-Stick-Steuerung. Wer klatschnass ist, muss zum Handtuch – wer es nach
 * SOAKED_AUTO_MS nicht selbst schafft, wird hingetragen. Klatschnass ist also nie ein Dauer-Aus.
 * Endet nach Ablauf der Zeit – oder sofort, wenn eine Seite gar nicht mehr mitspielen kann
 * (alle ihre Handys seit OFFLINE_OUT_MS weg bzw. vom VIP entfernt).
 * Aufwärmrunde (`ctx.practice`): kein Zeitlimit, kein vorzeitiges Ende, Klatschnass zählt nicht fürs Team –
 * die Wasserpistole kommt früher und öfter, damit man alles einmal ausprobieren kann.
 */
export class WasserGame implements MiniGame {
  readonly kind = 'wasser' as const;
  private players = new Map<string, P>();
  private balloons: Balloon[] = [];
  private splashes: (WasserSplash & { at: number })[] = [];
  private pistol: Point | null = null;
  private nextPistol = 0;
  private score: Record<Team, number> = { A: 0, B: 0 };
  private lastSoak: WasserState['lastSoak'] = null;
  private seq = 0;
  private sub: WasserState['sub'] = 'countdown';
  private endReason: WasserState['endReason'] = null;
  private deadline = Date.now() + W.COUNTDOWN_MS;
  private timers = new Timers();
  private readonly ffa: boolean;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    // Vom Spielbrett vorgegebene Teams (2 gegen 2, 1 gegen 3), sonst die der Aufwärmrunde bzw. zufällig geteilt;
    // bei 3 Spielern Jeder gegen jeden
    this.ffa = ids.length === 3 && !ctx.teams;
    const split = splitTeams(ids, ctx.teams ?? ctx.warmTeams);
    const order = [...split.A, ...split.B];
    const teamOf = new Map<string, Team>([...split.A.map((id) => [id, 'A'] as const), ...split.B.map((id) => [id, 'B'] as const)]);
    // Handicap bei ungleichen Brett-Teams: das kleinere startet mit Vorsprung
    if (ctx.teams && !this.ffa) this.score = teamHandicap(split.A.length, split.B.length);
    const perTeam: Record<Team, number> = { A: 0, B: 0 };
    order.forEach((id, i) => {
      const team: Team = teamOf.get(id) ?? 'A';
      const k = perTeam[team]++;
      const base = WASSER_BASE[team];
      const rows = Math.max(split.A.length, split.B.length);
      const y = W.AREA.y + 60 + ((k + 0.5) * (W.AREA.h - 90)) / rows;
      this.players.set(id, {
        id,
        x: team === 'A' ? base.towel.x + 30 + (k % 2) * 14 : base.towel.x - 30 - (k % 2) * 14,
        y,
        team: this.ffa ? null : team,
        color: this.ffa ? playerColor(this.ctx.colorOf?.(id) ?? i).num : TEAM_INFO[team].colorNum,
        wet: 0,
        ammo: W.MAX_AMMO,
        status: 'ok',
        dir: team === 'A' ? 1 : -1,
        moving: false,
        sx: 0,
        sy: 0,
        ax: 0,
        ay: 0,
        pistolUntil: 0,
        soakedAt: 0,
        dryStart: 0,
        away: false,
        shieldUntil: 0,
        lastHitAt: 0,
        lastHitBy: null,
        lastThrow: 0,
        refillAt: 0,
        refillMs: 0,
        refillHose: false,
        hits: 0,
        soaked: 0,
        soaks: 0,
        streamHit: new Map(),
      });
    });
    // Bei 3 Spielern: der Dritte startet in der Mitte unten
    if (this.ffa) {
      const third = this.players.get(order[2]);
      if (third) {
        third.x = 240;
        third.y = W.AREA.y + W.AREA.h - 14;
      }
    }
    this.timers.later(W.COUNTDOWN_MS, () => this.start());
  }

  private start() {
    this.sub = 'play';
    const now = Date.now();
    // Aufwärmrunde: kein Zeitlimit (endsIn 0)
    this.deadline = this.ctx.practice ? Infinity : now + W.TIME_MS;
    this.nextPistol = now + (this.ctx.practice ? W.PRACTICE_PISTOL_FIRST_MS : W.PISTOL_FIRST_MS);
    let last = now;
    this.timers.every(TICK_MS, () => {
      const t = Date.now();
      this.tick(t, Math.min(0.2, (t - last) / 1000));
      last = t;
    });
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Regeln

  private enemies(a: P, b: P) {
    return a.id !== b.id && (this.ffa || a.team !== b.team);
  }

  /** Eigene Handtücher/Eimer (Jeder gegen jeden: alle) */
  private bases(p: P) {
    return p.team ? [WASSER_BASE[p.team]] : [WASSER_BASE.A, WASSER_BASE.B];
  }

  private tick(now: number, dt: number) {
    const A = W.AREA;
    for (const p of this.players.values()) {
      // Verbindung weg (nach der 3-s-Gnadenfrist): eingefroren und unverwundbar, bis das Handy zurück ist
      p.away = !this.ctx.isConnected(p.id);
      if (p.away) p.sx = p.sy = p.ax = p.ay = 0;
      // Bewegung
      const canMove = p.status !== 'drying';
      const len = Math.hypot(p.sx, p.sy);
      p.moving = canMove && len > 0.15;
      if (p.moving) {
        const speed = (p.status === 'soaked' ? W.SOAKED_SPEED : W.SPEED) * Math.min(1, len);
        p.x += (p.sx / Math.max(1e-6, len)) * speed * dt;
        p.y += (p.sy / Math.max(1e-6, len)) * speed * dt;
        if (Math.abs(p.sx) > 0.2) p.dir = p.sx > 0 ? 1 : -1;
      }
      this.collide(p);
      p.x = clamp(p.x, A.x + W.PLAYER_R, A.x + A.w - W.PLAYER_R);
      p.y = clamp(p.y, A.y + W.PLAYER_R, A.y + A.h - W.PLAYER_R);

      if (p.status === 'ok') {
        // Sonne trocknet langsam
        if (now - p.lastHitAt > W.DRY_DELAY_MS) p.wet = Math.max(0, p.wet - W.DRY_PER_S * dt);
        // Nachfüllen
        if (p.ammo < W.MAX_AMMO) {
          const atHose = Math.hypot(p.x - WASSER_HOSE.x, p.y - WASSER_HOSE.y) < W.HOSE_R;
          const atBucket = this.bases(p).some((b) => Math.hypot(p.x - b.bucket.x, p.y - b.bucket.y) < W.REFILL_R);
          if (atHose || atBucket) {
            const ms = atHose ? W.HOSE_REFILL_MS : W.BUCKET_REFILL_MS;
            p.refillHose = atHose;
            if (!p.refillAt) {
              p.refillAt = now + ms;
              p.refillMs = ms;
            } else if (now >= p.refillAt) {
              p.ammo++;
              p.refillAt = p.ammo < W.MAX_AMMO ? now + ms : 0;
              p.refillMs = ms;
            }
          } else p.refillAt = 0;
        } else p.refillAt = 0;
        // Wasserpistole aufheben
        if (this.pistol && Math.hypot(p.x - this.pistol.x, p.y - this.pistol.y) < 10) {
          p.pistolUntil = now + W.PISTOL_MS;
          this.pistol = null;
          this.nextPistol = now + (this.ctx.practice ? W.PRACTICE_PISTOL_EVERY_MS : W.PISTOL_EVERY_MS);
        }
        if (p.pistolUntil > now) this.spray(p, now, dt);
      } else if (p.status === 'soaked') {
        const atTowel = this.bases(p).some((b) => Math.hypot(p.x - b.towel.x, p.y - b.towel.y) < W.TOWEL_R);
        if (atTowel) this.startDrying(p, now);
        else if (now - p.soakedAt >= W.SOAKED_AUTO_MS) {
          // Nicht selbst hingeschafft (oder Weg versperrt): ab aufs nächste eigene Handtuch – niemand wartet ewig
          const towel = this.bases(p)
            .map((b) => b.towel)
            .reduce((a, b) => (Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y) ? a : b));
          p.x = towel.x;
          p.y = towel.y;
          this.startDrying(p, now);
        }
      } else if (p.status === 'drying' && now - p.dryStart >= W.TOWEL_DRY_MS) {
        p.status = 'ok';
        p.wet = 0;
        p.ammo = W.MAX_AMMO;
        p.shieldUntil = now + W.SPAWN_SHIELD_MS;
        p.lastHitBy = null;
      }
    }

    // Wasserbomben landen
    const landed = this.balloons.filter((b) => now - b.start >= b.dur);
    if (landed.length) {
      this.balloons = this.balloons.filter((b) => now - b.start < b.dur);
      for (const b of landed) this.land(b, now);
    }
    this.splashes = this.splashes.filter((s) => now - s.at < W.SPLASH_KEEP_MS);

    // Wasserpistole erscheint ab und zu in der Mitte
    if (!this.pistol && now >= this.nextPistol && ![...this.players.values()].some((p) => p.pistolUntil > now)) {
      const spots = WASSER_PISTOL_SPOTS.filter((s) => ![...this.players.values()].some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 20));
      if (spots.length) this.pistol = { ...spots[Math.floor(Math.random() * spots.length)] };
      else this.nextPistol = now + 1000;
    }

    if (now >= this.deadline) this.end('time');
    else if (!this.ctx.practice && this.oneSideLeft()) this.end('away');
    else this.ctx.onChange();
  }

  private startDrying(p: P, now: number) {
    p.status = 'drying';
    p.dryStart = now;
    p.sx = p.sy = 0;
  }

  /** Kann gar nicht mehr mitspielen: vom VIP entfernt oder Handy länger als OFFLINE_OUT_MS weg */
  private out(id: string) {
    return !!this.ctx.isGone?.(id) || (this.ctx.offlineMs?.(id) ?? 0) >= OFFLINE_OUT_MS;
  }

  /**
   * Seiten = Teams bzw. bei Jeder-gegen-jeden die einzelnen Spieler. Kann nur noch eine Seite (oder keine)
   * mitspielen, ist das Spiel sofort vorbei – statt bis zum Ablauf der Zeit zu warten.
   * Eine Seite, die von Anfang an leer war (Solo-Test), zählt nicht.
   */
  private sides(): string[][] {
    const ps = [...this.players.values()];
    if (this.ffa) return ps.map((p) => [p.id]);
    return (['A', 'B'] as Team[]).map((t) => ps.filter((p) => p.team === t).map((p) => p.id)).filter((ids) => ids.length);
  }

  private oneSideLeft() {
    const sides = this.sides();
    return sides.length >= 2 && sides.filter((ids) => ids.some((id) => !this.out(id))).length <= 1;
  }

  /** Spieler aus Hecken, Liegen und Pool herausschieben */
  private collide(p: P) {
    const R = W.PLAYER_R;
    for (const r of WASSER_BLOCKERS) {
      const cx = clamp(p.x, r.x, r.x + r.w);
      const cy = clamp(p.y, r.y, r.y + r.h);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      if (d > 0.001) {
        p.x = cx + (dx / d) * R;
        p.y = cy + (dy / d) * R;
      } else {
        // Mittelpunkt im Rechteck → zur nächsten Kante
        const opts = [
          { x: r.x - R, y: p.y, c: p.x - r.x },
          { x: r.x + r.w + R, y: p.y, c: r.x + r.w - p.x },
          { x: p.x, y: r.y - R, c: p.y - r.y },
          { x: p.x, y: r.y + r.h + R, c: r.y + r.h - p.y },
        ].sort((a, b) => a.c - b.c)[0];
        p.x = opts.x;
        p.y = opts.y;
      }
    }
  }

  private vulnerable(p: P, now: number) {
    return p.status === 'ok' && !p.away && now >= p.shieldUntil;
  }

  private wetten(victim: P, by: P, amount: number, now: number) {
    victim.wet = Math.min(100, victim.wet + amount);
    victim.lastHitAt = now;
    victim.lastHitBy = by.id;
    if (victim.wet >= 100) {
      victim.status = 'soaked';
      victim.soakedAt = now;
      victim.wet = 100;
      victim.ammo = 0;
      victim.pistolUntil = 0;
      victim.ax = victim.ay = 0;
      victim.soaked++;
      by.soaks++;
      if (!this.ffa && by.team && !this.ctx.practice) this.score[by.team]++;
      this.lastSoak = { seq: ++this.seq, victim: victim.id, by: by.id };
    }
  }

  private land(b: Balloon, now: number) {
    const owner = this.players.get(b.owner);
    // Deckung kurz vor dem Ziel fängt die Bombe ab (Hecke/Liege) – gleiche Rechnung wie die Vorschau (shared/wasser.ts)
    const { x, y, cover } = throwLanding(b.fx, b.fy, b.tx, b.ty);
    let big = false;
    if (owner) {
      const targets = [...this.players.values()].filter((p) => this.enemies(owner, p) && this.vulnerable(p, now));
      // Volltreffer: nur der nächste Gegner direkt am Aufschlagpunkt
      let direct: P | null = null;
      if (!cover) {
        let dmin = W.DIRECT_R;
        for (const p of targets) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d <= dmin) {
            dmin = d;
            direct = p;
          }
        }
      }
      let hits = 0;
      if (direct) {
        big = true;
        hits++;
        this.wetten(direct, owner, W.DIRECT_WET, now);
      }
      for (const p of targets) {
        if (p === direct || p.status !== 'ok') continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > W.SPLASH_R) continue;
        if (coverBetween(x, y, p.x, p.y)) continue;
        hits++;
        this.wetten(p, owner, W.SPLASH_WET_MIN + (W.SPLASH_WET_MAX - W.SPLASH_WET_MIN) * (1 - d / W.SPLASH_R), now);
      }
      owner.hits += hits;
    }
    this.splashes.push({ id: b.id, x: Math.round(x), y: Math.round(y), big, cover, c: b.color, at: now });
  }

  /** Wasserpistole: kurzer Strahl in Zielrichtung, solange gezielt wird */
  private spray(p: P, now: number, dt: number) {
    const len = Math.hypot(p.ax, p.ay);
    if (len < 0.2) return;
    const ux = p.ax / len;
    const uy = p.ay / len;
    for (const o of this.players.values()) {
      if (!this.enemies(p, o) || !this.vulnerable(o, now)) continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > W.PISTOL_RANGE || d < 1) continue;
      const cos = (dx * ux + dy * uy) / d;
      if (cos < Math.cos(W.PISTOL_CONE)) continue;
      if (coverBetween(p.x, p.y, o.x, o.y)) continue;
      if (now - (p.streamHit.get(o.id) ?? 0) > 700) {
        p.hits++;
        p.streamHit.set(o.id, now);
      }
      this.wetten(o, p, W.PISTOL_WET_PER_S * dt, now);
    }
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    const pl = asRecord(payload);
    const vec = () => {
      let x = clamp(Number(pl.x) || 0, -1, 1);
      let y = clamp(Number(pl.y) || 0, -1, 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      return { x, y };
    };
    if (action === 'stick') {
      const v = vec();
      p.sx = v.x;
      p.sy = v.y;
    } else if (action === 'aim') {
      const v = vec();
      const ok = p.status === 'ok' && !p.away;
      p.ax = ok ? v.x : 0;
      p.ay = ok ? v.y : 0;
    } else if (action === 'throw') {
      const v = vec();
      p.ax = p.ay = 0;
      this.throwBalloon(p, v.x, v.y);
    }
  }

  private throwBalloon(p: P, vx: number, vy: number) {
    const now = Date.now();
    if (this.sub !== 'play' || p.status !== 'ok' || p.away || p.ammo <= 0 || p.pistolUntil > now) return;
    if (now - p.lastThrow < W.THROW_COOLDOWN_MS || Math.hypot(vx, vy) < W.AIM_MIN) return;
    // Gleiche Kurve wie die TV-Vorschau (shared/wasser.ts): wenig ziehen = kurz, voll ziehen = RANGE
    const { x: tx, y: ty } = throwTarget(p.x, p.y, vx, vy);
    p.ammo--;
    p.lastThrow = now;
    if (Math.abs(vx) > 0.1) p.dir = vx > 0 ? 1 : -1;
    this.balloons.push({ id: ++this.seq, owner: p.id, fx: p.x, fy: p.y - 8, tx, ty, start: now, dur: flightMs(Math.hypot(tx - p.x, ty - p.y)), color: p.color });
  }

  // ---------------------------------------------------------------- Ende

  private end(reason: 'time' | 'away') {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.endReason = reason;
    this.timers.clear();
    this.balloons = [];
    for (const p of this.players.values()) p.sx = p.sy = p.ax = p.ay = 0;
    this.ctx.onChange();
    const ps = [...this.players.values()];
    // Vorzeitiges Ende, weil eine Seite nicht mehr mitspielen kann: die verbliebene Seite gewinnt
    const left = reason === 'away' ? this.sides().filter((ids) => ids.some((id) => !this.out(id))) : [];
    const stay = left.length === 1 ? left[0] : null;
    // Ergebnis-Screen zeigt max. 16 Zeichen
    const detail = (p: P) => `${p.hits} Tr. · ${p.soaked}× nass`;
    const details = Object.fromEntries(ps.map((p) => [p.id, detail(p)]));
    let result: Parameters<MiniCtx['finish']>[0];
    if (this.ffa) {
      const score = (id: string) => {
        const p = this.players.get(id)!;
        return (stay?.includes(id) ? 1e6 : 0) + p.soaks * 1000 + p.hits * 10 - p.soaked;
      };
      const groups = groupByScore(this.ids, score);
      const best = this.players.get(groups[0][0])!;
      result = {
        groups,
        details: Object.fromEntries(ps.map((p) => [p.id, `${p.soaks}× nass gemacht`])),
        subtitle: stay
          ? `Nur noch ${this.ctx.nameOf(best.id)} ist dabei – Sieg!`
          : groups[0].length > 1
            ? 'Unentschieden – alle gleich nass!'
            : `${this.ctx.nameOf(best.id)} ist der Wasserbomben-Profi!`,
      };
    } else {
      // Gleichstand bei Klatschnass → mehr Treffer entscheiden
      const hits: Record<Team, number> = { A: 0, B: 0 };
      for (const p of ps) if (p.team) hits[p.team] += p.hits;
      const val = (t: Team) => this.score[t] * 10000 + hits[t];
      const teamOf = (id: string) => this.players.get(id)!.team!;
      const forfeit: Team | null = stay ? teamOf(stay[0]) : null;
      const win: Team | null = forfeit ?? (val('A') === val('B') ? null : val('A') > val('B') ? 'A' : 'B');
      const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
      // 1 gegen 1: Namen statt Teamnamen
      const label = (t: Team) => {
        const ids = ps.filter((p) => p.team === t);
        return ids.length === 1 ? this.ctx.nameOf(ids[0].id) : TEAM_INFO[t].name;
      };
      result = {
        groups: win ? groupByScore(this.ids, (id) => (teamOf(id) === win ? 1 : 0)) : [this.ids],
        details,
        subtitle: forfeit
          ? `${label(other(forfeit))} ist nicht mehr dabei – ${label(forfeit)} gewinnt!`
          : win
            ? `${TEAM_INFO[win].name} gewinnt ${this.score[win]}:${this.score[other(win)]}${this.score.A === this.score.B ? ' (mehr Treffer)' : ''}!`
            : 'Unentschieden – alle gleich nass!',
        coins: win ? [10, 3] : [6],
      };
    }
    this.timers.later(2500, () => this.ctx.finish(result));
  }

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const players: Record<string, WasserPlayer> = {};
    for (const p of this.players.values()) {
      players[p.id] = {
        x: r1(p.x),
        y: r1(p.y),
        t: p.team,
        c: p.color,
        w: Math.round(p.wet),
        a: p.ammo,
        s: p.status,
        d: p.dir,
        m: p.moving,
        ax: r2(p.ax),
        ay: r2(p.ay),
        pi: Math.max(0, p.pistolUntil - now),
        dp: p.status === 'drying' ? r2(Math.min(1, (now - p.dryStart) / W.TOWEL_DRY_MS)) : 0,
        sk: p.status === 'soaked' && this.sub === 'play' ? Math.max(0, p.soakedAt + W.SOAKED_AUTO_MS - now) : 0,
        ...(p.away ? { away: true } : {}),
        ...(p.status === 'ok' && p.refillAt > now
          ? { rf: r2(clamp(1 - (p.refillAt - now) / Math.max(1, p.refillMs), 0, 1)), ...(p.refillHose ? { rh: true as const } : {}) }
          : {}),
        ...(p.status === 'ok' && p.wet > 0 && this.sub === 'play' && now - p.lastHitAt > W.DRY_DELAY_MS ? { dr: true as const } : {}),
        ...(p.status === 'ok' && now < p.shieldUntil ? { pr: true as const } : {}),
        h: p.hits,
        n: p.soaked,
        k: p.soaks,
      };
    }
    const balloons: WasserBalloon[] = this.balloons.map((b) => ({
      id: b.id,
      fx: Math.round(b.fx),
      fy: Math.round(b.fy),
      tx: Math.round(b.tx),
      ty: Math.round(b.ty),
      age: now - b.start,
      dur: Math.round(b.dur),
      c: b.color,
    }));
    return {
      kind: 'wasser',
      state: {
        sub: this.sub,
        endReason: this.endReason,
        endsIn: Number.isFinite(this.deadline) ? Math.max(0, this.deadline - now) : 0,
        ffa: this.ffa,
        players,
        balloons,
        splashes: this.splashes.map(({ at: _at, ...s }) => s),
        pistol: this.pistol,
        score: this.score,
        lastSoak: this.lastSoak,
      },
    };
  }

  playerDisconnected(id: string) {
    const p = this.players.get(id);
    if (p) p.sx = p.sy = p.ax = p.ay = 0;
  }

  dispose() {
    this.timers.clear();
  }
}
