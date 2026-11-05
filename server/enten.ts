import type { EntenKind, EntenPlayer, EntenShot, EntenState, EntenTarget, MiniSnapshot } from '../shared/types';
import { ENTEN } from '../shared/games';
import { playerColor } from '../shared/players';
import { WORLD } from '../shared/flunky';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;

type Pattern = 'straight' | 'curve' | 'zigzag';

interface Target extends EntenTarget {
  born: number;
  /** Bis wann der Vogel im Feld bleibt, danach fliegt er davon */
  leaveAt: number;
  pattern: Pattern;
  turn: number;
  nextFlip: number;
  /** Grundhöhe + Phase für Wellenflug (Möwe, Flamingo, Badegast) */
  baseY: number;
  phase: number;
  dodgeUntil: number;
  stUntil: number;
  /** Am Wellenende verscheucht → Krabbe lacht nicht */
  quiet: boolean;
  /** Positionen der letzten ~250 ms für die Treffer-Prüfung */
  hist: { t: number; x: number; y: number }[];
}

interface Player extends EntenPlayer {
  lastShot: number;
  lastHit: number;
  reloadAt: number;
}

const BIRDS: EntenKind[] = ['duck', 'gull', 'flamingo'];

/**
 * Ententeich (Duck-Hunt-Hommage): Alle zielen gleichzeitig mit dem Handy auf den TV.
 * Enten, Möwen (klauen Pommes) und Flamingos geben Punkte, Badegäste kosten Punkte.
 * Der Server prüft Treffer anhand der eigenen Zielpositionen (mit kurzem Rückblick gegen Lag).
 */
