import type { PropType } from './verstecken';

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
  | 'sup' | 'tidy'
  | 'flieger' | 'kurve' | 'arena'
  | 'bowling'
  | 'sup' | 'tidy' | 'enten'
  | 'sup' | 'tidy' | 'ttt'
  | 'verstecken'
  | 'sup' | 'tidy' | 'parcours'
  | 'sup' | 'tidy' | 'kart'
  | 'sup' | 'tidy' | 'turm'
  | 'sup' | 'tidy' | 'igel';

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

// ------------------------------------------------------------------ Urlaubsflieger

export type FliegerControlType = 'button' | 'toggle' | 'switch' | 'tap';

/** Ein Bedienelement im Cockpit eines Spielers */
export interface FliegerControl {
  id: string;
  name: string;
  type: FliegerControlType;
  /** Beschriftung der Stellungen (Schalter: z. B. Aus / Mild / Tropisch, Kippschalter: AUS / AN) */
  labels: string[];
  /** Aktuelle Stellung (Kippschalter 0/1, Schalter Index) */
  value: number;
}

export interface FliegerState {
  /** intro = neues Cockpit ansehen, fly = Anweisungen, cleared = Zwischenlandung */
  sub: 'intro' | 'fly' | 'cleared' | 'crash' | 'arrived';
  endsIn: number;
  /** Aktuelle Etappe (0-basiert): von route[stage] nach route[stage + 1] */
  stage: number;
  route: string[];
  progress: number;
  target: number;
  /** Treibstoff 0–100 */
  fuel: number;
  /** Ausgeführte Anweisungen pro Spieler */
  done: Record<string, number>;
  /** Laufschrift auf dem TV (nur erledigte Aktionen, nie offene Anweisungen) */
  ticker: { text: string; ok: boolean; seq: number } | null;
  okCount: number;
  missCount: number;
}

/** Nur an den jeweiligen Spieler geschickt */
export interface FliegerPrivate {
  panel: FliegerControl[];
  order: { text: string; endsIn: number; totalMs: number; seq: number; taps: string | null } | null;
  feedback: { ok: boolean; text: string; seq: number } | null;
  /** Nur für Bots: was auf dem eigenen Panel gerade gebraucht wird */
  botHints?: { c: string; v: number; taps: number }[];
}

// ------------------------------------------------------------------ Controller-Spiele: Kurven-Duell

export type KurvePower = 'turbo' | 'slow' | 'wrap';

export interface KurveHead {
  x: number;
  y: number;
  /** Fahrtrichtung in Radiant */
  a: number;
  /** aktuelle Geschwindigkeit (px/s) – zum Glätten auf dem TV */
  v: number;
  alive: boolean;
  /** Index in KURVE.COLORS */
  color: number;
  score: number;
  /** Gerade in einer Lücke (Kopf zieht keine Spur) */
  gap: boolean;
  /** Aktive Power-ups (bei 'slow': man wird gerade ausgebremst) */
  fx: KurvePower[];
  /**
   * Nur das Ende der Spur (die letzten KURVE.TAIL Punkte), flach als [x, y, pen, x, y, pen, …].
   * pen = 1: Linie vom vorigen Punkt bis hierher zeichnen, 0 = Lücke/Sprung.
   * trailStart = Index des ersten Punkts im Gesamtverlauf dieser Runde – TV und Bots hängen daran an.
   */
  trailStart: number;
  trail: number[];
}

export interface KurveState {
  sub: 'countdown' | 'play' | 'roundEnd' | 'over';
  round: number;
  rounds: number;
  endsIn: number;
  /** Sturm: Runde dauert schon lange → alle werden schneller */
  storm: boolean;
  players: Record<string, KurveHead>;
  powerups: { id: number; x: number; y: number; type: KurvePower }[];
  /** Ausgeschiedene dieser Runde (für Effekte auf dem TV) */
  deaths: { id: string; x: number; y: number; seq: number }[];
  pickup: { id: string; type: KurvePower; x: number; y: number; seq: number } | null;
  roundWinner: string | null;
}

// ------------------------------------------------------------------ Controller-Spiele: Bomben-Arena

export interface ArenaPlayer {
  /** Position in Kacheln (Mitte einer Kachel = ganze Zahl) */
  x: number;
  y: number;
  alive: boolean;
  dir: 'u' | 'd' | 'l' | 'r';
  moving: boolean;
  /** Power-ups: max. gleichzeitige Bomben, Reichweite, Tempo-Stufe */
  bombs: number;
  range: number;
  speed: number;
  wins: number;
  kills: number;
}

