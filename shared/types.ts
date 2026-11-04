export interface Look {
  skin: number;
  hair: number;
  hairStyle: number;
  shirt: number;
  /** 0 = kein Bart */
  beard: number;
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

export type MiniKind =
  | 'flunky' | 'wwe' | 'sprint' | 'murder'
  | 'descent' | 'rhythm' | 'wrap' | 'stars'
  | 'nhie' | 'hilo' | 'bomb'
  | 'sup' | 'tidy' | 'fangen';

export type GameMode = 'party' | 'date' | 'drink';

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
  /** Trinkspiel-Variante: wer meistgewählt ist, trinkt */
  drinking: boolean;
  /** Schlücke dieser Runde (nur in "reveal") */
  sips: Record<string, number> | null;
}

// ------------------------------------------------------------------ Trinkspiel: Ich hab noch nie

export interface NhieState {
  round: number;
  rounds: number;
  statement: string;
  sub: 'question' | 'reveal' | 'over';
  endsIn: number;
  answered: string[];
  /** Wer es schon getan hat (nur in "reveal") */
  have: string[] | null;
  sips: Record<string, number>;
}

// ------------------------------------------------------------------ Trinkspiel: Höher oder Tiefer

export interface HiloState {
  round: number;
  rounds: number;
  sub: 'guess' | 'reveal' | 'over';
  endsIn: number;
  card: number;
  nextCard: number | null;
  guessed: string[];
  guesses: Record<string, 'higher' | 'lower'> | null;
  roundSips: Record<string, number> | null;
  sips: Record<string, number>;
}

// ------------------------------------------------------------------ Trinkspiel: Tick-Tack-Bumm

