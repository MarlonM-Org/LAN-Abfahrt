import type { SpruechePrivate, SpruecheState } from '../../../shared/types';
import { SPRUECHE } from '../../../shared/sprueche';
import { type Screen, app, el, escapeHtml, message, q, secondsLeft, send, socket, store, toast } from '../core';

/** Lokaler Entwurf – überlebt einen Neuaufbau des Screens (z. B. kurzer WLAN-Aussetzer) */
const local = { key: '', text: '' };

const quip = () => (store.state?.mini?.kind === 'sprueche' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Runde und Phase passt */
const priv = (): SpruechePrivate | null => {
  const p = store.priv?.kind === 'sprueche' ? store.priv.state : null;
  const s = quip();
  return p && s && p.round === s.round && p.sub === s.sub ? p : null;
};

/** Frage mit hervorgehobener Lücke */
export const promptHtml = (t: string) => escapeHtml(t).replace(/_{2,}/g, '<span class="sq-blank">_____</span>');

export function pickSprueche(s: SpruecheState, vip: boolean): Screen {
  const id = store.playerId!;
  if (!s.players.includes(id)) return ['sq-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  const p = priv();
  switch (s.sub) {
    case 'intro':
      return [`sq-intro-${s.round}`, () => buildIntro(s)];
    case 'answer': {
      if (!p) return ['sq-wait', message('Moment ...')];
      const next = p.todo[0];
      return next ? [`sq-ans-${s.round}-${next.id}`, () => buildAnswer(s, next)] : [`sq-done-${s.round}`, buildAnswered];
    }
    case 'vote':
      if (!p) return ['sq-wait', message('Moment ...')];
      return s.final ? [`sq-fvote-${s.round}-${p.canVote}`, () => buildFinalVote(s, p)] : [`sq-vote-${s.round}-${s.match}-${p.canVote}-${p.mine}`, () => buildVote(s, p)];
    case 'reveal':
      return [`sq-rev-${s.round}-${s.match}-${vip}`, () => buildReveal(s, vip)];
    case 'scores':
      return [`sq-scores-${s.round}-${vip}`, () => buildScores(s, vip)];
    default:
      return ['sq-over', message('Das war das Sprüche-Duell!', 'Gleich gibt’s die Auswertung ...')];
  }
}

function header(s: SpruecheState, right: string) {
  return `<div class="top-row"><span class="timer"></span><span>${right}</span></div>`;
}

const roundLabel = (s: SpruecheState) => (s.final ? 'Finale' : `Runde ${s.round}/${s.rounds}`);

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="big-btn sq-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    navigator.vibrate?.(15);
    socket.emit('vip:mini', 'next');
  });
  return b;
}

// ------------------------------------------------------------------ Intro

function buildIntro(s: SpruecheState) {
  app.append(
    el(`
      <div class="center">
        <h1>${s.final ? 'FINALE!' : `Runde ${s.round}`}</h1>
        <h2 class="yellow">Punkte ×${s.multiplier}</h2>
        <p>${
          s.final
            ? 'Alle beantworten dieselbe Frage. Danach hat jeder 3 Stimmen!'
            : 'Du bekommst zwei Fragen. Schreib die lustigste Antwort – jede Frage hat genau einen Gegner.'
        }</p>
      </div>
    `),
  );
  return null;
}

// ------------------------------------------------------------------ Antworten

