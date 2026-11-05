import type { KartCar, KartItem, KartState } from '../../shared/types';
import { KART, type KartInput, type KartPhys, type Track, getTrack, stepKart, wrapAngle } from '../../shared/kart';
import { rttMs, serverNow } from '../timesync';

/**
 * Client-Seite der Kart-Simulation (Handy und TV gemeinsam):
 * - Andere Karts werden zwischen den Server-Ständen (20/s) interpoliert, gerendert wird ~100 ms „in der Vergangenheit“.
 * - Das eigene Kart (nur Handy) wird mit derselben Physik wie auf dem Server vorhergesagt (`stepKart`), kommt ein
 *   neuer Server-Stand, wird ab dort mit den seitdem gemachten Eingaben neu gerechnet. Der Unterschied zur bisherigen
 *   Vorhersage wird nicht gesprungen, sondern über ~150 ms ausgeblendet (Fehler-Offset, der abklingt).
 */

/** Darstellungs-Zustand eines Karts für den Renderer */
export interface KartPose {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  drift: number;
  charged: boolean;
  boost: boolean;
  spin: number;
  offroad: boolean;
  finished: boolean;
  item: KartItem | null;
  place: number;
  lap: number;
}

interface Snap {
  t: number;
  karts: Record<string, KartCar>;
}

interface Own {
  id: string;
  phys: KartPhys;
  /** Darstellungs-Fehler, der nach einer Korrektur abklingt */
  ex: number;
  ey: number;
  ea: number;
  hist: { t: number; inp: KartInput; dt: number }[];
  /** Serverzeit des letzten verarbeiteten Standes */
  lastT: number;
}

/** Wie weit hinter der Serverzeit andere Karts gezeichnet werden (ms) */
const INTERP_DELAY = KART.TICK_MS * 2;
/** Länger als so lange wird nicht extrapoliert */
const EXTRAP_MAX = 150;

const physOf = (c: KartCar): KartPhys => ({
  x: c.x,
  y: c.y,
  angle: c.angle,
  vx: c.vx,
  vy: c.vy,
  driftDir: c.drift,
  driftCharge: c.dc,
  boostMs: c.bm,
  spinMs: c.spin,
  offroad: c.offroad,
});

export class KartWorld {
  readonly track: Track;
  state: KartState | null = null;
  private snaps: Snap[] = [];
  private own: Own | null = null;
  /** Diagnose: Größe der letzten Korrekturen der Vorhersage (Pixel) */
  readonly corrections: number[] = [];
  /** Diagnose: Alter des letzten Standes bei Ankunft (ms) und Zahl der nachgerechneten Eingaben */
  diag = { age: 0, replayed: 0, snaps: 0, big: [] as { at: number; corr: number; speed: number; spin: number; srvSpeed: number }[] };

  constructor(
    trackIndex: number,
    ownId: string | null = null,
  ) {
    this.track = getTrack(trackIndex);
    if (ownId) this.own = { id: ownId, phys: { x: 0, y: 0, angle: 0, vx: 0, vy: 0, driftDir: 0, driftCharge: 0, boostMs: 0, spinMs: 0, offroad: false }, ex: 0, ey: 0, ea: 0, hist: [], lastT: 0 };
  }

  get ownId() {
    return this.own?.id ?? null;
  }

  /** Neuer Stand vom Server */
  onSnapshot(st: KartState) {
    this.state = st;
    const last = this.snaps[this.snaps.length - 1];
    if (last && st.t <= last.t) {
      // Gleicher Physik-Schritt (z. B. Item-Event dazwischen): nur Flags übernehmen
      last.karts = st.karts;
      return;
    }
    this.snaps.push({ t: st.t, karts: st.karts });
    if (this.snaps.length > 6) this.snaps.shift();
    this.diag.snaps++;
    this.diag.age = serverNow() - st.t;
    this.reconcile(st);
  }

  /** Eigenes Kart: ab dem Server-Stand mit den Eingaben seit damals neu rechnen */
  private reconcile(st: KartState) {
    const o = this.own;
    if (!o) return;
    const car = st.karts[o.id];
    if (!car) return;
    if (st.sub !== 'race' || car.finished || o.lastT === 0) {
      // Noch kein Rennen (oder Ehrenrunde): einfach übernehmen
      o.phys = physOf(car);
      o.ex = o.ey = o.ea = 0;
      o.hist = [];
      o.lastT = st.t;
      return;
    }
    o.lastT = st.t;
    const server = physOf(car);
    // Eingaben, die der Server zu diesem Stand noch nicht kannte: alles ab (Stand − Laufzeit − halber Takt)
    const from = st.t - rttMs() / 2 - KART.TICK_MS / 2;
    o.hist = o.hist.filter((h) => h.t > from);
    this.diag.replayed = o.hist.length;
    for (const h of o.hist) stepKart(server, h.inp, h.dt, this.track);
    // Darstellung bleibt stetig: alter Fehler + (alte Vorhersage − neue Vorhersage)
    const corr = Math.hypot(o.phys.x - server.x, o.phys.y - server.y);
    this.corrections.push(corr);
    if (this.corrections.length > 200) this.corrections.shift();
    if (corr > 5) this.diag.big.push({ at: Math.round(st.t % 100000), corr: Math.round(corr), speed: Math.round(Math.hypot(server.vx, server.vy)), spin: server.spinMs, srvSpeed: Math.round(Math.hypot(car.vx, car.vy)) });
    o.ex += o.phys.x - server.x;
    o.ey += o.phys.y - server.y;
    o.ea = wrapAngle(o.ea + wrapAngle(o.phys.angle - server.angle));
    if (Math.hypot(o.ex, o.ey) > 40 || Math.abs(o.ea) > 1.6) o.ex = o.ey = o.ea = 0;
    o.phys = server;
  }

