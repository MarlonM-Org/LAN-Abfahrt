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

interface Ghost {
  x: number;
  y: number;
  sx: number;
  sy: number;
  health: number;
  /** Gebannt (Leben 0) – nur bei zwei Geistern, sonst endet die Runde */
  out: boolean;
  revealUntil: number;
  revealWhy: 'light' | 'flash' | 'touch';
  lit: boolean;
  scareReady: number;
}

/** Ab so vielen Spielern spuken zwei Geister gleichzeitig */
const TWO_GHOSTS_FROM = 7;

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
 * Ab 7 Spielern spuken zwei Geister gleichzeitig (jeder mit eigenem Leben); die Jäger
 * gewinnen erst, wenn beide gebannt sind.
 */
export class GeistGame implements MiniGame {
  readonly kind = 'geist' as const;
  private order: string[];
  private round = 0;
  private rounds: number;
  private sub: GeistState['sub'] = 'intro';
  private deadline = 0;
  private ghostCount: number;
  private ghostMap = new Map<string, Ghost>();
  private maxHealth = 100;
  private hunters = new Map<string, Hunter>();
  private flashSeq = 0;
  private nextFlash = 0;
  private lastScare: GeistState['lastScare'] = null;
  private lastRevive: GeistState['lastRevive'] = null;
  private lastBanish: GeistState['lastBanish'] = null;
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
    this.ghostCount = ids.length >= TWO_GHOSTS_FROM ? 2 : 1;
    this.rounds = Math.min(Math.ceil(ids.length / this.ghostCount), 3);
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
    const gids: string[] = [];
    for (let j = 0; j < this.ghostCount; j++) gids.push(this.order[((this.round - 1) * this.ghostCount + j) % this.order.length]);
    const hunterIds = this.ids.filter((id) => !gids.includes(id));
    for (const id of hunterIds) this.huntedRounds[id] += 1;
    for (const id of gids) if (!this.ghosts.includes(id)) this.ghosts.push(id);
    // Zwei Geister teilen sich die Jäger-Wucht: jeder hat ungefähr die Hälfte der Leben
    this.maxHealth = Math.round(GEIST.HEALTH_BASE + (GEIST.HEALTH_PER_HUNTER * hunterIds.length) / gids.length);
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
    // Geister starten in Küche bzw. Bad (oben, weit weg von den Jägern)
    const first = Math.random() < 0.5 ? 0 : 2;
    this.ghostMap.clear();
    gids.forEach((id, j) => {
      const gc = roomCenter(j === 0 ? first : 2 - first);
      this.ghostMap.set(id, { x: gc.x, y: gc.y - 20, sx: 0, sy: 0, health: this.maxHealth, out: false, revealUntil: 0, revealWhy: 'light', lit: false, scareReady: 0 });
    });
    this.lastScare = null;
    this.lastBanish = null;
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
    for (const g of this.ghostMap.values()) g.scareReady = now + 1500;
    this.scheduleFlash(now);
    this.ctx.onChange();
  }

  private scheduleFlash(now: number) {
    this.nextFlash = now + GEIST.FLASH_MIN + Math.random() * (GEIST.FLASH_MAX - GEIST.FLASH_MIN);
  }

  private tick(now: number, dt: number) {
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

    // --- Pro Geist: Licht, Bewegung, Erschrecken
    for (const [gid, g] of this.ghostMap) {
      if (g.out) continue;
      const cones = [...this.hunters.entries()].filter(([, h]) => !h.down && h.light && inCone(h.x, h.y, h.angle, g.x, g.y));
      g.lit = cones.length > 0;
      if (g.lit) {
        const total = Math.min(g.health, GEIST.DMG * Math.pow(cones.length, GEIST.STACK) * dt);
        g.health = Math.max(0, g.health - total);
        for (const [id] of cones) this.stats.get(id)!.damage += total / cones.length;
        this.reveal(g, now, 'light', GEIST.LIGHT_REVEAL_MS);
        if (g.health <= 0 && this.ghostMap.size > 1) {
          // Einer von zwei Geistern gebannt: bleibt sichtbar liegen, die Runde geht weiter
          g.out = true;
          g.lit = false;
          g.sx = 0;
          g.sy = 0;
          g.revealWhy = 'light';
          g.revealUntil = Number.MAX_SAFE_INTEGER;
          this.lastBanish = { id: gid, seq: ++this.seq };
          continue;
        }
      }

      if (this.ctx.isConnected(gid)) {
        const len = Math.hypot(g.sx, g.sy);
        if (len > 0.15) {
          const k = Math.min(1, len) / Math.max(1, len);
          const speed = GEIST.GHOST_SPEED * (g.lit ? GEIST.GHOST_LIT_SLOW : 1);
          g.x += g.sx * k * speed * dt;
          g.y += g.sy * k * speed * dt;
          collide(g);
        }
      }

      // Erschrecken (nur von außerhalb des Lichts)
      if (!g.lit && now >= g.scareReady) {
        for (const [id, h] of this.hunters) {
          if (h.down || Math.hypot(h.x - g.x, h.y - g.y) > GEIST.SCARE_DIST) continue;
          h.down = true;
          h.light = false;
          h.revive = 0;
          h.reviveMs = 0;
          this.stats.get(gid)!.scares += 1;
          this.points[gid] += 1;
          this.ghostPts[gid] += 1;
          this.lastScare = { victim: id, seq: ++this.seq, by: gid };
          g.scareReady = now + GEIST.SCARE_COOLDOWN;
          this.reveal(g, now, 'touch', GEIST.TOUCH_REVEAL_MS);
          break;
        }
      } else if (g.lit) {
        // Berührung im Licht: nur sichtbar
        for (const h of this.hunters.values()) {
          if (!h.down && Math.hypot(h.x - g.x, h.y - g.y) <= GEIST.SCARE_DIST) this.reveal(g, now, 'touch', 600);
        }
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
      for (const g of this.ghostMap.values()) if (!g.out) this.reveal(g, now, 'flash', GEIST.FLASH_MS);
      this.scheduleFlash(now);
    }

    // --- Rundenende?
    const hunters = [...this.hunters.values()];
    if ([...this.ghostMap.values()].every((g) => g.out || g.health <= 0)) {
      return this.endRound('hunters', this.ghostMap.size > 1 ? 'Beide Geister sind gebannt – die Jäger gewinnen!' : 'Der Geist ist erschöpft – die Jäger gewinnen!');
    }
    if (hunters.length && hunters.every((h) => h.down)) return this.endRound('ghost', 'Alle Jäger liegen vor Schreck am Boden!');
    if (now >= this.deadline) return this.endRound('ghost', 'Zeit um – der Geist hat durchgehalten!');
    this.ctx.onChange();
  }

  private reveal(g: Ghost, now: number, why: 'light' | 'flash' | 'touch', ms: number) {
    // Ein Blitz oder Schreck überschreibt kurzes Licht-Nachleuchten, nicht umgekehrt
    if (why !== 'light' || g.revealUntil <= now || g.revealWhy === 'light') g.revealWhy = why;
    g.revealUntil = Math.max(g.revealUntil, now + ms);
  }

  private get ghostIds() {
    return [...this.ghostMap.keys()];
  }

  private endRound(winner: 'ghost' | 'hunters', reason: string) {
    if (this.sub !== 'play') return;
    this.sub = 'roundEnd';
    this.roundWinner = winner;
    this.roundReason = reason;
    const hunterIds = [...this.hunters.keys()];
    if (winner === 'ghost') {
      for (const gid of this.ghostIds) {
        this.points[gid] += 5;
        this.ghostPts[gid] += 5;
        this.stats.get(gid)!.wins += 1;
      }
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
    // Zum Schluss die Geister zeigen
    for (const g of this.ghostMap.values()) {
      g.revealWhy = 'touch';
      g.revealUntil = Number.MAX_SAFE_INTEGER;
      g.sx = 0;
      g.sy = 0;
    }
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
      const g = this.ghostMap.get(id);
      if (g) {
        if (!g.out) (g.sx = x), (g.sy = y);
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
    const g = this.ghostMap.get(id);
    if (g) (g.sx = 0), (g.sy = 0);
    const h = this.hunters.get(id);
    if (h) (h.sx = 0), (h.sy = 0), (h.light = false);
  }

  dispose() {
    this.timers.clear();
  }

  // ---------------------------------------------------------------- Zustand

  snapshot(): MiniSnapshot {
    const now = Date.now();
    const ghosts = [...this.ghostMap.entries()]
      .filter(([, g]) => now < g.revealUntil)
      .map(([id, g]) => ({ id, x: Math.round(g.x), y: Math.round(g.y), why: g.revealWhy }));
    const first = this.ghostIds[0] ?? '';
    const firstSeen = ghosts.find((g) => g.id === first);
    const ghostHp = Object.fromEntries([...this.ghostMap.entries()].map(([id, g]) => [id, Math.round(g.health)]));
    return {
      kind: 'geist',
      state: {
        sub: this.sub,
        endsIn: Math.max(0, this.deadline - now),
        round: this.round,
        rounds: this.rounds,
        ghostId: first,
        ghostIds: this.ghostIds,
        health: Object.values(ghostHp).reduce((a, b) => a + b, 0),
        maxHealth: this.maxHealth * Math.max(1, this.ghostMap.size),
        ghostHp,
        ghostMax: this.maxHealth,
        hunters: Object.fromEntries(
          [...this.hunters.entries()].map(([id, { x, y, angle, moving, light, battery, empty, down, revive }]) => [
            id,
            { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, angle: Math.round(angle * 100) / 100, moving, light, battery: Math.round(battery * 100) / 100, empty, down, revive: Math.round(revive * 100) / 100 },
          ]),
        ),
        // Die Position eines Geists steht NUR während einer Enthüllung im öffentlichen Zustand
        ghost: firstSeen ? { x: firstSeen.x, y: firstSeen.y, why: firstSeen.why } : null,
        ghosts,
        flashSeq: this.flashSeq,
        lastScare: this.lastScare,
        lastRevive: this.lastRevive,
        lastBanish: this.lastBanish,
        roundWinner: this.roundWinner,
        roundReason: this.roundReason,
        points: { ...this.points },
      },
    };
  }

  privateFor(id: string): PrivateState {
    if (!this.ids.includes(id)) return null;
    let state: GeistPrivate;
    const me = this.ghostMap.get(id);
    if (me) {
      const mates = [...this.ghostMap.entries()].filter(([gid]) => gid !== id).map(([, g]) => ({ x: Math.round(g.x), y: Math.round(g.y), out: g.out }));
      state = {
        role: 'ghost', x: Math.round(me.x), y: Math.round(me.y), lit: me.lit, cooldown: Math.max(0, me.scareReady - Date.now()),
        hp: Math.round((me.health / this.maxHealth) * 100) / 100, out: me.out, mates,
      };
    } else {
      const h = this.hunters.get(id);
      let fear = 0;
      if (h && this.sub === 'play') {
        // Gänsehaut vom nächsten Geist, der noch spukt
        const d = Math.min(Infinity, ...[...this.ghostMap.values()].filter((g) => !g.out).map((g) => Math.hypot(h.x - g.x, h.y - g.y)));

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