export interface ArenaState {
  sub: 'countdown' | 'play' | 'roundOver' | 'over';
  /** countdown: bis zum Start · play: bis zur Flut (0 = Flut läuft) · roundOver: bis zur nächsten Runde */
  endsIn: number;
  round: number;
  winRounds: number;
  /** COLS × ROWS Zeichen, siehe ArenaCell in shared/arena.ts */
  grid: string;
  /** Anzahl bereits gefluteter Zellen (Index in FLOOD_ORDER) */
  flood: number;
  floodActive: boolean;
  bombs: { id: number; x: number; y: number; fuse: number; owner: string; range: number }[];
  flames: { x: number; y: number; k: 'c' | 'h' | 'v' }[];
  items: { x: number; y: number; t: 'bomb' | 'range' | 'speed' }[];
  players: Record<string, ArenaPlayer>;
  /** Nur in roundOver/over: Rundensieger (null = Unentschieden) */
  roundWinner: string | null;
}

// ------------------------------------------------------------------ Controller-Spiele: Bowling

/** Aufzeichnung eines Wurfs (cm, ganzzahlig), damit der TV ihn abspielen kann */
export interface BowlingTrack {
  /** Sekunden zwischen zwei Keyframes */
  dt: number;
  frames: number;
  /** x0, y0, x1, y1, … pro Keyframe */
  ball: number[];
  /** pro Pin: null = stand nicht, [x, y] = blieb liegen/stehen, sonst x, y pro Keyframe */
  pins: (number[] | null)[];
  /** Keyframe, ab dem der Pin umfällt (−1 = bleibt stehen) */
  downAt: number[];
  /** Keyframe, in dem der Ball in die Rinne fällt (−1 = nie) */
  gutterAt: number;
}

export type BowlingMark = 'strike' | 'spare' | 'gutter' | 'miss' | 'pins';

export interface BowlingRoll {
  seq: number;
  playerId: string;
  /** nur während des Abspielens (sub = 'roll') – spart Bandbreite */
  track: BowlingTrack | null;
  knocked: number;
  mark: BowlingMark;
  /** Strikes in Folge (für "Doppel!" / "Truthahn!") */
  streak: number;
}

export interface BowlingState {
  sub: 'intro' | 'aim' | 'roll' | 'over';
  endsIn: number;
  /** Anzahl Frames in diesem Spiel */
  frames: number;
  order: string[];
  turn: string;
  /** aktueller Frame (0-basiert) und Wurf im Frame */
  frame: number;
  ball: number;
  /** zählt bei jedem neuen Zielen hoch */
  aimSeq: number;
  /** Startposition, die der Werfer gerade einstellt (−1 … 1) */
  aimX: number;
  /** stehende Pins vor dem nächsten Wurf */
  rack: boolean[];
  rolls: Record<string, number[]>;
  last: BowlingRoll | null;
}

// ------------------------------------------------------------------ Controller-Spiele: Ententeich

/** duck/gull/flamingo = Vögel (Punkte), float = Badegast/Schwimmring (Strafe!) */
export type EntenKind = 'duck' | 'gull' | 'flamingo' | 'float';

export interface EntenTarget {
  id: number;
  kind: EntenKind;
  /** Optik-Variante (z. B. Badegast auf Quietscheente vs. Schwimmring) */
  look: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** fly = unterwegs, down = getroffen (fällt), escape = fliegt davon, hit = Badegast wurde getroffen (kurz) */
  st: 'fly' | 'down' | 'escape' | 'hit';
}

export interface EntenPlayer {
  /** Fadenkreuz in Weltkoordinaten */
  x: number;
  y: number;
  ammo: number;
  reloading: boolean;
  score: number;
  hits: number;
  shots: number;
  combo: number;
  /** Farbe des Fadenkreuzes (0xRRGGBB) */
  color: number;
}

export interface EntenShot {
  seq: number;
  pid: string;
  x: number;
  y: number;
  /** Was getroffen wurde (null = daneben) */
  kind: EntenKind | null;
  tid: number | null;
  pts: number;
  combo: number;
}

export interface EntenState {
  sub: 'intro' | 'banner' | 'play' | 'over';
  /** 1-basiert; im Intro 0 */
  wave: number;
  waves: number;
  waveName: string;
  endsIn: number;
  targets: EntenTarget[];
  players: Record<string, EntenPlayer>;
  /** Die letzten Schüsse (für Mündungsfeuer, Federn, Punkte-Popups) */
  shots: EntenShot[];
  /** Zählt hoch, wenn die Strandkrabbe lacht (Vogel entkommen / Badegast getroffen) */
  laughSeq: number;
}

