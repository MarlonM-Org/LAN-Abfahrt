import { LEXIKON, LEX_CAT, type LexPrivate, type LexState, lexShow } from '../../../shared/lexikon';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, socket, store, timerText, toast } from '../core';
import { haptic } from '../haptic';

/** Lokaler Entwurf – überlebt einen Neuaufbau des Screens (z. B. kurzer WLAN-Aussetzer) */
const local = { key: '', text: '' };

const lex = () => (store.state?.mini?.kind === 'lexikon' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Frage und Phase passt */
const priv = (): LexPrivate | null => {
  const p = store.priv?.kind === 'lexikon' ? store.priv.state : null;
  const s = lex();
  return p && s && p.round === s.round && p.sub === s.sub ? p : null;
};

const short = (name: string) => name.replace(/^Bot\s+/, '');
/** Aufgabe mit hervorgehobener Lücke */
const promptHtml = (t: string) => escapeHtml(t).replace(/_{2,}/g, '<span class="sq-blank">_____</span>');
const roundLabel = (s: LexState) => (s.rounds > 1 ? `Frage ${s.round}/${s.rounds}` : 'Lügen-Lexikon');
const tickTimer = (root: ParentNode) => {
  const t = root.querySelector('.timer');
  if (t) t.textContent = timerText();
};

export function pickLexikon(s: LexState, vip: boolean): Screen {
  injectCss();
  const id = store.playerId!;
  if (!s.players.includes(id)) return ['lx-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  const r = s.round;
  switch (s.sub) {
    case 'write': {
      const p = priv();
      if (!p) return ['lx-wait', message('Moment ...')];
      return p.lie === null ? [`lx-write-${r}`, () => buildWrite(s)] : [`lx-written-${r}`, buildWritten];
    }
    case 'vote':
      if (!priv()) return ['lx-wait', message('Moment ...')];
      return [`lx-vote-${r}`, () => buildVote(s)];
    case 'reveal':
      return [`lx-rev-${r}-${vip}`, () => buildReveal(vip)];
    case 'scores':
      return [`lx-scores-${r}-${vip}`, () => buildScores(s, vip)];
    default:
      return ['lx-over', message('Das war das Lügen-Lexikon!', 'Gleich gibt’s die Auswertung ...')];
  }
}

function head(s: LexState, withPrompt = true, small = '') {
  const cat = LEX_CAT[s.cat];
  return `
    <div class="top-row"><span class="timer"></span><span>${escapeHtml(roundLabel(s))}</span></div>
    <p class="lx-cat">${cat.icon} ${escapeHtml(cat.title)}${s.mult > 1 ? ` · <b>Punkte ×${s.mult}</b>` : ''}</p>
    ${withPrompt ? `<div class="sq-prompt">${small ? `<small>${escapeHtml(small)}</small>` : ''}<h2>${promptHtml(s.prompt)}</h2></div>` : ''}`;
}

// ------------------------------------------------------------------ Lüge schreiben

function buildWrite(s: LexState) {
  const key = `${s.round}-${s.prompt}`;
  if (local.key !== key) {
    local.key = key;
    local.text = '';
  }
  const root = el(`
    ${head(s, true, 'Erfinde eine glaubwürdige Antwort:')}
    <textarea class="sp-input sq-input" rows="2" maxlength="${LEXIKON.MAX_TEXT}" placeholder="Deine Lüge ..." autocomplete="off" autocapitalize="sentences"></textarea>
    <p class="sq-count"></p>
    <p class="lx-reject hidden"></p>
    <button class="secondary small" data-act="suggest">🎲 Lüge vorschlagen</button>
    <button data-act="done">Lüge abgeben</button>
    <p class="wait"></p>
  `);
  const input = q<HTMLTextAreaElement>(root, '.sq-input');
  const count = q(root, '.sq-count');
  const btn = q<HTMLButtonElement>(root, '[data-act=done]');
  const rejectEl = q(root, '.lx-reject');
  input.value = local.text;
  const round = s.round;
  let sent = false;
  let draftTimer: number | undefined;
  const sendDraft = () => {
    clearTimeout(draftTimer);
    send('draft', { round, text: input.value });
  };
  const showCount = () => (count.textContent = `${input.value.length}/${LEXIKON.MAX_TEXT}`);
  const unlock = () => {
    sent = false;
    input.disabled = false;
    btn.disabled = false;
  };
  input.addEventListener('input', () => {
    local.text = input.value;
    rejectEl.classList.add('hidden');
    showCount();
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(sendDraft, 600);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });
  btn.addEventListener('click', () => {
    if (sent) return;
    const text = input.value.trim();
    if (!text) return toast('Schreib etwas – oder lass dir eine Lüge vorschlagen.');
    sent = true;
    clearTimeout(draftTimer);
    input.blur();
    input.disabled = true;
    btn.disabled = true;
    haptic('tap');
    send('lie', { round, text });
  });
  q(root, '[data-act=suggest]').addEventListener('click', () => {
    if (sent) return;
    haptic('tick');
    send('suggest', { round });
  });
  let lastReject = priv()?.reject?.seq ?? 0;
  let lastSuggest = priv()?.suggest?.seq ?? 0;
  showCount();
  app.append(root);
  input.focus({ preventScroll: true });

  return () => {
    const st = lex();
    if (!st) return;
    tickTimer(root);
    const p = priv();
    if (p?.reject && p.reject.seq !== lastReject) {
      lastReject = p.reject.seq;
      rejectEl.textContent = p.reject.text;
      rejectEl.classList.remove('hidden');
      haptic('bad');
      unlock();
      input.focus({ preventScroll: true });
      input.select();
    }
    if (p?.suggest && p.suggest.seq !== lastSuggest && !sent) {
      lastSuggest = p.suggest.seq;
      input.value = local.text = p.suggest.text;
      rejectEl.classList.add('hidden');
      showCount();
      sendDraft();
    }
    q(root, '.wait').textContent = `${st.written.length}/${st.players.length} Lügen abgegeben`;
  };
}

function buildWritten() {
  const s = lex()!;
  const root = el(`
    ${head(s, false)}
    <div class="center">
      <p>Deine Lüge:</p>
      <h2 class="lx-mylie"></h2>
      <p class="wait"></p>
      <p>Gleich stehen alle Antworten auf dem Fernseher – such die Wahrheit!</p>
    </div>
  `);
  app.append(root);
  return () => {
    const st = lex();
    if (!st) return;
    tickTimer(root);
    q(root, '.lx-mylie').textContent = `„${priv()?.lie ?? '…'}“`;
    const missing = st.players.length - st.written.length;
    q(root, '.wait').textContent = missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle fertig!';
  };
}

// ------------------------------------------------------------------ Wahrheit tippen

function buildVote(s: LexState) {
  const p = priv()!;
  const options = s.options ?? [];
  const root = el(`
    ${head(s)}
    <p class="wait"></p>
    <div class="lx-opts">
      ${options
        .map((t, i) => {
          const mine = p.mine.includes(i);
          return `<button class="lx-opt${mine ? ' mine' : ''}" data-i="${i}" ${mine ? 'disabled' : ''}><span class="lx-num">${i + 1}</span><span class="lx-text">${escapeHtml(lexShow(t))}${mine ? '<small>deine Lüge</small>' : ''}</span></button>`;
        })
        .join('')}
    </div>
  `);
  let picked: number | null = p.pick;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.lx-opt')];
  const wait = q(root, '.wait');
  const refresh = () => {
    buttons.forEach((b, i) => b.classList.toggle('active', picked === i));
    const st = lex();
    const n = st ? `${st.voted.length}/${st.players.length}` : '';
    wait.textContent = picked === null ? `Tippe auf die Wahrheit! (${n})` : `Getippt – umentscheiden geht noch. (${n})`;
  };
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (p.mine.includes(i) || picked === i) return;
      picked = i;
      haptic('tap');
      send('pick', { round: s.round, idx: i });
      refresh();
    }),
  );
  refresh();
  app.append(root);
  return () => {
    tickTimer(root);
    refresh();
  };
}

