import type { PostStroke } from '../../../shared/types';
import { POST, POST_BRUSHES, POST_COLORS, POST_ERASER, POST_PAPER, paintDrawing, paintStroke } from '../../../shared/stillepost';
import { MALER, type MalerOp, type MalerPrivate, type MalerState, cloneStrokes, strokePoints } from '../../../shared/maler';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton, timerText, toast } from '../core';
import { haptic } from '../haptic';

/**
 * Montagsmaler live am Handy: Maler wählt ein Wort und malt (Striche gehen gebündelt ~15 Hz als Ops an den Server),
 * alle anderen tippen Tipps. Malstand und Tipp-Entwurf überleben einen Neuaufbau des Screens; nach einem Neuladen
 * holt sich das Maler-Handy das Bild vom Server zurück (Schlüsselbild).
 */
const local = {
  /** `${miniSeq}-${round}` – neues Bild = alles frisch */
  key: '',
  strokes: [] as PostStroke[],
  /** So viele Ops sind schon raus (der Server zählt mit) */
  n: 0,
  pending: [] as MalerOp[],
  restoring: false,
  restoreSince: 0,
  color: 0,
  size: 1,
  draft: '',
};

const st = () => (store.state?.mini?.kind === 'maler' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zum aktuellen Bild passt */
const priv = (): MalerPrivate | null => {
  const p = store.priv?.kind === 'maler' ? store.priv.state : null;
  const s = st();
  return p && s && p.round === s.round ? p : null;
};
const short = (name: string) => name.replace(/^Bot\s+/, '');
const tick = (root: ParentNode) => {
  const t = root.querySelector('.timer');
  if (t) t.textContent = timerText((sec) => `⏱ ${sec}s`);
};
const head = (s: MalerState, right?: string) => `<div class="top-row"><span class="timer"></span><span class="ml-head">${right ?? `Bild ${s.round}/${s.rounds}`}</span></div>`;

export function pickMaler(s: MalerState): Screen {
  injectCss();
  const id = store.playerId!;
  const r = s.round;
  if (!s.players.includes(id)) return ['ml-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  const drawer = s.drawer === id;
  switch (s.sub) {
    case 'choose':
      return drawer ? [`ml-choose-${r}`, buildChoose] : [`ml-wait-${r}`, buildWait];
    case 'draw':
      if (drawer) return [`ml-draw-${r}`, buildDraw];
      return s.guessed.includes(id) ? [`ml-got-watch-${r}`, buildGot] : [`ml-guess-${r}`, buildGuess];
    case 'reveal':
      return [`ml-reveal-${r}`, buildReveal];
    default:
      return ['ml-end', message('Das war Montagsmaler!', 'Gleich gibt’s die Auswertung ...')];
  }
}

// ------------------------------------------------------------------ Wort wählen / warten

function buildChoose() {
  const s = st()!;
  const root = el(`
    ${head(s)}
    <h2>Du bist dran! Was willst du malen?</h2>
    <div class="ml-choices"><p>Einen Moment ...</p></div>
    <p class="ml-sub">Die anderen sehen dein Bild live auf dem TV und raten auf ihren Handys. Nicht schreiben – nur malen!</p>
  `);
  const box = q(root, '.ml-choices');
  let shown = '';
  let picked = false;
  app.append(root);
  haptic('hit');
  return () => {
    tick(root);
    const p = priv();
    const choices = p?.choices ?? [];
    const key = choices.join('|');
    if (!choices.length || key === shown) return;
    shown = key;
    box.innerHTML = '';
    choices.forEach((w, i) => {
      const b = el(`<button class="ml-choice">${escapeHtml(w)}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (picked) return;
        picked = true;
        haptic('tap');
        b.classList.add('on');
        box.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = x !== b));
        send('choose', { round: s.round, index: i });
      });
      box.append(b);
    });
  };
}

function buildWait() {
  const s = st()!;
  const root = el(`
    ${head(s)}
    <div class="center">
      <h2>${escapeHtml(short(nameOf(s.drawer)))} sucht ein Wort aus ...</h2>
      <p>Gleich wird gemalt – schau auf den TV und tipp los, sobald du’s erkennst!</p>
      <p class="ml-score"></p>
    </div>
  `);
  app.append(root);
  return () => {
    const cur = st();
    tick(root);
    if (cur) q(root, '.ml-score').textContent = `Deine Punkte: ${cur.points[store.playerId!] ?? 0}`;
  };
}

// ------------------------------------------------------------------ Malen

function buildDraw() {
  const s = st()!;
  const round = s.round;
  const key = `${store.state?.miniSeq ?? 0}-${round}`;
  if (local.key !== key) {
    local.key = key;
    local.strokes = [];
    local.pending = [];
    local.n = 0;
    // Seite neu geladen o. Ä.: Auf dem Server liegen schon Striche → erst zurückholen
    local.restoring = s.ink.seq > 0;
    local.restoreSince = performance.now();
    if (local.restoring) send('sync');
  }
  const root = el(`
    ${head(s, '<span class="ml-gotn"></span>')}
    <div class="sp-prompt ml-prompt"><small>Du malst:</small><h2 class="ml-word">...</h2></div>
    <div class="ml-canvas-wrap"><canvas class="sp-canvas draw ml-canvas"></canvas><p class="ml-restore hidden">Bild wird geladen ...</p></div>
    <div class="sp-palette"></div>
    <div class="sp-tools"></div>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const g = canvas.getContext('2d')!;
  const base = document.createElement('canvas');
  let size = 0;
  /** Strich unter dem Finger (liegt schon in local.strokes, aber noch nicht auf `base`) */
  let active: (PostStroke & { fx: number; fy: number }) | null = null;
  let dirty = true;
  let warned = false;
  let lastFull = 0;

  // ---- Senden: Ops sammeln, ~15 Hz raus
  const flush = () => {
    if (!local.pending.length || local.restoring) return;
    const ops = local.pending;
    local.pending = [];
    send('ink', { round, n: local.n, ops });
    local.n += ops.length;
  };
  const timer = window.setInterval(() => {
    if (!canvas.isConnected) return window.clearInterval(timer);
    flush();
  }, MALER.SEND_MS);
  const queuePoint = (x: number, y: number) => {
    const last = local.pending[local.pending.length - 1];
    if (last && (last.t === 's' || last.t === 'a') && last.p.length / 2 < MALER.OP_POINTS) last.p.push(x, y);
    else local.pending.push({ t: 'a', p: [x, y] });
  };
  const sendFull = () => {
    local.pending = [];
    send('full', { round, n: local.n, s: local.strokes });
    lastFull = performance.now();
  };

  // ---- Werkzeuge (wie Stille Post)
  const palette = q(root, '.sp-palette');
  const swatches: HTMLButtonElement[] = [];
  [...POST_COLORS, POST_PAPER].forEach((col, i) => {
    const b = document.createElement('button');
    b.className = `sp-swatch${i === POST_ERASER ? ' eraser' : ''}`;
    b.style.background = col;
    if (i === POST_ERASER) b.textContent = 'Radierer';
    tapButton(b, () => {
      local.color = i;
      haptic('tick');
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
      haptic('tick');
      refreshTools();
    });
    tools.append(b);
    return b;
  });
  const undo = el(`<button class="secondary small">Zurück</button>`).firstElementChild as HTMLButtonElement;
  const clear = el(`<button class="secondary small">Leeren</button>`).firstElementChild as HTMLButtonElement;
  tapButton(undo, () => {
    if (active || local.restoring || !local.strokes.length) return;
    haptic('tick');
    local.strokes.pop();
    local.pending.push({ t: 'u' });
    flush();
    rebuild();
  });
  // Leeren mit zweitem Tipp bestätigen (kein Dialog, der das Spiel aufhält)
  let armed = 0;
  tapButton(clear, () => {
    if (active || local.restoring || !local.strokes.length) return;
    if (performance.now() - armed > 1800) {
      armed = performance.now();
      clear.textContent = 'Sicher?';
      clear.classList.add('ml-armed');
      window.setTimeout(() => {
        clear.textContent = 'Leeren';
        clear.classList.remove('ml-armed');
      }, 1800);
      return;
    }
    armed = 0;
    clear.textContent = 'Leeren';
    clear.classList.remove('ml-armed');
    haptic('hit');
    local.strokes = [];
    local.pending.push({ t: 'x' });
    flush();
    rebuild();
  });
  tools.append(undo, clear);
  const refreshTools = () => {
    swatches.forEach((b, i) => b.classList.toggle('active', i === local.color));
    sizeBtns.forEach((b, i) => {
      b.classList.toggle('active', i === local.size);
      b.querySelector('i')!.style.background = local.color === POST_ERASER ? '#b89a70' : POST_COLORS[local.color];
    });
  };
  refreshTools();

  // ---- Zeichnen
  const rebuild = () => {
    if (!size) return;
    base.width = base.height = size;
    paintDrawing(base.getContext('2d')!, { s: active ? local.strokes.slice(0, -1) : local.strokes }, size);
    dirty = true;
  };
  const resize = () => {
    const w = canvas.getBoundingClientRect().width || 300;
    const sz = Math.round(w * Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== sz) canvas.width = canvas.height = sz;
    if (sz !== size) {
      size = sz;
      rebuild();
    }
  };
  const toGrid = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(POST.GRID, ((e.clientX - r.left) / r.width) * POST.GRID)),
      y: Math.max(0, Math.min(POST.GRID, ((e.clientY - r.top) / r.height) * POST.GRID)),
    };
  };
  const full = () => strokePoints(local.strokes) >= MALER.MAX_POINTS;
  const addPoint = (x: number, y: number, force = false) => {
    if (!active) return;
    const n = active.p.length;
    const qx = Math.round(x);
    const qy = Math.round(y);
    if (n && qx === active.p[n - 2] && qy === active.p[n - 1]) return;
    if (n && !force && Math.hypot(qx - active.p[n - 2], qy - active.p[n - 1]) < MALER.MIN_DIST) return;
    if (full()) {
      if (!warned) toast('Das Bild ist voll – nimm „Zurück“, um Platz zu machen.');
      warned = true;
      return;
    }
    active.p.push(qx, qy);
    queuePoint(qx, qy);
    dirty = true;
  };
  let pointer: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (pointer !== null || local.restoring || local.strokes.length >= MALER.MAX_STROKES || full()) return;
    e.preventDefault();
    resize();
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = toGrid(e);
    const qx = Math.round(p.x);
    const qy = Math.round(p.y);
    active = { c: local.color, w: local.size, p: [qx, qy], fx: p.x, fy: p.y };
    local.strokes.push(active);
    local.pending.push({ t: 's', c: local.color, w: local.size, p: [qx, qy] });
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer || !active) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const p = toGrid(ev);
      // Leichte Glättung gegen Finger-Zittern
      active.fx += (p.x - active.fx) * 0.6;
      active.fy += (p.y - active.fy) * 0.6;
      addPoint(active.fx, active.fy);
    }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (!active) return;
    if (e.type === 'pointerup') {
      const p = toGrid(e);
      addPoint(p.x, p.y);
    }
    const done = active;
    active = null;
    // Nur die reinen Strichdaten behalten (fx/fy waren Glättungs-Hilfen)
    local.strokes[local.strokes.length - 1] = { c: done.c, w: done.w, p: done.p };
    if (size) paintStroke(base.getContext('2d')!, done.c, done.w, done.p, size);
    dirty = true;
    flush();
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
      if (active) paintStroke(g, active.c, active.w, active.p, size);
    }
    requestAnimationFrame(frame);
  };
  app.append(root);
  requestAnimationFrame(frame);
  haptic('win');

  return () => {
    const cur = st();
    if (!cur) return;
    tick(root);
    const p = priv();
    if (p?.word) q(root, '.ml-word').textContent = p.word;
    const others = cur.players.length - 1;
    q(root, '.ml-gotn').textContent = `${cur.guessed.length}/${others} haben’s`;
    // Wiederherstellen nach Neuladen: Schlüsselbild übernehmen und dem Server den eigenen Zähler mitteilen
    if (local.restoring) {
      if (cur.ink.full) {
        local.strokes = cloneStrokes(cur.ink.full);
        local.restoring = false;
        sendFull();
        rebuild();
      } else if (performance.now() - local.restoreSince > 6000) {
        local.restoring = false;
      } else if (performance.now() - local.restoreSince > 1500 && performance.now() - lastFull > 1500) {
        lastFull = performance.now();
        send('sync');
      }
    }
    q(root, '.ml-restore').classList.toggle('hidden', !local.restoring);
    // Server hat Striche verpasst → ganzes Bild schicken
    if (p?.need && !local.restoring && performance.now() - lastFull > 1000) sendFull();
  };
}

