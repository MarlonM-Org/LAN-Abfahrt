import type { WerwarsPrivate, WerwarsState } from '../../../shared/types';
import { WERWARS } from '../../../shared/werwars';
import { type Screen, app, avatarCanvas, el, escapeHtml, message, nameOf, q, send, socket, store, timerText, toast } from '../core';

/** Lokaler Entwurf – überlebt einen Neuaufbau des Screens (z. B. kurzer WLAN-Aussetzer) */
const local = { key: '', text: '' };

const ww = () => (store.state?.mini?.kind === 'werwars' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Phase und Runde passt */
const priv = (): WerwarsPrivate | null => {
  const p = store.priv?.kind === 'werwars' ? store.priv.state : null;
  const s = ww();
  return p && s && p.sub === s.sub && p.round === s.round ? p : null;
};

export function pickWerwars(s: WerwarsState, vip: boolean): Screen {
  injectCss();
  const id = store.playerId!;
  if (!s.players.includes(id)) return ['ww-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  const p = priv();
  switch (s.sub) {
    case 'intro':
      return ['ww-intro', () => buildIntro(s)];
    case 'answer': {
      if (!p) return ['ww-wait', message('Moment ...')];
      const next = p.todo[0];
      return next ? [`ww-ans-${next.id}`, () => buildAnswer(s, next)] : ['ww-answered', buildAnswered];
    }
    case 'guess':
      if (!p) return ['ww-wait', message('Moment ...')];
      return [`ww-guess-${s.round}`, () => buildGuess(s, p)];
    case 'reveal':
      return [`ww-rev-${s.round}-${vip}`, () => buildReveal(s, vip)];
    case 'scores':
      return [`ww-scores-${vip}`, () => buildScores(s, vip)];
    default:
      return ['ww-over', message('Das war „Wer war’s?“!', 'Gleich gibt’s die Auswertung ...')];
  }
}

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="big-btn ww-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    navigator.vibrate?.(15);
    socket.emit('vip:mini', 'next');
  });
  return b;
}

// ------------------------------------------------------------------ Intro

function buildIntro(s: WerwarsState) {
  app.append(
    el(`
      <div class="center">
        <h1>Wer war’s?</h1>
        <h2 class="yellow">${s.need === 1 ? 'Eine Frage' : `${s.need} Fragen`} nur für dich</h2>
        <p>Antworte ehrlich (oder schön gemein) – danach zeigt der TV jede Antwort anonym und alle raten, von wem sie stammt.</p>
        <p class="ww-hint">Richtig geraten +${WERWARS.POINTS_GUESS} · keiner errät dich +${WERWARS.POINTS_HIDDEN}</p>
      </div>
    `),
  );
  return null;
}

// ------------------------------------------------------------------ Schreiben

function buildAnswer(s: WerwarsState, task: { id: number; question: string }) {
  const key = `${task.id}-${task.question}`;
  if (local.key !== key) {
    local.key = key;
    local.text = '';
  }
  const num = (priv()?.answered ?? 0) + 1;
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Frage ${num}/${s.need}</span></div>
    <div class="sq-prompt"><small>Nur du siehst die Frage:</small><h2>${escapeHtml(task.question)}</h2></div>
    <textarea class="sp-input sq-input" rows="2" maxlength="${WERWARS.MAX_TEXT}" placeholder="Deine Antwort ..."></textarea>
    <p class="sq-count"></p>
    <button class="secondary small" data-act="safety">🎲 Zufallsantwort</button>
    <button data-act="done">Fertig!</button>
    <p class="wait"></p>
  `);
  const input = q<HTMLTextAreaElement>(root, '.sq-input');
  const count = q(root, '.sq-count');
  const btn = q<HTMLButtonElement>(root, '[data-act=done]');
  input.value = local.text;
  let sent = false;
  let draftTimer: number | undefined;
  const sendDraft = () => {
    clearTimeout(draftTimer);
    send('draft', { task: task.id, text: input.value });
  };
  const showCount = () => (count.textContent = `${input.value.length}/${WERWARS.MAX_TEXT}`);
  input.addEventListener('input', () => {
    local.text = input.value;
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
    if (text.length < 1) return toast('Schreib etwas – oder nimm eine Zufallsantwort.');
    sent = true;
    local.text = '';
    clearTimeout(draftTimer);
    input.blur();
    input.disabled = true;
    btn.disabled = true;
    navigator.vibrate?.(20);
    send('answer', { task: task.id, text });
  });
  q(root, '[data-act=safety]').addEventListener('click', () => !sent && send('safety'));
  let lastSuggest = priv()?.suggest?.seq ?? 0;
  showCount();
  app.append(root);
  input.focus({ preventScroll: true });

  return () => {
    const st = ww();
    if (!st) return;
    q(root, '.timer').textContent = timerText();
    const p = priv();
    if (p?.suggest && p.suggest.seq !== lastSuggest && !sent) {
      lastSuggest = p.suggest.seq;
      input.value = local.text = p.suggest.text;
      showCount();
      sendDraft();
    }
    const done = st.players.filter((id) => (st.answered[id] ?? 0) >= st.need).length;
    q(root, '.wait').textContent = `${done}/${st.players.length} fertig`;
  };
}

function buildAnswered() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Wer war’s?</span></div>
    <div class="center"><h2>Alles beantwortet!</h2><p class="wait"></p><p>Gleich wird geraten – schau dann auf den Fernseher.</p></div>
  `);
  app.append(root);
  return () => {
    const st = ww();
    if (!st) return;
    q(root, '.timer').textContent = timerText();
    const missing = st.players.filter((id) => (st.answered[id] ?? 0) < st.need).length;
    q(root, '.wait').textContent = missing ? `Warte noch auf ${missing} ...` : 'Alle fertig!';
  };
}

