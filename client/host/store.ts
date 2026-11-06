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
/**
 * Läuft diese TV-Seite über den Online-Tunnel (TV bei Freunden)? Dann zeigt der QR-Code die eigene Adresse –
 * die Heimnetz-Adresse aus `joinUrl` erreicht von dort niemand.
 */
let viaTunnel = false;
export const setViaTunnel = (v: boolean) => {
  if (v === viaTunnel) return;
  viaTunnel = v;
  if (current) bus.emit('state', current, current);
};
export const joinUrlOf = (s: GameState) => (viaTunnel ? `${location.origin}/` : s.joinUrl);

/** Läuft diese TV-Seite direkt am Laptop (Laptop-Steuerung aktiv)? Dann zeigen Szenen Tasten-Hinweise (Enter = weiter). */
let atLaptop = false;
export const setAtLaptop = (v: boolean) => {
  if (v === atLaptop) return;
  atLaptop = v;
  if (current) bus.emit('state', current, current);
};
export const isAtLaptop = () => atLaptop;

/** performance.now() beim letzten `meta` – „offline seit …“ (offlineMs) zählt ab da weiter */
export const metaReceivedAt = () => metaAt;

export const playerById = (id: string | null | undefined): PlayerPublic | undefined =>
  id ? current?.players.find((p) => p.id === id) : undefined;

export const FONT = '"Press Start 2P", monospace';

/** Socket der TV-Seite (für Rückmeldungen an das laufende Minispiel, `host:mini`) */
let hostSocket: { emit(ev: string, ...args: unknown[]): unknown } | null = null;
export const setHostSocket = (s: { emit(ev: string, ...args: unknown[]): unknown }) => {
  hostSocket = s;
};
/** TV → laufendes Minispiel (z. B. Guess the Song: Ton geladen / kaputt) */
export const hostMini = (action: string, payload?: unknown) => hostSocket?.emit('host:mini', action, payload);
