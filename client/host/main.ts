import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LobbyScene } from './LobbyScene';
import { BoardScene } from './BoardScene';
import { ResultsScene } from './ResultsScene';
import { FlunkyScene } from './FlunkyScene';
import { WweScene } from './WweScene';
import { SprintScene } from './SprintScene';
import { MurderScene } from './MurderScene';
import { setState } from './store';

const SCENE_KEYS = ['lobby', 'board', 'results', 'flunky', 'wwe', 'sprint', 'murder'];

/** Welche Phaser-Szene gehört zu welchem Zustand? */
function sceneKey(s: GameState): string {
  if (s.phase === 'mini' && s.mini) return s.mini.kind;
  return s.phase === 'mini' ? 'lobby' : s.phase;
}

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
    backgroundColor: '#2d1b12',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [LobbyScene, BoardScene, ResultsScene, FlunkyScene, WweScene, SprintScene, MurderScene],
  });

  let currentKey = '';
  const socket = io();
  socket.on('connect', () => socket.emit('host:hello'));
  socket.on('state', (s: GameState) => {
    const key = sceneKey(s);
    setState(s);
    if (key !== currentKey) {
      currentKey = key;
      for (const k of SCENE_KEYS) if (k !== key) game.scene.stop(k);
      game.scene.start(key);
    }
  });
}

start();
