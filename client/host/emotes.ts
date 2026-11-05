/**
 * Zuschauer-Overlay auf dem TV (DOM statt Phaser, damit keine Szene angefasst werden muss):
 *
 * - Emotes (😂 😱 👏 🍅) steigen mit Mini-Porträt des Spielers vom unteren Rand auf und verblassen
 * - Wetten der Ausgeschiedenen: kleine Anzeige „🎲 3 Wetten auf Lena“ (aus `mini.state.spectator`)
 * - Richtig getippt: Konfetti + Zeile „🎲 Ben & Mia lagen richtig!“
 *
 * Liest nur den Zustand aus `store.ts` – in `main.ts` genügt `initSpectatorOverlay()`.
 */
import type { GameState, PlayerPublic } from '../../shared/types';
import { AV_W, drawAvatar } from '../../shared/avatar';
import { EMOTES, type SpectatorInfo } from '../../shared/spectator';
import { bus } from './store';
import { sfx } from './sfx';

/** Nur die Kopfpartie des Avatars (Reihen 0 … 14) */
const HEAD_ROWS = 15;
const CONFETTI = ['#e0503f', '#3f8fe0', '#ffd25e', '#46b04a', '#f07aa8', '#9b5fc0', '#f4efe2'];

let layer: HTMLElement;
let betBox: HTMLElement;
let lastEmoteSeq = 0;
let primed = false;
let lastBetFx = '';
let betKey = '';
const portraits = new Map<string, string>();

export function initSpectatorOverlay() {
  layer = document.getElementById('spec-layer') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'spec-layer' }));
  betBox = document.createElement('div');
  betBox.className = 'spec-bets off';
  layer.append(betBox);
  bus.on('state', (s: GameState) => {
    try {
      update(s);
    } catch (e) {
      console.error(e);
    }
  });
}

function update(s: GameState) {
  // Emotes: nur neue (seq) – beim ersten Zustand nach dem Laden nichts nachholen
  const list = s.emotes ?? [];
  const newest = list.length ? list[list.length - 1].seq : lastEmoteSeq;
  if (!primed || newest < lastEmoteSeq) {
    primed = true;
    lastEmoteSeq = newest;
  } else {
    for (const e of list) {
      if (e.seq <= lastEmoteSeq) continue;
      const p = s.players.find((x) => x.id === e.playerId);
      if (p) floatEmote(p, EMOTES[e.i] ?? '❓', s.players);
    }
    lastEmoteSeq = newest;
  }

  const spec = s.phase === 'mini' ? spectatorOf(s) : null;
  showBets(s, spec);
  if (spec) {
    const fx = spec.fx[spec.fx.length - 1];
    const key = fx ? `${s.mini!.kind}-${fx.seq}` : '';
    if (lastBetFx === '') lastBetFx = key || '-';
    else if (key && key !== lastBetFx) {
      lastBetFx = key;
      if (fx.ids.length) celebrate(fx.ids.map((id) => nameOf(s, id)));
    }
  } else if (s.phase !== 'mini') lastBetFx = '';
}

function spectatorOf(s: GameState): SpectatorInfo | null {
  const st = s.mini?.state as { spectator?: SpectatorInfo } | undefined;
  return st?.spectator ?? null;
}

const nameOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)?.name ?? '?';

function portrait(p: PlayerPublic): string {
  const key = `${p.id}:${JSON.stringify(p.look)}`;
  let url = portraits.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = AV_W;
    c.height = HEAD_ROWS;
    drawAvatar(c.getContext('2d')!, p.look);
    url = c.toDataURL();
    portraits.set(key, url);
  }
  return url;
}

/** Ein Emote steigt über der „Bank“ des Spielers auf (Position nach Reihenfolge in der Spielerliste) */
function floatEmote(p: PlayerPublic, emoji: string, all: PlayerPublic[]) {
  const idx = Math.max(0, all.indexOf(p));
  const n = Math.max(1, all.length);
  // rechts unten bleibt Platz für die Wett-Anzeige
  const x = n === 1 ? 45 : 6 + (idx / (n - 1)) * 76;
  const el = document.createElement('div');
  el.className = 'spec-emote';
  el.style.left = `calc(${x}% + ${Math.round((Math.random() - 0.5) * 3)}vh)`;
  el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 8)}vh`);
  const img = document.createElement('img');
  img.src = portrait(p);
  img.alt = '';
  const em = document.createElement('span');
  em.textContent = emoji;
  el.append(em, img);
  layer.append(el);
  el.addEventListener('animationend', () => el.remove());
  sfx('pop', { pan: x / 50 - 1, vol: 0.35, pitch: 1.6 });
}

/** „🎲 3 Wetten auf Lena“ – je Tipp eine Zeile, sortiert nach Anzahl */
function showBets(s: GameState, spec: SpectatorInfo | null) {
  const counts = new Map<string, number>();
  for (const on of Object.values(spec?.bets ?? {})) counts.set(on, (counts.get(on) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const key = rows.map(([id, c]) => `${id}:${c}`).join(',') + `|${spec?.roundWinner ?? ''}`;
  if (key === betKey) return;
  betKey = key;
  betBox.classList.toggle('off', !rows.length);
  if (!rows.length) return;
  betBox.innerHTML = '';
  for (const [id, c] of rows) {
    const row = document.createElement('div');
    const won = spec?.roundWinner === id;
    row.className = `spec-bet${won ? ' won' : spec?.roundWinner !== undefined ? ' lost' : ''}`;
    row.textContent = `🎲 ${c} ${c === 1 ? 'Wette' : 'Wetten'} auf ${nameOf(s, id)}${won ? ' ✔' : ''}`;
    betBox.append(row);
  }
}

/** Richtig getippt: Konfetti von oben + Zeile in der Mitte */
function celebrate(names: string[]) {
  const banner = document.createElement('div');
  banner.className = 'spec-win';
  const who = names.length <= 3 ? names.join(' & ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  banner.textContent = `🎲 ${who} ${names.length === 1 ? 'lag' : 'lagen'} richtig! +1`;
  layer.append(banner);
  banner.addEventListener('animationend', () => banner.remove());
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'spec-confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = CONFETTI[i % CONFETTI.length];
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    c.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    c.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 1440)}deg`);
    c.style.setProperty('--sway', `${Math.round((Math.random() - 0.5) * 16)}vh`);
    layer.append(c);
    c.addEventListener('animationend', () => c.remove());
  }
  sfx('cheer', { vol: 0.6 });
}
