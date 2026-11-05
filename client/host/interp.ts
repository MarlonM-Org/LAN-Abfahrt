/**
 * Snapshot-Puffer mit Wiedergabe-Uhr für die Echtzeit-Spiele auf dem TV.
 *
 * Der Server stempelt jeden Stand mit seiner Zeit `t` (Date.now()). Der TV zeichnet `delay` ms
 * hinter der Serverzeit und interpoliert zwischen den zwei Ständen, zwischen denen die
 * Wiedergabe-Uhr gerade steht. Das ist bildratenunabhängig (60 und 144 Hz sehen gleich aus),
 * kennt kein 20-/30-Hz-„Pumpen“ und springt bei Richtungswechseln nicht.
 *
 * Die Uhr lässt sich anhalten (Hit-Stop: `rate = 0`), verlangsamen (Zeitlupe: `rate = 0.3`) und
 * holt danach mit 1,25× wieder auf, bis sie wieder `delay` ms hinter dem Server liegt – der Server
 * simuliert derweil ganz normal weiter (`Juice.hitStop()`/`slowMo()` setzen `rate`, wenn die Szene
 * den Puffer als `clock` übergibt). Der Puffer hält `keep` ms (8 s): genug für eine Wiederholung
 * (`replay()`), die alte Stände noch einmal abspielt und danach auf live zurückspringt.
 *
 *   const buf = new SnapBuffer<MyState>();        // in create() neu anlegen (Szenen werden wiederverwendet)
 *   onState: buf.push(st.t, st);
 *   update:  const s = buf.sample(); if (s) x = lerp(s.a.x, s.b.x, s.f);
 *
 * Ereignisse (Treffer-Funken, Töne), die im Stand `t` stecken, gehören zur gleichen Zeit auf den
 * Schirm wie die Figuren: `buf.after(t, () => …)` ruft sie erst auf, wenn die Uhr `t` erreicht.
 */

export interface Sample<S> {
  /** Stand vor der Wiedergabe-Uhr */
  a: S;
  /** Stand danach (bzw. der letzte – dann ist `f` > 1 und es wird leicht extrapoliert) */
  b: S;
  /** Anteil 0…1 zwischen a und b */
  f: number;
  /** Serverzeit der Wiedergabe-Uhr */
  t: number;
}

export class SnapBuffer<S> {
  /** So viele ms hinter der Serverzeit wird gezeichnet (bei 30 Hz reicht etwas mehr als ein Takt) */
  delay = 60;
  /** Wiedergabe-Tempo: 0 = Hit-Stop, 0.3 = Zeitlupe, 1 = normal (danach wird automatisch aufgeholt) */
  rate = 1;
  /** So viele ms bleiben im Puffer (für Wiederholungen) */
  keep = 8000;
  /** Höchstens so weit (ms) über den letzten Stand hinaus extrapolieren, wenn ein Paket spät kommt */
  extrapolate = 100;

  private snaps: { t: number; s: S }[] = [];
  private playT = 0;
  private lastReal = 0;
  private lastPush = 0;
  /** Serverzeit − performance.now(), geschätzt über die schnellsten Pakete */
  private offset: number | null = null;
  private replayUntil = 0;
  private replayRate = 1;
  private queue: { t: number; fn: () => void }[] = [];

  /** Neuester Stand (für HUD, Phasen, Zähler – alles, was nicht mit den Figuren mitlaufen muss) */
  get latest(): S | null {
    return this.snaps.length ? this.snaps[this.snaps.length - 1].s : null;
  }

  /** Serverzeit des neuesten Standes */
  get latestT(): number {
    return this.snaps.length ? this.snaps[this.snaps.length - 1].t : 0;
  }

  /** Serverzeit, die gerade gezeichnet wird */
  get time(): number {
    return this.playT;
  }

  /** Läuft gerade eine Wiederholung? */
  get replaying(): boolean {
    return this.replayUntil > 0;
  }

