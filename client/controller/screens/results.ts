import type { ResultsState } from '../../../shared/types';
import { MINI_INFO } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, q, socket, store } from '../core';
import { myLine, sessionPanel } from './leaderboard';

export function pickResults(r: ResultsState, vip: boolean): Screen {
  const single = !!store.state?.nochmal;
  return [`results-${r.final}-${r.title}-${vip}-${single}`, () => (single ? buildSingle(r, vip) : build(r, vip))];
}

/**
 * Ergebnis eines Einzelspiels (Arcade, Laptop-Auswahl, Einzelspiel aus der Lobby):
 * eigener Platz + Punkte, Gesamtstand des Abends, Tabelle auf Wunsch.
 * VIP: „Nochmal“ (gleiches Spiel, gleiche Leute) oder „Anderes Spiel“; alle anderen warten auf den Spielleiter.
 */
function buildSingle(r: ResultsState, vip: boolean) {
  const row = r.rows.find((rw) => rw.playerId === store.playerId);
  const pts = row && r.points ? r.points[row.playerId] : undefined;
  const root = el(`
    <div class="center">
      <p>${escapeHtml(r.title)}<span class="series"></span></p>
      ${r.hearts === undefined && !r.sips ? `<h1>${row ? `${row.place}. Platz` : 'Ergebnis'}</h1>` : ''}
      <p>${escapeHtml(row?.detail ?? '')}</p>
      ${r.hearts !== undefined ? `<h2 class="pink">♥ ${r.hearts} / ${r.maxHearts}</h2>` : ''}
      ${r.sips && row ? `<p class="pink">${r.sips[row.playerId] ?? 0} Schlücke</p>` : ''}
      <h2 class="yellow pts">${pts !== undefined ? `+${pts} Punkte` : ''}</h2>
      <p class="my-total"></p>
    </div>
    <div class="nochmal-actions"></div>
  `);
  const actions = q(root, '.nochmal-actions');
  let again: HTMLButtonElement | null = null;
  if (vip) {
    again = el(`<button class="nochmal-btn"></button>`).firstElementChild as HTMLButtonElement;
    again.addEventListener('click', () => socket.emit('vip:continue', 'again'));
    const other = el(`<button class="secondary nochmal-other">Anderes Spiel</button>`).firstElementChild as HTMLButtonElement;
    other.addEventListener('click', () => socket.emit('vip:continue', 'menu'));
    actions.append(again, other);
    if (store.state?.nochmal?.random) {
      const rnd = el(`<button class="secondary small">Zufälliges Spiel</button>`).firstElementChild as HTMLButtonElement;
      rnd.addEventListener('click', () => socket.emit('vip:continue', 'random'));
      actions.append(rnd);
    }
  } else {
    actions.append(el(`<p class="center wait-vip">Der Spielleiter entscheidet ...<br/><small>Nochmal oder ein anderes Spiel</small></p>`));
  }
  const table = sessionPanel();
  root.append(table.root);
  app.append(root);
  navigator.vibrate?.(row?.place === 1 ? [80, 60, 80] : 60);

  return () => {
    const s = store.state;
    const n = s?.nochmal;
    const ses = s?.session;
    q(root, '.series').textContent = ses?.series && ses.series.round > 1 ? ` · ${ses.series.label}` : '';
    q(root, '.my-total').innerHTML = ses ? myLine(ses) : '';
    if (again && n) {
      const info = MINI_INFO[n.kind];
      again.disabled = !!n.disabled;
      again.innerHTML = `Nochmal: ${info.icon} ${escapeHtml(info.title)}<br/><small>${escapeHtml(n.disabled ?? [n.next, n.detail].filter(Boolean).join(' · '))}</small>`;
    }
    table.update();
  };
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
