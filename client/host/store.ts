import Phaser from 'phaser';
import type { GameState, PlayerPublic } from '../../shared/types';

/** Zentrale Ablage für den letzten Server-Zustand + Event-Bus für die Szenen. */
export const bus = new Phaser.Events.EventEmitter();

let current: GameState | null = null;

export const getState = () => current;
export const setState = (s: GameState) => {
  const prev = current;
  current = s;
  bus.emit('state', s, prev);
};

export const playerById = (id: string | null | undefined): PlayerPublic | undefined =>
  id ? current?.players.find((p) => p.id === id) : undefined;

export const FONT = '"Press Start 2P", monospace';
