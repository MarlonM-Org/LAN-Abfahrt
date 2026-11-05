/**
 * Leaderboard des Abends am Handy: eigene Zeile + komplette Tabelle (mit ▲▼ und Serie).
 * Wird im Ergebnis eines Einzelspiels und in der Lobby benutzt.
 */
import type { SessionRow, SessionState } from '../../../shared/types';
import { MINI_INFO } from '../../../shared/games';
import { el, escapeHtml, store } from '../core';

/** ▲2 / ▼1 / – / neu */
export function moveMark(r: SessionRow): string {
  if (r.prevRank === null) return r.games ? '<span class="lb-new">neu</span>' : '';
  const d = r.prevRank - r.rank;
  if (d > 0) return `<span class="lb-up">▲${d}</span>`;
  if (d < 0) return `<span class="lb-down">▼${-d}</span>`;
  return '<span class="lb-same">–</span>';
}

const statusMark = (r: SessionRow) => (r.status === 'removed' ? ' <small class="lb-off">(weg)</small>' : r.status === 'offline' ? ' <small class="lb-off">(offline)</small>' : '');

/** Komplette Tabelle als HTML. `withSeries`: zusätzliche Spalte für die laufende Serie. */
export function sessionTableHtml(s: SessionState, withSeries = !!s.series && s.series.round > 1): string {
  if (!s.rows.length) return '<p>Noch niemand da.</p>';
  const series = withSeries ? s.series : null;
  const head = `<tr class="lb-head"><td>#</td><td>Name</td>${series ? `<td>${escapeHtml(series.label.split(' ')[0])}</td>` : ''}<td>+</td><td>Pkt</td></tr>`;
  const rows = s.rows
    .map((r) => {
      const cls = [r.id === store.playerId ? 'me' : '', r.status !== 'online' ? 'off' : ''].join(' ');
      const ser = series ? `<td>${series.totals[r.id] ?? 0}</td>` : '';
      return `<tr class="${cls}"><td>${r.rank}. ${moveMark(r)}</td><td>${escapeHtml(r.name)}${statusMark(r)}</td>${ser}<td>${r.last !== null ? `+${r.last}` : ''}</td><td>${r.points}</td></tr>`;
    })
    .join('');
  return `<table class="lb lb-session"><tbody>${head}${rows}</tbody></table>`;
}

/** Überschrift: „Leaderboard heute · 4 Spiele“ (+ Serie) */
export function sessionTitle(s: SessionState): string {
  const ser = s.series && s.series.round > 1 ? ` · ${MINI_INFO[s.series.kind].icon} ${escapeHtml(s.series.label)}` : '';
  return `Leaderboard heute · ${s.games} ${s.games === 1 ? 'Spiel' : 'Spiele'}${ser}`;
}

/** Eigene Gesamtplatzierung in einer Zeile */
export function myLine(s: SessionState): string {
  const r = s.rows.find((x) => x.id === store.playerId);
  if (!r) return '';
  return `Gesamt: ${r.rank}. Platz · ${r.points} Pkt ${moveMark(r)}`;
}

/** Panel mit Titel + Tabelle, das sich per `update()` auffrischt (ohne den Screen neu zu bauen) */
export function sessionPanel(opts: { open?: boolean } = {}) {
  const root = el(`
    <div class="panel lb-panel">
      <button class="secondary small lb-toggle"></button>
      <div class="lb-body"></div>
    </div>`).firstElementChild as HTMLElement;
  const toggle = root.querySelector('.lb-toggle') as HTMLButtonElement;
  const body = root.querySelector('.lb-body') as HTMLElement;
  let open = !!opts.open;
  let key = '';
  const update = () => {
    const s = store.state?.session;
    if (!s) return;
    toggle.innerHTML = `${open ? '▼' : '▶'} ${sessionTitle(s)}`;
    body.hidden = !open;
    const k = JSON.stringify([open, s]);
    if (k === key) return;
    key = k;
    body.innerHTML = sessionTableHtml(s);
  };
  toggle.addEventListener('click', () => {
    open = !open;
    update();
  });
  update();
  return { root, update };
}
