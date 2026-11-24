/**
 * Uhrabgleich Gerät ↔ Server (rein, ohne DOM/Node – benutzt von `client/timesync.ts`, getestet in
 * `scripts/test-rhythmus.ts`).
 *
 * Jede Messung (Ping) liefert Laufzeit hin + zurück (`rtt`) und einen Versatz unter der Annahme, dass Hin- und
 * Rückweg gleich lang sind. Im WLAN stimmt das oft nicht: Handys im Stromsparmodus bekommen Antworten erst mit dem
 * nächsten Beacon des Routers (bis ~100 ms später), der Fehler ist bis zu rtt/2. Darum:
 * - ein gleitendes Fenster der letzten Messungen (statt bei jedem Messstoß von vorn),
 * - davon nur die schnellsten 25 % (dort ist die Asymmetrie am kleinsten), deren Median (robust gegen Ausreißer),
 * - der benutzte Versatz gleitet sanft zur Schätzung (höchstens 5 % der verstrichenen Zeit) – ein Song verrutscht
 *   nicht mitten im Takt; nur große Abweichungen (Uhr verstellt, neu verbunden) springen sofort.
 */

export const UHR = {
  /** So viele Messungen bleiben im Fenster (bei einem Ping alle 2 s ≈ 1 min) */
  FENSTER: 32,
  /** Anteil der schnellsten Messungen, die zählen */
  BESTE: 0.25,
  /** Ab so viel Abweichung (ms) springt der Versatz statt zu gleiten */
  SPRUNG_MS: 150,
  /** Gleiten: höchstens so viele ms Korrektur pro ms verstrichener Zeit */
  GLEIT: 0.05,
  /** Messungen mit längerer Laufzeit (ms) sind wertlos */
  MAX_RTT: 3000,
};

export interface UhrProbe {
  rtt: number;
  /** Serverzeit − lokale Zeit (ms) */
  off: number;
}

/** Schätzung aus einem Satz Messungen: Median der Versätze der schnellsten 25 % (mindestens 3) */
export function versatzSchaetzen(proben: UhrProbe[]): number | null {
  if (!proben.length) return null;
  const schnell = [...proben].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(3, Math.ceil(proben.length * UHR.BESTE)));
  const offs = schnell.map((p) => p.off).sort((a, b) => a - b);
  const m = offs.length >> 1;
  return offs.length % 2 ? offs[m] : (offs[m - 1] + offs[m]) / 2;
}

export class Uhrabgleich {
  private proben: UhrProbe[] = [];
  private aktuell: number | null = null;
  private zuletzt = 0;
  private ziel: number | null = null;

  /** Eine Messung: `t0`/`t1` = lokale Zeit beim Senden/Empfangen, `server` = Serverzeit aus der Antwort */
  probe(t0: number, server: number, t1: number) {
    const rtt = t1 - t0;
    if (!(rtt >= 0) || rtt > UHR.MAX_RTT || !Number.isFinite(server)) return;
    this.proben.push({ rtt, off: server - (t0 + t1) / 2 });
    if (this.proben.length > UHR.FENSTER) this.proben.shift();
    this.ziel = versatzSchaetzen(this.proben);
  }

  /** Versatz (Serverzeit − lokale Zeit), der zur lokalen Zeit `now` gilt */
  offset(now: number): number {
    const z = this.ziel;
    if (z === null) return this.aktuell ?? 0;
    if (this.aktuell === null || Math.abs(z - this.aktuell) > UHR.SPRUNG_MS) {
      this.aktuell = z;
      this.zuletzt = now;
      return z;
    }
    const step = Math.max(0, now - this.zuletzt) * UHR.GLEIT;
    this.zuletzt = now;
    this.aktuell += Math.max(-step, Math.min(step, z - this.aktuell));
    return this.aktuell;
  }

  /** Kürzeste Laufzeit im Fenster (ms), `Infinity` ohne Messung */
  bestRtt(): number {
    return this.proben.reduce((m, p) => Math.min(m, p.rtt), Infinity);
  }

  get messungen() {
    return this.proben.length;
  }
}
