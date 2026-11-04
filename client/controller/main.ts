import { io } from 'socket.io-client';
import type { FlunkyState, GameState, JoinResponse, Look, Team } from '../../shared/types';
import { AV_H, AV_W, HAIRS, HAIR_STYLES, SHIRTS, SKINS, drawAvatar, randomLook, sanitizeLook } from '../../shared/avatar';
import { RUN_TAPS, TEAM_INFO, otherTeam } from '../../shared/flunky';

const LS = { id: 'lanabfahrt.playerId', name: 'lanabfahrt.name', look: 'lanabfahrt.look' };

const socket = io();
const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

let playerId: string | undefined = localStorage.getItem(LS.id) ?? undefined;
let name = localStorage.getItem(LS.name) ?? '';
let look: Look = loadLook();
let joined = false;
let editing = !name;
let state: GameState | null = null;

let screenKey = '';
let updater: (() => void) | null = null;

// ---------------------------------------------------------------- Netzwerk

function join() {
  socket.emit('player:join', { name, look, playerId }, (r: JoinResponse) => {
    if (r.ok && r.playerId) {
      playerId = r.playerId;
      localStorage.setItem(LS.id, r.playerId);
      joined = true;
      editing = false;
      requestWakeLock();
    } else {
      toast(r.error ?? 'Beitreten hat nicht geklappt.');
      joined = false;
    }
    render();
  });
}

socket.on('connect', () => {
  if (name && !editing) join();
  else render();
});
socket.on('disconnect', () => {
  joined = false;
  render();
});
socket.on('toast', (msg: string) => toast(msg));
socket.on('state', (s: GameState) => {
  state = s;
  // Server neu gestartet oder aus der Lobby geflogen → neu beitreten
  if (joined && !s.players.some((p) => p.id === playerId)) {
    joined = false;
    if (name && !editing) join();
  }
  render();
});

// ---------------------------------------------------------------- Rendering

/** Baut den Screen nur neu, wenn sich der "Screen-Typ" ändert – sonst nur Werte aktualisieren.
 *  So gehen keine Taps oder Wischgesten verloren, während Updates reinkommen. */
function render() {
  const [key, build] = pickScreen();
  if (key !== screenKey) {
    screenKey = key;
    app.innerHTML = '';
    updater = build();
  }
  updater?.();
}

type Builder = () => (() => void) | null;

function pickScreen(): [string, Builder] {
  if (editing || !name) return ['edit', buildEdit];
  if (!socket.connected) return ['offline', () => buildMessage('Verbinde ...', 'Bist du im selben WLAN wie der PC?')];
  if (!joined || !state) return ['joining', () => buildMessage('Trete bei ...')];
  const me = state.players.find((p) => p.id === playerId);
  const vip = !!me?.isVip;

  if (state.phase === 'lobby') return [`lobby-${vip}`, () => buildLobby(vip)];

  const f = state.flunky;
  if (!f || !playerId) return ['wait', () => buildMessage('Warte ...')];
  const team = teamOf(f, playerId);
  if (!team) return ['spectate', () => buildMessage('Du schaust zu', 'Nächste Runde bist du dabei!')];

  switch (f.sub) {
    case 'aim':
      return f.throwerId === playerId ? [`aim-me-${f.lastThrow?.seq ?? 0}`, () => buildAim(team)] : ['aim-other', () => buildWatch(team)];
    case 'flight':
      return ['flight', () => buildMessage('Der Ball fliegt ...', 'Schau auf den Fernseher!')];
    case 'chug':
      if (team === f.turnTeam) return (f.beer[playerId] ?? 0) > 0 ? ['drink', () => buildDrink(team)] : ['drunk', () => buildMessage('Ausgetrunken!', 'Feuer dein Team an!')];
      if (f.runnerId === playerId) return ['run', () => buildRun(team)];
      return ['chug-watch', () => buildWatch(team)];
    case 'reset':
      return ['reset', () => buildMessage('Flasche steht wieder!', 'Wechsel ...')];
    case 'over':
      return [`over-${vip}`, () => buildOver(team, vip)];
  }
}