// ------------------------------------------------------------------ Aufdecken / Zwischenstand

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="lx-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    haptic('tap');
    socket.emit('vip:mini', 'next');
  });
  return b;
}

function buildReveal(vip: boolean) {
  const s = lex()!;
  const root = el(`
    ${head(s, false)}
    <div class="center">
      <h2>Schau auf den Fernseher!</h2>
      <div class="lx-status"></div>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton('Weiter'));
  app.append(root);
  const id = store.playerId!;
  let felt = -1;
  return () => {
    const st = lex();
    if (!st || st.sub !== 'reveal') return;
    const myPick = priv()?.pick ?? null;
    const cur = st.steps[st.steps.length - 1];
    const opts = st.options ?? [];
    const lines: string[] = [];
    if (myPick !== null && opts[myPick] !== undefined) lines.push(`<p>Dein Tipp: <b>„${escapeHtml(lexShow(opts[myPick]))}“</b></p>`);
    if (cur) {
      const text = escapeHtml(lexShow(opts[cur.idx] ?? ''));
      if (cur.truth) {
        const right = cur.pickers.includes(id);
        lines.push(`<p>Die Wahrheit:</p><h2 class="lx-truth">„${text}“</h2>`);
        lines.push(right ? `<h1>Richtig! +${cur.points}</h1>` : '<h2 class="pink">Leider daneben!</h2>');
        const gain = st.gain[id] ?? 0;
        lines.push(`<p>Diese Frage: <b>+${gain}</b> · Gesamt: ${st.points[id] ?? 0} Punkte</p>`);
        if (felt !== st.steps.length) haptic(right ? 'win' : 'bad');
      } else if (cur.by.includes(id)) {
        lines.push(`<h1>+${cur.points}</h1><h2 class="yellow">${cur.pickers.length} ${cur.pickers.length === 1 ? 'ist' : 'sind'} auf deine Lüge reingefallen!</h2>`);
        if (felt !== st.steps.length) haptic('win');
      } else if (cur.pickers.includes(id)) {
        const by = cur.by.length ? `von ${cur.by.map((x) => escapeHtml(short(nameOf(x)))).join(' & ')}` : 'vom Lexikon (Haus-Lüge)';
        lines.push(`<h2 class="pink">Reingefallen!</h2><p>„${text}“ war gelogen – ${by}.</p>`);
        if (felt !== st.steps.length) haptic('bad');
      } else lines.push(`<p>Gerade aufgedeckt: „${text}“</p>`);
      felt = st.steps.length;
    }
    q(root, '.lx-status').innerHTML = lines.join('');
  };
}

function buildScores(s: LexState, vip: boolean) {
  const id = store.playerId!;
  const ranked = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const final = s.round >= s.rounds;
  const root = el(`
    <div class="center">
      <p>${final ? 'Endstand' : `Zwischenstand nach Frage ${s.round}/${s.rounds}`}</p>
      <h1>Platz ${place}</h1>
      <h2>${s.points[id] ?? 0} Punkte</h2>
      <p>${s.gain[id] ? `+${s.gain[id]} in dieser Frage` : 'Diese Frage gab’s keine Punkte.'}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(final ? 'Zur Auswertung' : 'Nächste Frage'));
  app.append(root);
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
.lx-cat { font-size: 9px; color: var(--ink-soft); margin-top: -4px; }
.lx-cat b { color: var(--red); font-weight: normal; }
.lx-reject { font-size: 9px; line-height: 1.6; color: #fff4d6; background: var(--red); border: 3px solid var(--wood-darker); padding: 8px; margin-top: -4px; }
.lx-mylie { color: var(--red); word-break: break-word; }
.lx-opts { display: flex; flex-direction: column; gap: 6px; }
.lx-opt { display: flex; align-items: center; gap: 8px; padding: 8px 8px; min-height: 44px; text-align: left; font-size: 10px; line-height: 1.6; word-break: break-word;
  background: var(--paper-light); color: var(--ink); text-shadow: none; border: 3px solid var(--wood-dark); box-shadow: 0 3px 0 var(--wood-darker); }
.lx-opt .lx-num { flex: 0 0 auto; min-width: 22px; padding: 3px 0; text-align: center; font-size: 9px; color: var(--gold); background: #2d1b12; border: 2px solid var(--wood-darker); }
.lx-opt .lx-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.lx-opt small { font-size: 7px; color: var(--ink-soft); }
.lx-opt.active { background: #fff1b0; border-color: var(--red); box-shadow: inset 0 0 0 2px var(--gold), 0 3px 0 var(--wood-darker); }
.lx-opt.mine { border-style: dashed; }
.lx-opt.mine:disabled { opacity: 0.55; filter: none; }
.lx-status { display: flex; flex-direction: column; gap: 10px; }
.lx-status b { color: var(--ink); font-weight: normal; }
.lx-truth { color: #2f7d32; word-break: break-word; }
.lx-next { margin-top: 6px; }
`;
