import type { PostDrawing, PostStroke, StillepostPrivate, StillepostState } from '../../../shared/types';
import { POST, POST_BRUSHES, POST_COLORS, POST_ERASER, POST_PAPER, drawingPoints, paintDrawing, paintStroke } from '../../../shared/stillepost';
import { type Screen, app, el, escapeHtml, message, nameOf, q, secondsLeft, send, socket, store, tapButton, toast } from '../core';

/** Lokaler Entwurf – überlebt einen Neuaufbau des Screens (z. B. kurzer WLAN-Aussetzer) */
const local = { round: -1, task: '', strokes: [] as PostStroke[], text: '', color: 0, size: 1 };

const post = () => (store.state?.mini?.kind === 'stillepost' ? store.state.mini.state : null);
const priv = (task?: StillepostPrivate['task']): StillepostPrivate | null => {
  const p = store.priv?.kind === 'stillepost' ? store.priv.state : null;
  const s = post();
  if (!p || !s || p.round !== s.round) return null;
  return !task || p.task === task ? p : null;
};

export function pickStillepost(s: StillepostState, vip: boolean): Screen {
  const id = store.playerId!;
  if (!(id in s.likes)) return ['sp-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  switch (s.sub) {
    case 'write':
    case 'describe':
      return [`sp-text-${s.round}`, () => buildText(s)];
    case 'draw':
      return [`sp-draw-${s.round}`, () => buildDraw(s)];
    case 'reveal':
      return [`sp-reveal-${s.chain}-${vip}`, () => buildReveal(vip)];
    case 'vote':
      return [`sp-vote-${s.chain}-${vip}`, () => buildVote(s, vip)];
    case 'tally':
      return [`sp-tally-${s.chain}-${vip}`, () => buildTally(s, vip)];
    default:
      return ['sp-over', message('Das war Stille Post!', 'Gleich gibt’s die Auswertung ...')];
  }
}

function resetLocal(s: StillepostState) {
  if (local.round !== s.round || local.task !== s.sub) {
    local.round = s.round;
    local.task = s.sub;
    local.strokes = [];
    local.text = '';
  }
}

function header(s: StillepostState) {
  return `<div class="top-row"><span class="timer"></span><span>Schritt ${s.round}/${s.steps}</span></div>`;
}

/** Wartetext + Fertig/Ändern-Button gemeinsam für Schreiben und Malen */
function doneControls(root: HTMLElement, onDone: () => boolean) {
  const btn = q<HTMLButtonElement>(root, '[data-act=done]');
  const wait = q(root, '.wait');
  let done = false;
  const set = (d: boolean) => {
    done = d;
    btn.textContent = d ? 'Doch noch ändern' : 'Fertig!';
    btn.classList.toggle('secondary', d);
    root.classList.toggle('sp-locked', d);
  };
  btn.addEventListener('click', () => {
    if (done) {
      send('undone');
      set(false);
    } else if (onDone()) {
      navigator.vibrate?.(20);
      set(true);
    }
  });
  return {
    get done() {
      return done;
    },
    update(s: StillepostState, p: StillepostPrivate | null) {
      if (p && p.done !== done) set(p.done);
      q(root, '.timer').textContent = `${secondsLeft()}s`;
      const missing = s.order.length - s.done.length;
      wait.textContent = done ? (missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle fertig!') : `${s.done.length}/${s.order.length} fertig`;
    },
  };
}

// ------------------------------------------------------------------ Schreiben / Beschreiben

function buildText(s: StillepostState) {
  resetLocal(s);
  const write = s.sub === 'write';
  const root = el(`
    ${header(s)}
    <h2>${write ? 'Schreib einen Satz, den jemand malen soll!' : 'Was ist auf dem Bild zu sehen?'}</h2>
    ${write ? '' : '<canvas class="sp-canvas view"></canvas>'}
    <textarea class="sp-input" rows="3" maxlength="${POST.MAX_TEXT}" placeholder="${write ? 'z. B. Ein Flamingo verliert beim Limbo' : 'Beschreib das Bild ...'}"></textarea>
    ${write ? '<button class="secondary small" data-act="rand">Zufällig</button>' : ''}
    <button data-act="done">Fertig!</button>
    <p class="wait"></p>
  `);
  const input = q<HTMLTextAreaElement>(root, '.sp-input');
  input.value = local.text;
  const round = s.round;
  let draftTimer: number | undefined;
  const sendDraft = (done = false) => {
    clearTimeout(draftTimer);
    send('text', { round, text: input.value, done });
  };
  input.addEventListener('input', () => {
    local.text = input.value;
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => sendDraft(), 600);
  });
  const ctl = doneControls(root, () => {
    if (input.value.trim().length < 2) {
      toast(write ? 'Schreib etwas – oder tippe auf „Zufällig“.' : 'Schreib, was du siehst!');
      return false;
    }
    input.blur();
    sendDraft(true);
    return true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      q<HTMLButtonElement>(root, '[data-act=done]').click();
    }
  });
  let lastSuggest = 0;
  if (write) q(root, '[data-act=rand]').addEventListener('click', () => !ctl.done && send('random'));

  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  let painted: PostDrawing | null = null;
  app.append(root);

  return () => {
    const st = post();
    if (!st) return;
    const p = priv(st.sub as 'write' | 'describe');
    ctl.update(st, p);
    input.disabled = ctl.done;
    if (p?.suggest && p.suggest.seq !== lastSuggest) {
      lastSuggest = p.suggest.seq;
      input.value = local.text = p.suggest.text;
    }
    if (canvas && p?.drawing && p.drawing !== painted) {
      painted = p.drawing;
      const size = fitCanvas(canvas);
      paintDrawing(canvas.getContext('2d')!, painted, size);
    }
  };
}

