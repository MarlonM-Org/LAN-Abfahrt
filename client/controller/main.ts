import '@fontsource/press-start-2p/400.css';
import type { GameState, JoinResponse, PrivateState } from '../../shared/types';
import { type Screen, LS, app, el, kartViewPref, me, message, socket, store, toast } from './core';
import { startTimeSync } from '../timesync';
import { knownKind, watchServerVersion } from '../version';
import { buildEdit, buildLobby } from './screens/lobby';
import { pickBoard } from './screens/board';
import { pickResults } from './screens/results';
import { pickFlunky } from './screens/flunky';
import { pickWwe } from './screens/wwe';
import { pickSprint } from './screens/sprint';
import { pickMurder } from './screens/murder';
import { pickDescent, pickRhythm, pickStars, pickStory, pickWrap } from './screens/date';
import { pickBomb, pickHilo, pickNhie } from './screens/drink';
import { pickFlieger } from './screens/flieger';
import { pickKurve } from './screens/kurve';
import { pickArena, pickSup, pickTidy } from './screens/controller';
import { pickBowling } from './screens/bowling';
import { pickBoule } from './screens/boule';
import { pickEnten } from './screens/enten';
import { pickTtt } from './screens/ttt';
import { pickVerstecken } from './screens/verstecken';
import { pickParcours } from './screens/parcours';
import { onKartRerender, pickKart } from './screens/kart';
import { pickTurm } from './screens/turm';
import { pickIgel } from './screens/igel';
import { pickSmash } from './screens/smash';
import { pickWasser } from './screens/wasser';
import { pickStillepost } from './screens/stillepost';
import { pickFangen } from './screens/fangen';
import { pickGeist } from './screens/geist';
import { pickGrill } from './screens/grill';
import { pickSumo } from './screens/sumo';
import { pickVolley } from './screens/volley';
import { pickTourist } from './screens/tourist';
import { pickSprueche } from './screens/sprueche';
import { pickPixel } from './screens/pixel';
import { pickWpistole } from './screens/wpistole';
import { pickAngeln } from './screens/angeln';
import { pickKoffer } from './screens/koffer';
import { pickBogen } from './screens/bogen';
import { pickZauber } from './screens/zauber';
import { pickDarts } from './screens/darts';
import { pickGolf } from './screens/golf';
import { pickAutoball } from './screens/autoball';
import { pickWerwolf } from './screens/werwolf';
import { buildKicked, initVipPlayersButton } from './players';

let screenKey = '';
let updater: (() => void) | null = null;

// ---------------------------------------------------------------- Netzwerk

let joinPending = false;
/** Beitritt abgelehnt, weil gerade ein Spiel lief → in der Lobby automatisch nochmal */
let retryInLobby = false;

function join() {
  if (joinPending) return;
  joinPending = true;
  socket.emit('player:join', { name: store.name, look: store.look, playerId: store.playerId, kartView: kartViewPref() }, (r: JoinResponse) => {
    joinPending = false;
    if (r.ok && r.playerId) {
      store.playerId = r.playerId;
      localStorage.setItem(LS.id, r.playerId);
      store.joined = true;
      store.editing = false;
      requestWakeLock();
    } else if (r.kicked) {
      return onKicked();
    } else {
      toast(r.error ?? 'Beitreten hat nicht geklappt.');
      store.joined = false;
      retryInLobby = !!store.state && store.state.phase !== 'lobby';
    }
    render();
  });
}

/** Vom VIP/Laptop entfernt: gespeicherte Spieler-ID vergessen (kein Bann – „Neu beitreten“ geht immer). */
function onKicked() {
  // Selbst trennen – „Neu beitreten“ baut eine frische Verbindung auf
  if (socket.connected) socket.disconnect();
  store.kicked = true;
  store.joined = false;
  store.playerId = undefined;
  localStorage.removeItem(LS.id);
  render();
}

function rejoin() {
  store.kicked = false;
  store.playerId = undefined;
  if (socket.connected) join();
  else socket.connect(); // → 'connect' → join()
  render();
}

startTimeSync(socket);
watchServerVersion(socket, () => toast('Handy-Code ist älter als der Server – am Laptop „npm run build“ ausführen.'));

socket.on('kicked', onKicked);
socket.on('connect', () => {
  if (store.name && !store.editing && !store.kicked) join();
  else render();
});
socket.on('disconnect', (reason) => {
  store.joined = false;
  joinPending = false;
  // Vom Server getrennt → socket.io verbindet nicht von selbst neu
  if (reason === 'io server disconnect' && !store.kicked) socket.connect();
  render();
});

