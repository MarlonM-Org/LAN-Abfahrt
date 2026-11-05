import { io } from 'socket.io-client';
import type { GameState, Look, PlayerPublic, PrivateState, Team } from '../../shared/types';
import type { PhoneOrientation } from '../../shared/games';
import { AV_H, AV_W, drawAvatar, randomLook, sanitizeLook } from '../../shared/avatar';
import { TEAM_INFO } from '../../shared/flunky';

export const LS = { id: 'lanabfahrt.playerId', name: 'lanabfahrt.name', look: 'lanabfahrt.look', kartView: 'lanabfahrt.kartView' };

/** Kart-Rennen: gespeicherte Ansichts-Wahl (eigene Verfolger-Ansicht am Handy oder TV-Splitscreen) */
export function kartViewPref(): 'phone' | 'tv' | undefined {
  const v = localStorage.getItem(LS.kartView);
  return v === 'phone' || v === 'tv' ? v : undefined;
}

// Gleich per WebSocket (schneller Aufbau, kein Polling-Umweg im schwachen WLAN); Polling nur, wenn WebSocket scheitert
export const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });

/** Gemeinsamer Zustand des Handy-Controllers */
export const store = {
  /** meta (Spieler, Leaderboards – nur bei Änderung) + state (laufendes Spiel) zusammengeführt */
  state: null as GameState | null,
  priv: null as PrivateState,
  playerId: (localStorage.getItem(LS.id) ?? undefined) as string | undefined,
  name: localStorage.getItem(LS.name) ?? '',
  look: loadLook(),
  joined: false,
  editing: !localStorage.getItem(LS.name),
  /** Vom VIP/Laptop entfernt → „Du wurdest entfernt“-Screen */
  kicked: false,
  /** performance.now()-Zeitpunkt, an dem der aktuelle Countdown abläuft */
  endsAt: 0,
  /** Aktuelle Phase hat kein Zeitlimit (Server schickt endsIn 0) → keinen Countdown zeigen */
  noTimer: false,
};

export type Builder = () => (() => void) | null;
/** [Key, Builder, optional: Handy-Haltung für genau diesen Screen – übersteuert MINI_INFO[kind].orientation] */
export type Screen = [key: string, build: Builder, orient?: PhoneOrientation];

export const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

/** Minispiel-Eingabe an den Server */
export function send(action: string, payload?: unknown) {
  socket.emit('mini:input', { action, payload });
}

export function me(): PlayerPublic | undefined {
  return store.state?.players.find((p) => p.id === store.playerId);
}

export function nameOf(id: string | null | undefined): string {
  return store.state?.players.find((p) => p.id === id)?.name ?? '?';
}

export function secondsLeft(): number {
  return Math.max(0, Math.ceil((store.endsAt - performance.now()) / 1000));
}

/** Countdown-Text – leer, wenn die Phase kein Zeitlimit hat (dann wird in Ruhe gespielt) */
export function timerText(fmt: (sec: number) => string = (sec) => `${sec}s`): string {
  return store.noTimer ? '' : fmt(secondsLeft());
}

export function el(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const frag = document.createElement('div');
  frag.style.display = 'contents';
  frag.append(t.content);
  return frag;
}

export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector(sel) as T;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function teamBadge(team: Team) {
  return `<div class="team-badge team-${team}">${TEAM_INFO[team].name}</div>`;
}

export function avatarCanvas(scale: number, look?: Look) {
  const c = document.createElement('canvas');
  c.width = AV_W * scale;
  c.height = AV_H * scale;
  c.className = 'avatar';
  c.dataset.scale = String(scale);
  if (look) paintAvatar(c, look);
  return c;
}

export function paintAvatar(c: HTMLCanvasElement, l: Look) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  drawAvatar(ctx, l, 0, 0, Number(c.dataset.scale));
}

/** Button, der schon beim Berühren auslöst (schneller als click) */
export function tapButton(btn: HTMLElement, onTap: () => void) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onTap();
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function message(title: string, sub = ''): Builder {
  return () => {
    app.append(el(`<div class="center"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div>`));
    return null;
  };
}

/** Liste mit Spieler-Buttons (Avatar + Name) für Abstimmungen */
export function playerButtons(players: PlayerPublic[], onPick: (id: string) => void) {
  const grid = el(`<div class="player-grid"></div>`);
  const inner = q(grid, '.player-grid');
  // Ab 9 Spielern drei Spalten mit kleineren Avataren, damit alle ohne viel Scrollen passen
  const many = players.length > 8;
  if (many) inner.classList.add('many');
  for (const p of players) {
    const b = document.createElement('button');
    b.className = 'player-btn';
    b.append(avatarCanvas(many ? 2 : 3, p.look));
    const span = document.createElement('span');
    span.textContent = p.name;
    b.append(span);
    b.addEventListener('click', () => onPick(p.id));
    inner.append(b);
  }
  return grid;
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 2500);
}

function loadLook(): Look {
  try {
    const raw = localStorage.getItem(LS.look);
    if (raw) return sanitizeLook(JSON.parse(raw));
  } catch {
    /* ignorieren */
  }
  return randomLook();
}