// ------------------------------------------------------------------ Raten

function buildGuess(s: WerwarsState, p: WerwarsPrivate) {
  const id = store.playerId!;
  const root = el(`
    <div class="top-row"><span class="timer"></span><span>Antwort ${s.round}/${s.rounds}</span></div>
    <div class="sq-prompt ww-card"><small>${escapeHtml(s.question)}</small><h2>„${escapeHtml(s.answer)}“</h2></div>
    <p class="ww-hint"></p>
    <div class="player-grid"></div>
  `);
  const grid = q(root, '.player-grid');
  const players = (store.state?.players ?? []).filter((x) => s.players.includes(x.id) && x.id !== id);
  const many = players.length > 8;
  if (many) grid.classList.add('many');
  let picked: string | null = p.myGuess;
  const buttons = players.map((pl) => {
    const b = document.createElement('button');
    b.className = 'player-btn ww-pick';
    b.append(avatarCanvas(many ? 2 : 3, pl.look));
    const span = document.createElement('span');
    span.textContent = pl.name;
    b.append(span);
    b.addEventListener('click', () => {
      if (picked) return;
      picked = pl.id;
      navigator.vibrate?.(20);
      send('guess', { round: s.round, target: pl.id });
      refresh();
    });
    grid.append(b);
    return [pl.id, b] as const;
  });
  const hint = q(root, '.ww-hint');
  const refresh = () => {
    for (const [pid, b] of buttons) {
      b.disabled = !!picked && picked !== pid;
      b.classList.toggle('active', picked === pid);
    }
    hint.textContent = p.mine
      ? picked
        ? 'Pokerface halten ...'
        : 'Psst, das ist deine! Tipp zum Schein jemanden an.'
      : picked
        ? `Getippt: ${nameOf(picked)} – warte auf die anderen ...`
        : 'Wer hat das geschrieben?';
    hint.classList.toggle('mine', p.mine);
  };
  refresh();
  app.append(root);
  return () => {
    q(root, '.timer').textContent = timerText();
  };
}

// ------------------------------------------------------------------ Auflösung / Wertung

function buildReveal(s: WerwarsState, vip: boolean) {
  const id = store.playerId!;
  const r = s.reveal;
  let mine = '';
  if (r) {
    const gain = r.gains[id] ?? 0;
    if (r.author === id) {
      mine =
        r.bonus === 'hidden'
          ? `<h2 class="yellow">Keiner hat dich erkannt! +${gain}</h2>`
          : r.bonus === 'sneaky'
            ? `<h2 class="yellow">Kaum einer kam drauf! +${gain}</h2>`
            : `<h2>Durchschaut! ${r.correct.length}× erkannt</h2>`;
    } else if (r.guesses[id]) {
      mine = r.correct.includes(id) ? `<h2 class="yellow">Richtig! +${gain}</h2>` : `<h2 class="pink">Daneben – du hast ${escapeHtml(nameOf(r.guesses[id]))} getippt</h2>`;
    } else mine = '<h2>Nicht getippt</h2>';
  }
  const root = el(`
    <div class="center">
      <p>„${escapeHtml(s.answer)}“</p>
      <p>Das war ...</p>
      <h1>${escapeHtml(r ? nameOf(r.author) : '?')}${r?.author === id ? ' (du!)' : ''}</h1>
      ${mine}
      <p>Deine Punkte: ${s.points[id] ?? 0}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(s.round >= s.rounds ? 'Zum Endstand' : 'Nächste Antwort'));
  app.append(root);
  return null;
}

function buildScores(s: WerwarsState, vip: boolean) {
  const id = store.playerId!;
  const ranked = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const root = el(`
    <div class="center">
      <p>Endstand</p>
      <h1>Platz ${place}</h1>
      <h2>${s.points[id] ?? 0} Punkte</h2>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton('Zur Auswertung'));
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
.ww-card { background: #fff6dc; border-color: var(--red); box-shadow: inset 0 0 0 3px #f3e2b3, 0 3px 0 var(--wood-darker); }
.ww-card small { line-height: 1.6; color: var(--red); }
.ww-card h2 { font-size: 13px; }
.ww-hint { text-align: center; font-size: 9px; line-height: 1.6; color: var(--ink-soft); margin: 0; }
.ww-hint.mine { color: var(--red); }
.player-btn.ww-pick.active { background: var(--gold); border-color: var(--red); }
.player-btn.ww-pick:disabled { opacity: 0.4; }
.player-btn.ww-pick.active:disabled { opacity: 1; filter: none; }
.big-btn.ww-next { flex: none; min-height: 18vh; font-size: 16px; background: #e46e98; box-shadow: inset 0 4px 0 #f59ab9, inset 0 -6px 0 #b0306a, 0 3px 0 var(--outline); }
`;
