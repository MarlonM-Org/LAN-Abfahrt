/**
 * Wasserpistolen-Duell: gemeinsame Konstanten, Zustandstypen und die Ausweich-Bahn der Ziele.
 * Wird von Server (Spiellogik + Treffer-Prüfung), TV, Handy und Bots benutzt.
 *
 * Jedes Duell hat zwei „Zielkästen“ (je WP.BOX_W × WP.BOX_H Duell-Pixel). Im Kasten tänzelt der
 * jeweilige Spieler nach dem „ZIEHT!“ auf einer festen Bahn hin und her (wpTargetAt) – Server,
 * TV und Handy rechnen sie identisch aus, dadurch braucht es keine Positions-Updates übers Netz.
 */

export const WP = {
  /** Zielkasten in Duell-Pixeln */
  BOX_W: 64,
  BOX_H: 40,
  /** Trefferradius um die Körpermitte (Touch: Tippen ist präziser als Zielen mit dem Handy) */
  HIT_R_TOUCH: 7,
  HIT_R_MOTION: 10,
  /** Spritzer pro Duell */
  SHOTS: 3,
  SHOT_COOLDOWN_MS: 220,

  INTRO_MS: 8000,
  /** „Hand ans Holster!“ – endet früher, sobald alle bereit sind (frühestens nach ARM_MIN_MS) */
  ARM_MS: 4500,
  ARM_MIN_MS: 1200,
  /** Zufällige Wartezeit bis zum „ZIEHT!“ */
  WAIT_MIN_MS: 1600,
  WAIT_MAX_MS: 4200,
  /** Falscher Ruf („ZIEGE!“): Anzeigedauer und Mindestabstand zum echten Ruf */
  FAKE_MS: 750,
  FAKE_GAP_MS: 1300,
  /** Längstes Duell nach dem „ZIEHT!“ */
  DUEL_MS: 5500,
  /** Nach dem ersten Treffer noch kurz warten – ein langsamer Funkweg soll niemanden den Sieg kosten */
  GRACE_MS: 160,
  /** Pause, wenn alle Duelle entschieden sind, bevor das Ergebnis kommt */
  SETTLE_MS: 600,
  RESULT_MS: 3600,
  TABLE_MS: 5500,
  OVER_MS: 3500,

  /** Schneller als das kann kein Mensch reagieren → geraten = Frühstart */
  MIN_REACT_MS: 90,
  /** So weit darf die Handy-Zeitmessung von der Server-Messung abweichen */
  HINT_TOL_MS: 120,
  /** Annahme, falls ein Handy das „ZIEHT!“ nie bestätigt hat (halbe Funkstrecke) */
  NO_ACK_MS: 120,
  /** Treffer-Prüfung: Bahn um ± so viele ms um den Schusszeitpunkt prüfen (Wackeln der Messung) */
  LAG_MS: 60,

  /** Vorrunde (Schweizer System): Runden je nach Spielerzahl */
  ROUNDS_FEW: 9,
  ROUNDS_MANY: 8,
  /** Finale: wer zuerst so viele Duelle gewinnt (zu zweit: das ganze Spiel) */
  FINAL_TO: 3,
  FINAL_TO_2P: 7,
  FINAL_MAX_DUELS: 5,
  FINAL_MAX_DUELS_2P: 13,

  /** Gartenzwerg Gustav (Gegner bei ungerader Spielerzahl) */
  GNOME_ID: 'zwerg',
  GNOME_MIN_MS: 420,
  GNOME_MAX_MS: 720,

  COLORS: [0xff4040, 0x3f8fff, 0x4ee04e, 0xffe03a, 0xff7ad8, 0xff9a2e, 0xa67bff, 0x3fe8d8, 0xffffff, 0xc8ff3a, 0xd89a5a, 0xc0305f],
};

/** Falsche Rufe – wer da zieht, hat einen Frühstart */
export const WP_FAKES = ['ZIEGE!', 'ZITRONE!', 'ZIMTSTERN!', 'ZIEHHARMONIKA!', 'ZIELWASSER!', 'ZIRKUS!', 'ZUCCHINI!', 'ZIERFISCH!', 'ZIEHT ... EUCH WAS AN!'];

