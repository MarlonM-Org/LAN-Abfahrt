import type { BalanceTurn } from '../../../shared/balance';
import { SKI, type SkiState } from '../../../shared/skisprung';
import type { TepState } from '../../../shared/teppich';
import { type Screen, app, el, escapeHtml, message, nameOf, q, store } from '../core';
import { haptic } from '../haptic';

/**
 * Handy bei den Balance-Board-Spielen: gespielt wird auf dem Board, das Handy zeigt nur, wer dran ist.
 * Wer dran ist, sieht seinen Schwerpunkt live (zum Üben beim Einmessen); alle anderen bekommen die
 * Zuschauer-Leiste (Key mit „watch“).
 */

const CSS = `
.bb-card { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
.bb-board { position: relative; width: 220px; height: 128px; border-radius: 18px; background: #f2f2ee; border: 3px solid #7b8090; box-shadow: 0 3px 0 var(--outline); }
.bb-board::before, .bb-board::after { content: ''; position: absolute; top: 10px; bottom: 10px; width: 92px; border-radius: 12px; background: #c9ccd2; }
.bb-board::before { left: 10px; }
.bb-board::after { right: 10px; }
.bb-dot { position: absolute; z-index: 1; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #e2574c; border: 2px solid #7a1e18; left: 50%; top: 50%; transition: left 0.08s linear, top 0.08s linear; }
.bb-zone { position: absolute; z-index: 1; border: 3px solid #3fbf5a; border-radius: 50%; }
.bb-front { font-size: 9px; opacity: 0.7; }
.bb-bar { width: 220px; height: 10px; background: #2a3550; border: 2px solid var(--outline); }
.bb-bar > i { display: block; height: 100%; width: 0; background: #3fbf5a; }
.bb-big { font-size: 22px; color: var(--gold, #ffd25e); }
`;
let cssDone = false;
function css() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
}

type Live = BalanceTurn & { sub: string };

/** Board-Draufsicht mit Punkt; liefert einen Updater */
function boardView(root: HTMLElement, zone: (st: Live) => { x: number; y: number; r: number } | null) {
  const board = q(root, '.bb-board');
  const dot = el('<i class="bb-dot"></i>').firstElementChild as HTMLElement;
  const ring = el('<i class="bb-zone"></i>').firstElementChild as HTMLElement;
  board.append(ring, dot);
  return (st: Live) => {
    const b = st.bal;
    dot.style.display = b && b.w > 10 ? '' : 'none';
    if (b) {
      dot.style.left = `${50 + b.x * 45}%`;
      dot.style.top = `${50 - b.y * 42}%`;
    }
    const z = zone(st);
    ring.style.display = z ? '' : 'none';
    if (z) {
      ring.style.left = `${50 + z.x * 45 - z.r * 45}%`;
      ring.style.top = `${50 - z.y * 42 - z.r * 42}%`;
      ring.style.width = `${z.r * 90}%`;
      ring.style.height = `${z.r * 84}%`;
    }
  };
}

function buildMyTurn<S extends Live>(get: () => S | null, text: (st: S) => [string, string], zone: (st: S) => { x: number; y: number; r: number } | null) {
  return () => {
    css();
    const root = el(`
      <div class="center bb-card">
        <h2 class="bb-title"></h2>
        <span class="bb-front">▲ vorn (zum TV)</span>
        <div class="bb-board"></div>
        <div class="bb-bar"><i></i></div>
        <p class="bb-sub"></p>
      </div>
    `);
    app.append(root);
    const view = boardView(root, zone as (st: Live) => { x: number; y: number; r: number } | null);
    const bar = q(root, '.bb-bar');
    const fill = q(root, '.bb-bar > i');
    let calibDone = false;
    haptic('win');
    return () => {
      const st = get();
      if (!st) return;
      view(st);
      const [title, sub] = text(st);
      q(root, '.bb-title').textContent = title;
      q(root, '.bb-sub').textContent = sub;
      bar.style.display = st.sub === 'ready' ? '' : 'none';
      fill.style.width = `${Math.round(st.calib * 100)}%`;
      if (st.calib >= 1 && !calibDone) {
        calibDone = true;
        haptic('tap');
      }
    };
  };
}

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

// ---------------------------------------------------------------- Skispringen

const ski = () => (store.state?.mini?.kind === 'skisprung' ? store.state.mini.state : null);