// ------------------------------------------------------------------ Verräter im Ferienhaus

export type TttRole = 'innocent' | 'traitor' | 'detective';
export type TttWeapon = 'pistol' | 'coconut';
export type TttItemKind = TttWeapon | 'medkit';
export type TttShopItem = 'trap' | 'cloak' | 'radio';

/** Öffentlich sichtbare Spielerinfo (unsichtbare Spieler fehlen ganz) */
export interface TttPlayerPub {
  x: number;
  y: number;
  /** Blickrichtung für die Figur */
  dir: 1 | -1;
  moving: boolean;
  hp: number;
  weapon: TttWeapon | null;
  /** Kurz betäubt (z. B. nach der Falle) */
  stunned: boolean;
}

export interface TttAttack {
  seq: number;
  /** null = unsichtbarer Angreifer */
  by: string | null;
  kind: 'noodle' | TttWeapon;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  target: string | null;
  /** Ziel wurde dadurch ausgeknockt */
  ko: boolean;
}

export interface TttBody {
  id: string;
  x: number;
  y: number;
  /** Rolle erst nach dem Untersuchen sichtbar */
  role: TttRole | null;
  inspectedBy: string | null;
}

export interface TttRoundResult {
  round: number;
  winner: 'innocent' | 'traitor';
  reason: string;
  traitors: string[];
  /** Punkte dieser Runde */
  points: Record<string, number>;
}

export interface TttState {
  sub: 'roles' | 'play' | 'roundEnd' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  players: Record<string, TttPlayerPub>;
  alive: Record<string, boolean>;
  detective: string | null;
  traitorCount: number;
  bodies: TttBody[];
  items: { id: number; kind: TttItemKind; x: number; y: number }[];
  attacks: TttAttack[];
  /** Laufschrift auf dem TV: Funksprüche, Untersuchungen, Spuren */
  feed: { seq: number; text: string; tone: 'info' | 'radio' | 'clue' | 'alert' }[];
  /** Ausgelöste Fallen (nur zur Animation) */
  traps: { seq: number; x: number; y: number }[];
  scores: Record<string, number>;
  /** Erst am Rundenende gefüllt – während der Runde bleibt alles geheim */
  last: TttRoundResult | null;
  roles: Record<string, TttRole> | null;
}

/** Nur an den jeweiligen Spieler */
export interface TttPrivate {
  role: TttRole;
  /** Eigene Position (auch wenn man gerade unsichtbar ist) */
  x: number;
  y: number;
  partners: string[];
  alive: boolean;
  hp: number;
  weapon: TttWeapon | null;
  ammo: number;
  credits: number;
  /** Was liegt in Reichweite für "Benutzen"? */
  near: string | null;
  cloakLeft: number;
  attackReady: boolean;
  /** Steht in einer Tür (für die Falle) */
  inDoor: boolean;
  info: { seq: number; text: string } | null;
}

// ------------------------------------------------------------------ Versteckspiel mit Möbeln

/** Ein Möbelstück auf dem TV – echte Möbel und verkleidete Spieler sehen gleich aus. */
export interface VsObject {
  /** Zufällige ID pro Runde (verrät nichts) */
  o: number;
  t: PropType;
  v: number;
  x: number;
  y: number;
  /** gespiegelt */
  f: boolean;
}

export interface VsAvatar {
  x: number;
  y: number;
  dir: 1 | -1;
  moving: boolean;
  stunned: boolean;
}

export interface VsCheck {
  seq: number;
  by: string;
  x: number;
  y: number;
  ok: boolean;
  /** Bei Erfolg: wer gefunden wurde */
  found: string | null;
}

export interface VsWhistle {
  seq: number;
  /** ungefähre Position (verwackelt) */
  x: number;
  y: number;
  zone: number;
  forced: boolean;
}

export interface VerstState {
  sub: 'intro' | 'hide' | 'seek' | 'reveal' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  seekers: string[];
  hiders: string[];
  /** In dieser Runde gefundene Verstecker (Reihenfolge) */
  found: string[];
  objects: VsObject[];
  /** Sichtbare Figuren: Sucher + noch unverkleidete Verstecker */
  avatars: Record<string, VsAvatar>;
  checks: VsCheck[];
  whistles: VsWhistle[];
  scores: Record<string, number>;
  /** Nur in "reveal": wer welches Möbel war */
  reveal: { id: string; x: number; y: number; t: PropType }[] | null;
  /** Wer die Runde gewonnen hat (nur reveal/over) */
  winner: 'seekers' | 'hiders' | null;
}

