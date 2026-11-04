import '@fontsource/press-start-2p/400.css';
import type { GameState, JoinResponse, PrivateState } from '../../shared/types';
import { type Screen, LS, app, el, me, message, socket, store, toast } from './core';
import { startTimeSync } from '../timesync';
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
import { pickTourist } from './screens/tourist';

let screenKey = '';
let updater: (() => void) | null = null;

// ---------------------------------------------------------------- Netzwerk

function join() {
  socket.emit('player:join', { name: store.name, look: store.look, playerId: store.playerId }, (r: JoinResponse) => {
    if (r.ok && r.playerId) {
      store.playerId = r.playerId;
      localStorage.setItem(LS.id, r.playerId);
      store.joined = true;
      store.editing = false;
      requestWakeLock();
    } else {
      toast(r.error ?? 'Beitreten hat nicht geklappt.');
      store.joined = false;
    }
    render();
  });
}

startTimeSync(socket);

socket.on('connect', () => {
  if (store.name && !store.editing) join();
  else render();
});
socket.on('disconnect', () => {
  store.joined = false;
  render();
});
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
  const [key, build] = pickScreen();
  if (key !== screenKey) {
    screenKey = key;
    app.innerHTML = '';
    updater = build();
    addVipAbort();
  }
  updater?.();
}

function pickScreen(): Screen {
  if (store.editing || !store.name) return ['edit', () => buildEdit(afterEdit)];
  if (!socket.connected) return ['offline', message('Verbinde ...', 'Bist du im selben WLAN wie der PC?')];
  const s = store.state;
  if (!store.joined || !s) return ['joining', message('Trete bei ...')];
  const vip = !!me()?.isVip;

  switch (s.phase) {
    case 'lobby':
      return [`lobby-${vip}-${s.mode}-${s.mode === 'arcade' ? JSON.stringify(s.leaderboard.map((e) => e.points)) : ''}`, () => buildLobby(vip, () => ((store.editing = true), render()))];
    case 'board':
      return s.board ? withPrefix('b', pickBoard(s.board)) : ['wait', message('Warte ...')];
    case 'results':
      return s.results ? pickResults(s.results, vip || inCouple()) : ['wait', message('Warte ...')];
    case 'story':
      return s.date ? pickStory(s.date, vip || inCouple()) : ['wait', message('Warte ...')];
    case 'mini': {
      const m = s.mini;
      if (!m) return ['wait', message('Warte ...')];
      if (!(store.playerId && s.players.some((p) => p.id === store.playerId))) return ['wait', message('Warte ...')];
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
        case 'tourist':
          return pickTourist(m.state);
      }
    }
  }
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

/** Der VIP kann jederzeit abbrechen und zurück in die Lobby. */
function addVipAbort() {
  const s = store.state;
  if (!s || s.phase === 'lobby' || !me()?.isVip || store.editing) return;
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

// Countdowns etc. regelmäßig aktualisieren
setInterval(() => updater?.(), 250);

render();
