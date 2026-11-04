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
      ${r.hearts === undefined && !r.sips ? `<h1>${row ? `${row.place}. Platz` : 'Ergebnis'}</h1>` : ''}
      <p>${escapeHtml(row?.detail ?? '')}</p>
      ${party && !r.final && row ? `<h2 class="yellow">+${row.coins} Münzen</h2>` : ''}
      ${r.hearts !== undefined ? `<h1 class="pink">♥ ${r.hearts} / ${r.maxHearts}</h1><p>gemeinsam verdient</p>` : ''}
      ${r.sips && row ? `<h2 class="pink">${r.sips[row.playerId] ?? 0} Schlücke</h2>` : ''}
      ${r.arcade && row ? `<h2 class="yellow">+${r.arcade[row.playerId] ?? 0} Arcade-Punkte</h2>` : ''}
      ${r.final && first ? '<h2 class="yellow">Du bist Urlaubs-Champion!</h2>' : ''}
    </div>
  `);
  if (vip && store.state?.drinkActive && !r.final) {
    const next = el(`<button class="drink-btn">Nächste Runde</button>`).firstElementChild as HTMLButtonElement;
    next.addEventListener('click', () => socket.emit('vip:continue'));
    const end = el(`<button class="secondary">Beenden & Statistik</button>`).firstElementChild as HTMLButtonElement;
    end.addEventListener('click', () => socket.emit('vip:continue', 'end'));
    root.append(next, end);
  } else if (vip) {
    const dateRun = !!store.state?.date;
    const label = dateRun ? 'Weiter' : r.final || !party ? 'Zurück zur Lobby' : 'Weiter zum Spielbrett';
    const btn = el(`<button>${label}</button>`).firstElementChild as HTMLButtonElement;
    btn.addEventListener('click', () => socket.emit('vip:continue'));
    root.append(btn);
  } else {
    root.append(el(`<p>Gleich geht’s weiter ...</p>`));
  }
  app.append(root);
  navigator.vibrate?.(first ? [80, 60, 80] : 60);
  return null;
}
