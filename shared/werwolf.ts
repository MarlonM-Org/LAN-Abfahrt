/**
 * Werwölfe im Ferienhaus – Rollen, Zeiten und Zustandstypen.
 * Der öffentliche Zustand (`WolfState`) enthält Rollen nur von Toten (und am Ende von allen);
 * alles Geheime steht in `WolfPrivate` und geht nur per `privateFor()` an den jeweiligen Spieler.
 */

export const WOLF = {
  /** Rollen anschauen */
  ROLES_MS: 14000,
  /** Nacht: Werwölfe wählen, Seherin schaut, alle anderen tippen einen Verdacht */
  NIGHT_MS: 35000,
  /** Danach ist die Hexe dran (alle anderen zählen weiter Schäfchen) */
  WITCH_MS: 15000,
  /** Morgen: Wer ist gestorben? */
  DAWN_MS: 9000,
  /** Abstimmung am Tag */
  VOTE_MS: 30000,
  /** Auflösung der Abstimmung */
  VERDICT_MS: 9000,
  /** Der Jäger nimmt jemanden mit */
  HUNTER_MS: 20000,
  OVER_MS: 8000,
  /** Mindestdauer der Nacht, auch wenn alle schon fertig sind (sonst wirkt es hektisch) */
  NIGHT_MIN_MS: 6000,
  /** Jäger erst ab so vielen Spielern */
  HUNTER_FROM: 8,
  /** Punkte */
  WIN_POINTS: 3,
  SURVIVE_POINTS: 1,
};

/** Diskussionszeit: 90 s + 10 s pro Spieler, zwischen 2 und 3 Minuten */
export const wolfDayMs = (players: number) => Math.max(120000, Math.min(180000, 90000 + players * 10000));

/** Werwölfe: etwa einer pro 4 Spieler (6 → 1, 7–10 → 2, 11–12 → 3) */
export const wolfCount = (players: number) => Math.max(1, Math.floor((players + 1) / 4));

export type WolfRole = 'wolf' | 'seherin' | 'hexe' | 'jaeger' | 'dorf';

export const WOLF_ROLES: Record<WolfRole, { name: string; plural: string; short: string; color: string; text: string }> = {
  wolf: {
    name: 'Werwolf',
    plural: 'Werwölfe',
    short: 'WOLF',
    color: '#a8342a',
    text: 'Nachts sucht ihr euch gemeinsam ein Opfer aus. Tagsüber: unschuldig gucken!',
  },
  seherin: {
    name: 'Seherin',
    plural: 'Seherinnen',
    short: 'SEHERIN',
    color: '#7b3fa8',
    text: 'Jede Nacht schaust du in eine Person hinein: Werwolf oder nicht?',
  },
  hexe: {
    name: 'Hexe',
    plural: 'Hexen',
    short: 'HEXE',
    color: '#2f7d32',
    text: 'Ein Heiltrank und ein Gifttrank – jeder einmal pro Spiel. Nachts nach den Wölfen.',
  },
  jaeger: {
    name: 'Jäger',
    plural: 'Jäger',
    short: 'JÄGER',
    color: '#8d5629',
    text: 'Stirbst du, nimmst du mit deinem letzten Schuss jemanden mit.',
  },
  dorf: {
    name: 'Urlauber',
    plural: 'Urlauber',
    short: 'URLAUBER',
    color: '#2d64a8',
    text: 'Du willst nur Urlaub machen. Finde die Werwölfe und wählt sie tagsüber raus!',
  },
};

export const isWolfTeam = (r: WolfRole) => r === 'wolf';

export type WolfSub = 'roles' | 'night' | 'witch' | 'dawn' | 'day' | 'vote' | 'verdict' | 'hunter' | 'over';

export type WolfCause = 'wolf' | 'poison' | 'lynch' | 'hunter' | 'left';

export const WOLF_CAUSE_TEXT: Record<WolfCause, string> = {
  wolf: 'von Werwölfen geholt',
  poison: 'vergiftet',
  lynch: 'rausgewählt',
  hunter: 'vom Jäger erwischt',
  left: 'hat das Ferienhaus verlassen',
};

/** Öffentlich – geht an TV und alle Handys */
export interface WolfState {
  sub: WolfSub;
  /** Nummer der aktuellen Nacht/des Tages (1, 2, …) */
  day: number;
  endsIn: number;
  phaseNo: number;
  /** Diskussionszeit dieses Spiels (für die Zeitleiste) */
  dayMs: number;
  alive: Record<string, boolean>;
  /** Rollen der Toten (bei Tod aufgedeckt) */
  revealed: Record<string, WolfRole>;
  /** Welche Rollen insgesamt im Spiel sind (öffentlich, wie beim Kartenspiel) */
  roleCounts: Partial<Record<WolfRole, number>>;
  /** Todesfälle der letzten Nacht (dawn) bzw. der letzten Abstimmung/des Jägers */
  deaths: { id: string; cause: WolfCause }[];
  /** Nacht: wie viele schon fertig getippt haben (ohne Namen) */
  nightDone: number;
  nightTotal: number;
  /** Lustige Verdachts-Umfrage der Nacht (meistgenannter Name) */
  suspect: string | null;
  /** Abstimmung: wer schon abgestimmt hat (ohne Ziel) */
  voted: string[];
  /** Nach der Abstimmung: wer wen gewählt hat ('none' = niemand) */
  votes: Record<string, string> | null;
  lynched: string | null;
  /** Gleichstand → niemand */
  tie: boolean;
  /** Der Jäger, der gerade zielt */
  hunter: string | null;
  /** Kommt nach dem Jäger der Tag (true) oder die Nacht (false)? */
  hunterThenDay: boolean;
  /** Der Jäger hat geschossen (bzw. Zeit um): Ziel oder null = daneben */
  shotDone: boolean;
  shot: string | null;
  winner: 'dorf' | 'wolf' | null;
  winReason: string | null;
  /** Alle Rollen – erst am Spielende */
  roles: Record<string, WolfRole> | null;
}

/** Geheim – nur für den jeweiligen Spieler */
export interface WolfPrivate {
  role: WolfRole;
  alive: boolean;
  day: number;
  /** Werwölfe: die anderen Wölfe */
  partners: string[];
  /** Werwölfe: aktuelle Wahl des Rudels (Wolf → Ziel) */
  pack: Record<string, string>;
  /** Eigene Wahl in der Nacht (Opfer / Blick / Verdacht) */
  nightPick: string | null;
  /** Seherin: alle bisherigen Blicke */
  seen: { id: string; wolf: boolean }[];
  /** Hexe */
  heal: boolean;
  poison: boolean;
  /** Hexe in ihrer Phase: wer heute angegriffen wurde */
  victim: string | null;
  witchHealed: boolean;
  witchPoison: string | null;
  witchDone: boolean;
  /** Eigene Stimme am Tag */
  myVote: string | null;
  /** Tote sehen alle Rollen */
  allRoles: Record<string, WolfRole> | null;
}
