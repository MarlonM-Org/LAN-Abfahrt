import { fairRoleScores } from './rolefair';
import type { GeistHunter, GeistPrivate, GeistState, MiniSnapshot, PrivateState } from '../shared/types';
import { GEIST, collide, inCone, roomCenter, roomRect } from '../shared/geist';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const TICK_MS = 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Hunter extends GeistHunter {
  sx: number;
  sy: number;
  reviveMs: number;
}

interface Stats {
  scares: number;
  damage: number;
  revives: number;
  wins: number;
  /** Schon in Punkte umgerechneter Lichtschaden */
  paid: number;
}

/**
 * Geisterjagd – frei nach "Luigi's Ghost Mansion".
 *
 * Stromausfall im Ferienhaus: Einer ist der Geist und auf dem TV unsichtbar – nur sein
 * eigenes Handy zeigt ihm die Karte. Alle anderen jagen ihn mit Taschenlampen.
 * Licht auf dem Geist kostet ihn Lebenspunkte; erwischt der Geist einen Jäger von
 * außerhalb des Lichts, liegt der vor Schreck am Boden, bis ihn jemand rettet.
 * Der Geist wird kurz sichtbar: im Lichtkegel, bei Blitzen und wenn er jemanden erschreckt.
 */
export class GeistGame implements MiniGame {
  readonly kind = 'geist' as const;
  private order: string[];
  private round = 0;
  private rounds: number;
  private sub: GeistState['sub'] = 'intro';
  private deadline = 0;
  private ghostId = '';
  private ghost = { x: 0, y: 0, sx: 0, sy: 0 };
  private health = 100;
  private maxHealth = 100;
  private hunters = new Map<string, Hunter>();
  private revealUntil = 0;
  private revealWhy: 'light' | 'flash' | 'touch' = 'light';
  private lit = false;
  private scareReady = 0;
  private flashSeq = 0;
  private nextFlash = 0;
  private lastScare: GeistState['lastScare'] = null;
  private lastRevive: GeistState['lastRevive'] = null;
  private seq = 0;
  private roundWinner: GeistState['roundWinner'] = null;
  private roundReason: string | null = null;
  private points: Record<string, number>;
  /** Anteil der Punkte aus der Geister-Rolle (für die faire Wertung) */
  private ghostPts: Record<string, number>;
  private huntedRounds: Record<string, number>;
  private ghosts: string[] = [];
  private stats = new Map<string, Stats>();
  private timers = new Timers();
  private tickLast = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.order = shuffle(ids);
    this.rounds = Math.min(ids.length, 3);
    this.points = Object.fromEntries(ids.map((id) => [id, 0]));
    this.ghostPts = Object.fromEntries(ids.map((id) => [id, 0]));
    this.huntedRounds = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const id of ids) this.stats.set(id, { scares: 0, damage: 0, revives: 0, wins: 0, paid: 0 });
    this.timers.every(TICK_MS, () => {
      const now = Date.now();
      const dt = this.tickLast ? Math.min(0.1, (now - this.tickLast) / 1000) : 0;
      this.tickLast = now;
      if (this.sub === 'play') this.tick(now, dt);
    });
    this.startRound();
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.ghostId = this.order[(this.round - 1) % this.order.length];
    const hunterIds = this.ids.filter((id) => id !== this.ghostId);
    for (const id of hunterIds) this.huntedRounds[id] += 1;
    if (!this.ghosts.includes(this.ghostId)) this.ghosts.push(this.ghostId);
    this.maxHealth = GEIST.HEALTH_BASE + GEIST.HEALTH_PER_HUNTER * hunterIds.length;
    this.health = this.maxHealth;
    // Jäger starten im Flur (unten Mitte), der Geist in Küche oder Bad (oben, weit weg)
    this.hunters.clear();
    const start = roomRect(4);
    const n = hunterIds.length;
    const cols = Math.min(4, n);
    hunterIds.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = i % cols;
      this.hunters.set(id, {
        x: start.x + start.w / 2 + (col - (inRow - 1) / 2) * 22,
        y: start.y + start.h - 22 - row * 20,
        angle: -Math.PI / 2,
        moving: false,
        light: false,
        battery: 1,
        empty: false,
        down: false,
        revive: 0,
        sx: 0,
        sy: 0,
        reviveMs: 0,
      });
    });
    const gc = roomCenter(Math.random() < 0.5 ? 0 : 2);
    this.ghost = { x: gc.x, y: gc.y - 20, sx: 0, sy: 0 };
    this.revealUntil = 0;
    this.lit = false;
    this.lastScare = null;
    this.lastRevive = null;
    this.roundWinner = null;
    this.roundReason = null;
    this.sub = 'intro';
    this.setDeadline(GEIST.INTRO_MS);
    this.timers.later(GEIST.INTRO_MS, () => this.startPlay());
    this.ctx.onChange();
  }

  private startPlay() {
    const now = Date.now();
    this.sub = 'play';
    this.setDeadline(GEIST.ROUND_MS);
    this.scareReady = now + 1500;
    this.scheduleFlash(now);
    this.ctx.onChange();
  }

  private scheduleFlash(now: number) {
    this.nextFlash = now + GEIST.FLASH_MIN + Math.random() * (GEIST.FLASH_MAX - GEIST.FLASH_MIN);
  }

  private tick(now: number, dt: number) {
    const ghostConnected = this.ctx.isConnected(this.ghostId);
    // --- Jäger bewegen + Akku
    for (const h of this.hunters.values()) {
      if (h.down) {
        h.moving = false;
        h.light = false;
        continue;
      }
      if (h.empty) {
        h.moving = false;
        h.battery = Math.min(1, h.battery + GEIST.EMPTY_RECHARGE * dt);
        if (h.battery >= GEIST.EMPTY_RESUME) h.empty = false;
        continue;
      }
      const len = Math.hypot(h.sx, h.sy);
      h.moving = len > 0.15;
      if (h.moving) {
        const k = Math.min(1, len) / Math.max(1, len);
        h.x += h.sx * k * GEIST.HUNTER_SPEED * dt;
        h.y += h.sy * k * GEIST.HUNTER_SPEED * dt;
        h.angle = Math.atan2(h.sy, h.sx);
        collide(h);
      }
      if (h.light) {
        h.battery -= GEIST.DRAIN * dt;
        if (h.battery <= 0) {
          h.battery = 0;
          h.light = false;
          h.empty = true;
        }
      } else {
        h.battery = Math.min(1, h.battery + GEIST.RECHARGE * dt);
      }
    }
    // Jäger nicht übereinander stapeln (Abstand, damit man sich noch sieht)
    const list = [...this.hunters.values()].filter((h) => !h.down);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = GEIST.R * 1.6;
        if (d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
          collide(a);
          collide(b);
        }
      }
    }

    // --- Licht auf dem Geist?
    const g = this.ghost;
    const cones = [...this.hunters.entries()].filter(([, h]) => !h.down && h.light && inCone(h.x, h.y, h.angle, g.x, g.y));
    this.lit = cones.length > 0;
    if (this.lit) {
      const total = GEIST.DMG * Math.pow(cones.length, GEIST.STACK) * dt;
      this.health = Math.max(0, this.health - total);
      for (const [id] of cones) this.stats.get(id)!.damage += total / cones.length;
      this.reveal(now, 'light', GEIST.LIGHT_REVEAL_MS);
    }

    // --- Geist bewegen
    if (ghostConnected) {
      const len = Math.hypot(g.sx, g.sy);
      if (len > 0.15) {
        const k = Math.min(1, len) / Math.max(1, len);
        const speed = GEIST.GHOST_SPEED * (this.lit ? GEIST.GHOST_LIT_SLOW : 1);
        g.x += g.sx * k * speed * dt;
        g.y += g.sy * k * speed * dt;
        collide(g);
      }
    }

    // --- Erschrecken (nur von außerhalb des Lichts)
    if (!this.lit && now >= this.scareReady) {
      for (const [id, h] of this.hunters) {
        if (h.down || Math.hypot(h.x - g.x, h.y - g.y) > GEIST.SCARE_DIST) continue;
        h.down = true;
        h.light = false;
        h.revive = 0;
        h.reviveMs = 0;
        this.stats.get(this.ghostId)!.scares += 1;
        this.points[this.ghostId] += 1;
        this.ghostPts[this.ghostId] += 1;
        this.lastScare = { victim: id, seq: ++this.seq };
        this.scareReady = now + GEIST.SCARE_COOLDOWN;
        this.reveal(now, 'touch', GEIST.TOUCH_REVEAL_MS);
        break;
      }
    } else if (this.lit) {
      // Berührung im Licht: nur sichtbar
      for (const h of this.hunters.values()) {
        if (!h.down && Math.hypot(h.x - g.x, h.y - g.y) <= GEIST.SCARE_DIST) this.reveal(now, 'touch', 600);
      }
    }

    // --- Wiederbeleben
    for (const [id, h] of this.hunters) {
      if (!h.down) continue;
      const helpers = [...this.hunters.entries()].filter(([oid, o]) => oid !== id && !o.down && !o.empty && Math.hypot(o.x - h.x, o.y - h.y) <= GEIST.REVIVE_DIST);
      if (helpers.length) h.reviveMs += dt * 1000;
      else h.reviveMs = Math.max(0, h.reviveMs - dt * 500);
      h.revive = clamp(h.reviveMs / GEIST.REVIVE_MS, 0, 1);
      if (h.reviveMs >= GEIST.REVIVE_MS) {
        h.down = false;
        h.revive = 0;
        h.reviveMs = 0;
        h.battery = Math.max(h.battery, 0.4);
        for (const [hid] of helpers) {
          this.stats.get(hid)!.revives += 1;
          this.points[hid] += 1;
        }
        this.lastRevive = { id, seq: ++this.seq };
      }
    }

    // --- Blitz
    if (now >= this.nextFlash) {
      this.flashSeq += 1;
      this.reveal(now, 'flash', GEIST.FLASH_MS);
      this.scheduleFlash(now);
    }

    // --- Rundenende?
    const hunters = [...this.hunters.values()];
    if (this.health <= 0) return this.endRound('hunters', 'Der Geist ist erschöpft – die Jäger gewinnen!');
    if (hunters.length && hunters.every((h) => h.down)) return this.endRound('ghost', 'Alle Jäger liegen vor Schreck am Boden!');
    if (now >= this.deadline) return this.endRound('ghost', 'Zeit um – der Geist hat durchgehalten!');
    this.ctx.onChange();
  }

  private reveal(now: number, why: 'light' | 'flash' | 'touch', ms: number) {
    // Ein Blitz oder Schreck überschreibt kurzes Licht-Nachleuchten, nicht umgekehrt
    if (why !== 'light' || this.revealUntil <= now || this.revealWhy === 'light') this.revealWhy = why;
    this.revealUntil = Math.max(this.revealUntil, now + ms);
  }

  private endRound(winner: 'ghost' | 'hunters', reason: string) {
    if (this.sub !== 'play') return;
    this.sub = 'roundEnd';
    this.roundWinner = winner;
    this.roundReason = reason;
    const hunterIds = [...this.hunters.keys()];
    if (winner === 'ghost') {
      this.points[this.ghostId] += 5;
      this.ghostPts[this.ghostId] += 5;
      this.stats.get(this.ghostId)!.wins += 1;
    } else {
      for (const id of hunterIds) {
        this.points[id] += 3;
        this.stats.get(id)!.wins += 1;
      }
    }
    // Lichtschaden: 1 Punkt pro 15 Schaden (abgerundet)
    for (const id of hunterIds) {
      const st = this.stats.get(id)!;
      const total = Math.floor(st.damage / 15);
      this.points[id] += total - st.paid;
      st.paid = total;
    }
    // Zum Schluss den Geist zeigen
    this.revealWhy = 'touch';
    this.revealUntil = Number.MAX_SAFE_INTEGER;
    for (const h of this.hunters.values()) (h.sx = 0), (h.sy = 0), (h.light = false);
    this.setDeadline(GEIST.END_MS);
    this.ctx.onChange();
    this.timers.later(GEIST.END_MS, () => (this.round >= this.rounds ? this.end() : this.startRound()));
  }

  private end() {
    this.sub = 'over';
    this.setDeadline(0);
    this.ctx.onChange();
    // Mehr Spieler als Runden: Geister-Punkte nur unter Geistern vergleichen (sonst entscheidet das Los)
    const fair = fairRoleScores(this.ids, this.rounds, this.points, this.ghostPts, this.huntedRounds, this.ghosts);
    this.timers.later(3500, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, (id) => fair[id]),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const st = this.stats.get(id)!;
            const parts = [`${Math.round(fair[id])} Pkt`];
            if (st.scares) parts.push(`${st.scares}x Buh`);
            if (st.damage >= 1) parts.push(`${Math.round(st.damage)} Licht`);
            if (st.revives) parts.push(`${st.revives}x gerettet`);
            return [id, parts.join(' · ')];
          }),
        ),
        subtitle: 'Wer hat am besten gespukt – und wer am mutigsten geleuchtet?',
      }),
    );
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const pl = asRecord(payload);
    if (action === 'stick') {
      const x = clamp(Number(pl.x) || 0, -1, 1);
      const y = clamp(Number(pl.y) || 0, -1, 1);
      if (id === this.ghostId) {
        this.ghost.sx = x;
        this.ghost.sy = y;
      } else {
        const h = this.hunters.get(id);
        if (h) (h.sx = x), (h.sy = y);
      }
    } else if (action === 'light') {
      const h = this.hunters.get(id);
      if (!h || h.down || h.empty || this.sub !== 'play') return;
      h.light = typeof pl.on === 'boolean' ? pl.on : !h.light;
      if (h.light && h.battery <= 0.02) h.light = false;
      this.ctx.onChange();
    }
  }

  playerDisconnected(id: string) {
    if (id === this.ghostId) (this.ghost.sx = 0), (this.ghost.sy = 0);
    const h = this.hunters.get(id);
    if (h) (h.sx = 0), (h.sy = 0), (h.light = false);
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const visible = now < this.revealUntil;
    return {
      kind: 'geist',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        rounds: this.rounds,
        ghostId: this.ghostId,
        health: Math.round(this.health),
        maxHealth: this.maxHealth,
        hunters: Object.fromEntries(
          [...this.hunters.entries()].map(([id, { x, y, angle, moving, light, battery, empty, down, revive }]) => [
            id,
            { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, angle: Math.round(angle * 100) / 100, moving, light, battery: Math.round(battery * 100) / 100, empty, down, revive: Math.round(revive * 100) / 100 },
          ]),
        ),
        // Die Position des Geists steht NUR während einer Enthüllung im öffentlichen Zustand
        ghost: visible ? { x: Math.round(this.ghost.x), y: Math.round(this.ghost.y), why: this.revealWhy } : null,
        flashSeq: this.flashSeq,
        lastScare: this.lastScare,
        lastRevive: this.lastRevive,
        roundWinner: this.roundWinner,
        roundReason: this.roundReason,
        points: { ...this.points },
      },
    };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    let state: GeistPrivate;
    if (id === this.ghostId) {
      state = { role: 'ghost', x: Math.round(this.ghost.x), y: Math.round(this.ghost.y), lit: this.lit, cooldown: Math.max(0, this.scareReady - Date.now()) };
    } else {
      const h = this.hunters.get(id);
      let fear = 0;
      if (h && this.sub === 'play') {
        const d = Math.hypot(h.x - this.ghost.x, h.y - this.ghost.y);
        fear = Math.round(clamp(1 - d / GEIST.FEAR_DIST, 0, 1) * 100) / 100;
      }
      state = { role: 'hunter', fear };
    }
    return { kind: 'geist', state };
  }

  private setDeadline(ms: number) {
    this.deadline = Date.now() + ms;
  }
}
