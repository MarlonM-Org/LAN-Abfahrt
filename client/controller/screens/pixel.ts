import type { PixelPrivate, PixelState } from '../../../shared/types';
import { PIXEL, PIXEL_CELLS, PIXEL_COLORS, PIXEL_NAMES, cellsToPic, floodFill, paintPic, picToCells } from '../../../shared/pixel';
import { type Screen, app, el, escapeHtml, message, q, send, socket, store, tapButton, timerText, toast } from '../core';

type Tool = 'pen' | 'fill' | 'erase';

/** Lokaler Entwurf – überlebt einen Neuaufbau des Screens (z. B. kurzer WLAN-Aussetzer) */
const local = { round: -1, cells: [] as number[], history: [] as number[][], color: 0, tool: 'pen' as Tool };

const UNDO_MAX = 40;

const pix = () => (store.state?.mini?.kind === 'pixel' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Runde und Phase passt */
const priv = (): PixelPrivate | null => {
  const p = store.priv?.kind === 'pixel' ? store.priv.state : null;
  const s = pix();
  return p && s && p.round === s.round && p.sub === s.sub ? p : null;
};

export function pickPixel(s: PixelState, vip: boolean): Screen {
  const id = store.playerId!;
  if (!s.players.includes(id)) return ['px-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  switch (s.sub) {
    case 'intro':
      return [`px-intro-${s.round}-${vip}`, () => buildIntro(s, vip)];
    case 'paint':
      // Schlüssel ändert sich während der Malphase nie → das Bild wird nicht neu aufgebaut
      return [`px-paint-${s.round}`, () => buildPaint(s)];
    case 'vote': {
      const p = priv();
      if (!p) return ['px-wait', message('Moment ...')];
      return [`px-vote-${s.round}-${p.canVote}-${p.mine}-${vip}`, () => buildVote(s, p, vip)];
    }
    case 'reveal':
      return [`px-reveal-${s.round}-${vip}`, () => buildReveal(s, vip)];
    case 'scores':
      return [`px-scores-${s.round}-${vip}`, () => buildScores(s, vip)];
    default:
      return ['px-over', message('Die Galerie schließt!', 'Gleich gibt’s die Auswertung ...')];
  }
}

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="big-btn px-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    navigator.vibrate?.(15);
    socket.emit('vip:mini', 'next');
  });
  return b;
}

// ------------------------------------------------------------------ Intro

