import type { KugelState } from '../../../shared/kugel';
import type { SkiState } from '../../../shared/skisprung';
import type { TepState } from '../../../shared/teppich';
import { type Screen, app, el, escapeHtml, message, nameOf, q, store } from '../core';

/**
 * Handy bei den Balance-Board-Spielen: gespielt wird auf dem Board, das Handy zeigt nur, wer dran ist.
 * Wer dran ist, sieht seinen Schwerpunkt live (zum Üben beim Einmessen); alle anderen bekommen die
 * Zuschauer-Leiste (Key mit „watch“).
 */

function buildWatch(text: () => [string, string]) {
  return () => {
    const root = el(`<div class="center"><h2 class="bb-w-title"></h2><p class="bb-w-sub"></p></div>`);
    app.append(root);
    return () => {
      const [t, s] = text();
      q(root, '.bb-w-title').textContent = t;
      q(root, '.bb-w-sub').innerHTML = s;
    };
  };
}

/** Wer auf dem Board dran ist, braucht das Handy nicht: alles läuft am großen Bildschirm */
const goToBoard = (): Screen => ['bb-me', message('Du bist dran!', 'Geh zum Balance Board – alles Weitere siehst du am großen Bildschirm.'), 'any'];

// ---------------------------------------------------------------- Skispringen

const ski = () => (store.state?.mini?.kind === 'skisprung' ? store.state.mini.state : null);

export function pickSkisprung(s: SkiState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu', 'Schanzen-Springen läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const rank = Object.keys(s.points).sort((a, b) => s.points[b] - s.points[a]).indexOf(id) + 1;
    return ['ski-over', message(`Platz ${rank}`, `${s.points[id].toFixed(1)} Punkte – schau auf den Fernseher!`)];
  }
  if (s.active === id) return goToBoard();
  return [`ski-watch-${s.round}`, buildWatch(() => {
    const st = ski();
    if (!st) return ['', ''];
    const my = st.jumps[id] ?? [];
    const mine = my.length ? `Deine Sprünge: ${my.map((j) => (j.dns ? '–' : `${j.dist.toFixed(1)} m`)).join(' · ')}<br>${st.points[id].toFixed(1)} Punkte` : 'Du kommst noch dran.';
    const next = st.order.indexOf(id) > st.order.indexOf(st.active ?? '') && !my[st.round - 1] ? '<br><b>Mach dich bereit – du kommst bald!</b>' : '';
    return [st.active ? `${escapeHtml(nameOf(st.active))} springt` : 'Gleich geht’s weiter', `${mine}${next}`];
  })];
}

// ---------------------------------------------------------------- Teppich

const tep = () => (store.state?.mini?.kind === 'teppich' ? store.state.mini.state : null);

export function pickTeppich(s: TepState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu', 'Teppich-Parcours läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const r = s.runs[id];
    return ['tep-over', message(r && !r.dns ? `${r.score.toFixed(2)} s` : 'Vorbei!', 'Schau auf den Fernseher!')];
  }
  if (s.active === id) return goToBoard();
  return ['tep-watch', buildWatch(() => {
    const st = tep();
    if (!st) return ['', ''];
    const r = st.runs[id];
    const mine = r ? (r.dns ? 'Du bist nicht geflogen.' : `Deine Zeit: ${r.score.toFixed(2)} s (${r.gems} 💎)`) : 'Du kommst noch dran.';
    return [st.active ? `${escapeHtml(nameOf(st.active))} fliegt` : 'Gleich geht’s weiter', mine];
  })];
}


// ---------------------------------------------------------------- Tempel-Kugel

const kug = () => (store.state?.mini?.kind === 'kugel' ? store.state.mini.state : null);

export function pickKugel(s: KugelState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu', 'Tempel-Kugel läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const r = s.runs[id];
    return ['kug-over', message(r && !r.dns ? `${r.score.toFixed(1)} s` : 'Vorbei!', 'Schau auf den Fernseher!')];
  }
  if (s.active === id) return goToBoard();
  return ['kug-watch', buildWatch(() => {
    const st = kug();
    if (!st) return ['', ''];
    const r = st.runs[id];
    const mine = r ? (r.dns ? 'Du bist nicht gerollt.' : `Deine Wertung: ${r.score.toFixed(1)} s (${r.falls}× abgestürzt)`) : 'Du kommst noch dran.';
    return [st.active ? `${escapeHtml(nameOf(st.active))} rollt` : 'Gleich geht’s weiter', mine];
  })];
}