  /**
   * Eigenes Kart einen Frame vorhersagen (nur Handy). Liefert true, wenn gerade ein Mini-Turbo gezündet wurde.
   */
  predict(inp: KartInput, dtMs: number): boolean {
    const o = this.own;
    const st = this.state;
    if (!o || !st || st.sub !== 'race') return false;
    const car = st.karts[o.id];
    if (!car || car.finished) return false;
    const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
    o.hist.push({ t: serverNow(), inp: { ...inp }, dt });
    if (o.hist.length > 120) o.hist.shift();
    const fired = stepKart(o.phys, inp, dt, this.track);
    // Korrektur-Offset abklingen lassen (~150 ms)
    const k = Math.exp(-dt / 0.15);
    o.ex *= k;
    o.ey *= k;
    o.ea *= k;
    return fired;
  }

  /** Vorhergesagter Zustand des eigenen Karts (für HUD/Funken) */
  get ownPhys(): KartPhys | null {
    return this.own?.phys ?? null;
  }

  private interp(id: string): { x: number; y: number; angle: number; vx: number; vy: number; car: KartCar } | null {
    const S = this.snaps;
    if (!S.length) return null;
    const rt = serverNow() - INTERP_DELAY;
    let a = S[0];
    let b: Snap | null = null;
    for (let i = S.length - 1; i >= 0; i--) {
      if (S[i].t <= rt) {
        a = S[i];
        b = S[i + 1] ?? null;
        break;
      }
    }
    const ca = a.karts[id];
    if (!ca) return null;
    const cb = b?.karts[id];
    if (b && cb) {
      const f = Math.max(0, Math.min(1, (rt - a.t) / Math.max(1, b.t - a.t)));
      return { x: ca.x + (cb.x - ca.x) * f, y: ca.y + (cb.y - ca.y) * f, angle: ca.angle + wrapAngle(cb.angle - ca.angle) * f, vx: cb.vx, vy: cb.vy, car: cb };
    }
    // Kein neuerer Stand: kurz extrapolieren
    const last = S[S.length - 1];
    const cl = last.karts[id] ?? ca;
    const ahead = Math.min(EXTRAP_MAX, Math.max(0, rt - last.t)) / 1000;
    const moving = this.state?.sub === 'race' ? 1 : 0;
    return { x: cl.x + cl.vx * ahead * moving, y: cl.y + cl.vy * ahead * moving, angle: cl.angle, vx: cl.vx, vy: cl.vy, car: cl };
  }

  /** Darstellungs-Zustand eines Karts (eigenes: Vorhersage, andere: Interpolation) */
  poseOf(id: string): KartPose | null {
    const st = this.state;
    if (!st) return null;
    const car = st.karts[id];
    if (!car) return null;
    const o = this.own;
    if (o && o.id === id && st.sub === 'race' && !car.finished && o.lastT) {
      const p = o.phys;
      return {
        id,
        x: p.x + o.ex,
        y: p.y + o.ey,
        angle: wrapAngle(p.angle + o.ea),
        speed: Math.hypot(p.vx, p.vy),
        drift: p.driftDir,
        charged: p.driftDir !== 0 && p.driftCharge >= KART.DRIFT_CHARGE_S,
        boost: p.boostMs > 0,
        spin: p.spinMs,
        offroad: p.offroad,
        finished: false,
        item: car.item,
        place: car.place,
        lap: car.lap,
      };
    }
    const i = this.interp(id);
    if (!i) return null;
    const c = i.car;
    return {
      id,
      x: i.x,
      y: i.y,
      angle: i.angle,
      speed: Math.hypot(i.vx, i.vy),
      drift: c.drift,
      charged: c.charged,
      boost: c.boost,
      spin: c.spin,
      offroad: c.offroad,
      finished: c.finished,
      item: c.item,
      place: c.place,
      lap: c.lap,
    };
  }

  /** Alle Karts (Reihenfolge wie im Stand) */
  poses(): KartPose[] {
    const st = this.state;
    if (!st) return [];
    const out: KartPose[] = [];
    for (const id of Object.keys(st.karts)) {
      const p = this.poseOf(id);
      if (p) out.push(p);
    }
    return out;
  }
}