function buildIntro(s: PixelState, vip: boolean) {
  const root = el(`
    <div class="center">
      <h1>Runde ${s.round}/${s.rounds}</h1>
      <p>Das Thema:</p>
      <h2 class="px-theme">${escapeHtml(s.prompt)}</h2>
      <p>${s.round === 1 ? 'Male es auf 16 × 16 Pixeln – Stift, Eimer, Radierer. Danach stimmen alle ab!' : 'Gleich geht’s los ...'}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton('Los geht’s!'));
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Malen

function buildPaint(s: PixelState) {
  const round = s.round;
  if (local.round !== round) {
    local.round = round;
    local.cells = picToCells(null);
    local.history = [];
    local.tool = 'pen';
  }
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Runde ${s.round}/${s.rounds}</span></div>
    <div class="sp-prompt"><small>Male:</small><h2>${escapeHtml(s.prompt)}</h2></div>
    <canvas class="px-canvas"></canvas>
    <div class="px-palette"></div>
    <div class="px-tools">
      <button class="secondary" data-tool="pen">Stift</button>
      <button class="secondary" data-tool="fill">Eimer</button>
      <button class="secondary" data-tool="erase">Radierer</button>
      <button class="secondary" data-act="undo">Zurück</button>
      <button class="secondary" data-act="clear">Leeren</button>
    </div>
    <button data-act="done">Fertig!</button>
    <p class="wait"></p>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const g = canvas.getContext('2d')!;
  const doneBtn = q<HTMLButtonElement>(root, '[data-act=done]');
  const wait = q(root, '.wait');
  let done = false;
  let restored = false;

  // ---- Palette + Werkzeuge
  const palette = q(root, '.px-palette');
  const swatches = PIXEL_COLORS.map((col, i) => {
    const b = document.createElement('button');
    b.className = 'px-swatch';
    b.style.background = col;
    b.setAttribute('aria-label', PIXEL_NAMES[i]);
    tapButton(b, () => {
      local.color = i;
      if (local.tool === 'erase') local.tool = 'pen';
      refreshTools();
    });
    palette.append(b);
    return b;
  });
  const toolBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  for (const b of toolBtns) {
    tapButton(b, () => {
      local.tool = b.dataset.tool as Tool;
      refreshTools();
    });
  }
  const refreshTools = () => {
    swatches.forEach((b, i) => b.classList.toggle('active', i === local.color && local.tool !== 'erase'));
    toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === local.tool));
  };
  refreshTools();
  tapButton(q(root, '[data-act=undo]'), () => {
    if (done) return;
    const prev = local.history.pop();
    if (!prev) return;
    local.cells = prev;
    redraw();
    scheduleDraft();
  });
  q(root, '[data-act=clear]').addEventListener('click', () => {
    if (done || local.cells.every((c) => c < 0) || !confirm('Bild wirklich löschen?')) return;
    pushHistory();
    local.cells = picToCells(null);
    redraw();
    scheduleDraft();
  });

  // ---- Senden
  let draftTimer: number | undefined;
  const scheduleDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => send('paint', { round, pic: cellsToPic(local.cells), done: false }), 400);
  };
  const setDone = (d: boolean) => {
    done = d;
    doneBtn.textContent = d ? 'Doch noch ändern' : 'Fertig!';
    doneBtn.classList.toggle('secondary', d);
    root.classList.toggle('px-locked', d);
  };
  doneBtn.addEventListener('click', () => {
    if (done) {
      send('undone');
      return setDone(false);
    }
    if (local.cells.every((c) => c < 0)) return toast('Noch ist die Leinwand leer – male etwas!');
    clearTimeout(draftTimer);
    send('paint', { round, pic: cellsToPic(local.cells), done: true });
    navigator.vibrate?.(20);
    setDone(true);
  });

  // ---- Zeichnen
  const N = PIXEL.SIZE;
  let cellPx = 0;
  const resize = () => {
    if (!canvas.isConnected) return window.removeEventListener('resize', resize);
    const w = canvas.getBoundingClientRect().width || 300;
    const c = Math.max(4, Math.round((w * Math.min(3, window.devicePixelRatio || 1)) / N));
    if (c !== cellPx) {
      cellPx = c;
      canvas.width = canvas.height = c * N;
      redraw();
    }
  };
  const redraw = () => {
    if (!cellPx) return;
    paintPic(g, cellsToPic(local.cells), cellPx, true);
    // feines Raster als Orientierung
    g.fillStyle = 'rgba(61, 36, 20, 0.13)';
    for (let i = 1; i < N; i++) {
      g.fillRect(i * cellPx, 0, 1, N * cellPx);
      g.fillRect(0, i * cellPx, N * cellPx, 1);
    }
    g.fillStyle = 'rgba(61, 36, 20, 0.3)';
    g.fillRect((N / 2) * cellPx, 0, 1, N * cellPx);
    g.fillRect(0, (N / 2) * cellPx, N * cellPx, 1);
  };
  const pushHistory = () => {
    local.history.push([...local.cells]);
    if (local.history.length > UNDO_MAX) local.history.shift();
  };
  const cellAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N);
    const y = Math.floor(((e.clientY - r.top) / r.height) * N);
    return { x: Math.max(0, Math.min(N - 1, x)), y: Math.max(0, Math.min(N - 1, y)) };
  };
  const value = () => (local.tool === 'erase' ? -1 : local.color);
  let changed = false;
  const plot = (x: number, y: number) => {
    const i = y * N + x;
    if (local.cells[i] === value()) return;
    local.cells[i] = value();
    changed = true;
  };
  /** Linie zwischen zwei Feldern (Bresenham) – schnelles Wischen lässt keine Lücken */
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) (err += dy), (x0 += sx);
      if (e2 <= dx) (err += dx), (y0 += sy);
    }
  };
  let active: number | null = null;
  let last = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    if (done || active !== null) return;
    e.preventDefault();
    resize();
    const c = cellAt(e);
    if (local.tool === 'fill') {
      const before = [...local.cells];
      if (floodFill(local.cells, c.x, c.y, local.color)) {
        local.history.push(before);
        if (local.history.length > UNDO_MAX) local.history.shift();
        redraw();
        scheduleDraft();
        navigator.vibrate?.(10);
      }
      return;
    }
    active = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    pushHistory();
    changed = false;
    plot(c.x, c.y);
    last = c;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const c = cellAt(ev);
      if (c.x === last.x && c.y === last.y) continue;
      line(last.x, last.y, c.x, c.y);
      last = c;
    }
    redraw();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    // Nichts verändert (z. B. gleiche Farbe) → keinen leeren Undo-Schritt behalten
    if (!changed) local.history.pop();
    else scheduleDraft();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  app.append(root);
  requestAnimationFrame(resize);
  window.addEventListener('resize', resize);
  const filledLocal = () => local.cells.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0);

  return () => {
    const st = pix();
    if (!st) return;
    if (!cellPx) resize();
    q(root, '.timer').textContent = timerText();
    const p = priv();
    // Nach Neuladen der Seite: Entwurf vom Server zurückholen
    if (p && !restored) {
      restored = true;
      if (p.pic && filledLocal() === 0) {
        local.cells = picToCells(p.pic);
        redraw();
      }
    }
    if (p && p.done !== done) setDone(p.done);
    const n = st.players.length;
    const missing = n - st.done.length;
    wait.textContent = done ? (missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle fertig!') : `${st.done.length}/${n} fertig · ${filledLocal()}/${PIXEL_CELLS} Pixel`;
  };
}

// ------------------------------------------------------------------ Abstimmung

function picCanvas(pic: string, cell = 6) {
  const c = document.createElement('canvas');
  c.width = c.height = PIXEL.SIZE * cell;
  paintPic(c.getContext('2d')!, pic, cell);
  return c;
}

function buildVote(s: PixelState, p: PixelPrivate, vip: boolean) {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Runde ${s.round}/${s.rounds}</span></div>
    <h2>Vernissage!</h2>
    <p class="wait">${p.canVote ? 'Tippe auf dein Lieblingsbild (nicht dein eigenes).' : 'Schau auf den Fernseher!'}</p>
    <div class="px-votes"></div>
  `);
  const list = q(root, '.px-votes');
  if (s.gallery.length > 6) list.classList.add('many');
  let picked: number | null = p.myVote;
  const buttons = s.gallery.map((e, i) => {
    const b = document.createElement('button');
    b.className = 'px-vote';
    const label = document.createElement('small');
    label.textContent = i === p.mine ? 'Dein Bild' : `Nr. ${i + 1}`;
    b.append(picCanvas(e.pic), label);
    b.addEventListener('click', () => {
      if (picked !== null || b.disabled || !p.canVote) return;
      picked = i;
      navigator.vibrate?.(20);
      send('vote', { round: s.round, idx: i });
      refresh();
    });
    list.append(b);
    return b;
  });
  if (vip) {
    const end = el(`<button class="secondary small">Abstimmung beenden</button>`).firstElementChild as HTMLButtonElement;
    end.addEventListener('click', () => socket.emit('vip:mini', 'next'));
    root.append(end);
  }
  const refresh = () => {
    const pp = priv();
    if (pp?.myVote != null) picked = pp.myVote;
    buttons.forEach((b, i) => {
      b.disabled = !p.canVote || i === p.mine || (picked !== null && picked !== i);
      b.classList.toggle('active', picked === i);
      b.classList.toggle('mine', i === p.mine);
    });
    if (picked !== null) q(root, '.wait').textContent = 'Danke! Warte auf die anderen ...';
  };
  app.append(root);
  refresh();
  return () => {
    q(root, '.timer').textContent = timerText();
    refresh();
  };
}