export interface BombState {
  round: number;
  rounds: number;
  sub: 'pass' | 'boom' | 'over';
  category: string;
  holder: string;
  passes: number;
  passSeq: number;
  sips: Record<string, number>;
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

// ------------------------------------------------------------------ Date Night: Abstieg

export interface DescentRunner {
  s: number;
  /** Restliche Sprungzeit in ms (0 = am Boden) */
  jumpLeft: number;
  stunned: boolean;
  hits: number;
  finished: boolean;
}

export interface DescentState {
  sub: 'countdown' | 'run' | 'over';
  endsIn: number;
  length: number;
  runners: Record<string, DescentRunner>;
  stones: { id: number; s: number }[];
  obstacles: { s: number; type: 'bottle' | 'pigeon' | 'puddle' }[];
}

// ------------------------------------------------------------------ Date Night: Gespräch (Rhythmus)

export interface RhythmNote {
  t: number;
  lane: 0 | 1;
}

export interface RhythmState {
  sub: 'ready' | 'play' | 'over';
  /** Wer schon bereit ist (Audio entsperrt) */
  ready: string[];
  playSeq: number;
  bpm: number;
  leadIn: number;
  duration: number;
  charts: Record<string, RhythmNote[]>;
  /** Abschnitte: wer gerade "redet" */
  phrases: { from: number; to: number; speaker: string; topic: string }[];
  score: Record<string, number>;
  combo: Record<string, number>;
  lastHit: Record<string, { q: 0 | 1 | 2; seq: number }>;
  sympathy: number;
}

// ------------------------------------------------------------------ Date Night: Wrap

export interface WrapPlayer {
  step: number;
  mistakes: number;
  done: boolean;
  doneMs: number | null;
  /** Reihenfolge der Zutaten auf dem Rad */
  wheel: string[];
  speed: number;
  lastGrab: { item: string; ok: boolean; seq: number } | null;
}

export interface WrapState {
  sub: 'build' | 'over';
  endsIn: number;
  recipe: string[];
  players: Record<string, WrapPlayer>;
  /** Für wen baut wer? */
  forWhom: Record<string, string>;
}

// ------------------------------------------------------------------ Date Night: Sternbilder

export interface StarsState {
  sub: 'draw' | 'done' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  name: string;
  hint: string;
  stars: { id: number; x: number; y: number; big: boolean }[];
  edges: [number, number][];
  found: [number, number][];
  /** Anzahl Linien im aktuellen Sternbild */
  edgeTotal: number;
  wrong: number;
  completed: number;
  lastWrong: { a: number; b: number; seq: number } | null;
}

// ------------------------------------------------------------------ Controller-Spiele: SUP

export interface SupBoard {
  id: number;
  /** Mitglieder: [links, rechts] – bei Solo dieselbe ID zweimal */
  left: string;
  right: string;
  x: number;
  y: number;
  heading: number;
  balance: number;
  fallen: boolean;
  finished: boolean;
  finishMs: number | null;
  strokes: { left: number; right: number };
  color: number;
}

export interface SupState {
  sub: 'countdown' | 'race' | 'over';
  endsIn: number;
  length: number;
  boards: SupBoard[];
  obstacles: { x: number; y: number; r: number; type: 'buoy' | 'rock' | 'jelly' }[];
}

// ------------------------------------------------------------------ Controller-Spiele: Aufräumen

export interface TidyPlayer {
  x: number;
  y: number;
  team: Team;
  /** Blickrichtung (für die Figur) */
  dir: 1 | -1;
  moving: boolean;
  dashLeft: number;
}

export interface TidyState {
  sub: 'countdown' | 'play' | 'over';
  endsIn: number;
  players: Record<string, TidyPlayer>;
  items: { id: number; x: number; y: number; type: string }[];
  baskets: { team: Team; x: number; y: number; r: number }[];
  score: Record<Team, number>;
  /** Kurzer Jubel, wenn ein Teil im Korb landet */
  lastScore: { team: Team; type: string; seq: number } | null;
}

// ------------------------------------------------------------------ Controller-Spiele: Urlaubs-Fangen

export interface FangenHunter {
  x: number;
  y: number;
  dir: 1 | -1;
  moving: boolean;
  /** Restliche Abklingzeit des Sprints in ms */
  sprintLeft: number;
  sprinting: boolean;
  /** Fährte: 0 = kalt, 1 = lau, 2 = warm, 3 = heiß */
  heat: 0 | 1 | 2 | 3;
}

/** Kurz sichtbare Fußspur – echte und falsche (Ablenkung) sehen gleich aus */
export interface FangenPrint {
  id: number;
  x: number;
  y: number;
  angle: number;
  /** Restliche Sichtbarkeit in ms */
  ttl: number;
}

export interface FangenOutcome {
  runner: string;
  caught: boolean;
  by: string | null;
  survivedMs: number;
  /** Wo der Flüchtling am Ende war (erst nach der Runde öffentlich) */
  x: number;
  y: number;
}

export interface FangenState {
  sub: 'intro' | 'chase' | 'roundEnd' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  /** Wer gerade Flüchtling ist (die Position bleibt geheim!) */
  runner: string;
  hunters: Record<string, FangenHunter>;
  prints: FangenPrint[];
  points: Record<string, number>;
  /** Nur in "roundEnd" / "over" */
  outcome: FangenOutcome | null;
}

/** Nur an den Flüchtling: die eigene Position (die Fänger stehen öffentlich im GameState) */
export interface FangenPrivate {
  role: 'runner';
  x: number;
  y: number;
  dir: 1 | -1;
  decoyLeft: number;
  decoyActive: boolean;
}

// ------------------------------------------------------------------ Date Night: Ablauf

export interface DateCard {
  title: string;
  text: string;
  kicker: string;
  final: boolean;
}

export interface DateRunState {
  version: string;
  versionTitle: string;
  chapter: number;
  chapters: { title: string; kind: MiniKind }[];
  hearts: (number | null)[];
  totalHearts: number;
  maxHearts: number;
  card: DateCard | null;
  /** A und B: die beiden Date-Spieler */
  couple: [string, string];
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
  /** Nur im Trinkspiel: Schlücke dieser Runde */
  sips?: Record<string, number>;
  /** Nur bei Date Night: gemeinsam verdiente Herzen */
  hearts?: number;
  maxHearts?: number;
}

// ------------------------------------------------------------------ Gesamtzustand

export type Phase = 'lobby' | 'board' | 'mini' | 'results' | 'story';

export type MiniSnapshot =
  | { kind: 'flunky'; state: FlunkyState }
  | { kind: 'wwe'; state: WweState }
  | { kind: 'sprint'; state: SprintState }
  | { kind: 'murder'; state: MurderState }
  | { kind: 'descent'; state: DescentState }
  | { kind: 'rhythm'; state: RhythmState }
  | { kind: 'wrap'; state: WrapState }
  | { kind: 'stars'; state: StarsState }
  | { kind: 'nhie'; state: NhieState }
  | { kind: 'hilo'; state: HiloState }
  | { kind: 'bomb'; state: BombState }
  | { kind: 'sup'; state: SupState }
  | { kind: 'tidy'; state: TidyState }
  | { kind: 'fangen'; state: FangenState };

export interface GameState {
  phase: Phase;
  players: PlayerPublic[];
  joinUrl: string;
  partyActive: boolean;
  /** Im Lobby-Menü gewählter Spielmodus */
  mode: GameMode;
  date: DateRunState | null;
  /** Trinkspiel läuft */
  drinkActive: boolean;
  customNhieCount: number;
  botCount: number;
  board: BoardState | null;
  mini: MiniSnapshot | null;
  results: ResultsState | null;
  customQuestionCount: number;
}

export type PrivateState = { kind: 'murder'; state: MurderPrivate } | { kind: 'fangen'; state: FangenPrivate } | null;

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
  mode: 'party' | 'date' | 'drink' | MiniKind;
  rounds?: number;
  version?: string;
}