export class EntenGame implements MiniGame {
  readonly kind = 'enten' as const;
  private players = new Map<string, Player>();
  private targets: Target[] = [];
  private shots: EntenShot[] = [];
  private seq = 0;
  private tseq = 0;
  private laughSeq = 0;
  private sub: EntenState['sub'] = 'intro';
  private wave = 0;
  private deadline = Date.now() + ENTEN.INTRO_MS;
  private nextSpawn = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    ids.forEach((id, i) => {
      this.players.set(id, {
        x: ENTEN.FIELD_W / 2 + ((i % 4) - 1.5) * 20,
        y: 110 + Math.floor(i / 4) * 16,
        ammo: ENTEN.AMMO,
        reloading: false,
        score: 0,
        hits: 0,
        shots: 0,
        combo: 0,
        color: playerColor(ctx.colorOf?.(id) ?? i).num,
        lastShot: 0,
        lastHit: 0,
        reloadAt: 0,
      });
    });
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(0.2, (now - last) / 1000));
      last = now;
    });
  }

  private get waveDef() {
    return ENTEN.WAVES[Math.max(0, this.wave - 1)];
  }

  // ---------------------------------------------------------------- Ablauf

  private tick(now: number, dt: number) {
    if (this.sub === 'over') return;
    if (now >= this.deadline) {
      if (this.sub === 'intro' || (this.sub === 'play' && this.wave < ENTEN.WAVES.length)) {
        if (this.sub === 'play') this.scatter(now);
        this.wave += 1;
        this.sub = 'banner';
        this.deadline = now + ENTEN.BANNER_MS;
      } else if (this.sub === 'banner') {
        this.sub = 'play';
        this.deadline = now + this.waveDef.ms;
        this.nextSpawn = now + 300;
        for (const p of this.players.values()) {
          p.ammo = ENTEN.AMMO;
          p.reloading = false;
        }
        // Badegäste treiben schon auf dem Wasser
        const floats = this.targets.filter((t) => t.kind === 'float').length;
        for (let i = floats; i < this.waveDef.floats; i++) this.spawn('float', now, true);
      } else {
        return this.end();
      }
    }
    for (const p of this.players.values()) {
      if (p.reloading && now >= p.reloadAt) {
        p.reloading = false;
        p.ammo = ENTEN.AMMO;
      }
    }
    if (this.sub === 'play') this.spawner(now);
    this.move(now, dt);
    this.ctx.onChange();
  }

  private spawner(now: number) {
    const w = this.waveDef;
    const extra = Math.floor(this.ids.length / 3);
    const birds = this.targets.filter((t) => t.kind !== 'float' && t.st === 'fly').length;
    if (now >= this.nextSpawn && birds < w.maxBirds + extra) {
      const roll = Math.random();
      const kind: EntenKind = roll < w.weights.duck ? 'duck' : roll < w.weights.duck + w.weights.gull ? 'gull' : 'flamingo';
      this.spawn(kind, now);
      this.nextSpawn = now + w.every * rand(0.7, 1.3) * (this.ids.length > 6 ? 0.8 : 1);
    }
    const floats = this.targets.filter((t) => t.kind === 'float').length;
    if (floats < w.floats && Math.random() < 0.02) this.spawn('float', now);
  }

  private spawn(kind: EntenKind, now: number, onField = false) {
    const W = ENTEN.FIELD_W;
    const sp = this.waveDef.speed;
    const fromLeft = Math.random() < 0.5;
    const dir = fromLeft ? 1 : -1;
    const t: Target = {
      id: ++this.tseq,
      kind,
      look: Math.floor(Math.random() * 3),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      st: 'fly',
      born: now,
      leaveAt: now + this.waveDef.life * rand(0.85, 1.15),
      pattern: 'straight',
      turn: 0,
      nextFlip: now + rand(400, 900),
      baseY: 0,
      phase: Math.random() * Math.PI * 2,
      dodgeUntil: 0,
      stUntil: 0,
      quiet: false,
      hist: [],
    };
    if (kind === 'duck') {
      // Startet aus dem Schilf
      t.x = rand(40, W - 40);
      t.y = ENTEN.REED_Y;
      const speed = rand(62, 82) * sp;
      const ang = -Math.PI / 2 + rand(0.35, 0.85) * (Math.random() < 0.5 ? -1 : 1);
      t.vx = Math.cos(ang) * speed;
      t.vy = Math.sin(ang) * speed;
      const roll = Math.random();
      t.pattern = this.wave === 1 ? (roll < 0.6 ? 'straight' : 'curve') : roll < 0.35 ? 'curve' : roll < 0.7 ? 'zigzag' : 'straight';
      t.turn = rand(0.8, 1.6) * (Math.random() < 0.5 ? -1 : 1);
    } else if (kind === 'gull') {
      t.x = fromLeft ? -14 : W + 14;
      t.baseY = rand(26, 110);
      t.y = t.baseY;
      t.vx = dir * rand(120, 150) * sp;
      t.pattern = this.wave >= 3 && Math.random() < 0.5 ? 'zigzag' : 'straight';
    } else if (kind === 'flamingo') {
      t.x = fromLeft ? -16 : W + 16;
      t.baseY = rand(40, 120);
      t.y = t.baseY;
      t.vx = dir * rand(55, 72) * sp;
    } else {
      t.x = onField ? rand(40, W - 40) : fromLeft ? -20 : W + 20;
      t.baseY = rand(ENTEN.FLOAT_MIN_Y, ENTEN.FLOAT_MAX_Y);
      t.y = t.baseY;
      t.vx = dir * rand(10, 18);
    }
    this.targets.push(t);
  }

  /** Am Wellenende fliegen alle Vögel davon */
  private scatter(now: number) {
    for (const t of this.targets) {
      if (t.kind === 'duck' && t.st === 'fly') {
        t.leaveAt = now;
        t.quiet = true;
      }
    }
  }

  private move(now: number, dt: number) {
    const W = ENTEN.FIELD_W;
    let laughed = false;
    this.targets = this.targets.filter((t) => {
      const age = (now - t.born) / 1000;
      if (t.st === 'down') {
        t.vy += 420 * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        return now < t.stUntil;
      }
      if (t.st === 'hit' && now >= t.stUntil) t.st = 'fly';
      if (t.kind === 'duck') {
        if (t.st === 'fly' && now >= t.leaveAt) {
          t.st = 'escape';
          t.vx *= 0.4;
          t.vy = -150;
        }
        if (t.st === 'fly') {
          if (t.pattern === 'curve') {
            const a = t.turn * dt;
            const c = Math.cos(a);
            const s = Math.sin(a);
            [t.vx, t.vy] = [t.vx * c - t.vy * s, t.vx * s + t.vy * c];
            if (now >= t.nextFlip) {
              t.turn *= -1;
              t.nextFlip = now + rand(900, 1600);
            }
          } else if (t.pattern === 'zigzag' && now >= t.nextFlip) {
            t.vx *= -1;
            t.nextFlip = now + rand(450, 800);
          }
          // Mindesttempo halten
          const sp = Math.hypot(t.vx, t.vy) || 1;
          const want = (now < t.dodgeUntil ? 125 : 72) * this.waveDef.speed;
          t.vx = (t.vx / sp) * (sp + (want - sp) * Math.min(1, dt * 3));
          t.vy = (t.vy / sp) * (sp + (want - sp) * Math.min(1, dt * 3));
          if (t.x < 10) t.vx = Math.abs(t.vx);
          if (t.x > W - 10) t.vx = -Math.abs(t.vx);
          if (t.y < 16) t.vy = Math.abs(t.vy);
          if (t.y > 150 && age > 1.2) t.vy = -Math.abs(t.vy);
        }
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        if (t.st === 'escape' && t.y < -24) {
          if (!t.quiet) laughed = true;
          return false;
        }
      } else if (t.kind === 'gull' || t.kind === 'flamingo') {
        const amp = t.kind === 'gull' ? 10 : 18;
        const freq = t.kind === 'gull' ? 4 : 2.2;
        if (now < t.dodgeUntil) t.baseY = clamp(t.baseY + t.vy * dt, 18, 140);
        else t.vy *= Math.pow(0.1, dt);
        if (t.pattern === 'zigzag' && now >= t.nextFlip) {
          t.baseY = clamp(t.baseY + rand(-40, 40), 22, 130);
          t.nextFlip = now + rand(500, 900);
        }
        const boost = now < t.dodgeUntil ? 1.6 : 1;
        t.x += t.vx * dt * boost;
        t.y += (t.baseY + Math.sin(age * freq + t.phase) * amp - t.y) * Math.min(1, dt * 8);
        if ((t.vx > 0 && t.x > W + 24) || (t.vx < 0 && t.x < -24)) {
          if (t.st === 'fly') laughed = true;
          return false;
        }
      } else {
        // Badegast treibt gemütlich
        t.x += t.vx * dt;
        t.y = t.baseY + Math.sin(age * 2 + t.phase) * 1.5;
        if ((t.vx > 0 && t.x > W + 30) || (t.vx < 0 && t.x < -30)) return false;
      }
      t.hist.push({ t: now, x: t.x, y: t.y });
      while (t.hist.length && now - t.hist[0].t > ENTEN.LAG_MS + 60) t.hist.shift();
      return true;
    });
    if (laughed) this.laughSeq += 1;
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p || this.sub === 'over') return;
    const pl = asRecord(payload);
    const aimX = Number(pl.x);
    const aimY = Number(pl.y);
    const hasAim = Number.isFinite(aimX) && Number.isFinite(aimY);
    if (action === 'aim') {
      if (!hasAim) return;
      p.x = clamp(aimX, 0, ENTEN.FIELD_W);
      p.y = clamp(aimY, 0, WORLD.H);
    } else if (action === 'reload') {
      if (p.reloading || p.ammo >= ENTEN.AMMO) return;
      p.reloading = true;
      p.reloadAt = Date.now() + ENTEN.RELOAD_MS;
    } else if (action === 'shoot') {
      if (hasAim) {
        p.x = clamp(aimX, 0, ENTEN.FIELD_W);
        p.y = clamp(aimY, 0, WORLD.H);
      }
      this.shoot(id, p, Date.now());
    }
  }

  private shoot(id: string, p: Player, now: number) {
    if (this.sub !== 'play' || p.reloading || p.ammo <= 0 || now - p.lastShot < ENTEN.SHOT_COOLDOWN_MS) return;
    p.lastShot = now;
    p.ammo -= 1;
    p.shots += 1;
    const hit = this.hitTest(p.x, p.y, now);
    let pts = 0;
    if (hit) {
      if (hit.kind === 'float') {
        pts = ENTEN.POINTS.float;
        p.combo = 0;
        hit.st = 'hit';
        hit.stUntil = now + 1000;
        this.laughSeq += 1;
      } else {
        p.combo = now - p.lastHit <= ENTEN.COMBO_MS ? p.combo + 1 : 1;
        p.lastHit = now;
        p.hits += 1;
        pts = ENTEN.POINTS[hit.kind] + Math.min(ENTEN.COMBO_MAX_BONUS, (p.combo - 1) * ENTEN.COMBO_BONUS);
        hit.st = 'down';
        hit.vx = hit.vx * 0.15;
        hit.vy = -40;
        hit.stUntil = now + 1100;
      }
      p.score += pts;
    } else {
      p.combo = 0;
      this.dodge(p.x, p.y, now);
    }
    this.shots.push({ seq: ++this.seq, pid: id, x: r1(p.x), y: r1(p.y), kind: hit?.kind ?? null, tid: hit?.id ?? null, pts, combo: p.combo });
    if (this.shots.length > 20) this.shots.shift();
    this.ctx.onChange();
  }

  /** Vögel vor Badegästen; sonst der nächstgelegene. Prüft auch kurz zurückliegende Positionen. */
  private hitTest(x: number, y: number, now: number): Target | null {
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (t.st === 'down' || t.st === 'hit') continue;
      // Enten, die noch im Schilf stecken, sind gedeckt
      if (t.kind === 'duck' && t.y > ENTEN.REED_Y - 22) continue;
      let d = Math.hypot(t.x - x, t.y - y);
      for (const h of t.hist) if (now - h.t <= ENTEN.LAG_MS) d = Math.min(d, Math.hypot(h.x - x, h.y - y));
      if (d > ENTEN.RADIUS[t.kind] + 1.5) continue;
      const score = d + (t.kind === 'float' ? 100 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  /** Fehlschuss in der Nähe: Vögel weichen aus */
  private dodge(x: number, y: number, now: number) {
    for (const t of this.targets) {
      if (!BIRDS.includes(t.kind) || t.st !== 'fly') continue;
      const dx = t.x - x;
      const dy = t.y - y;
      const d = Math.hypot(dx, dy);
      if (d > ENTEN.DODGE_R) continue;
      t.dodgeUntil = now + 650;
      if (t.kind === 'duck') {
        const sp = Math.hypot(t.vx, t.vy) || 70;
        t.vx = (dx / (d || 1)) * sp;
        t.vy = (dy / (d || 1)) * sp;
      } else {
        t.vy = (dy >= 0 ? 1 : -1) * 90;
      }
    }
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now();
    this.scatter(Date.now());
    this.ctx.onChange();
    // Noch kurz weiterlaufen lassen, damit die Vögel davonfliegen
    this.timers.clear();
    let last = Date.now();
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      this.move(now, (now - last) / 1000);
      last = now;
      this.ctx.onChange();
    });
    const acc = (p: Player) => (p.shots ? Math.round((p.hits / p.shots) * 100) : 0);
    const list = [...this.players.entries()];
    const top = [...list].sort((a, b) => b[1].score - a[1].score)[0];
    const sharp = [...list].filter(([, p]) => p.shots >= 5).sort((a, b) => acc(b[1]) - acc(a[1]))[0];
    const subtitle = top
      ? `${this.ctx.nameOf(top[0])} ist Teich-König!${sharp ? ` Beste Quote: ${this.ctx.nameOf(sharp[0])} (${acc(sharp[1])}%)` : ''}`
      : 'Der Teich ist wieder ruhig.';
    this.timers.later(2800, () => {
      this.timers.clear();
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => this.players.get(id)?.score ?? 0),
        details: Object.fromEntries(list.map(([id, p]) => [id, `${p.score} Punkte · ${p.hits} Treffer (${acc(p)}%)`])),
        subtitle,
      });
    });
  }

  snapshot(): MiniSnapshot {
    return {
      kind: 'enten',
      state: {
        sub: this.sub,
        wave: this.wave,
        waves: ENTEN.WAVES.length,
        waveName: this.wave ? this.waveDef.name : '',
        endsIn: Math.max(0, this.deadline - Date.now()),
        targets: this.targets.map(({ id, kind, look, x, y, vx, vy, st }) => ({ id, kind, look, x: r1(x), y: r1(y), vx: Math.round(vx), vy: Math.round(vy), st })),
        players: Object.fromEntries(
          [...this.players.entries()].map(([id, { x, y, ammo, reloading, score, hits, shots, combo, color }]) => [
            id,
            { x: r1(x), y: r1(y), ammo, reloading, score, hits, shots, combo, color },
          ]),
        ),
        shots: this.shots,
        laughSeq: this.laughSeq,
      },
    };
  }

  playerDisconnected() {}

  dispose() {
    this.timers.clear();
  }
}