// ------------------------------------------------------------------ Auflösung + Zwischenstand

function buildReveal(s: PixelState, vip: boolean) {
  const id = store.playerId!;
  const mine = s.gallery.find((e) => e.by === id);
  const votes = mine?.votes ?? 0;
  const max = Math.max(0, ...s.gallery.map((e) => e.votes ?? 0));
  const root = el(`
    <div class="center">
      <h2>„${escapeHtml(s.prompt)}“</h2>
      <div class="px-mine"></div>
      <h1>${!mine ? 'Kein Bild diesmal' : votes ? `+${votes} ${votes === 1 ? 'Stimme' : 'Stimmen'}!` : 'Keine Stimme diesmal'}</h1>
      ${mine && votes && votes === max ? '<p class="yellow">Publikumsliebling der Runde!</p>' : ''}
      <p>Schau auf den Fernseher!</p>
    </div>
  `);
  if (mine) q(root, '.px-mine').append(picCanvas(mine.pic, 8));
  if (vip) q(root, '.center').append(nextButton('Weiter'));
  app.append(root);
  return null;
}

function buildScores(s: PixelState, vip: boolean) {
  const id = store.playerId!;
  const ranked = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const last = s.round >= s.rounds;
  const root = el(`
    <div class="center">
      <h2>${last ? 'Endstand' : `Nach Runde ${s.round}/${s.rounds}`}</h2>
      <h1>${s.points[id] ?? 0} ${(s.points[id] ?? 0) === 1 ? 'Stimme' : 'Stimmen'}</h1>
      <p>Platz ${place} von ${s.players.length}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(last ? 'Zur Auswertung' : 'Nächste Runde'));
  app.append(root);
  return null;
}
