import Phaser from 'phaser';
import { io } from 'socket.io-client';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LobbyScene } from './LobbyScene';
import { FlunkyScene } from './FlunkyScene';
import { getState, setState } from './store';

const SCENE_FOR_PHASE: Record<GameState['phase'], string> = {
  lobby: 'lobby',
  flunky: 'flunky',
};

async function start() {
  // Pixel-Font laden, bevor Phaser Texte rendert (sonst Fallback-Font)
  await Promise.race([
    document.fonts.load('8px "Press Start 2P"'),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => undefined);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: WORLD.W,
    height: WORLD.H,
    pixelArt: true,
    backgroundColor: '#1d2b53',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [LobbyScene, FlunkyScene],
  });

  const socket = io();
  socket.on('connect', () => socket.emit('host:hello'));
  socket.on('state', (s: GameState) => {
    const prevPhase = getState()?.phase;
    setState(s);
    if (prevPhase !== s.phase) {
      for (const sc of game.scene.getScenes(true)) game.scene.stop(sc.scene.key);
      game.scene.start(SCENE_FOR_PHASE[s.phase]);
    }
  });
}

start();
