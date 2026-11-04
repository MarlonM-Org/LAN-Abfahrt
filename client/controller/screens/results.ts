import type { ResultsState } from '../../../shared/types';
import { type Screen, app, el, escapeHtml, socket, store } from '../core';

export function pickResults(r: ResultsState, vip: boolean): Screen {
  return [`results-${r.final}-${r.title}-${vip}`, () => build(r, vip)];
}

function build(r: ResultsState, vip: boolean) {
  const row = r.rows.find((rw) => rw.playerId === store.playerId);
  const party = !!store.state?.partyActive;
  const first = row?.place === 1;
  const root = el(`
    <div class="center">
      <p>${escapeHtml(r.title)}</p>
      <h1>${row ? `${row.place}. Platz` : 'Ergebnis'}</h1>
      <p>${escapeHtml(row?.detail ?? '')}</p>
      ${party && !r.final && row ? `<h2 class="yellow">+${row.coins} Münzen</h2>` : ''}
      ${r.final && first ? '<h2 class="yellow">Du bist Urlaubs-Champion!</h2>' : ''}
    </div>
  `);
  if (vip) {
    const label = r.final || !party ? 'Zurück zur Lobby' : 'Weiter zum Spielbrett';
    const btn = el(`<button>${label}</button>`).firstElementChild as HTMLButtonElement;
    btn.addEventListener('click', () => socket.emit('vip:continue'));
    root.append(btn);
  } else {
    root.append(el(`<p>Der VIP geht gleich weiter ...</p>`));
  }
  app.append(root);
  navigator.vibrate?.(first ? [80, 60, 80] : 60);
  return null;
}