  /** Neuer Stand vom Server (gleiche Zeit wie der letzte = gleicher Physik-Schritt, nur Flags übernehmen) */
  push(t: number, s: S) {
    const now = performance.now();
    const last = this.snaps[this.snaps.length - 1];
    if (last && t <= last.t) {
      if (t === last.t) last.s = s;
      return;
    }
    this.snaps.push({ t, s });
    while (this.snaps.length > 2 && this.snaps[0].t < t - this.keep) this.snaps.shift();
    const o = t - now;
    // Das schnellste Paket bestimmt die Uhr; ganz leicht abfallen lassen, damit Drift nicht festklebt
    this.offset = this.offset === null ? o : Math.max(o, this.offset - (now - this.lastPush) * 0.001);
    this.lastPush = now;
  }

  /** `fn` aufrufen, sobald die Wiedergabe-Uhr `t` erreicht hat */
  after(t: number, fn: () => void) {
    this.queue.push({ t, fn });
  }

  /**
   * Wiederholung: die Uhr springt auf `fromT` und läuft mit `rate` bis `toT`, dann zurück auf live.
   * Die Szene zeichnet währenddessen einfach weiter aus `sample()`.
   */
  replay(fromT: number, toT: number, rate = 0.3) {
    const first = this.snaps[0]?.t ?? fromT;
    this.playT = Math.max(first, fromT);
    this.replayUntil = toT;
    this.replayRate = rate;
  }

  /** Wiederholung abbrechen → sofort wieder live */
  live() {
    this.replayUntil = 0;
    this.lastReal = 0;
  }

  /** Pro Frame: Uhr weiterstellen und die beiden Stände um die Uhr herum liefern */
  sample(): Sample<S> | null {
    if (!this.snaps.length || this.offset === null) return null;
    const now = performance.now();
    const dt = this.lastReal ? Math.min(100, now - this.lastReal) : 0;
    this.lastReal = now;
    const want = now + this.offset - this.delay;
    if (this.replayUntil) {
      this.playT += dt * this.replayRate;
      if (this.playT >= this.replayUntil) {
        this.replayUntil = 0;
        this.playT = want;
      }
    } else {
      const err = want - this.playT;
      if (!dt || Math.abs(err) > 500) this.playT = want;
      else {
        let r = this.rate;
        // Hinterher (nach Hit-Stop/Zeitlupe): mit 1,25× aufholen · voraus (Uhr korrigiert): sanft bremsen
        if (r >= 1) r = err > 8 ? Math.max(r, 1.25) : err < -8 ? 0.85 : r;
        this.playT += dt * r;
        if (r > 1 && this.playT > want) this.playT = want;
      }
    }
    if (this.queue.length && !this.replayUntil) {
      const due = this.queue.filter((q) => q.t <= this.playT);
      if (due.length) {
        this.queue = this.queue.filter((q) => q.t > this.playT);
        for (const q of due) q.fn();
      }
    }
    return this.at(this.playT);
  }

  /** Stände um die Serverzeit `t` herum */
  at(t: number): Sample<S> {
    const s = this.snaps;
    const n = s.length;
    if (n === 1 || t <= s[0].t) return { a: s[0].s, b: s[0].s, f: 0, t: s[0].t };
    const last = s[n - 1];
    if (t >= last.t) {
      const p = s[n - 2];
      const span = last.t - p.t;
      const over = Math.min(this.extrapolate, t - last.t);
      return { a: p.s, b: last.s, f: span > 0 ? 1 + over / span : 1, t: last.t + over };
    }
    let i = n - 2;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i];
    const b = s[i + 1];
    return { a: a.s, b: b.s, f: (t - a.t) / (b.t - a.t), t };
  }
}

export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Zwischenwert – aber bei einem Sprung (Respawn, Anstoß, Teleport) sofort der neue Wert */
export const lerpJump = (a: number, b: number, f: number, maxJump: number) => (Math.abs(b - a) > maxJump ? b : a + (b - a) * f);

/** Winkel (rad) auf dem kurzen Weg interpolieren */
export function lerpAngle(a: number, b: number, f: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}