// ------------------------------------------------------------------ Raten

function hintHtml(hint: string) {
  return [...hint]
    .map((c) => (c === ' ' ? '<span class="ml-gap"></span>' : c === '-' ? '<span class="ml-l ml-dash">-</span>' : `<span class="ml-l">${c === '_' ? '' : escapeHtml(c)}</span>`))
    .join('');
}

function buildGuess() {
  const s = st()!;
  const round = s.round;
  const key = `${store.state?.miniSeq ?? 0}-${round}`;
  if (local.key !== key) {
    local.key = key;
    local.draft = '';
  }
  const root = el(`
    ${head(s)}
    <p class="ml-who">${escapeHtml(short(nameOf(s.drawer)))} malt – schau auf den TV!</p>
    <div class="ml-hint"></div>
    <form class="ml-form" autocomplete="off">
      <input type="text" class="ml-input" maxlength="${MALER.GUESS_MAX}" placeholder="Dein Tipp ..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" />
      <button type="button" class="ml-send">Raten</button>
    </form>
    <p class="ml-fb">&nbsp;</p>
    <div class="ml-mine"></div>
  `);
  const input = q<HTMLInputElement>(root, '.ml-input');
  const fb = q(root, '.ml-fb');
  input.value = local.draft;
  input.addEventListener('input', () => (local.draft = input.value));
  let lastSent = 0;
  const submit = () => {
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (performance.now() - lastSent < MALER.GUESS_GAP_MS) return;
    lastSent = performance.now();
    send('guess', { round, text });
    input.value = local.draft = '';
    haptic('tick');
    // Tastatur offen lassen – gleich der nächste Tipp
    input.focus();
  };
  q(root, '.ml-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  // Beim Berühren auslösen, ohne dem Eingabefeld den Fokus zu nehmen
  tapButton(q(root, '.ml-send'), submit);
  let hint = '';
  let tries = priv()?.tries ?? 0;
  app.append(root);
  window.setTimeout(() => input.focus(), 50);
  return () => {
    const cur = st();
    if (!cur) return;
    tick(root);
    if (cur.hint !== hint) {
      const more = hint && cur.hint.split('_').length < hint.split('_').length;
      hint = cur.hint;
      const box = q(root, '.ml-hint');
      box.innerHTML = hintHtml(hint);
      box.classList.toggle('long', [...hint].length > 10);
      if (more) {
        box.classList.remove('ml-pop');
        void box.offsetWidth;
        box.classList.add('ml-pop');
        haptic('tick');
      }
    }
    const p = priv();
    if (!p) return;
    if (p.tries !== tries) {
      tries = p.tries;
      const last = p.mine[p.mine.length - 1];
      if (last?.res === 'close') {
        fb.textContent = `„${last.text}“ – knapp daneben!`;
        fb.className = 'ml-fb close';
        haptic('hit');
      } else if (last?.res === 'miss') {
        fb.textContent = `„${last.text}“ – leider nein`;
        fb.className = 'ml-fb miss';
      }
    }
    q(root, '.ml-mine').innerHTML = [...p.mine]
      .reverse()
      .map((m) => `<span class="${m.res}">${m.res === 'close' ? '≈' : m.res === 'hit' ? '✓' : '✗'} ${escapeHtml(m.text)}</span>`)
      .join('');
  };
}

function buildGot() {
  const s = st()!;
  const root = el(`
    ${head(s)}
    <div class="center ml-got">
      <h1>✓ Richtig!</h1>
      <p>Das Wort: <b class="ml-word">...</b></p>
      <h2 class="ml-gain"></h2>
      <p class="ml-sub ml-left"></p>
    </div>
  `);
  app.append(root);
  haptic('win');
  return () => {
    const cur = st();
    if (!cur) return;
    tick(root);
    const p = priv();
    if (p?.word) q(root, '.ml-word').textContent = p.word;
    const id = store.playerId!;
    q(root, '.ml-gain').textContent = `+${cur.gain[id] ?? 0} Punkte`;
    const others = cur.players.length - 1;
    q(root, '.ml-left').textContent = `${cur.guessed.length}/${others} haben’s – schick dem TV ein Emoji!`;
  };
}

// ------------------------------------------------------------------ Auflösung

function buildReveal() {
  const s = st()!;
  const id = store.playerId!;
  const gain = s.gain[id] ?? 0;
  const drawer = s.drawer === id;
  const got = s.guessed.includes(id);
  const line = drawer
    ? gain
      ? `+${gain} Punkte als Maler!`
      : 'Keiner hat’s erraten ...'
    : got
      ? `+${gain} Punkte`
      : 'Nicht erraten';
  const sorted = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = sorted.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const next = s.round < s.rounds ? s.order[s.round] : null;
  const root = el(`
    <div class="center">
      <p>Das Wort war</p>
      <h1 class="ml-reveal">${escapeHtml((s.word ?? '?').toUpperCase())}</h1>
      <h2 class="${gain ? 'ml-plus' : ''}">${escapeHtml(line)}</h2>
      <p>Gesamt: ${s.points[id] ?? 0} Punkte · Platz ${place}</p>
      ${next ? `<p class="ml-sub">Als Nächstes malt: ${next === id ? '<b>du!</b>' : escapeHtml(short(nameOf(next)))}</p>` : '<p class="ml-sub">Das war das letzte Bild!</p>'}
    </div>
  `);
  app.append(root);
  if (gain) haptic('win');
  return null;
}

// ------------------------------------------------------------------ Stil (eigenes <style>, damit style.css unberührt bleibt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.ml-head { color: var(--ink-soft); }
.ml-sub { font-size: 9px; line-height: 1.6; margin: 0; }
.ml-choices { display: flex; flex-direction: column; gap: 10px; }
.ml-choice { font-size: 15px; padding: 18px 8px; background: var(--sea); box-shadow: inset 0 4px 0 #7fbcf0, inset 0 -6px 0 #2d64a8, 0 3px 0 var(--outline); }
.ml-choice.on { background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.ml-score { color: var(--ink); }
#app:has(.ml-canvas) { gap: 8px; padding-top: 10px; padding-bottom: 10px; }
#app:has(.ml-canvas):has(> .abort) { padding-top: 34px; }
.ml-prompt { padding: 4px 8px; }
.ml-prompt h2 { font-size: 15px; }
.ml-canvas-wrap { position: relative; display: flex; justify-content: center; }
.ml-canvas { width: min(100%, 52vh); }
.ml-restore { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255, 246, 220, 0.8); color: var(--red); }
.ml-armed { background: #e46e98 !important; color: #fff4d6 !important; }
.ml-who { margin: 0; }
.ml-hint { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 10px 4px; background: var(--paper-light); border: 3px solid var(--wood-dark); }
.ml-l { width: 20px; height: 26px; display: flex; align-items: flex-end; justify-content: center; font-size: 17px; line-height: 1; color: var(--red); border-bottom: 3px solid var(--ink); }
.ml-hint.long .ml-l { width: 15px; font-size: 13px; height: 22px; }
.ml-l.ml-dash { border-bottom: 0; color: var(--ink); }
.ml-gap { width: 12px; }
.ml-pop { animation: ml-pop 0.45s ease-out; }
@keyframes ml-pop { 0% { transform: scale(1.12); background: #fff1b0; } 100% { transform: scale(1); } }
.ml-form { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
.ml-form input { font-size: 16px; padding: 12px 10px; }
.ml-send { padding: 10px 12px; font-size: 11px; background: var(--green); box-shadow: inset 0 3px 0 #7fd47f, inset 0 -4px 0 #2f7d32, 0 3px 0 var(--outline); }
.ml-fb { margin: 0; min-height: 1.7em; font-size: 10px; }
.ml-fb.close { color: #c06a1f; animation: ml-pop 0.45s ease-out; }
.ml-fb.miss { color: var(--ink-soft); }
.ml-mine { display: flex; flex-direction: column; gap: 4px; }
.ml-mine span { padding: 6px 8px; background: var(--paper-light); border: 2px solid var(--paper-dark); font-size: 10px; color: var(--ink-soft); overflow-wrap: anywhere; }
.ml-mine span.close { color: #c06a1f; border-color: #f0b13a; }
.ml-got h1 { color: var(--green); }
.ml-word { color: var(--red); font-weight: normal; }
.ml-gain, .ml-plus { color: #2f7d32; }
.ml-reveal { font-size: 20px; overflow-wrap: anywhere; }
`;
