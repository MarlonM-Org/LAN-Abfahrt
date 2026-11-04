export interface Look {
  skin: number;
  hair: number;
  hairStyle: number;
  shirt: number;
}

export interface PlayerPublic {
  id: string;
  name: string;
  look: Look;
  connected: boolean;
  isVip: boolean;
}

export type Team = 'A' | 'B';

export interface Point {
  x: number;
  y: number;
}

export type MiniKind = 'flunky' | 'wwe' | 'sprint' | 'murder';

// ------------------------------------------------------------------ Flunkyball

export interface ThrowResult {
  seq: number;
  throwerId: string;
  team: Team;
  from: Point;
  to: Point;
  hit: boolean;
}

/** aim → flight → (chug → reset) → aim … → over */
export type FlunkySub = 'aim' | 'flight' | 'chug' | 'reset' | 'over';

export interface FlunkyState {
  teams: Record<Team, string[]>;
  /** Restbier pro Spieler, 100 = volle Flasche, 0 = ausgetrunken */
  beer: Record<string, number>;
  turnTeam: Team;
  throwerId: string;
  sub: FlunkySub;
  /** -1 … 1, positiv = Wind treibt nach rechts */
  wind: number;
  runnerId: string | null;
  runProgress: number;
  winner: Team | null;
  lastThrow: ThrowResult | null;
}

// ------------------------------------------------------------------ Wer würde eher …?

export interface WweState {
  round: number;
  rounds: number;
  question: string;
  sub: 'question' | 'reveal' | 'over';
  /** Restzeit in ms (zum Zeitpunkt des Snapshots) */
  endsIn: number;
  /** Wer schon abgestimmt hat (ohne Ziel – bleibt geheim bis zur Auflösung) */
  voted: string[];
  /** voter → gewählter Spieler, nur in "reveal" */
  votes: Record<string, string> | null;
  tally: Record<string, number> | null;
  points: Record<string, number>;
}

// ------------------------------------------------------------------ Liegestuhl-Sprint

export interface SprintState {
  round: number;
  rounds: number;
  /** wait = Nacht (nicht tippen!), go = JETZT, reveal = Rundenergebnis */
  sub: 'wait' | 'go' | 'reveal' | 'over';
  goSeq: number;
  /** Reaktionszeit in ms, 'early' = Fehlstart, null = (noch) nicht getippt */
  times: Record<string, number | 'early' | null>;
  points: Record<string, number>;
}

// ------------------------------------------------------------------ Mord im Ferienhaus

export type MurderSub = 'roles' | 'tasks' | 'meeting' | 'vote' | 'ejected' | 'over';

export interface MurderState {
  sub: MurderSub;
  endsIn: number;
  phaseNo: number;
  alive: Record<string, boolean>;
  /** Anzahl lebender Spieler pro Raum (ohne Namen!) */
  roomCounts: number[];
  taskProgress: number;
  taskTarget: number;
  /** Tote, die in dieser Besprechung bekannt gegeben werden */
  deaths: string[];
  reporter: string | null;
  voted: string[];
  voteTally: Record<string, number> | null;
  ejected: string | null;
  ejectedWasMurderer: boolean | null;
  winner: 'murderer' | 'urlauber' | null;
  winReason: string | null;
  /** Erst bei "over" sichtbar */
  murderers: string[] | null;
  /** Zählt hoch, wenn irgendwo ein Schrei zu hören ist */
  screamSeq: number;
}

/** Nur an den jeweiligen Spieler geschickt */
export interface MurderPrivate {
  role: 'murderer' | 'urlauber';
  partners: string[];
  alive: boolean;
  room: number | null;
  taskTaps: number;
  doneRooms: number[];
  killTarget: string | null;
  bodyHere: boolean;
  myVote: string | null;
}

// ------------------------------------------------------------------ Spielbrett

export type FieldType = 'start' | 'blue' | 'red' | 'event';

export interface BoardRoll {
  seq: number;
  playerId: string;
  value: number;
  path: number[];
}

export interface BoardState {
  round: number;
  maxRounds: number;
  order: string[];
  turnIdx: number;
  sub: 'roll' | 'moving' | 'intro';
  pos: Record<string, number>;
  coins: Record<string, number>;
  cocktails: Record<string, number>;
  barField: number;
  lastRoll: BoardRoll | null;
  /** Ereignistext für TV + Handys */
  message: string;
  messageSeq: number;
  nextMini: MiniKind | null;
}

// ------------------------------------------------------------------ Ergebnisse

export interface ResultRow {
  playerId: string;
  place: number;
  detail: string;
  coins: number;
}

export interface ResultsState {
  title: string;
  subtitle: string;
  rows: ResultRow[];
  final: boolean;
}

// ------------------------------------------------------------------ Gesamtzustand

export type Phase = 'lobby' | 'board' | 'mini' | 'results';

export type MiniSnapshot =
  | { kind: 'flunky'; state: FlunkyState }
  | { kind: 'wwe'; state: WweState }
  | { kind: 'sprint'; state: SprintState }
  | { kind: 'murder'; state: MurderState };

export interface GameState {
  phase: Phase;
  players: PlayerPublic[];
  joinUrl: string;
  partyActive: boolean;
  board: BoardState | null;
  mini: MiniSnapshot | null;
  results: ResultsState | null;
  customQuestionCount: number;
}

export type PrivateState = { kind: 'murder'; state: MurderPrivate } | null;

export interface JoinRequest {
  name: string;
  look: Look;
  playerId?: string;
}

export interface JoinResponse {
  ok: boolean;
  playerId?: string;
  error?: string;
}

export interface StartRequest {
  mode: 'party' | MiniKind;
  rounds?: number;
}
