/**
 * Strand-Volleyball: gemeinsame Konstanten und Ball-Physik (Server, TV, Bots).
 * Seitenansicht in Welt-Pixeln (480 × 270), y nach unten. Spieler-Positionen sind die Füße.
 */
import type { Team } from './types';

export const VOLLEY = {
  TICK_MS: 33,
  /** Physik-Unterschritte pro Tick (≈ 120 Hz) */
  SUBSTEPS: 6,
  INTRO_MS: 4000,
  /** So lange schwebt der Ball über dem Aufschläger */
  SERVE_MS: 1500,
  POINT_MS: 2000,
  END_MS: 2600,
  /** Spielzeit, danach entscheidet der Spielstand (bei Gleichstand: Golden Point) */
  MATCH_MS: 240000,
  TARGET: 7,
  CAP: 11,
  /** Höchstens so viele pro Team gleichzeitig im Feld – der Rest wechselt nach jedem Punkt durch */
  COURT_MAX: 3,

  // Spielfeld
  GROUND: 240,
  WALL_L: 6,
  WALL_R: 474,
  NET_X: 240,
  NET_HALF: 4,
  NET_TOP: 184,

  // Ball
  BALL_R: 6,
  BALL_G: 330,
  BALL_MAX: 360,
  /** Höchstes Tempo nach oben nach einem Treffer (Gipfel ≈ BALL_UP_MAX² / 2·BALL_G über dem Treffpunkt) */
  BALL_UP_MAX: 300,
  WALL_E: 0.85,
  NET_E: 0.55,

  // Spieler (Kollisionskreis um den Oberkörper)
  P_R: 10,
  /** Kreismitte so weit über den Füßen */
  P_BODY: 13,
  RUN: 125,
  JUMP_V: 320,
  P_G: 950,
  /** Abstand der Füße zu Wand/Netz */
  P_HALF: 7,
  /** Ball-Abpraller: Rückprall (relativ zum Spieler), Extra-Schwung, Mindesttempo */
  HIT_E: 0.75,
  HIT_BOOST: 60,
  HIT_MIN: 200,
  /** Sprung kurz vor der Landung wird gemerkt */
  JUMP_BUFFER_MS: 150,

  // Schmettern
  SPIKE_WINDOW_MS: 260,
  SPIKE_CD_MS: 1400,
  SPIKE_SPEED: 390,
  /** Größere Reichweite, solange der Schmetterarm draußen ist */
  SPIKE_REACH: 5,
  /** Ein Ballkontakt zählt erst wieder nach dieser Pause (sonst zählt ein Kontakt mehrfach) */
  TOUCH_GAP_MS: 160,
};

/** Spielrichtung: Team Sonne (A) spielt links → nach rechts, Team Meer (B) umgekehrt */
export const vollDir = (t: Team) => (t === 'A' ? 1 : -1);

/** Erlaubter Bereich der Füße auf der eigenen Seite */
export function vollSide(t: Team): [number, number] {
  const V = VOLLEY;
  return t === 'A' ? [V.WALL_L + V.P_HALF, V.NET_X - V.NET_HALF - V.P_HALF] : [V.NET_X + V.NET_HALF + V.P_HALF, V.WALL_R - V.P_HALF];
}

/** Startplätze: der Aufschläger (Index 0) steht hinten, die anderen davor */
export function vollSpot(t: Team, i: number): number {
  const off = [52, 120, 180][i] ?? 150;
  return t === 'A' ? off : 480 - off;
}

export interface VollBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Ein Physikschritt für den Ball: Schwerkraft, Seitenwände, Netz (fester Pfosten bis zum Sand).
 * Spieler-Kontakte und der Sand gehören nicht dazu (macht der Server).
 * Gibt true zurück, wenn der Ball das Netz berührt hat.
 */
export function vollStepBall(b: VollBall, dt: number): boolean {
  const V = VOLLEY;
  const r = V.BALL_R;
  b.vy += V.BALL_G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < V.WALL_L + r) {
    b.x = V.WALL_L + r;
    b.vx = Math.abs(b.vx) * V.WALL_E;
  } else if (b.x > V.WALL_R - r) {
    b.x = V.WALL_R - r;
    b.vx = -Math.abs(b.vx) * V.WALL_E;
  }
  // Netz als Rechteck: nächster Punkt zum Ballmittelpunkt
  const nx0 = V.NET_X - V.NET_HALF;
  const nx1 = V.NET_X + V.NET_HALF;
  const cx = Math.max(nx0, Math.min(nx1, b.x));
  const cy = Math.max(V.NET_TOP, Math.min(V.GROUND, b.y));
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r) return false;
  let nx: number;
  let ny: number;
  if (d > 0.0001) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Mittelpunkt im Pfosten: zur Seite raus, von der er kam
    nx = b.vx > 0 ? -1 : 1;
    ny = 0;
  }
  b.x = cx + nx * r;
  b.y = cy + ny * r;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + V.NET_E) * vn * nx;
    b.vy -= (1 + V.NET_E) * vn * ny;
  }
  // Genau oben auf der Netzkante liegen bleiben gibt es nicht
  if (ny < -0.9 && Math.abs(b.vx) < 25) b.vx += b.x < V.NET_X ? -30 : 30;
  return true;
}

/**
 * Wo kreuzt der Ball die Höhe `y` (fallend)? Simuliert Wände und Netz mit.
 * Liefert null, wenn er das innerhalb von `maxS` Sekunden nicht tut.
 */
export function vollPredict(ball: VollBall, y: number, maxS = 3): { x: number; t: number } | null {
  const b = { ...ball };
  const dt = 1 / 60;
  for (let t = 0; t < maxS; t += dt) {
    vollStepBall(b, dt);
    if (b.vy > 0 && b.y >= y) return { x: b.x, t };
    if (b.y + VOLLEY.BALL_R >= VOLLEY.GROUND) return { x: b.x, t };
  }
  return null;
}

/** Gewonnen? Bis TARGET mit 2 Vorsprung, spätestens bei CAP */
export function vollWon(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return (hi >= VOLLEY.TARGET && Math.abs(a - b) >= 2) || hi >= VOLLEY.CAP;
}
