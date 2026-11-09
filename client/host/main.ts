import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import type { GameLive, GameMeta, GameState, HostInfo } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LobbyScene } from './LobbyScene';
import { BoardScene } from './BoardScene';
import { ResultsScene } from './ResultsScene';
import { FlunkyScene } from './FlunkyScene';
import { WweScene } from './WweScene';
import { SprintScene } from './SprintScene';
import { MurderScene } from './MurderScene';
import { TttScene } from './TttScene';
import { mergeLive, mergeMeta, setAtLaptop, setState, setHostSocket, setViaTunnel } from './store';
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
import { WolfrundeScene } from './WolfrundeScene';
import { PixelScene } from './PixelScene';
import { WpistoleScene } from './WpistoleScene';
import { AngelnScene } from './AngelnScene';
import { KingsCupScene } from './KingsCupScene';
import { KofferScene } from './KofferScene';
import { SuessScene } from './SuessScene';
import { SpionScene } from './SpionScene';
import { UmzugScene } from './UmzugScene';
import { WackelScene } from './WackelScene';
import { FunkScene } from './FunkScene';
import { IntroScene } from './IntroScene';
import { WarmupScene, isWarmup } from './WarmupScene';
import { SchaetzScene } from './SchaetzScene';
import { LexikonScene } from './LexikonScene';
import { LiederScene } from './LiederScene';
import { WerwarsScene } from './WerwarsScene';
import { MaexScene } from './MaexScene';
import { SkisprungScene } from './SkisprungScene';
import { TeppichScene } from './TeppichScene';
import { KugelScene } from './KugelScene';
import { installBalanceBoard } from './balanceBoard';
import { hdFactor, installHd } from './hd';

const SCENE_KEYS = ['lobby', 'board', 'intro', 'results', 'flunky', 'wwe', 'sprint', 'murder', 'story', 'descent', 'rhythm', 'wrap', 'stars', 'nhie', 'hilo', 'bomb', 'kingscup', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'stillepost', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'volley', 'tourist', 'sprueche', 'werwolf', 'wolfrunde', 'pixel', 'bogen', 'darts', 'golf', 'autoball', 'wpistole', 'zauber', 'angeln', 'koffer', 'suess', 'spion', 'umzug', 'wackel', 'werwars', 'maexchen', 'schaetz', 'lexikon', 'lieder', 'funk', 'skisprung', 'teppich', 'kugel'];

/** Welche Phaser-Szene gehört zu welchem Zustand? */
function sceneKey(s: GameState): string {
  if (s.phase === 'mini' && s.mini) return s.mini.kind;
  // Aufwärmrunde: die echte Szene des Spiels (darüber die WarmupScene), sonst die Regelkarte (IntroScene)
  if (s.phase === 'intro') return isWarmup(s) ? s.mini!.kind : s.intro ? 'intro' : 'lobby';
  return s.phase === 'mini' ? 'lobby' : s.phase;
}