export function pickSkisprung(s: SkiState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu', 'Schanzen-Springen läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const rank = Object.keys(s.points).sort((a, b) => s.points[b] - s.points[a]).indexOf(id) + 1;
    return ['ski-over', message(`Platz ${rank}`, `${s.points[id].toFixed(1)} Punkte – schau auf den Fernseher!`)];
  }
  if (s.active === id) {
    return [`ski-me-${s.round}`, buildMyTurn(ski, skiText, (st) => (st.sub === 'flight' ? { x: 0, y: SKI.FLIGHT_Y, r: 0.55 } : st.sub === 'landed' ? null : { x: 0, y: 0, r: 0.5 })), 'portrait'];
  }
  return [`ski-watch-${s.round}`, buildWatch(() => {
    const st = ski();
    if (!st) return ['', ''];
    const my = st.jumps[id] ?? [];
    const mine = my.length ? `Deine Sprünge: ${my.map((j) => (j.dns ? '–' : `${j.dist.toFixed(1)} m`)).join(' · ')}<br>${st.points[id].toFixed(1)} Punkte` : 'Du kommst noch dran.';
    const next = st.order.indexOf(id) > st.order.indexOf(st.active ?? '') && !my[st.round - 1] ? '<br><b>Mach dich bereit – du kommst bald!</b>' : '';
    return [st.active ? `${escapeHtml(nameOf(st.active))} springt` : 'Gleich geht’s weiter', `${mine}${next}`];
  })];
}

function skiText(st: SkiState): [string, string] {
  switch (st.sub) {
    case 'ready':
      return !st.board ? ['Du bist dran!', 'Das Board ist noch nicht verbunden – am Laptop B drücken.'] : st.bal && st.bal.w >= 15 ? ['Ruhig stehen …', 'Dein Gewicht wird eingemessen.'] : ['Du bist dran!', 'Stell dich aufs Balance Board (Füße links und rechts).'];
    case 'countdown':
      return ['In die Hocke!', 'Knie beugen, Schwerpunkt in die Mitte.'];
    case 'inrun':
      return ['Anlauf!', 'Ruhig in der Mitte bleiben – am Tisch schnell aufrichten!'];
    case 'flight':
      return [`${st.dist.toFixed(1)} m`, 'Leicht nach vorn lehnen, nicht seitlich kippen!'];
    case 'landed':
      return st.last ? [st.last.fall ? 'Sturz!' : `${st.last.dist.toFixed(1)} m`, `${st.last.points.toFixed(1)} Punkte · Haltung ${st.last.style.toFixed(1)}`] : ['Gelandet!', ''];
    default:
      return ['', ''];
  }
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
  if (s.active === id) return ['tep-me', buildMyTurn(tep, tepText, (st) => (st.sub === 'ready' ? { x: 0, y: 0, r: 0.4 } : null)), 'portrait'];
  return ['tep-watch', buildWatch(() => {
    const st = tep();
    if (!st) return ['', ''];
    const r = st.runs[id];
    const mine = r ? (r.dns ? 'Du bist nicht geflogen.' : `Deine Zeit: ${r.score.toFixed(2)} s (${r.gems} 💎)`) : 'Du kommst noch dran.';
    return [st.active ? `${escapeHtml(nameOf(st.active))} fliegt` : 'Gleich geht’s weiter', mine];
  })];
}

function tepText(st: TepState): [string, string] {
  switch (st.sub) {
    case 'ready':
      return !st.board ? ['Du bist dran!', 'Das Board ist noch nicht verbunden – am Laptop B drücken.'] : st.bal && st.bal.w >= 15 ? ['Ruhig stehen …', 'Dein Gewicht wird eingemessen.'] : ['Du bist dran!', 'Stell dich aufs Balance Board.'];
    case 'countdown':
      return ['Festhalten!', 'Hinten = steigen · vorn = sinken · rechts = schneller'];
    case 'fly':
      return [`${st.ft.toFixed(1)} s · ${st.got.length} 💎`, 'Hinten = steigen · vorn = sinken · rechts = schneller'];
    case 'done':
      return st.last ? [`${st.last.score.toFixed(2)} s`, `${st.last.gems} Juwelen · ${st.last.hits} Treffer`] : ['Gelandet!', ''];
    default:
      return ['', ''];
  }
}