export interface VerstPrivate {
  role: 'seeker' | 'hider';
  found: boolean;
  foundBy: string | null;
  disguise: { t: PropType; v: number } | null;
  locked: boolean;
  /** Eigene Position (für die eigene Anzeige/Bots) */
  x: number;
  y: number;
  zone: number;
  hint: string;
  hintLevel: 'ok' | 'warn' | 'bad';
  /** Möbel in Reichweite zum Verwandeln */
  canMorph: boolean;
  whistleIn: number;
  stunIn: number;
  score: number;
  finds: number;
  note: { text: string; seq: number } | null;
}

// ------------------------------------------------------------------ Controller-Spiele: Fallen-Parcours

export interface ParcoursRunner {
  x: number;
  y: number;
  face: 1 | -1;
  /** run = läuft, dead = raus, goal = im Ziel */
  st: 'run' | 'dead' | 'goal';
  ground: boolean;
  /** Wer hat mich erwischt? (Besitzer des Teils) */
  by: string | null;
  /** Ziel-Platz (1 = Erster) */
  place: number | null;
}

export interface ParcoursBuilder {
  stage: 'pick' | 'place' | 'done';
  choice: import('./parcours').PartType[];
  pick: import('./parcours').PartType | null;
  gx: number;
  gy: number;
  rot: number;
  ok: boolean;
}

export interface ParcoursGain {
  goal: number;
  first: number;
  traps: number;
}

export interface ParcoursState {
  sub: 'intro' | 'build' | 'countdown' | 'run' | 'score' | 'over';
  endsIn: number;
  round: number;
  rounds: number;
  target: number;
  /** Teile ändern sich selten – rev zählt hoch, damit das TV nur dann neu baut */
  parts: import('./parcours').ParcoursPart[];
  partsRev: number;
  /** Laufzeit (ms) für Schwebeplattformen */
  t: number;
  nuts: { id: number; x: number; y: number }[];
  runners: Record<string, ParcoursRunner>;
  builders: Record<string, ParcoursBuilder>;
  /** Farbindex pro Spieler */
  colors: Record<string, number>;
  points: Record<string, number>;
  /** Ergebnis der letzten Runde */
  last: { verdict: 'ok' | 'easy' | 'hard'; gains: Record<string, ParcoursGain> } | null;
  /** Effekte fürs TV (Explosion, KO, Ziel) */
  fx: { seq: number; kind: 'boom' | 'ko' | 'goal' | 'place'; x: number; y: number; who: string | null }[];
}

// ------------------------------------------------------------------ Controller-Spiele: Kart-Rennen

export type KartItem = 'coconut' | 'banana' | 'ice' | 'gull';

export interface KartCar {
  x: number;
  y: number;
  angle: number;
  /** Aktuelle Lenkung (−1…1) – nur für die Optik */
  steer: number;
  /** 0 = noch vor der Startlinie, 1…LAPS = laufende Runde */
  lap: number;
  place: number;
  finished: boolean;
  finishMs: number | null;
  item: KartItem | null;
  /** > 0: dreht sich gerade (Rest in ms) */
  spin: number;
  boost: boolean;
  /** −1/1 = driftet nach links/rechts, 0 = nein; 2 = Mini-Turbo geladen */
  drift: number;
  charged: boolean;
  offroad: boolean;
}

export interface KartEvent {
  seq: number;
  kind: 'hit' | 'gull' | 'item' | 'finish' | 'turbo';
  who: string;
  /** z. B. Verursacher */
  by: string | null;
  text: string;
}

export interface KartState {
  sub: 'countdown' | 'race' | 'over';
  /** Countdown bzw. Restzeit nach dem Sieger (sonst Notbremse) */
  endsIn: number;
  closing: boolean;
  track: number;
  laps: number;
  karts: Record<string, KartCar>;
  boxes: { x: number; y: number; on: boolean }[];
  hazards: { id: number; kind: 'banana' | 'coconut'; x: number; y: number }[];
  gulls: { id: number; x: number; y: number; target: string; from: string }[];
  finishOrder: string[];
  events: KartEvent[];
}

// ------------------------------------------------------------------ Wackelturm

/** Das gerade fallende (gesteuerte) Teil. x/y: Schwerpunkt, y = Höhe über der Plattform (nach oben). */
export interface TurmActive {
  id: number;
  shape: number;
  /** Farbvariante 0–2 */
  v: number;
  x: number;
  y: number;
  /** Anzahl 90°-Drehungen im Uhrzeigersinn */
  rot: number;
}

