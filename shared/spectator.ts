/**
 * Zuschauer-Ebene (für alle Spiele): Emotes, Wetten auf den Rundensieger, Geister-Aktionen.
 * Gemeinsame Konstanten und Typen für Server, TV, Handy und Bots.
 */

/** Die vier Emotes der Zuschauer-Leiste (Index geht als Event `emote` an den Server) */
export const EMOTES = ['😂', '😱', '👏', '🍅'] as const;

export const SPECTATOR = {
  /** Abklingzeit pro Spieler zwischen zwei Emotes */
  EMOTE_COOLDOWN_MS: 2000,
  /** So lange steht ein Emote im Zustand (TV lässt es in dieser Zeit aufsteigen und verblassen) */
  EMOTE_TTL_MS: 4000,
  /** Ringpuffer: höchstens so viele Emotes gleichzeitig */
  EMOTE_MAX: 12,
  /** Bomben-Arena: Geister werfen höchstens alle 8 s eine Wasserbombe */
  ARENA_GHOST_MS: 8000,
  /** Bomben-Arena: Geister-Zielkreuz (Kacheln pro Sekunde bei vollem Stick-Ausschlag) */
  ARENA_GHOST_SPEED: 9,
  /** Bomben-Arena: Reichweite einer Geister-Bombe */
  ARENA_GHOST_RANGE: 2,
  /** Sumo-Steg: Geister schicken höchstens alle 5 s eine Welle */
  SUMO_WAVE_MS: 5000,
  /** Sumo-Steg: Tempo der Wellenfront (px/s), halbe Breite (px) und Stoß (px/s) */
  SUMO_WAVE_SPEED: 230,
  SUMO_WAVE_HALF: 42,
  SUMO_WAVE_PUSH: 95,
};

/** Ein kurzlebiges Emote im Zustand (`GameLive.emotes`) */
export interface EmoteEntry {
  seq: number;
  playerId: string;
  /** Index in EMOTES */
  i: number;
  /** Serverzeit (ms) */
  at: number;
}

/** Auflösung einer Wett-Runde (für Konfetti auf dem TV und „Richtig getippt!“ am Handy) */
export interface BetFx {
  seq: number;
  round: number;
  winner: string;
  /** Wer richtig getippt hat */
  ids: string[];
}

/**
 * Generisches Zuschauer-Feld im Snapshot der Elimination-Spiele (Arena, Sumo, Bogen, Kurve, Smash).
 * Handy (Live-Stand + Wett-Knöpfe), TV-Overlay („🎲 3 Wetten auf Lena“) und Bots lesen nur das.
 */
export interface SpectatorInfo {
  /** Wer in dieser Runde noch lebt */
  alive: string[];
  /** Erst am Rundenende gesetzt (null = Unentschieden) */
  roundWinner?: string | null;
  round: number;
  /** Ausgeschiedene dürfen gerade wetten */
  open: boolean;
  /** Wetten dieser Runde: Wettende(r) → Tipp */
  bets: Record<string, string>;
  /** Richtige Tipps über das ganze Spiel (fließt als Bonus in die Platzierung) */
  bonus: Record<string, number>;
  /** Letzte Auflösungen (neueste zuletzt) */
  fx: BetFx[];
}
