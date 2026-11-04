/**
 * Handy: Spielerliste mit Online/Offline-Status, Spieler entfernen (VIP) und
 * der „Du wurdest entfernt“-Screen. Gegenstück zum Server-Abschnitt
 * „Spieler entfernen & Offline“ in server/room.ts.
 */
import type { KickResponse, PlayerPublic } from '../../shared/types';
import { offlineLabel } from '../../shared/players';
import { avatarCanvas, el, escapeHtml, me, q, socket, store, toast } from './core';

/** Wann der letzte Zustand ankam – damit „offline seit X min“ ohne neuen Zustand weiterzählt */
let stateAt = performance.now();
socket.on('state', () => (stateAt = performance.now()));

/** Sichtbare Spieler (ohne bereits entfernte) */
const visiblePlayers = (): PlayerPublic[] => store.state?.players.filter((p) => !p.removed) ?? [];

const offlineMs = (p: PlayerPublic) => (p.offlineMs ?? 0) + (performance.now() - stateAt);

const statusText = (p: PlayerPublic) => (p.connected ? (p.bot ? 'Bot' : 'online') : offlineLabel(offlineMs(p)));

function kick(p: PlayerPublic) {
  if (!confirm(`${p.name} wirklich aus der Runde entfernen?`)) return;
  socket.emit('vip:kick', p.id, (r: KickResponse) => toast(r.ok ? `${p.name} wurde entfernt.` : (r.error ?? 'Hat nicht geklappt.')));
}

function kickOthers() {
  if (!confirm('Wirklich alle anderen Spieler entfernen? Du bleibst als VIP in der Lobby.')) return;
  socket.emit('vip:kickOthers', (r: KickResponse) => toast(r.ok ? `${r.removed ?? 0} Spieler entfernt.` : (r.error ?? 'Hat nicht geklappt.')));
}

/** Eine Zeile pro Spieler; `kickable` entscheidet, wer einen „✕ entfernen“-Knopf bekommt. */
function fillList(list: HTMLElement, players: PlayerPublic[], kickable: (p: PlayerPublic) => boolean) {
  list.innerHTML = '';
  for (const p of players) {
    const row = el(`<div class="pl-row${p.connected ? '' : ' offline'}"><div class="pl-av"></div><div class="pl-info"><span class="pl-name"></span><span class="pl-state"></span></div></div>`)
      .firstElementChild as HTMLElement;
    q(row, '.pl-av').append(avatarCanvas(2, p.look));
    q(row, '.pl-name').innerHTML = `${escapeHtml(p.name)}${p.isVip ? ' <b class="pl-tag">VIP</b>' : ''}${p.id === store.playerId ? ' <b class="pl-tag">du</b>' : ''}`;
    q(row, '.pl-state').textContent = statusText(p);
    if (kickable(p)) {
      const b = el(`<button class="secondary small pl-kick">✕ entfernen</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => kick(p));
      row.append(b);
    }
    list.append(row);
  }
}

const listKey = (players: PlayerPublic[], vip: boolean) =>
  `${vip}|${players.map((p) => `${p.id}${p.name}${p.connected}${p.isVip}${p.connected ? '' : statusText(p)}`).join('|')}`;

/**
 * Spielerliste für die Lobby. Gibt Element + Updater zurück; die Liste wird nur neu gebaut,
 * wenn sich wirklich etwas ändert (sonst gehen Taps verloren).
 */
export function lobbyPlayerList() {
  const root = el(`
    <div class="panel pl-panel">
      <p class="label-left">Spieler</p>
      <div class="pl-list"></div>
      <button class="secondary small pl-all hidden">Alle anderen entfernen</button>
    </div>
  `);
  const list = q(root, '.pl-list');
  const all = q<HTMLButtonElement>(root, '.pl-all');
  all.addEventListener('click', kickOthers);
  let key = '';
  const update = () => {
    const vip = !!me()?.isVip;
    const players = visiblePlayers();
    const k = listKey(players, vip);
    if (k === key) return;
    key = k;
    fillList(list, players, (p) => vip && p.id !== store.playerId);
    all.classList.toggle('hidden', !vip || players.length < 2);
  };
  update();
  return { root, update };
}

/** „Du wurdest aus der Runde entfernt“ + „Neu beitreten“ */
export function buildKicked(onRejoin: () => void) {
  const root = el(`
    <div class="center">
      <h1>Tschüss!</h1>
      <h2>Du wurdest aus der Runde entfernt</h2>
      <p>Der VIP oder der Laptop hat dich rausgenommen. Du kannst jederzeit wieder einsteigen.</p>
      <button data-act="rejoin">Neu beitreten</button>
    </div>
  `);
  q(root, '[data-act=rejoin]').addEventListener('click', onRejoin);
  document.getElementById('app')!.append(root);
  return null;
}

// ---------------------------------------------------------------- VIP während des Spiels

/**
 * Während eines Spiels: kleiner Knopf „Spieler“ für den VIP, sobald jemand offline ist.
 * Liegt außerhalb von #app (eigenes DOM), damit Screen-Wechsel ihn nicht stören.
 */
export function initVipPlayersButton() {
  const btn = el(`<button class="pl-fab hidden"></button>`).firstElementChild as HTMLButtonElement;
  const sheet = el(`
    <div class="pl-sheet hidden">
      <div class="panel">
        <h2>Spieler</h2>
        <p>Offline-Spieler kannst du hier entfernen – das Spiel läuft ohne sie weiter.</p>
        <div class="pl-list"></div>
        <button class="secondary small" data-act="close">Schließen</button>
      </div>
    </div>
  `).firstElementChild as HTMLElement;
  document.body.append(btn, sheet);
  const list = q(sheet, '.pl-list');
  let open = false;
  let key = '';
  btn.addEventListener('click', () => ((open = true), (key = ''), update()));
  q(sheet, '[data-act=close]').addEventListener('click', () => ((open = false), update()));

  const update = () => {
    const s = store.state;
    const vip = !!me()?.isVip;
    const inGame = !!s && s.phase !== 'lobby' && store.joined && vip && !store.editing;
    const players = visiblePlayers();
    const offline = players.filter((p) => !p.connected);
    btn.classList.toggle('hidden', !inGame || !offline.length);
    btn.textContent = `Spieler (${offline.length} offline)`;
    if (!inGame || (!offline.length && open)) open = false;
    sheet.classList.toggle('hidden', !open);
    if (!open) return;
    const k = listKey(players, vip);
    if (k === key) return;
    key = k;
    fillList(list, players, (p) => !p.connected && p.id !== store.playerId);
  };
  socket.on('state', update);
  setInterval(update, 1000);
}