export interface TurmLane {
  id: string;
  lives: number;
  /** Aktuelle stabile Turmhöhe in Physik-Einheiten */
  height: number;
  /** Bisher beste stabile Höhe */
  best: number;
  /** Platzierung, sobald der Gipfel erreicht ist (1, 2, …), sonst 0 */
  place: number;
  finishMs: number | null;
  /** Keine Leben mehr → Turm eingefroren */
  frozen: boolean;
  /** Fortschritt des "Halten!"-Countdowns über der Ziellinie (0–1) */
  hold: number;
  /** Vorschau: nächstes Teil [Form, Variante] */
  next: [number, number];
  active: TurmActive | null;
  /** Liegende Teile, flach: [id, Form, Variante, x, y, Winkel·100, …] (y nach oben, Winkel im Uhrzeigersinn) */
  pieces: number[];
  /** Windböe: Richtung (−1/1) oder 0 */
  gust: number;
  /** Zählt hoch, wenn ein Teil verloren ging (für Effekte) */
  lostSeq: number;
}

export interface TurmState {
  sub: 'countdown' | 'play' | 'over';
  endsIn: number;
  /** Ms bis zur nächsten Windböe (nur Anzeige) */
  gustIn: number;
  lanes: TurmLane[];
}

// ------------------------------------------------------------------ Controller-Spiele: Igel-Krieg

export type IgelWeapon = 'bazooka' | 'grenade' | 'teleport' | 'punch';

export interface IgelHog {
  id: number;
  owner: string;
  x: number;
  y: number;
  hp: number;
  dir: 1 | -1;
  /** ok = im Spiel, dead = Sandburg-Grabstein, drowned = treibt auf dem Schwimmring davon */
  state: 'ok' | 'dead' | 'drowned';
  flying: boolean;
  walking: boolean;
}

export interface IgelFx {
  seq: number;
  type: 'boom' | 'dmg' | 'splash' | 'pow' | 'tele' | 'ko' | 'water';
  x: number;
  y: number;
  r?: number;
  text?: string;
}

export interface IgelState {
  /** countdown → aim (Zug) → flight (Geschoss unterwegs) → retreat (Rückzug) → settle → aim … → over */
  sub: 'countdown' | 'aim' | 'flight' | 'retreat' | 'settle' | 'over';
  endsIn: number;
  /** Terrain = genTerrain(seed) + alle Krater in Reihenfolge */
  seed: number;
  craters: [number, number, number][];
  water: number;
  /** −1 … 1, positiv = nach rechts */
  wind: number;
  /** Spieler-IDs in Zugreihenfolge (jeder Spieler = ein Team) */
  teams: string[];
  hogs: IgelHog[];
  turn: number;
  active: string | null;
  activeHog: number | null;
  next: string | null;
  weapon: IgelWeapon;
  /** Restmunition pro Spieler, −1 = unbegrenzt */
  ammo: Record<string, Record<IgelWeapon, number>>;
  /** Live-Zielvorschau des aktiven Spielers (für die Ziellinie am TV) */
  aim: { angle: number; power: number } | null;
  projs: { id: number; type: 'bazooka' | 'grenade'; x: number; y: number }[];
  fx: IgelFx[];
  suddenDeath: boolean;
  /** ms bis Sudden Death (0 = läuft schon) */
  suddenIn: number;
  damage: Record<string, number>;
  /** Ausgeschiedene Spieler in Reihenfolge */
  out: string[];
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
  | { kind: 'flieger'; state: FliegerState }
  | { kind: 'kurve'; state: KurveState }
  | { kind: 'arena'; state: ArenaState }
  | { kind: 'bowling'; state: BowlingState }
  | { kind: 'enten'; state: EntenState }
  | { kind: 'ttt'; state: TttState }
  | { kind: 'verstecken'; state: VerstState }
  | { kind: 'parcours'; state: ParcoursState }
  | { kind: 'kart'; state: KartState }
  | { kind: 'turm'; state: TurmState }
  | { kind: 'igel'; state: IgelState };

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

export type PrivateState =
  | { kind: 'murder'; state: MurderPrivate }
  | { kind: 'flieger'; state: FliegerPrivate }
  | { kind: 'ttt'; state: TttPrivate }
  | { kind: 'verstecken'; state: VerstPrivate }
  | null;

export interface JoinRequest {
  name: string;
  look: Look;
  playerId?: string;
  /** Testspieler (Bots) melden sich so an – manche Spiele geben ihnen Hinweise */
  bot?: boolean;
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
