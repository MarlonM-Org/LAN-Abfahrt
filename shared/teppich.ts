/**
 * Teppich-Parcours auf dem Balance Board: Strecke, Konstanten und Zustand (Server, TV, Handy, Bots).
 *
 * Seitenansicht in Welt-Pixeln (Bildhöhe 270, y nach unten). Der fliegende Teppich fliegt von links nach rechts
 * durch eine Wüstenstadt bei Nacht: Minarette von unten, Gewitterwolken von oben, Geier dazwischen, Juwelen zum
 * Einsammeln. Steuerung über den Schwerpunkt: nach vorn lehnen = sinken, nach hinten = steigen,
 * nach rechts = schneller, nach links = bremsen. Wertung: Zeit − 1 s pro Juwel (+ 2 s pro Treffer stecken im Tempo).
 */
import { type BalanceTurn, seeded } from './balance';

export const TEP = {
  TICK_MS: 33,
  /** Streckenlänge (px) */
  LEN: 3000,
  /** Startposition */
  START_X: 60,
  START_Y: 135,
  /** Boden (Sanddünen) – darunter geht’s nicht */
  GROUND_Y: 248,
  CEIL_Y: 14,
  /** Tempo (px/s): Grundtempo, ± durch Seitwärtslehnen */
  SPEED: 92,
  SPEED_LEAN: 52,
  /** Steigen/Sinken (px/s) bei vollem Lehnen */
  CLIMB: 120,
  /** Teppich-Hitbox (halbe Breite/Höhe) */
  HW: 15,
  HH: 6,
  /** Nach einem Treffer: so lange benommen (langsam, blinkt), dann kurz unverwundbar */
  STUN_MS: 800,
  SAFE_MS: 1300,
  /** Juwel einsammeln: Radius */
  GEM_R: 9,
  /** Zeitgutschrift pro Juwel (s) */
  GEM_BONUS: 1,
  /** Spätestens nach so vielen s ist der Flug vorbei (dann zählt die Strecke) */
  MAX_S: 75,
  GATE_MS: 3000,
  DONE_MS: 4000,
  /** Anzeige: hier sitzt der Teppich auf dem Bildschirm */
  SCREEN_X: 150,
};

export type TepObstacle =
  /** Minarett/Turm von unten: oberer Rand `top` */
  | { k: 'tower'; x: number; w: number; top: number }
  /** Gewitterwolke von oben: unterer Rand `bottom` */
  | { k: 'cloud'; x: number; w: number; bottom: number }
  /** Geier: schwebt um y0 auf und ab (Amplitude `a`, Periode `p` s, Phase `ph`) */
  | { k: 'bird'; x: number; y0: number; a: number; p: number; ph: number };

export interface TepGem {
  x: number;
  y: number;
}

export interface TepCourse {
  obstacles: TepObstacle[];
  gems: TepGem[];
}

/** Geier-Position zur Flugzeit `t` (s seit Start) – gleich auf Server und TV */
export const birdY = (o: Extract<TepObstacle, { k: 'bird' }>, t: number) => o.y0 + o.a * Math.sin((t / o.p) * Math.PI * 2 + o.ph);
/** Geier fliegen langsam nach links */
export const birdX = (o: Extract<TepObstacle, { k: 'bird' }>, t: number) => o.x - t * 14;
export const BIRD_R = 8;

/**
 * Strecke aus einem Startwert: Tore (Turm unten + Wolke oben mit Lücke) im Wechsel mit freien Abschnitten,
 * Geiern und Juwelen. Die Lücken wandern, werden nach hinten enger, und manche Juwelen liegen riskant.
 */
export function tepCourse(seed: number): TepCourse {
  const r = seeded(seed);
  const obstacles: TepObstacle[] = [];
  const gems: TepGem[] = [];
  let x = 330;
  let gapY = 135;
  let i = 0;
  while (x < TEP.LEN - 220) {
    const hard = x / TEP.LEN;
    const kind = r();
    if (kind < 0.62 || i < 2) {
      // Tor: Lücke 110 → 72 px, Mitte wandert höchstens ±70 px
      const gap = 110 - hard * 38;
      gapY = Math.max(TEP.CEIL_Y + gap / 2 + 26, Math.min(TEP.GROUND_Y - gap / 2 - 18, gapY + (r() - 0.5) * 140));
      const w = 26 + Math.round(r() * 14);
      if (r() < 0.85) obstacles.push({ k: 'tower', x, w, top: Math.round(gapY + gap / 2) });
      if (r() < 0.85) obstacles.push({ k: 'cloud', x: x - 4, w: w + 8, bottom: Math.round(gapY - gap / 2) });
      gems.push({ x: x + w / 2, y: Math.round(gapY + (r() - 0.5) * gap * 0.5) });
      x += 150 + Math.round(r() * 70) - Math.round(hard * 30);
    } else if (kind < 0.85) {
      // Geier-Schwarm: zwei bis drei, dazwischen Juwelen
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        obstacles.push({ k: 'bird', x: x + k * 60, y0: 60 + Math.round(r() * 150), a: 20 + Math.round(r() * 30), p: 1.6 + r() * 1.4, ph: r() * Math.PI * 2 });
        gems.push({ x: x + k * 60 + 30, y: 50 + Math.round(r() * 170) });
      }
      x += 120 + n * 60;
    } else {
      // Juwelen-Bogen (riskant hoch oder tief)
      const hi = r() < 0.5;
      for (let k = 0; k < 5; k++) gems.push({ x: x + k * 26, y: Math.round((hi ? 50 : 215) + Math.sin((k / 4) * Math.PI) * (hi ? -18 : 18)) });
      x += 200;
    }
    i++;
  }
  return { obstacles, gems };
}

export interface TepRun {
  /** Zeit bis ins Ziel (s), ohne Juwelen-Gutschrift; bei Abbruch: MAX_S */
  time: number;
  gems: number;
  hits: number;
  /** Wertung: time − gems × GEM_BONUS (kleiner = besser) */
  score: number;
  finished: boolean;
  dns?: boolean;
  /** Neuer Gesamtrekord / persönliche Bestzeit */
  rec?: import('./balance').RecordResult;
}

export interface TepState extends BalanceTurn {
  sub: 'ready' | 'countdown' | 'fly' | 'done' | 'over';
  t: number;
  seed: number;
  /** Teppich */
  x: number;
  y: number;
  vy: number;
  speed: number;
  /** Flugzeit (s) seit dem Start */
  ft: number;
  /** Benommen bis / unverwundbar bis (ms Flugzeit) */
  stunMs: number;
  safeMs: number;
  /** Eingesammelte Juwelen (Indizes) und Treffer im aktuellen Flug */
  got: number[];
  hits: number;
  runs: Record<string, TepRun>;
  /** Gesamtpunkte für die Zuschauer-Leiste (Platz-Punkte, aktualisiert nach jedem Flug) */
  points: Record<string, number>;
  last: (TepRun & { id: string }) | null;
}