/** Ausweich-Bahn im Zielkasten (Lissajous-Figur), t in ms seit dem „ZIEHT!“ */
export interface WpPath {
  ax: number;
  ay: number;
  wx: number;
  wy: number;
  px: number;
  py: number;
}

export function wpTargetAt(p: WpPath, tMs: number): { x: number; y: number } {
  const t = Math.max(0, tMs) / 1000;
  return {
    x: WP.BOX_W / 2 + p.ax * Math.sin(p.wx * t + p.px),
    y: 22 + p.ay * Math.sin(p.wy * t + p.py),
  };
}

/** Neue zufällige Bahn; `speed` wächst mit den Runden */
export function wpRandomPath(speed: number, rnd: () => number = Math.random): WpPath {
  const r = (a: number, b: number) => a + rnd() * (b - a);
  return {
    ax: r(13, 20),
    ay: r(3, 7),
    wx: r(1.6, 2.5) * speed * (rnd() < 0.5 ? -1 : 1),
    wy: r(2.4, 3.8) * speed,
    px: r(0, Math.PI * 2),
    py: r(0, Math.PI * 2),
  };
}

/** Trifft ein Spritzer (Kasten-Koordinaten) das Ziel zur Zeit t (± LAG_MS)? */
export function wpHits(p: WpPath, tMs: number, x: number, y: number, r: number): boolean {
  for (let dt = -WP.LAG_MS; dt <= WP.LAG_MS; dt += 20) {
    const c = wpTargetAt(p, tMs + dt);
    if (Math.hypot(c.x - x, c.y - y) <= r) return true;
  }
  return false;
}

/** Sekunden mit Komma: 0,42 s */
export const wpSec = (ms: number | null | undefined) => (ms == null ? '–' : `${(ms / 1000).toFixed(2).replace('.', ',')} s`);

// ------------------------------------------------------------------ Zustand

export interface WpSide {
  /** Spieler-ID oder WP.GNOME_ID */
  id: string;
  /** Eigene Ausweich-Bahn (darauf zielt der Gegner) */
  path: WpPath;
  armed: boolean;
  /** Reaktionszeit beim Ziehen (ms nach „ZIEHT!“) */
  drawMs: number | null;
  /** Zeit des Treffers (ms nach „ZIEHT!“) */
  hitMs: number | null;
  /** Verbrauchte Spritzer */
  shots: number;
  foul: boolean;
  /** Ergebnis: nass geworden */
  wet: boolean;
  /** Fadenkreuz (Bewegungssensor) im Kasten des Gegners – nur fürs TV */
  aim: { x: number; y: number } | null;
}

export interface WpDuel {
  a: WpSide;
  b: WpSide;
  done: boolean;
  /** Sieger-ID (kann der Zwerg sein) oder null = keiner */
  winner: string | null;
  /** Kurzer Ergebnistext, z. B. „Frühstart!“ */
  note: string;
}

export interface WpShot {
  seq: number;
  duel: number;
  /** Seite des Schützen */
  from: 'a' | 'b';
  x: number;
  y: number;
  hit: boolean;
}

export interface WpPlayer {
  wins: number;
  /** Schnellster Treffer */
  best: number | null;
  fouls: number;
  color: number;
  /** Siege im Finale */
  fw: number;
}

export interface WpistoleState {
  sub: 'intro' | 'arm' | 'wait' | 'draw' | 'result' | 'table' | 'over';
  /** Vorrunde: Rundennummer; Finale: Nummer des Final-Duells */
  round: number;
  rounds: number;
  final: boolean;
  /** Finale: Siege bis zum Titel */
  finalTo: number;
  finalists: string[];
  endsIn: number;
  /** Zählt jedes echte „ZIEHT!“ – Handys bestätigen damit, wann sie es gesehen haben */
  drawSeq: number;
  /** Aktueller Ruf (echt oder falsch) */
  call: string | null;
  callReal: boolean;
  callSeq: number;
  duels: WpDuel[];
  players: Record<string, WpPlayer>;
  shots: WpShot[];
}
