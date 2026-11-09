import type { MiniSnapshot } from '../shared/types';
import { SEKT, type SektPlayer, type SektPop, type SektState, fmtM, sektMeters, sektRed } from '../shared/sekt';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

interface P extends SektPlayer {
  /** Letzte Schüttel-Meldung (ms) – ältere gilt als Stillstand */
  sAt: number;
  /** Zeit in der roten Zone (ms) */
  dangerMs: number;
}

/**
 * Sektkorken: alle schütteln gleichzeitig. Der Server integriert den Druck aus den gebündelten Schüttel-Stärken
 * der Handys (Sensor oder Reiben), lässt ihn langsam sinken, bewegt die rote Zone und entscheidet über PLOPP
 * (Loslassen) und PENG (zu lange im Roten). Drei Durchgänge, der beste Wurf zählt.
 */
export class SektGame implements MiniGame {
  readonly kind = 'sekt' as const;
  private players = new Map<string, P>();
  private order: string[];
  private sub: SektState['sub'] = 'intro';
  private round = 0;
  private deadline = Date.now() + SEKT.INTRO_MS;
  /** Beginn der Schüttelzeit (für die rote Zone) */
  private shakeStart = 0;
  private redPhase = Math.random();
  private red = SEKT.RED_START;
  private pops: SektPop[] = [];
  private seq = 0;
  /** Alle fertig → Durchgang endet zu diesem Zeitpunkt (0 = noch nicht) */
  private allDoneAt = 0;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    this.order = shuffle(ids);
    this.order.forEach((id, slot) => {
      this.players.set(id, { slot, st: 'wait', p: 0, s: 0, danger: 0, throws: [], best: 0, sAt: 0, dangerMs: 0 });
    });
    let last = Date.now();
    this.timers.every(SEKT.TICK_MS, () => {
      const now = Date.now();
      this.tick(now, Math.min(200, now - last));
      last = now;
    });
  }

  // ---------------------------------------------------------------- Ablauf

  private tick(now: number, dtMs: number) {
    if (this.sub === 'over') return;
    if (this.sub === 'intro' || this.sub === 'show') {
      if (now >= this.deadline) {
        if (this.round >= SEKT.ROUNDS) return this.end();
        this.startCountdown(now);
      }
    } else if (this.sub === 'countdown') {
      this.red = sektRed(0, this.redPhase);
      if (now >= this.deadline) {
        this.sub = 'shake';
        this.shakeStart = now;
        this.deadline = now + SEKT.SHAKE_MS;
        this.allDoneAt = 0;
      }
    } else if (this.sub === 'shake') {
      this.red = sektRed(now - this.shakeStart, this.redPhase);
      const dt = dtMs / 1000;
      for (const [id, p] of this.players) this.step(id, p, now, dt, dtMs);
      if (now >= this.deadline) return this.timeUp(now);
      if (!this.allDoneAt && this.allDone()) this.allDoneAt = now + SEKT.ALL_DONE_MS;
      if (this.allDoneAt && now >= this.allDoneAt) return this.timeUp(now);
    }
    this.ctx.onChange();
  }

  private startCountdown(now: number) {
    this.round += 1;
    this.sub = 'countdown';
    this.deadline = now + SEKT.COUNT_MS;
    this.redPhase = Math.random();
    this.red = sektRed(0, this.redPhase);
    for (const p of this.players.values()) {
      p.st = 'wait';
      p.p = 0;
      p.s = 0;
      p.sAt = 0;
      p.danger = 0;
      p.dangerMs = 0;
    }
  }

  /** Druck eines Spielers in der Schüttelzeit */
  private step(id: string, p: P, now: number, dt: number, dtMs: number) {
    if (now - p.sAt > SEKT.S_STALE_MS) p.s = 0;
    if (p.st !== 'in') return;
    const gain = SEKT.GAIN * p.s * (1 - SEKT.STIFF * p.p);
    p.p = clamp(p.p + (gain - SEKT.DECAY) * dt, 0, 1);
    if (p.p >= 1) return this.pop(id, p, now, false, true);
    if (p.p > this.red) p.dangerMs += dtMs;
    else p.dangerMs = Math.max(0, p.dangerMs - 2 * dtMs);
    p.danger = clamp(p.dangerMs / SEKT.BURST_MS, 0, 1);
    if (p.dangerMs >= SEKT.BURST_MS) this.pop(id, p, now, false, true);
  }

  /** Wer ist in diesem Durchgang fertig (oder offline ohne Korken)? */
  private allDone() {
    return [...this.players.entries()].every(([id, p]) => p.st === 'pop' || p.st === 'burst' || p.st === 'fizzle' || (p.st === 'wait' && !this.ctx.isConnected(id)));
  }

  /** PLOPP (oder PENG) – Weite steht sofort fest */
  private pop(id: string, p: P, _now: number, auto: boolean, burst = false) {
    if (p.st !== 'in') return;
    const pressure = p.p;
    let m = 0;
    if (burst) {
      p.st = 'burst';
      p.throws[this.round - 1] = -1;
    } else if (pressure < SEKT.MIN_POP) {
      p.st = 'fizzle';
      p.throws[this.round - 1] = 0;
    } else {
      const noise = 1 + (Math.random() * 2 - 1) * SEKT.NOISE;
      m = Math.max(0.1, Math.round(sektMeters(pressure) * noise * 10) / 10);
      p.st = 'pop';
      p.throws[this.round - 1] = m;
      p.best = Math.max(p.best, m);
    }
    p.danger = burst ? 1 : 0;
    p.dangerMs = 0;
    p.s = 0;
    this.pops.push({ seq: ++this.seq, pid: id, round: this.round, m, burst, p: r2(pressure), auto });
    if (this.pops.length > 40) this.pops.shift();
  }

  /** Zeit um: wer noch hält, dessen Korken knallt jetzt – dann die Weiten-Schau */
  private timeUp(now: number) {
    for (const [id, p] of this.players) {
      if (p.st === 'in') this.pop(id, p, now, true);
      else if (p.st === 'wait') p.throws[this.round - 1] = 0;
    }
    this.sub = 'show';
    this.deadline = now + SEKT.SHOW_MS;
    this.allDoneAt = 0;
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.players.get(id);
    if (!p || this.sub === 'over') return;
    const pl = asRecord(payload);
    const now = Date.now();
    if (action === 'cork') {
      const down = !!pl.down;
      if (down) {
        // Daumen drauf: im Countdown und in der Schüttelzeit (vorher zählt nichts)
        if (p.st === 'wait' && (this.sub === 'countdown' || this.sub === 'shake')) {
          p.st = 'in';
          p.p = 0;
        }
      } else if (p.st === 'in') {
        // Loslassen = PLOPP – auch versehentlich. Ohne Druck (oder vor dem Start) einfach wieder ohne Korken.
        if (this.sub === 'shake' && p.p >= SEKT.MIN_POP) this.pop(id, p, now, false);
        else {
          p.st = 'wait';
          p.p = 0;
          p.danger = 0;
          p.dangerMs = 0;
        }
      }
      this.ctx.onChange();
    } else if (action === 'shake') {
      const s = Number(pl.s);
      if (!Number.isFinite(s)) return;
      p.s = r2(clamp(s, 0, SEKT.S_MAX));
      p.sAt = now;
    }
  }

  // ---------------------------------------------------------------- Ende

  private end() {
    if (this.sub === 'over') return;
    this.sub = 'over';
    this.deadline = Date.now() + SEKT.OVER_MS;
    this.ctx.onChange();
    this.timers.clear();
    const list = [...this.players.entries()];
    const top = [...list].sort((a, b) => b[1].best - a[1].best)[0];
    const bursts = list.reduce((n, [, p]) => n + p.throws.filter((m) => m < 0).length, 0);
    const subtitle = top && top[1].best > 0
      ? `Weitester Korken: ${this.ctx.nameOf(top[0])} mit ${fmtM(top[1].best)}!`
      : bursts
        ? 'Alle Flaschen geplatzt – was für eine Sauerei!'
        : 'Kein einziger Korken ist geflogen …';
    this.timers.later(SEKT.OVER_MS, () => {
      this.ctx.finish({
        // Gleichstand beim besten Wurf: der zweitbeste entscheidet
        groups: groupByScore(this.ids, (id) => {
          const p = this.players.get(id);
          if (!p) return 0;
          const sorted = p.throws.filter((m) => m > 0).sort((a, b) => b - a);
          return Math.round((sorted[0] ?? 0) * 10) * 1000 + Math.round((sorted[1] ?? 0) * 10);
        }),
        details: Object.fromEntries(
          list.map(([id, p]) => {
            const n = p.throws.filter((m) => m < 0).length;
            return [id, `${p.best > 0 ? fmtM(p.best) : '0 m'}${n ? ` · ${n}× PENG` : ''}`];
          }),
        ),
        subtitle,
      });
    });
  }

  snapshot(): MiniSnapshot {
    const players: Record<string, SektPlayer> = {};
    for (const [id, p] of this.players) {
      players[id] = { slot: p.slot, st: p.st, p: r2(p.p), s: p.s, danger: r2(p.danger), throws: [...p.throws].map((m) => m ?? 0), best: p.best };
    }
    return {
      kind: 'sekt',
      state: {
        sub: this.sub,
        round: this.round,
        rounds: SEKT.ROUNDS,
        endsIn: Math.max(0, this.deadline - Date.now()),
        red: r2(this.red),
        order: this.order,
        players,
        pops: this.pops,
      },
    };
  }

  playerDisconnected(_id: string) {
    // Korken bleibt drin (ohne Schütteln sinkt der Druck) – zur Zeit knallt er automatisch
  }

  dispose() {
    this.timers.clear();
  }
}