/**
 * iOS/Android frieren die Seite ein, sobald man die App wechselt – der Socket ist danach oft
 * tot, ohne dass es jemand merkt (bis zu ~45 s). Beim Zurückkommen deshalb sofort prüfen
 * und notfalls neu verbinden; der Server erkennt uns an der playerId wieder.
 */
let lastCheck = 0;
function checkConnection() {
  if (document.visibilityState === 'hidden' || store.kicked) return;
  const now = Date.now();
  if (now - lastCheck < 1000) return;
  lastCheck = now;
  if (!socket.connected) {
    socket.connect();
    return;
  }
  socket.timeout(2500).emit('time:ping', now, (err: unknown) => {
    if (err && socket.connected) {
      // Verbindung hängt → hart neu verbinden
      socket.disconnect();
      socket.connect();
    }
  });
  if (!store.joined && store.name && !store.editing) join();
}
document.addEventListener('visibilitychange', checkConnection);
window.addEventListener('pageshow', checkConnection);
window.addEventListener('focus', checkConnection);
window.addEventListener('online', checkConnection);
socket.on('toast', (msg: string) => toast(msg));
socket.on('private', (p: PrivateState) => {
  store.priv = p;
  render();
});
socket.on('state', (s: GameState) => {
  const prevKey = timerKey(store.state);
  store.state = s;
  const key = timerKey(s);
  if (key !== prevKey && s.mini && 'endsIn' in s.mini.state) store.endsAt = performance.now() + s.mini.state.endsIn;
  // Server neu gestartet oder aus der Lobby geflogen → neu beitreten
  if (store.joined && !s.players.some((p) => p.id === store.playerId)) {
    store.joined = false;
    if (store.name && !store.editing) join();
  }
  // Beitritt wurde abgelehnt (z. B. lief gerade ein Spiel) → in der Lobby erneut versuchen
  if (!store.joined && retryInLobby && !store.kicked && s.phase === 'lobby' && store.name && !store.editing) {
    retryInLobby = false;
    join();
  }
  render();
});

/** Countdown nur neu setzen, wenn sich die Spielphase ändert */
function timerKey(s: GameState | null) {
  if (!s?.mini) return '';
  const st = s.mini.state as unknown as Record<string, unknown>;
  return `${s.mini.kind}-${st.sub}-${st.round ?? ''}-${st.phaseNo ?? ''}`;
}

// ---------------------------------------------------------------- Rendering

/** Baut den Screen nur neu, wenn sich der Screen-Key ändert – sonst nur Werte aktualisieren.
 *  So gehen keine Taps oder Wischgesten verloren, während Updates reinkommen. */
function render() {
  let screen: Screen;
  try {
    screen = pickScreen();
  } catch (e) {
    // Ohne Fallback bliebe bei einem Fehler einfach der alte Screen (z. B. das Lobby-Menü) stehen
    console.error(e);
    screen = ['error', message('Hoppla!', 'Anzeigefehler – lade die Seite neu.')];
  }
  const [key, build] = screen;
  if (key !== screenKey) {
    screenKey = key;
    app.innerHTML = '';
    try {
      updater = build();
    } catch (e) {
      console.error(e);
      updater = null;
      message('Hoppla!', 'Anzeigefehler – lade die Seite neu.')();
    }
  }
  syncVipAbort();
  try {
    updater?.();
  } catch (e) {
    console.error(e);
  }
}

/** Spiel, das dieser (veraltete) Handy-Code nicht kennt */
function outdatedScreen(): Screen {
  return ['outdated', message('Handy-Code veraltet', 'Seite neu laden. Hilft das nicht: am Laptop „npm run build“ ausführen und den Server neu starten.')];
}