function buildAnswer(s: SpruecheState, task: { id: number; prompt: string }) {
  const key = `${s.round}-${task.id}`;
  if (local.key !== key) {
    local.key = key;
    local.text = '';
  }
  const num = (priv()?.answered ?? 0) + 1;
  const root = el(`
    ${header(s, `${roundLabel(s)} · Frage ${num}/${s.need}`)}
    <div class="sq-prompt"><small>Vervollständige:</small><h2>${promptHtml(task.prompt)}</h2></div>
    <textarea class="sp-input sq-input" rows="2" maxlength="${SPRUECHE.MAX_TEXT}" placeholder="Deine Antwort ..."></textarea>
    <p class="sq-count"></p>
    <button class="secondary small" data-act="safety">Sicherheits-Spruch</button>
    <button data-act="done">Fertig!</button>
    <p class="wait"></p>
  `);
  const input = q<HTMLTextAreaElement>(root, '.sq-input');
  const count = q(root, '.sq-count');
  const btn = q<HTMLButtonElement>(root, '[data-act=done]');
  input.value = local.text;
  const round = s.round;
  let sent = false;
  let draftTimer: number | undefined;
  const sendDraft = () => {
    clearTimeout(draftTimer);
    send('draft', { round, prompt: task.id, text: input.value });
  };
  const showCount = () => (count.textContent = `${input.value.length}/${SPRUECHE.MAX_TEXT}`);
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
    if (text.length < 1) return toast('Schreib etwas – oder nimm einen Sicherheits-Spruch.');
    sent = true;
    clearTimeout(draftTimer);
    input.blur();
    input.disabled = true;
    btn.disabled = true;
    navigator.vibrate?.(20);
    send('answer', { round, prompt: task.id, text });
  });
  q(root, '[data-act=safety]').addEventListener('click', () => !sent && send('safety'));
  let lastSuggest = priv()?.suggest?.seq ?? 0;
  showCount();
  app.append(root);
  input.focus({ preventScroll: true });

  return () => {
    const st = quip();
    if (!st) return;
    q(root, '.timer').textContent = `${secondsLeft()}s`;
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
  const s = quip()!;
  const root = el(`
    ${header(s, roundLabel(s))}
    <div class="center"><h2>Alles beantwortet!</h2><p class="wait"></p><p>Gleich wird abgestimmt – schau dann auf den Fernseher.</p></div>
  `);
  app.append(root);
  return () => {
    const st = quip();
    if (!st) return;
    q(root, '.timer').textContent = `${secondsLeft()}s`;
    const missing = st.players.filter((id) => (st.answered[id] ?? 0) < st.need).length;
    q(root, '.wait').textContent = missing ? `Warte noch auf ${missing} ...` : 'Alle fertig!';
  };
}

// ------------------------------------------------------------------ Abstimmen (Duell)

function buildVote(s: SpruecheState, p: SpruechePrivate) {
  const duel = s.duel!;
  const root = el(`
    ${header(s, `Duell ${s.match + 1}/${s.matches}`)}
    <div class="sq-prompt"><h2>${promptHtml(s.prompt)}</h2></div>
    <p class="wait"></p>
    <div class="sq-answers"></div>
  `);
  const list = q(root, '.sq-answers');
  let picked: number | null = p.myVotes[0] ?? null;
  const buttons = duel.answers.map((text, i) => {
    const b = document.createElement('button');
    b.className = 'sq-answer';
    b.textContent = text;
    b.addEventListener('click', () => {
      if (picked !== null || !p.canVote) return;
      picked = i;
      navigator.vibrate?.(20);
      send('vote', { match: s.match, pick: i });
      refresh();
    });
    list.append(b);
    return b;
  });
  const wait = q(root, '.wait');
  const refresh = () => {
    buttons.forEach((b, i) => {
      b.disabled = !p.canVote || (picked !== null && picked !== i);
      b.classList.toggle('active', picked === i);
      b.classList.toggle('mine', p.mine === i);
    });
    wait.textContent =
      p.mine !== null
        ? 'Das ist dein Duell – Daumen drücken!'
        : !p.canVote
          ? 'Du schaust bei diesem Duell zu.'
          : picked !== null
            ? 'Danke! Warte auf die anderen ...'
            : 'Welche Antwort ist lustiger?';
  };
  refresh();
  app.append(root);
  return () => {
    q(root, '.timer').textContent = `${secondsLeft()}s`;
  };
}

// ------------------------------------------------------------------ Abstimmen (Finale)

