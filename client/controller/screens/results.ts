import type { EveningTitle, ResultsState } from '../../../shared/types';
import { MINI_INFO } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, q, socket, store } from '../core';
import { myLine, sessionPanel, sessionTableHtml } from './leaderboard';

export function pickResults(r: ResultsState, vip: boolean): Screen {
  const single = !!store.state?.nochmal;
  const turnier = !!store.state?.turnier;
  return [`results-${r.final}-${r.title}-${vip}-${single}-${turnier}`, () => (turnier ? buildTurnier(r, vip) : single ? buildSingle(r, vip) : build(r, vip))];
}

/** Eigene „Titel des Abends“ (am Ende von Party/Turnier und im Einzelspiel-Ergebnis) */
function myTitlesHtml(): string {
  const titles = (store.state?.evening?.titles ?? []).filter((t: EveningTitle) => t.playerId === store.playerId);
  if (!titles.length) return '';
  return `<p class="label-left">Dein Titel des Abends</p>${titles.map((t) => `<p class="my-title">${t.icon} <b>${escapeHtml(t.title)}</b><br/><small>${escapeHtml(t.text)}</small></p>`).join('')}`;
}

/**
 * Turnier: eigener Platz + Punkte dieses Spiels, Zwischenstand der Playlist; am Ende Siegerehrung.
 * VIP: „Weiter“ (nächstes Spiel bzw. Siegerehrung), danach „Zurück zur Lobby“.
 */
function buildTurnier(r: ResultsState, vip: boolean) {
  const t = store.state!.turnier!;
  const row = r.rows.find((rw) => rw.playerId === store.playerId);
  const pts = row && r.points ? r.points[row.playerId] : undefined;
  const first = row?.place === 1;
  const root = el(`
    <div class="center">
      <p>${r.final ? `${t.icon} ${escapeHtml(t.name)}` : `${escapeHtml(r.title)} · Spiel ${t.index + 1}/${t.kinds.length}`}</p>
      ${r.hearts === undefined && !r.sips ? `<h1>${row ? `${row.place}. Platz` : 'Ergebnis'}</h1>` : ''}
      <p>${escapeHtml(row?.detail ?? '')}</p>
      ${r.hearts !== undefined ? `<h2 class="pink">♥ ${r.hearts} / ${r.maxHearts}</h2>` : ''}
      ${r.final && first ? '<h2 class="yellow">Du gewinnst das Turnier!</h2>' : ''}
      <h2 class="yellow pts">${pts !== undefined ? `+${pts} Punkte` : ''}</h2>
      <p class="my-total"></p>
      <div class="my-titles"></div>
    </div>
    <div class="nochmal-actions"></div>
    <div class="panel lb-panel"><p class="label-left tour-title"></p><div class="tour-table"></div></div>
  `);
  const actions = q(root, '.nochmal-actions');
  if (vip) {
    const next = t.kinds[t.index + 1];
    const label = r.final ? 'Zurück zur Lobby' : next ? `Weiter: ${MINI_INFO[next].icon} ${escapeHtml(MINI_INFO[next].title)}<br/><small>Spiel ${t.index + 2} von ${t.kinds.length}</small>` : 'Weiter zur Siegerehrung';
    const btn = el(`<button class="nochmal-btn">${label}</button>`).firstElementChild as HTMLButtonElement;
    btn.addEventListener('click', () => socket.emit('vip:continue'));
    actions.append(btn);
  } else {
    actions.append(el(`<p class="center wait-vip">${r.final ? 'Danke fürs Mitspielen!' : 'Gleich geht’s weiter ...'}</p>`));
  }
  app.append(root);
  navigator.vibrate?.(first ? [80, 60, 80] : 60);
  let key = '';
  return () => {
    const s = store.state;
    const tt = s?.turnier;
    if (!tt) return;
    const mine = tt.table.rows.find((x) => x.id === store.playerId);
    q(root, '.my-total').textContent = mine ? `Turnier: ${mine.rank}. Platz · ${mine.points} Pkt` : '';
    q(root, '.tour-title').textContent = `${tt.icon} ${tt.name} · nach ${tt.played} von ${tt.kinds.length} Spielen`;
    const k = JSON.stringify([tt.table, s?.evening]);
    if (k === key) return;
    key = k;
    q(root, '.tour-table').innerHTML = sessionTableHtml(tt.table, false);
    q(root, '.my-titles').innerHTML = r.final || tt.played > 1 ? myTitlesHtml() : '';
  };
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
      <div class="my-titles"></div>
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

  let titlesKey = '';
  return () => {
    const s = store.state;
    const n = s?.nochmal;
    const ses = s?.session;
    q(root, '.series').textContent = ses?.series && ses.series.round > 1 ? ` · ${ses.series.label}` : '';
    q(root, '.my-total').innerHTML = ses ? myLine(ses) : '';
    const tk = JSON.stringify(s?.evening?.titles ?? []);
    if (tk !== titlesKey) {
      titlesKey = tk;
      q(root, '.my-titles').innerHTML = myTitlesHtml();
    }
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
      <div class="my-titles"></div>
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
  // Titel des Abends nur am Ende der Party (Endstand) – nicht nach jedem Brett-Minispiel
  if (!r.final) return null;
  let titlesKey = '';
  return () => {
    const tk = JSON.stringify(store.state?.evening?.titles ?? []);
    if (tk === titlesKey) return;
    titlesKey = tk;
    q(root, '.my-titles').innerHTML = myTitlesHtml();
  };
}