function buildEdit() {
  const preview = avatarCanvas(8);
  const root = el(`
    <h1>LAN-ABFAHRT</h1>
    <div class="panel"></div>
    <label>Dein Name</label>
    <input type="text" maxlength="12" placeholder="z. B. Marlon" />
    <div class="pickers"></div>
    <button class="secondary small" data-act="random">Zufall</button>
    <button data-act="go">Los geht's!</button>
  `);
  root.querySelector('.panel')!.append(preview);
  const input = root.querySelector('input')!;
  input.value = name;

  const pickers = root.querySelector('.pickers')!;
  const fields: { key: keyof Look; label: string; n: number; text: (i: number) => string }[] = [
    { key: 'skin', label: 'Haut', n: SKINS.length, text: (i) => `${i + 1}/${SKINS.length}` },
    { key: 'hairStyle', label: 'Frisur', n: HAIR_STYLES.length, text: (i) => HAIR_STYLES[i] },
    { key: 'hair', label: 'Haare', n: HAIRS.length, text: (i) => `${i + 1}/${HAIRS.length}` },
    { key: 'shirt', label: 'Shirt', n: SHIRTS.length, text: (i) => `${i + 1}/${SHIRTS.length}` },
  ];
  const valueEls: HTMLElement[] = [];
  for (const f of fields) {
    const row = el(`<div class="picker"><span>${f.label}</span><button class="small">&lt;</button><span class="value"></span><button class="small">&gt;</button></div>`).firstElementChild as HTMLElement;
    const [prev, next] = row.querySelectorAll('button');
    const step = (d: number) => {
      look = { ...look, [f.key]: (look[f.key] + d + f.n) % f.n };
      update();
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    valueEls.push(row.querySelector('.value') as HTMLElement);
    pickers.append(row);
  }
  root.querySelector('[data-act=random]')!.addEventListener('click', () => {
    look = randomLook();
    update();
  });
  root.querySelector('[data-act=go]')!.addEventListener('click', () => {
    const n = input.value.trim().slice(0, 12);
    if (!n) return toast('Bitte gib einen Namen ein.');
    name = n;
    localStorage.setItem(LS.name, name);
    localStorage.setItem(LS.look, JSON.stringify(look));
    editing = false;
    if (socket.connected) join();
    render();
  });
  app.append(root);

  const update = () => {
    paintAvatar(preview, look);
    fields.forEach((f, i) => (valueEls[i].textContent = f.text(look[f.key])));
  };
  update();
  return null;
}

function buildLobby(vip: boolean) {
  const preview = avatarCanvas(6);
  const root = el(`
    <h1>LAN-ABFAHRT</h1>
    <div class="panel"></div>
    <h2 class="hello"></h2>
    <p class="count"></p>
    <div class="center"></div>
    <button class="secondary small" data-act="edit">Charakter ändern</button>
  `);
  root.querySelector('.panel')!.append(preview);
  paintAvatar(preview, look);
  const center = root.querySelector('.center')!;
  let startBtn: HTMLButtonElement | null = null;
  if (vip) {
    center.append(el(`<p>Du bist der VIP – du startest die Spiele.</p>`));
    startBtn = el(`<button>Flunkyball starten</button>`).firstElementChild as HTMLButtonElement;
    startBtn.addEventListener('click', () => socket.emit('vip:start', 'flunky'));
    center.append(startBtn);
  } else {
    center.append(el(`<p>Warte, bis der VIP das Spiel startet ...</p>`));
  }
  root.querySelector('[data-act=edit]')!.addEventListener('click', () => {
    editing = true;
    render();
  });
  app.append(root);

  return () => {
    const n = state?.players.filter((p) => p.connected).length ?? 0;
    (root.querySelector('.hello') as HTMLElement).textContent = `Hi ${name}!`;
    (root.querySelector('.count') as HTMLElement).textContent = `${n} Spieler in der Lobby`;
    if (startBtn) startBtn.disabled = n < 2;
  };
}

function buildAim(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>Du wirfst!</h2>
    <p class="wind"></p>
    <div class="swipe-pad">
      <div class="arrow">^</div>
      <p class="pad-text">Schnell nach oben wischen!<br/>Länge = Kraft, Richtung = Ziel</p>
    </div>
  `);
  app.append(root);
  const pad = root.querySelector('.swipe-pad') as HTMLElement;
  const padText = root.querySelector('.pad-text') as HTMLElement;
  let start: { x: number; y: number; id: number } | null = null;
  let thrown = false;

  pad.addEventListener('pointerdown', (e) => {
    if (thrown) return;
    pad.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  pad.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id || thrown) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (-dy < 40) {
      padText.textContent = 'Nach OBEN wischen!';
      return;
    }
    const angle = Math.atan2(dx, -dy);
    const power = Math.min(1, -dy / (pad.clientHeight * 0.9));
    thrown = true;
    navigator.vibrate?.(30);
    padText.textContent = `Wurf! Kraft ${Math.round(power * 100)}%`;
    socket.emit('flunky:throw', { angle, power });
  });

  return () => {
    const f = state?.flunky;
    if (f) (root.querySelector('.wind') as HTMLElement).textContent = windText(f.wind);
  };
}

function buildDrink(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>TREFFER! Trinken!</h2>
    <p>So schnell tippen wie du kannst!</p>
    <button class="big-btn drink">TRINKEN!</button>
    <p>Dein Bier</p>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  tapButton(root.querySelector('.big-btn') as HTMLButtonElement);
  const fill = root.querySelector('.meter > div') as HTMLElement;
  return () => {
    const beer = (playerId && state?.flunky?.beer[playerId]) || 0;
    fill.style.width = `${beer}%`;
  };
}

function buildRun(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>LAUF! Stell die Flasche auf!</h2>
    <p>Tippen = Laufen. Schnell, bevor die anderen austrinken!</p>
    <button class="big-btn run">LAUFEN!</button>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  tapButton(root.querySelector('.big-btn') as HTMLButtonElement);
  const fill = root.querySelector('.meter > div') as HTMLElement;
  fill.style.background = 'var(--sea)';
  return () => {
    const p = state?.flunky?.runProgress ?? 0;
    fill.style.width = `${(p / RUN_TAPS) * 100}%`;
  };
}

function buildWatch(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <div class="center">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <p>Dein Bier</p>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  const fill = root.querySelector('.meter > div') as HTMLElement;
  return () => {
    const f = state?.flunky;
    if (!f || !state) return;
    const nameOf = (id: string | null) => state!.players.find((p) => p.id === id)?.name ?? '?';
    const headline = root.querySelector('.headline') as HTMLElement;
    const sub = root.querySelector('.sub') as HTMLElement;
    if (f.sub === 'aim') {
      headline.textContent = `${nameOf(f.throwerId)} wirft ...`;
      sub.textContent = f.turnTeam === team ? 'Dein Team ist dran – Daumen drücken!' : 'Hoffentlich daneben!';
    } else {
      headline.textContent = `${TEAM_INFO[f.turnTeam].name} trinkt!`;
      sub.textContent = `${nameOf(f.runnerId)} läuft für ${TEAM_INFO[otherTeam(f.turnTeam)].name} – anfeuern!`;
    }
    fill.style.width = `${(playerId && f.beer[playerId]) || 0}%`;
  };
}

function buildOver(team: Team, vip: boolean) {
  const won = state?.flunky?.winner === team;
  const root = el(`
    ${teamBadge(team)}
    <div class="center">
      <h1>${won ? 'GEWONNEN!' : 'VERLOREN!'}</h1>
      <p>${won ? 'Ihr habt am schnellsten ausgetrunken.' : 'Revanche?'}</p>
    </div>
  `);
  if (vip) {
    const btn = el(`<button>Zurück zur Lobby</button>`).firstElementChild as HTMLButtonElement;
    btn.addEventListener('click', () => socket.emit('vip:lobby'));
    root.append(btn);
  }
  app.append(root);
  navigator.vibrate?.(won ? [80, 60, 80] : 200);
  return null;
}

function buildMessage(title: string, sub = '') {
  app.append(el(`<div class="center"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div>`));
  return null;
}

// ---------------------------------------------------------------- Helfer

function tapButton(btn: HTMLButtonElement) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    socket.emit('flunky:tap');
    navigator.vibrate?.(8);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

function teamOf(f: FlunkyState, id: string): Team | null {
  if (f.teams.A.includes(id)) return 'A';
  if (f.teams.B.includes(id)) return 'B';
  return null;
}

function teamBadge(team: Team) {
  return `<div class="team-badge team-${team}">${TEAM_INFO[team].name}</div>`;
}

function windText(w: number) {
  const n = Math.round(Math.abs(w) * 3);
  if (n === 0) return 'Windstill';
  return `Wind ${(w < 0 ? '<' : '>').repeat(n)} – zieht nach ${w < 0 ? 'links' : 'rechts'}`;
}

function avatarCanvas(scale: number) {
  const c = document.createElement('canvas');
  c.width = AV_W * scale;
  c.height = AV_H * scale;
  c.className = 'avatar';
  c.dataset.scale = String(scale);
  return c;
}

function paintAvatar(c: HTMLCanvasElement, l: Look) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  drawAvatar(ctx, l, 0, 0, Number(c.dataset.scale));
}

function el(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const frag = document.createElement('div');
  frag.style.display = 'contents';
  frag.append(t.content);
  return frag;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
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

let toastTimer: number | undefined;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 2500);
}

async function requestWakeLock() {
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    /* nur über HTTPS verfügbar – egal */
  }
}

render();
