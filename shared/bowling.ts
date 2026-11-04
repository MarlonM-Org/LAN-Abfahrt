/**
 * Bowling: gemeinsame Geometrie (in Zentimetern, wie eine echte Bahn) und Punktezählung.
 * Koordinaten: x quer zur Bahn (0 = Mitte, links negativ), y längs (0 = Foullinie, wachsend Richtung Pins).
 */

export const BOWL = {
  /** halbe Bahnbreite (echte Bahn: 105 cm) */
  LANE_HALF: 52.5,
  /** Rinnenbreite auf jeder Seite */
  GUTTER: 23,
  /** Abstand Foullinie → Kopfpin */
  PIN_Y: 1829,
  /** Abstand zwischen den Pin-Mittelpunkten */
  PIN_GAP: 30.5,
  PIN_R: 6,
  /** umgefallene Pins liegen und decken mehr Fläche ab */
  PIN_DOWN_R: 8,
  BALL_R: 10.9,
  /** Ende des Pindecks – dahinter liegt der Schacht */
  DECK_END: 1829 + 79 + 55,
  PIT_END: 2010,
  /** Startposition des Balls: −1 … 1 → ±START_X */
  START_X: 38,
  /** Ballgeschwindigkeit (cm/s) */
  SPEED_MIN: 520,
  SPEED_MAX: 1000,
  /** maximaler Abwurfwinkel (rad) */
  ANGLE_MAX: 0.05,
  /** maximale seitliche Hakenbeschleunigung (cm/s²) durch Effet */
  HOOK_MAX: 60,
  /** Zeit fürs Zielen am Handy */
  AIM_MS: 30000,
  INTRO_MS: 5000,
  /** Pause nach dem Abspielen eines Wurfs (Banner) */
  RESULT_MS: 1700,
  OVER_MS: 3000,
  /** Keyframe-Abstand der Wurf-Aufzeichnung */
  TRACK_DT: 1 / 20,
};

/** Pin-Positionen 1 … 10 (Index 0 = Kopfpin) */
export const PIN_POS: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  const rowDy = BOWL.PIN_GAP * Math.sin(Math.PI / 3);
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k <= r; k++) out.push({ x: (k - r / 2) * BOWL.PIN_GAP, y: BOWL.PIN_Y + r * rowDy });
  }
  return out;
})();

/** Wie viele Frames? Je mehr Spieler, desto kürzer – damit das Spiel ~5 Minuten dauert. */
export function bowlingFrames(players: number): number {
  if (players <= 3) return 5;
  if (players <= 6) return 3;
  return 2;
}

export interface FrameView {
  /** Anzeige pro Wurf: "X", "/", "-", "7" … */
  marks: string[];
  /** Laufende Summe, null = noch offen (Bonus fehlt) */
  total: number | null;
}

/**
 * Normale Bowling-Wertung, nur mit weniger Frames:
 * Strike = 10 + nächste zwei Würfe, Spare = 10 + nächster Wurf.
 * Im letzten Frame gibt es nach Strike/Spare Bonuswürfe (wie im echten Bowling).
 */
export function scoreFrames(rolls: number[], frames: number): { frames: FrameView[]; total: number } {
  const out: FrameView[] = [];
  let i = 0;
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    if (i >= rolls.length) {
      out.push({ marks: [], total: null });
      continue;
    }
    if (!last) {
      if (rolls[i] === 10) {
        const b = rolls.slice(i + 1, i + 3);
        const done = b.length === 2;
        sum += 10 + b.reduce((a, c) => a + c, 0);
        out.push({ marks: ['X'], total: done ? sum : null });
        i += 1;
      } else {
        const a = rolls[i];
        const b = rolls[i + 1];
        if (b === undefined) {
          sum += a;
          out.push({ marks: [mark(a)], total: null });
          i += 1;
        } else if (a + b === 10) {
          const bonus = rolls[i + 2];
          sum += 10 + (bonus ?? 0);
          out.push({ marks: [mark(a), '/'], total: bonus === undefined ? null : sum });
          i += 2;
        } else {
          sum += a + b;
          out.push({ marks: [mark(a), mark(b)], total: sum });
          i += 2;
        }
      }
    } else {
      const r = rolls.slice(i, i + 3);
      const marks: string[] = [];
      let standing = 10;
      r.forEach((v, k) => {
        const fresh = standing === 10;
        if (fresh && v === 10) marks.push('X');
        else if (!fresh && v === standing) marks.push('/');
        else marks.push(mark(v));
        standing -= v;
        if (standing === 0) standing = 10;
        void k;
      });
      sum += r.reduce((a, c) => a + c, 0);
      out.push({ marks, total: lastFrameDone(r) ? sum : null });
      i += r.length;
    }
  }
  return { frames: out, total: sum };
}

const mark = (v: number) => (v === 0 ? '-' : String(v));

/** Ist der letzte Frame (Würfe r) komplett? */
export function lastFrameDone(r: number[]): boolean {
  if (r.length < 2) return false;
  if (r.length === 3) return true;
  return r[0] + r[1] < 10;
}

/**
 * Wo steht ein Spieler? Liefert Frame-Index, Wurf im Frame und ob nach diesem Wurf neue Pins
 * aufgestellt werden. done = alle Frames gespielt.
 */
export function framePosition(rolls: number[], frames: number): { frame: number; ball: number; done: boolean; frameRolls: number[] } {
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    const r = rolls.slice(i);
    if (!last) {
      if (r.length === 0) return { frame: f, ball: 0, done: false, frameRolls: [] };
      if (r[0] === 10) {
        i += 1;
        continue;
      }
      if (r.length === 1) return { frame: f, ball: 1, done: false, frameRolls: [r[0]] };
      i += 2;
    } else {
      if (lastFrameDone(r)) return { frame: f, ball: r.length, done: true, frameRolls: r.slice(0, 3) };
      return { frame: f, ball: r.length, done: false, frameRolls: r };
    }
  }
  return { frame: frames - 1, ball: 0, done: true, frameRolls: [] };
}

/** Wie viele Pins stehen vor dem nächsten Wurf im Frame? (10 = neu aufgestellt) */
export function pinsReset(frameRolls: number[]): boolean {
  let standing = 10;
  for (const v of frameRolls) {
    standing -= v;
    if (standing === 0) standing = 10;
  }
  return standing === 10;
}
