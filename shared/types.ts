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

export type Phase = 'lobby' | 'flunky';

export interface GameState {
  phase: Phase;
  players: PlayerPublic[];
  flunky: FlunkyState | null;
  joinUrl: string;
}

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
