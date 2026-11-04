import type { Point } from './types';

// ------------------------------------------------------------------ Abstieg (Donkey-Kong-artig, bergab)

/** Zickzack-Weg den steinigen Abhang hinunter (Welt 480 × 270) */
export const DESCENT_PATH: Point[] = [
  { x: 30, y: 74 },
  { x: 430, y: 104 },
  { x: 448, y: 132 },
  { x: 50, y: 162 },
  { x: 32, y: 190 },
  { x: 430, y: 216 },
  { x: 448, y: 240 },
  { x: 170, y: 258 },
];

export const DESCENT = {
  SPEED: 62,
  STONE_SPEED: 104,
  JUMP_MS: 620,
  STUN_STONE_MS: 1100,
  STUN_OBSTACLE_MS: 700,
  TIME_MS: 75000,
  COUNTDOWN_MS: 3000,
  HIT_RADIUS: 7,
};

const segLens = DESCENT_PATH.slice(1).map((p, i) => Math.hypot(p.x - DESCENT_PATH[i].x, p.y - DESCENT_PATH[i].y));
export const DESCENT_LENGTH = segLens.reduce((a, b) => a + b, 0);

/** Position auf dem Weg bei Strecke s (+ Richtung, für Blickrichtung der Figur) */
export function descentPos(s: number): Point & { dir: 1 | -1 } {
  let rest = Math.max(0, Math.min(DESCENT_LENGTH, s));
  for (let i = 0; i < segLens.length; i++) {
    const a = DESCENT_PATH[i];
    const b = DESCENT_PATH[i + 1];
    if (rest <= segLens[i] || i === segLens.length - 1) {
      const t = Math.min(1, rest / segLens[i]);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: b.x >= a.x ? 1 : -1 };
    }
    rest -= segLens[i];
  }
  const last = DESCENT_PATH[DESCENT_PATH.length - 1];
  return { ...last, dir: -1 };
}

/** Feste Hindernisse (nur auf den langen Rampen) */
export const DESCENT_OBSTACLES: { s: number; type: 'bottle' | 'pigeon' | 'puddle' }[] = (() => {
  const out: { s: number; type: 'bottle' | 'pigeon' | 'puddle' }[] = [];
  const types = ['bottle', 'pigeon', 'puddle'] as const;
  let acc = 0;
  segLens.forEach((len, i) => {
    if (len > 200) {
      for (const f of [0.3, 0.68]) out.push({ s: acc + len * f, type: types[(i + out.length) % 3] });
    }
    acc += len;
  });
  return out;
})();

// ------------------------------------------------------------------ Gespräch (Rhythmus)

export const RHYTHM = {
  BPM: 96,
  LEAD_IN: 3000,
  BEATS: 48,
  PERFECT_MS: 70,
  GOOD_MS: 140,
  /** Zeit, die eine Note sichtbar von oben nach unten fällt */
  FALL_MS: 1600,
};

export const RHYTHM_TOPICS = ['Musik?', 'Reisen!', 'Haha!', 'Echt?!', 'Ich auch!', 'Lieblingsessen?', 'Peinlich ...', 'Träume'];

// ------------------------------------------------------------------ Wrap

export const WRAP_RECIPE = ['tortilla', 'salat', 'tomate', 'gurke', 'paprika', 'mais', 'sriracha'];
export const WRAP_DISTRACTORS = ['banane', 'schoko', 'gummi'];

export const INGREDIENT_NAMES: Record<string, string> = {
  tortilla: 'Tortilla',
  salat: 'Salat',
  tomate: 'Tomate',
  gurke: 'Gurke',
  paprika: 'Paprika',
  mais: 'Mais',
  sriracha: 'Sriracha-Mayo',
  banane: 'Banane',
  schoko: 'Schokolade',
  gummi: 'Gummibärchen',
};

export const WRAP = { TIME_MS: 60000, BASE_SPEED: 0.9, SPEED_STEP: 0.18 };

// ------------------------------------------------------------------ Sternbilder

/** Koordinaten normiert auf 0…1 (Himmel ist 3:2) */
export interface Constellation {
  name: string;
  hint: string;
  stars: [number, number][];
  edges: [number, number][];
}

export const CONSTELLATIONS: Constellation[] = [
  {
    name: 'Kassiopeia',
    hint: 'Ein großes W',
    stars: [[0.18, 0.35], [0.33, 0.62], [0.5, 0.4], [0.66, 0.64], [0.82, 0.32]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    name: 'Großer Wagen',
    hint: 'Ein Kasten mit Deichsel',
    stars: [[0.12, 0.3], [0.27, 0.36], [0.4, 0.44], [0.53, 0.5], [0.58, 0.74], [0.82, 0.74], [0.84, 0.48]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    name: 'Schwan',
    hint: 'Ein großes Kreuz',
    stars: [[0.5, 0.15], [0.5, 0.4], [0.5, 0.62], [0.5, 0.86], [0.24, 0.35], [0.76, 0.48]],
    edges: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
  },
  {
    name: 'Das Herz',
    hint: 'Euer ganz eigenes Sternbild',
    stars: [[0.5, 0.32], [0.38, 0.18], [0.22, 0.24], [0.2, 0.44], [0.34, 0.64], [0.5, 0.84], [0.66, 0.64], [0.8, 0.44], [0.78, 0.24], [0.62, 0.18]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0]],
  },
];

export const STARS = { TIME_MS: 90000, DISTRACTORS: 9, DONE_MS: 1800 };