async function start() {
  // Pixel-Font laden, bevor Phaser Texte rendert (sonst Fallback-Font)
  await Promise.race([
    document.fonts.load('8px "Press Start 2P"'),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => undefined);

  // Render-Auflösung ×2 (960 × 540) bei unveränderter Welt 480 × 270 – siehe hd.ts (?hd=1|2, Laptop-Steuerung)
  const hd = hdFactor();
  installHd(hd);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: WORLD.W * hd,
    height: WORLD.H * hd,
    pixelArt: true,
    backgroundColor: '#2d1b12',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [LobbyScene, BoardScene, IntroScene, ResultsScene, FlunkyScene, WweScene, SprintScene, MurderScene, ...DATE_SCENES, ...DRINK_SCENES, KingsCupScene, ...CONTROLLER_SCENES, FliegerScene, KurveScene, ArenaScene, BowlingScene, EntenScene, TttScene, VersteckScene, ParcoursScene, ...KART_SCENES, TurmScene, IgelScene, SmashScene, WasserScene, StillepostScene, FangenScene, GeistScene, GrillScene, BouleScene, SumoScene, VolleyScene, TouristScene, SpruecheScene, WerwolfScene, WolfrundeScene, PixelScene, BogenScene, DartsScene, GolfScene, AutoballScene, WpistoleScene, ZauberScene, AngelnScene, KofferScene, SuessScene, SpionScene, UmzugScene, WackelScene, WerwarsScene, MaexScene, SchaetzScene, LexikonScene, LiederScene, FunkScene, SkisprungScene, TeppichScene, KugelScene, WarmupScene],
  });

  let currentKey = '';
  /** Instanz des Minispiels, für die die laufende Szene gestartet wurde (Aufwärmrunde → echtes Spiel = Neustart) */
  let currentInst = -1;
  // Gleich per WebSocket (schneller, kein Polling-Umweg); nur wenn das scheitert, Polling als Notlösung
  const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  startTimeSync(socket);
  initPlayersPanel(socket); // Panel „Spieler“ (Taste P)
  connectMusic(socket);
  setHostSocket(socket);
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
  socket.on('host:info', (info: Partial<HostInfo>) => {
    setViaTunnel(!!info?.online);
    setAtLaptop(!!info?.local);
    if (info?.local && !controls) {
      controls = true;
      installHostControls(socket);
      // Balance Board (WebHID) nur am Laptop – dort hängt es per Bluetooth
      installBalanceBoard(socket);
    }
  });
  // meta (selten) + state (laufend) → ein GameState für Szenen und Panels
  socket.on('meta', (m: GameMeta) => show(mergeMeta(m)));
  socket.on('state', (l: GameLive) => show(mergeLive(l)));
  function show(s: GameState | null) {
    if (!s) return;
    const key = sceneKey(s);
    const inst = s.mini && key === s.mini.kind ? (s.miniSeq ?? 0) : -1;
    setState(s);
    if (key !== currentKey || inst !== currentInst) {
      // Neue Instanz desselben Spiels (Aufwärmrunde → echtes Spiel, frische Übungsrunde): Szene neu starten, create() setzt zurück
      const music = key !== currentKey;
      currentKey = key;
      currentInst = inst;
      for (const k of SCENE_KEYS) if (k !== key) game.scene.stop(k);
      game.scene.start(key);
      if (music) {
        setScene(key);
        musicMenuScene(key);
      }
    }
    // Aufwärm-Leiste über der Spielszene
    if (isWarmup(s)) {
      if (!game.scene.isActive('warmup')) game.scene.run('warmup');
      game.scene.bringToTop('warmup');
    } else if (game.scene.isActive('warmup') || game.scene.isPaused('warmup')) game.scene.stop('warmup');
    showOrientBanner(s);
  }

  // „📱↔ Handys QUER halten“ bzw. hochkant, 4 s unten mittig – nur wenn ein Minispiel OHNE Regelkarte startet
  // (Trinkspiel, Date Night, „Nochmal“); nach der Phase `intro` hat die IntroScene die Haltung schon gezeigt
  const orientTv = document.getElementById('orient-tv');
  let orientKind = '';
  let orientPrev = '';
  let orientTimer: number | undefined;
  const hideOrient = (now: boolean) => {
    clearTimeout(orientTimer);
    orientTv?.classList.toggle('now', now);
    orientTv?.classList.add('off');
  };
  function showOrientBanner(s: GameState) {
    const prev = orientPrev;
    orientPrev = s.phase;
    if (s.phase === 'results' || s.phase === 'board' || s.phase === 'lobby') hideOrient(true);
    const kind = s.phase === 'mini' && s.mini ? s.mini.kind : '';
    if (kind === orientKind) return;
    orientKind = kind;
    if (!kind || prev === 'intro') return;
    const info = MINI_INFO[kind as keyof typeof MINI_INFO];
    if (!orientTv || !info) return;
    const text = ORIENT_TEXT[info.orientation].replace('Handy ', 'Handys ').replace('Halte das Handy, wie du magst', 'Haltet die Handys, wie ihr mögt');
    orientTv.textContent = `${info.icon} ${info.title} · ${text}`;
    orientTv.classList.toggle('landscape', info.orientation === 'landscape');
    orientTv.classList.remove('off', 'now');
    clearTimeout(orientTimer);
    orientTimer = window.setTimeout(() => hideOrient(false), 4000);
  }
}

start();
