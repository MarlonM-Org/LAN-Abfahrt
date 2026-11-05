import Phaser from 'phaser';
import type { GameLive, GameMeta, GameState, PlayerPublic } from '../../shared/types';

/** Zentrale Ablage für den letzten Server-Zustand + Event-Bus für die Szenen. */
export const bus = new Phaser.Events.EventEmitter();

let current: GameState | null = null;
let meta: GameMeta | null = null;
let live: GameLive | null = null;
let metaAt = performance.now();

export const getState = () => current;
export const setState = (s: GameState) => {
  const prev = current;
  current = s;
  bus.emit('state', s, prev);
};

/**
 * Der Server schickt `meta` (Spieler, Leaderboards, Zähler – nur bei Änderung) und `state`
 * (laufendes Spiel, bis 25/s) getrennt. Hier wird daraus wieder der gewohnte GameState,
 * damit alle Szenen weiter `getState().players` usw. lesen können. null, solange eins fehlt.
 */
export const mergeMeta = (m: GameMeta): GameState | null => {
  meta = m;
  metaAt = performance.now();
  return live ? { ...m, ...live } : null;
};
export const mergeLive = (l: GameLive): GameState | null => {
  live = l;
  return meta ? { ...meta, ...l } : null;
};
/** performance.now() beim letzten `meta` – „offline seit …“ (offlineMs) zählt ab da weiter */
export const metaReceivedAt = () => metaAt;

export const playerById = (id: string | null | undefined): PlayerPublic | undefined =>
  id ? current?.players.find((p) => p.id === id) : undefined;

export const FONT = '"Press Start 2P", monospace';
