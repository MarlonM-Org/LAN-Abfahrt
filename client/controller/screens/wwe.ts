import type { WweState } from '../../../shared/types';
import { type Screen, app, el, escapeHtml, nameOf, playerButtons, q, send, store, timerText } from '../core';

export function pickWwe(w: WweState): Screen {
  const id = store.playerId!;
  if (!(id in w.points)) return ['spectate', () => (app.append(el(`<div class="center"><h2>Du schaust zu</h2></div>`)), null)];
  if (w.sub === 'question') {
    return w.voted.includes(id) ? [`wwe-voted-${w.round}`, buildVoted] : [`wwe-q-${w.round}`, () => buildQuestion(w)];
  }
  return [`wwe-reveal-${w.round}-${w.sub}`, () => buildReveal(w)];
}

const wwe = () => (store.state?.mini?.kind === 'wwe' ? store.state.mini.state : null);

function header(w: WweState) {
  return `
    <p>Frage ${w.round}/${w.rounds}<span class="timer"></span></p>
    <h2 class="question">Wer würde eher ${escapeHtml(w.question.replace(/^\.\.\.\s*/, ''))}</h2>
  `;
}

function buildQuestion(w: WweState) {
  const root = el(header(w));
  const players = (store.state?.players ?? []).filter((p) => p.id in w.points);
  let sent = false;
  root.append(
    playerButtons(players, (target) => {
      if (sent) return;
      sent = true;
      navigator.vibrate?.(20);
      send('vote', { target });
    }),
  );
  app.append(root);
  return () => {
    q(root, '.timer').textContent = timerText((sec) => ` · ${sec}s`);
  };
}

function buildVoted() {
  const w = wwe()!;
  const root = el(`${header(w)}<div class="center"><h2>Abgestimmt!</h2><p class="wait"></p></div>`);
  app.append(root);
  return () => {
    const s = wwe();
    if (!s) return;
    q(root, '.timer').textContent = timerText((sec) => ` · ${sec}s`);
    const missing = Object.keys(s.points).length - s.voted.length;
    q(root, '.wait').textContent = missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle haben abgestimmt!';
  };
}

function buildReveal(w: WweState) {
  const id = store.playerId!;
  const tally = w.tally ?? {};
  const max = Math.max(0, ...Object.values(tally));
  const winners = Object.keys(tally).filter((k) => tally[k] === max);
  const myVote = w.votes?.[id];
  const gotPoint = !!myVote && tally[myVote] === max;
  const aboutMe = winners.includes(id);
  app.append(
    el(`
      <div class="center">
        <p>Wer würde eher ${escapeHtml(w.question.replace(/^\.\.\.\s*/, ''))}</p>
        <h1>${escapeHtml(winners.map(nameOf).join(' & ') || 'Niemand')}</h1>
        ${aboutMe ? '<h2 class="pink">Das bist DU!</h2>' : ''}
        ${
          w.drinking
            ? `<h2 class="${w.sips?.[id] ? 'pink' : ''}">${w.sips?.[id] ? `Trink ${w.sips[id]} Schl${w.sips[id] === 1 ? 'uck' : 'ücke'}!` : 'Kein Schluck für dich.'}</h2>`
            : `<h2 class="${gotPoint ? 'yellow' : ''}">${gotPoint ? '+1 Punkt – mit der Mehrheit!' : 'Kein Punkt diesmal'}</h2><p>Deine Punkte: ${w.points[id] ?? 0}</p>`
        }
      </div>
    `),
  );
  return null;
}
