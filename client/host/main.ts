import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import type { GameLive, GameMeta, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LobbyScene } from './LobbyScene';
import { BoardScene } from './BoardScene';
import { ResultsScene } from './ResultsScene';
import { FlunkyScene } from './FlunkyScene';
import { WweScene } from './WweScene';
import { SprintScene } from './SprintScene';
import { MurderScene } from './MurderScene';
import { TttScene } from './TttScene';
import { mergeLive, mergeMeta, setState } from './store';
import { installHostControls } from './hostControls';
import { startTimeSync } from '../timesync';
import { connectMusic, setScene, unlockMusic } from './music';
import { isMusicMenuOpen, musicMenuScene, setupMusicMenu, toggleMusicMenu } from './musicMenu';
import { watchServerVersion } from '../version';
import { MINI_INFO, ORIENT_TEXT } from '../../shared/games';
import { DATE_SCENES } from './DateScenes';
import { DRINK_SCENES } from './DrinkScenes';
import { CONTROLLER_SCENES } from './ControllerScenes';
import { FliegerScene } from './FliegerScene';
import { KurveScene } from './KurveScene';
import { ArenaScene } from './ArenaScene';
import { BowlingScene } from './BowlingScene';
import { BouleScene } from './BouleScene';
import { EntenScene } from './EntenScene';
import { VersteckScene } from './VersteckScene';
import { ParcoursScene } from './ParcoursScene';
import { KART_SCENES } from './KartScene';
import { TurmScene } from './TurmScene';
import { IgelScene } from './IgelScene';
import { SmashScene } from './SmashScene';
import { WasserScene } from './WasserScene';
import { StillepostScene } from './StillepostScene';
import { FangenScene } from './FangenScene';
import { GeistScene } from './GeistScene';
import { initPlayersPanel } from './playersPanel';
import { GrillScene } from './GrillScene';
import { SumoScene } from './SumoScene';
import { VolleyScene } from './VolleyScene';
import { TouristScene } from './TouristScene';
import { SpruecheScene } from './SpruecheScene';
import { BogenScene } from './BogenScene';
import { ZauberScene } from './ZauberScene';
import { DartsScene } from './DartsScene';
import { GolfScene } from './GolfScene';
import { AutoballScene } from './AutoballScene';
import { WerwolfScene } from './WerwolfScene';
import { PixelScene } from './PixelScene';
import { WpistoleScene } from './WpistoleScene';
import { AngelnScene } from './AngelnScene';
import { KingsCupScene } from './KingsCupScene';
import { KofferScene } from './KofferScene';
import { SuessScene } from './SuessScene';
import { SpionScene } from './SpionScene';
import { UmzugScene } from './UmzugScene';
import { WackelScene } from './WackelScene';

const SCENE_KEYS = ['lobby', 'board', 'results', 'flunky', 'wwe', 'sprint', 'murder', 'story', 'descent', 'rhythm', 'wrap', 'stars', 'nhie', 'hilo', 'bomb', 'kingscup', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'stillepost', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'volley', 'tourist', 'sprueche', 'werwolf', 'pixel', 'bogen', 'darts', 'golf', 'autoball', 'wpistole', 'zauber', 'angeln', 'koffer', 'suess', 'spion', 'umzug', 'wackel'];

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
    scene: [LobbyScene, BoardScene, ResultsScene, FlunkyScene, WweScene, SprintScene, MurderScene, ...DATE_SCENES, ...DRINK_SCENES, KingsCupScene, ...CONTROLLER_SCENES, FliegerScene, KurveScene, ArenaScene, BowlingScene, EntenScene, TttScene, VersteckScene, ParcoursScene, ...KART_SCENES, TurmScene, IgelScene, SmashScene, WasserScene, StillepostScene, FangenScene, GeistScene, GrillScene, BouleScene, SumoScene, VolleyScene, TouristScene, SpruecheScene, WerwolfScene, PixelScene, BogenScene, DartsScene, GolfScene, AutoballScene, WpistoleScene, ZauberScene, AngelnScene, KofferScene, SuessScene, SpionScene, UmzugScene, WackelScene],
  });

  let currentKey = '';
  // Gleich per WebSocket (schneller, kein Polling-Umweg); nur wenn das scheitert, Polling als Notlösung
  const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  startTimeSync(socket);
  initPlayersPanel(socket); // Panel „Spieler“ (Taste P)
  connectMusic(socket);
  setupMusicMenu();
  watchServerVersion(socket);
  void import('./emotes').then((m) => m.initSpectatorOverlay()); // Emotes + Wetten der Zuschauer als DOM-Overlay über allen Szenen

  // Browser erlauben Ton erst nach einer Nutzeraktion → einmal klicken/Taste drücken
  const overlay = document.getElementById('sound');
  const unlock = () => {
    unlockMusic();
    overlay?.remove();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') {
      // M öffnet das Musik-Menü (Lautstärke, Stumm, Bibliothek, Zuordnung)
      unlock();
      toggleMusicMenu();
      return;
    }
    if (e.key === 'Escape' && isMusicMenuOpen()) {
      // Nur das Menü schließen – nicht zusätzlich „Spiel abbrechen“ (Laptop-Steuerung) auslösen
      toggleMusicMenu(false);
      e.stopImmediatePropagation();
      return;
    }
    unlock();
  });
  socket.on('connect', () => socket.emit('host:hello'));
  // Steuer-Overlay nur, wenn die TV-Seite direkt am Laptop läuft (der Server prüft das)
  let controls = false;
  socket.on('host:info', (info: { local?: boolean }) => {
    if (info?.local && !controls) {
      controls = true;
      installHostControls(socket);
    }
  });
  // meta (selten) + state (laufend) → ein GameState für Szenen und Panels
  socket.on('meta', (m: GameMeta) => show(mergeMeta(m)));
  socket.on('state', (l: GameLive) => show(mergeLive(l)));
  function show(s: GameState | null) {
    if (!s) return;
    const key = sceneKey(s);
    setState(s);
    if (key !== currentKey) {
      currentKey = key;
      for (const k of SCENE_KEYS) if (k !== key) game.scene.stop(k);
      game.scene.start(key);
      setScene(key);
      musicMenuScene(key);
    }
    showOrientBanner(s);
  }

  // Beim Start eines Minispiels 6 s „📱↔ Handys QUER halten“ bzw. hochkant – auch ohne Brett-Intro (Arcade, Trinkspiel, Date)
  const orientTv = document.getElementById('orient-tv');
  let orientKind = '';
  let orientTimer: number | undefined;
  function showOrientBanner(s: GameState) {
    const kind = s.phase === 'mini' && s.mini ? s.mini.kind : '';
    if (kind === orientKind) return;
    orientKind = kind;
    const info = kind ? MINI_INFO[kind as keyof typeof MINI_INFO] : undefined;
    if (!orientTv || !info) return;
    const text = ORIENT_TEXT[info.orientation].replace('Handy ', 'Handys ').replace('Halte das Handy, wie du magst', 'Haltet die Handys, wie ihr mögt');
    orientTv.textContent = `${info.icon} ${info.title} · ${text}`;
    orientTv.classList.toggle('landscape', info.orientation === 'landscape');
    orientTv.classList.remove('off');
    clearTimeout(orientTimer);
    orientTimer = window.setTimeout(() => orientTv.classList.add('off'), 6000);
  }
}

start();