/** Canvas-Pixelgröße an die angezeigte Breite anpassen (scharf auf Retina) */
function fitCanvas(canvas: HTMLCanvasElement) {
  const w = canvas.getBoundingClientRect().width || 300;
  const size = Math.round(w * Math.min(3, window.devicePixelRatio || 1));
  if (canvas.width !== size) canvas.width = canvas.height = size;
  return size;
}

// ------------------------------------------------------------------ Malen

function buildDraw(s: StillepostState) {
  resetLocal(s);
  const root = el(`
    ${header(s)}
    <div class="sp-prompt"><small>Male:</small><h2 class="sp-text">...</h2></div>
    <canvas class="sp-canvas draw"></canvas>
    <div class="sp-palette"></div>
    <div class="sp-tools"></div>
    <button data-act="done">Fertig!</button>
    <p class="wait"></p>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const g = canvas.getContext('2d')!;
  const base = document.createElement('canvas');
  const round = s.round;
  let size = 0;
  let current: (PostStroke & { fx: number; fy: number }) | null = null;
  let dirty = true;
  let warned = false;

  // ---- Werkzeuge
  const palette = q(root, '.sp-palette');
  const swatches: HTMLButtonElement[] = [];
  [...POST_COLORS, POST_PAPER].forEach((col, i) => {
    const b = document.createElement('button');
    b.className = `sp-swatch${i === POST_ERASER ? ' eraser' : ''}`;
    b.style.background = col;
    if (i === POST_ERASER) b.textContent = 'Radierer';
    tapButton(b, () => {
      local.color = i;
      refreshTools();
    });
    swatches.push(b);
    palette.append(b);
  });
  const tools = q(root, '.sp-tools');
  const sizeBtns = POST_BRUSHES.map((_, i) => {
    const b = document.createElement('button');
    b.className = 'sp-size secondary';
    b.innerHTML = `<i style="width:${4 + i * 5}px;height:${4 + i * 5}px"></i>`;
    tapButton(b, () => {
      local.size = i;
      refreshTools();
    });
    tools.append(b);
    return b;
  });
  const undo = el(`<button class="secondary small">Zurück</button>`).firstElementChild as HTMLButtonElement;
  const clear = el(`<button class="secondary small">Leeren</button>`).firstElementChild as HTMLButtonElement;
  tapButton(undo, () => {
    if (ctl.done || !local.strokes.length) return;
    local.strokes.pop();
    rebuild();
    scheduleDraft();
  });
  clear.addEventListener('click', () => {
    if (ctl.done || !local.strokes.length || !confirm('Bild wirklich löschen?')) return;
    local.strokes = [];
    rebuild();
    scheduleDraft();
  });
  tools.append(undo, clear);
  const refreshTools = () => {
    swatches.forEach((b, i) => b.classList.toggle('active', i === local.color));
    sizeBtns.forEach((b, i) => {
      b.classList.toggle('active', i === local.size);
      const dot = b.querySelector('i')!;
      dot.style.background = local.color === POST_ERASER ? '#b89a70' : POST_COLORS[local.color];
    });
  };
  refreshTools();

  // ---- Senden
  let draftTimer: number | undefined;
  const drawing = (): PostDrawing => ({ s: local.strokes });
  const scheduleDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => send('drawing', { round, drawing: drawing(), done: false }), 500);
  };
  const ctl = doneControls(root, () => {
    clearTimeout(draftTimer);
    const d = drawing();
    send('drawing', { round, drawing: d, done: true });
    console.info(`Stille Post: Zeichnung ${local.strokes.length} Striche, ${drawingPoints(d)} Punkte, ${JSON.stringify(d).length} Bytes`);
    return true;
  });

  // ---- Zeichnen
  const rebuild = () => {
    if (!size) return;
    base.width = base.height = size;
    paintDrawing(base.getContext('2d')!, drawing(), size);
    dirty = true;
  };
  const resize = () => {
    const sz = fitCanvas(canvas);
    if (sz !== size) {
      size = sz;
      rebuild();
    }
  };
  const used = () => local.strokes.reduce((n, st) => n + st.p.length / 2, 0) + (current ? current.p.length / 2 : 0);
  const toGrid = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(POST.GRID, ((e.clientX - r.left) / r.width) * POST.GRID)),
      y: Math.max(0, Math.min(POST.GRID, ((e.clientY - r.top) / r.height) * POST.GRID)),
    };
  };
  const addPoint = (x: number, y: number, force = false) => {
    if (!current) return;
    const n = current.p.length;
    const qx = Math.round(x);
    const qy = Math.round(y);
    if (n && !force && Math.hypot(qx - current.p[n - 2], qy - current.p[n - 1]) < 1.5) return;
    if (n && qx === current.p[n - 2] && qy === current.p[n - 1]) return;
    if (used() >= POST.MAX_POINTS) {
      if (!warned) toast('Das Bild ist voll – nimm „Zurück“, um Platz zu machen.');
      warned = true;
      return;
    }
    current.p.push(qx, qy);
    dirty = true;
  };
  let activePointer: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (ctl.done || activePointer !== null || local.strokes.length >= POST.MAX_STROKES) return;
    e.preventDefault();
    resize();
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = toGrid(e);
    current = { c: local.color, w: local.size, p: [], fx: p.x, fy: p.y };
    addPoint(p.x, p.y, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !current) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const p = toGrid(ev);
      // Leichte Glättung gegen Finger-Zittern
      current.fx += (p.x - current.fx) * 0.6;
      current.fy += (p.y - current.fy) * 0.6;
      addPoint(current.fx, current.fy);
    }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (!current) return;
    const p = toGrid(e);
    if (e.type === 'pointerup') addPoint(p.x, p.y);
    const st: PostStroke = { c: current.c, w: current.w, p: simplify(current.p, 0.8) };
    current = null;
    local.strokes.push(st);
    if (size) paintStroke(base.getContext('2d')!, st.c, st.w, st.p, size);
    dirty = true;
    scheduleDraft();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const frame = () => {
    if (!canvas.isConnected) return;
    if (!size || canvas.width !== size) resize();
    if (dirty && size) {
      dirty = false;
      g.drawImage(base, 0, 0);
      if (current) paintStroke(g, current.c, current.w, current.p, size);
    }
    requestAnimationFrame(frame);
  };
  app.append(root);
  requestAnimationFrame(frame);

  return () => {
    const st = post();
    if (!st) return;
    const p = priv('draw');
    ctl.update(st, p);
    if (p?.text) q(root, '.sp-text').textContent = p.text;
  };
}

/** Ramer-Douglas-Peucker auf flachen Punktlisten – spart Punkte ohne sichtbaren Unterschied */
function simplify(p: number[], eps: number): number[] {
  const n = p.length / 2;
  if (n <= 2) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      // Geschlossene Formen (Anfang = Ende): Abstand zum Punkt statt zur Linie
      const d =
        len < 1e-6
          ? Math.hypot(p[i * 2] - ax, p[i * 2 + 1] - ay)
          : Math.abs((bx - ax) * (ay - p[i * 2 + 1]) - (ax - p[i * 2]) * (by - ay)) / len;
      if (d > bd) (bd = d), (best = i);
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

// ------------------------------------------------------------------ Vorführung

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="big-btn sp-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    navigator.vibrate?.(15);
    socket.emit('vip:mini', 'next');
  });
  return b;
}

function buildReveal(vip: boolean) {
  const root = el(`
    <h2 class="sp-chain"></h2>
    <p class="sp-step"></p>
    <div class="center"><p>Schau auf den Fernseher!</p></div>
  `);
  const btn = vip ? nextButton('Weiter') : null;
  if (btn) q(root, '.center').append(btn);
  app.append(root);
  return () => {
    const s = post();
    if (!s) return;
    q(root, '.sp-chain').textContent = `Kette von ${nameOf(s.order[s.chain])} (${s.chain + 1}/${s.chains})`;
    const last = s.shown >= s.steps;
    q(root, '.sp-step').textContent = `Schritt ${s.shown}/${s.steps}`;
    if (btn) btn.textContent = last ? 'Zur Abstimmung' : 'Weiter';
  };
}

function buildVote(s: StillepostState, vip: boolean) {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Kette ${s.chain + 1}/${s.chains}</span></div>
    <h2>Was war am besten?</h2>
    <p class="wait">Tippe auf deinen Favoriten (nicht deinen eigenen).</p>
    <div class="sp-votes"></div>
  `);
  const list = q(root, '.sp-votes');
  let picked: number | null = null;
  const buttons = s.entries.map((e, i) => {
    const b = document.createElement('button');
    b.className = 'sp-vote';
    const name = document.createElement('small');
    name.textContent = `${i + 1}. ${nameOf(e.by)}`;
    b.append(name);
    if (e.kind === 'drawing') {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      paintDrawing(c.getContext('2d')!, e.drawing, 160);
      b.append(c);
    } else {
      const t = document.createElement('span');
      t.textContent = e.text ?? '';
      b.append(t);
    }
    b.addEventListener('click', () => {
      if (picked !== null || b.disabled) return;
      picked = i;
      navigator.vibrate?.(20);
      send('vote', { entry: i });
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
    const p = priv('vote');
    if (p?.myVote != null) picked = p.myVote;
    buttons.forEach((b, i) => {
      b.disabled = s.entries[i].by === store.playerId || (picked !== null && picked !== i);
      b.classList.toggle('active', picked === i);
    });
    if (picked !== null) q(root, '.wait').textContent = 'Danke! Warte auf die anderen ...';
  };
  app.append(root);
  refresh();
  return () => {
    const st = post();
    if (!st) return;
    q(root, '.timer').textContent = `${secondsLeft()}s`;
    refresh();
  };
}

function buildTally(s: StillepostState, vip: boolean) {
  const id = store.playerId!;
  const mine = s.entries.reduce((n, e, i) => n + (e.by === id ? (s.chainLikes?.[i] ?? 0) : 0), 0);
  const root = el(`
    <div class="center">
      <h2>Kette von ${escapeHtml(nameOf(s.order[s.chain]))}</h2>
      <h1>${mine ? `+${mine} Like${mine === 1 ? '' : 's'} für dich!` : 'Keine Likes diesmal'}</h1>
      <p>Insgesamt: ${s.likes[id] ?? 0} Likes</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(s.chain + 1 >= s.chains ? 'Zur Auswertung' : 'Nächste Kette'));
  app.append(root);
  return null;
}