function buildFinalVote(s: SpruecheState, p: SpruechePrivate) {
  const answers = s.finalAnswers ?? [];
  const root = el(`
    ${header(s, 'Finale')}
    <div class="sq-prompt"><h2>${promptHtml(s.prompt)}</h2></div>
    <p class="wait"></p>
    <div class="sq-answers final"></div>
    <button data-act="done">Fertig!</button>
  `);
  const list = q(root, '.sq-answers');
  const done = q<HTMLButtonElement>(root, '[data-act=done]');
  const picks = new Set(p.myVotes);
  let finished = p.voteDone;
  const buttons = answers.map((a, i) => {
    const b = document.createElement('button');
    b.className = 'sq-answer';
    b.textContent = a.text;
    b.addEventListener('click', () => {
      if (finished || !p.canVote || p.mine === i) return;
      const on = !picks.has(i);
      if (on && picks.size >= SPRUECHE.FINAL_PICKS) return toast(`Höchstens ${SPRUECHE.FINAL_PICKS} Stimmen – tipp eine an, um sie zurückzunehmen.`);
      if (on) picks.add(i);
      else picks.delete(i);
      navigator.vibrate?.(15);
      send('fvote', { idx: i, on });
      refresh();
    });
    list.append(b);
    return b;
  });
  done.addEventListener('click', () => {
    if (finished) return;
    if (!picks.size) return toast('Tippe mindestens eine Antwort an.');
    finished = true;
    send('fdone');
    refresh();
  });
  const wait = q(root, '.wait');
  const refresh = () => {
    buttons.forEach((b, i) => {
      b.disabled = !p.canVote || p.mine === i || (finished && !picks.has(i));
      b.classList.toggle('active', picks.has(i));
      b.classList.toggle('mine', p.mine === i);
    });
    done.disabled = finished || !p.canVote;
    done.classList.toggle('hidden', !p.canVote);
    wait.textContent = !p.canVote
      ? 'Schau auf den Fernseher!'
      : finished || picks.size >= Math.min(SPRUECHE.FINAL_PICKS, answers.length - (p.mine !== null ? 1 : 0))
        ? 'Danke! Warte auf die anderen ...'
        : `Deine Favoriten: ${picks.size}/${SPRUECHE.FINAL_PICKS} Stimmen`;
  };
  refresh();
  app.append(root);
  return () => {
    q(root, '.timer').textContent = `${secondsLeft()}s`;
    // Nur "fertig" vom Server übernehmen – die eigene Auswahl ist lokal aktueller
    if (priv()?.voteDone && !finished) {
      finished = true;
      refresh();
    }
  };
}

// ------------------------------------------------------------------ Auflösung / Wertung

function buildReveal(s: SpruecheState, vip: boolean) {
  const id = store.playerId!;
  let mine = '';
  if (s.final) {
    const a = s.finalAnswers?.find((x) => x.by === id);
    if (a) mine = `<h1>+${a.gained ?? 0}</h1><p>${a.votes ?? 0} Stimme${a.votes === 1 ? '' : 'n'} für deinen Spruch</p>`;
  } else if (s.duel?.authors) {
    const k = s.duel.authors.indexOf(id);
    if (k >= 0) {
      const won = (s.duel.votes?.[k] ?? 0) > (s.duel.votes?.[1 - k] ?? 0);
      mine = `
        <h1>+${s.duel.gained?.[k] ?? 0}</h1>
        ${s.duel.sweep === k ? '<h2 class="pink">ABRÄUMER!</h2>' : won ? '<h2 class="yellow">Duell gewonnen!</h2>' : ''}
        <p>${s.duel.votes?.[k] ?? 0} Stimme${s.duel.votes?.[k] === 1 ? '' : 'n'} für dich</p>`;
    }
  }
  const root = el(`
    <div class="center">
      <p>${escapeHtml(roundLabel(s))}</p>
      ${mine || '<h2>Schau auf den Fernseher!</h2>'}
      <p>Deine Punkte: ${s.points[id] ?? 0}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton('Weiter'));
  app.append(root);
  return null;
}

function buildScores(s: SpruecheState, vip: boolean) {
  const id = store.playerId!;
  const ranked = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const root = el(`
    <div class="center">
      <p>Zwischenstand nach ${escapeHtml(roundLabel(s))}</p>
      <h1>Platz ${place}</h1>
      <h2>${s.points[id] ?? 0} Punkte</h2>
      <p>${s.roundGain[id] ? `+${s.roundGain[id]} in dieser Runde` : 'Diese Runde gab’s keine Punkte.'}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(s.final ? 'Zur Auswertung' : 'Nächste Runde'));
  app.append(root);
  return null;
}