function pickScreen(): Screen {
  if (store.kicked) return ['kicked', () => buildKicked(rejoin)];
  if (store.editing || !store.name) return ['edit', () => buildEdit(afterEdit)];
  if (!socket.connected) return ['offline', message('Verbinde ...', 'Bist du im selben WLAN wie der PC?')];
  const s = store.state;
  if (!store.joined && retryInLobby) return ['waitlobby', message('Gerade läuft ein Spiel', 'Du steigst automatisch ein, sobald die Runde vorbei ist.')];
  if (!store.joined || !s) return ['joining', message('Trete bei ...')];
  const vip = !!me()?.isVip;

  switch (s.phase) {
    case 'lobby':
      return [`lobby-${vip}-${s.mode}-${s.mode === 'arcade' ? `${s.arcadeVote ? 'vote' : ''}${JSON.stringify(s.leaderboard.map((e) => e.points))}` : ''}`, () => buildLobby(vip, () => ((store.editing = true), render()))];
    case 'board':
      return s.board ? withPrefix('b', pickBoard(s.board)) : ['wait', message('Warte ...')];
    case 'results':
      return s.results ? pickResults(s.results, vip || inCouple()) : ['wait', message('Warte ...')];
    case 'story':
      return s.date ? pickStory(s.date, vip || inCouple()) : ['wait', message('Warte ...')];
    case 'mini': {
      const m = s.mini;
      if (!m) return ['wait', message('Warte ...')];
      if (!knownKind(m.kind)) return outdatedScreen();
      if (!(store.playerId && s.players.some((p) => p.id === store.playerId))) return ['wait', message('Warte ...')];
      // Erst nach Spielstart zurückgekommen → diese Runde zuschauen
      if (s.inGame && !s.inGame.includes(store.playerId)) return ['watch', message('Du schaust zu', 'Diese Runde läuft ohne dich – beim nächsten Spiel bist du dabei!')];
      switch (m.kind) {
        case 'flunky':
          return pickFlunky(m.state);
        case 'wwe':
          return pickWwe(m.state);
        case 'sprint':
          return pickSprint(m.state);
        case 'murder':
          return pickMurder(m.state, vip);
        case 'descent':
          return pickDescent(m.state);
        case 'rhythm':
          return pickRhythm(m.state);
        case 'wrap':
          return pickWrap(m.state);
        case 'stars':
          return pickStars(m.state);
        case 'nhie':
          return pickNhie(m.state);
        case 'hilo':
          return pickHilo(m.state);
        case 'bomb':
          return pickBomb(m.state);
        case 'sup':
          return pickSup(m.state);
        case 'tidy':
          return pickTidy(m.state);
        case 'flieger':
          return pickFlieger(m.state);
        case 'kurve':
          return pickKurve(m.state);
        case 'arena':
          return pickArena(m.state);
        case 'bowling':
          return pickBowling(m.state);
        case 'enten':
          return pickEnten(m.state);
        case 'ttt':
          return pickTtt(m.state);
        case 'verstecken':
          return pickVerstecken(m.state);
        case 'parcours':
          return pickParcours(m.state);
        case 'kart':
          return pickKart(m.state);
        case 'turm':
          return pickTurm(m.state);
        case 'igel':
          return pickIgel(m.state);
        case 'smash':
          return pickSmash(m.state);
        case 'wasser':
          return pickWasser(m.state);
        case 'stillepost':
          return pickStillepost(m.state, vip);
        case 'fangen':
          return pickFangen(m.state);
        case 'geist':
          return pickGeist(m.state);
        case 'grill':
          return pickGrill(m.state);
        case 'boule':
          return pickBoule(m.state);
        case 'sumo':
          return pickSumo(m.state);
        case 'volley':
          return pickVolley(m.state);
        case 'tourist':
          return pickTourist(m.state);
        case 'sprueche':
          return pickSprueche(m.state, vip);
        case 'bogen':
          return pickBogen(m.state);
        case 'darts':
          return pickDarts(m.state);
        case 'golf':
          return pickGolf(m.state);
        case 'autoball':
          return pickAutoball(m.state);
        case 'werwolf':
          return pickWerwolf(m.state);
        case 'pixel':
          return pickPixel(m.state, vip);
        case 'wpistole':
          return pickWpistole(m.state);
        case 'zauber':
          return pickZauber(m.state);
        case 'angeln':
          return pickAngeln(m.state);
        case 'koffer':
          return pickKoffer(m.state);
      }
      return outdatedScreen();
    }
  }
  return outdatedScreen();
}

function inCouple() {
  return !!store.playerId && !!store.state?.date?.couple.includes(store.playerId);
}

function withPrefix(prefix: string, [key, build]: Screen): Screen {
  return [`${prefix}-${key}`, build];
}

function afterEdit() {
  if (socket.connected) join();
  render();
}

/** Der VIP kann jederzeit abbrechen und zurück in die Lobby. Wird bei jedem Render abgeglichen,
 *  weil sich der VIP-Status ändern kann, ohne dass der Screen neu gebaut wird (z. B. nach Wiederverbinden). */
function syncVipAbort() {
  const s = store.state;
  const show = !!s && store.joined && s.phase !== 'lobby' && !!me()?.isVip && !store.editing;
  const existing = app.querySelector<HTMLButtonElement>(':scope > button.abort');
  if (!show) return existing?.remove();
  if (existing) return;
  const b = el(`<button class="abort">Abbrechen</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (confirm('Spiel wirklich abbrechen und zurück in die Lobby?')) socket.emit('vip:lobby');
  });
  app.append(b);
}

async function requestWakeLock() {
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    /* nur über HTTPS verfügbar – egal */
  }
}

onKartRerender(() => render());
initVipPlayersButton();

// Countdowns etc. regelmäßig aktualisieren
setInterval(() => updater?.(), 250);

render();
