import type { ParcoursState } from '../../../shared/types';
import { PARCOURS as P, PART_DEFS, type PartType } from '../../../shared/parcours';
import { partPix } from '../../art/parcours';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton } from '../core';
import { joystick } from './controller';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const pc = () => (store.state?.mini?.kind === 'parcours' ? store.state.mini.state : null);

/** Teil-Bild, das in eine Box der Breite maxW passt (höchstens 3-fach) */
function partIcon(type: PartType, maxW = 84) {
  const c = partPix(type).canvas;
  const scale = Math.min(3, maxW / c.width);
  c.className = 'pc-icon';
  c.style.width = `${c.width * scale}px`;
  c.style.height = `${c.height * scale}px`;
  return c;
}

function header(s: ParcoursState, extra = '') {
  const id = store.playerId!;
  const color = hex(P.COLORS[s.colors[id] ?? 0]);
  return `<div class="top-row pc-top"><span><i class="pc-dot" style="background:${color}"></i>Runde ${Math.max(1, s.round)}/${s.rounds}</span><span class="pc-pts">${s.points[id] ?? 0}/${s.target} P</span></div>${extra}`;
}

export function pickParcours(s: ParcoursState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'intro') {
    return ['pc-intro', message('Fallen-Parcours', 'Jede Runde baut jeder ein Teil in die Strecke – dann rennen alle vom Handtuch zur Cocktailbar.\n\nPunkte gibt es nur, wenn manche ankommen – aber nicht alle!')];
  }
  if (s.sub === 'build') {
    const b = s.builders[id];
    if (!b || b.stage === 'done') return [`pc-done-${s.round}`, () => buildWait(s, 'Eingebaut!', 'Warte auf die anderen ...')];
    if (b.stage === 'pick') return [`pc-pick-${s.round}`, () => buildPick(s)];
    return [`pc-place-${s.round}-${b.pick}`, () => buildPlace(s, b.pick!)];
  }
  if (s.sub === 'countdown' || s.sub === 'run') {
    const r = s.runners[id];
    if (!r) return [`pc-watch-${s.round}`, message('Du schaust zu', 'Nächste Runde bist du wieder dabei.')];
    if (r.st === 'dead') return [`pc-dead-${s.round}`, () => buildWait(s, 'Erwischt!', r.by && r.by !== id ? `${nameOf(r.by)}s Falle hat dich erwischt.` : r.by === id ? 'Von deiner eigenen Falle ...' : 'Platsch – ab ins Wasser!')];
    if (r.st === 'goal') return [`pc-goal-${s.round}`, () => buildWait(s, r.place === 1 ? 'Erster an der Bar!' : 'An der Bar!', 'Prost! Schau, wer es noch schafft.')];
    return [`pc-run-${s.round}`, () => buildRun(s)];
  }
  return [`pc-score-${s.round}-${s.sub}`, () => buildScore(s)];
}

function buildWait(s: ParcoursState, title: string, sub: string) {
  const root = el(`${header(s)}<div class="center"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div>`);
  app.append(root);
  return () => {
    const st = pc();
    if (st) q(root, '.pc-pts').textContent = `${st.points[store.playerId!] ?? 0}/${st.target} P`;
  };
}

function buildPick(s: ParcoursState) {
  const b = s.builders[store.playerId!];
  const root = el(`${header(s)}<h2>Wähle ein Teil</h2><div class="pc-cards"></div><p class="hint pc-time"></p>`);
  const cards = q(root, '.pc-cards');
  for (const type of b.choice) {
    const d = PART_DEFS[type];
    const btn = el(`<button class="pc-card"><span class="pc-card-icon"></span><span class="pc-card-text"><b>${d.name}</b><small>${d.desc}</small></span></button>`).firstElementChild as HTMLButtonElement;
    q(btn, '.pc-card-icon').append(partIcon(type));
    btn.addEventListener('click', () => {
      send('pick', { type });
      navigator.vibrate?.(15);
    });
    cards.append(btn);
  }
  app.append(root);
  return () => {
    const st = pc();
    if (st) q(root, '.pc-time').textContent = `Noch ${Math.ceil(st.endsIn / 1000)}s`;
  };
}

function buildPlace(s: ParcoursState, type: PartType) {
  const d = PART_DEFS[type];
  const root = el(`
    ${header(s)}
    <div class="pc-picked"><span class="pc-card-icon"></span><span><b>${d.name}</b><small class="pc-status"></small></span></div>
    <div class="stick-area"></div>
    <div class="pc-build-btns">
      <button class="secondary pc-back">Zurück</button>
      ${d.rots > 1 ? '<button class="secondary pc-rot">DREHEN</button>' : ''}
    </div>
    <button class="big-btn pc-place">PLATZIEREN</button>
  `);
  q(root, '.pc-card-icon').append(partIcon(type, 64));
  joystick(q(root, '.stick-area'), (x, y) => send('stick', { x, y }));
  q(root, '.pc-back').addEventListener('click', () => send('unpick'));
  const rot = root.querySelector<HTMLButtonElement>('.pc-rot');
  if (rot) tapButton(rot, () => send('rotate'));
  const place = q<HTMLButtonElement>(root, '.pc-place');
  tapButton(place, () => {
    send('place');
    navigator.vibrate?.(25);
  });
  app.append(root);
  return () => {
    const st = pc();
    const b = st?.builders[store.playerId!];
    if (!st || !b) return;
    place.disabled = !b.ok;
    q(root, '.pc-status').textContent = b.ok ? `Passt! Noch ${Math.ceil(st.endsIn / 1000)}s` : `Hier nicht möglich · ${Math.ceil(st.endsIn / 1000)}s`;
  };
}

function buildRun(s: ParcoursState) {
  const root = el(`
    ${header(s)}
    <p class="hint pc-run-hint"></p>
    <div class="pc-run">
      <div class="stick-area"></div>
      <button class="big-btn jump pc-jump">SPRINGEN</button>
    </div>
  `);
  joystick(q(root, '.stick-area'), (x) => send('stick', { x, y: 0 }));
  const jump = q<HTMLButtonElement>(root, '.pc-jump');
  let pointer: number | null = null;
  jump.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jump.setPointerCapture(e.pointerId);
    pointer = e.pointerId;
    jump.classList.add('down');
    send('jump', { down: true });
    navigator.vibrate?.(10);
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    jump.classList.remove('down');
    send('jump', { down: false });
  };
  jump.addEventListener('pointerup', up);
  jump.addEventListener('pointercancel', up);
  jump.addEventListener('contextmenu', (e) => e.preventDefault());
  app.append(root);
  return () => {
    const st = pc();
    if (!st) return;
    q(root, '.pc-run-hint').textContent =
      st.sub === 'countdown' ? `Gleich geht’s los! ${Math.max(1, Math.ceil(st.endsIn / 1000))}` : `Ab zur Cocktailbar! ${Math.ceil(st.endsIn / 1000)}s · länger drücken = höher`;
  };
}

function buildScore(s: ParcoursState) {
  const id = store.playerId!;
  const g = s.last?.gains[id] ?? { goal: 0, first: 0, traps: 0 };
  const verdict = s.sub === 'over' ? 'Spiel vorbei!' : s.last?.verdict === 'easy' ? 'Zu leicht!' : s.last?.verdict === 'hard' ? 'Zu schwer!' : 'Wertung';
  const lines =
    s.last?.verdict !== 'ok'
      ? s.last?.verdict === 'easy'
        ? 'Alle sind angekommen – niemand bekommt Punkte.'
        : 'Keiner hat es geschafft – niemand bekommt Punkte.'
      : [g.goal ? `Ziel +${g.goal}` : 'Nicht im Ziel', g.first ? `Erster +${g.first}` : '', g.traps ? `Falle +${g.traps}` : ''].filter(Boolean).join(' · ');
  const ranking = Object.keys(s.points)
    .sort((a, b) => s.points[b] - s.points[a])
    .map((pid) => `<li${pid === id ? ' class="me"' : ''}><i class="pc-dot" style="background:${hex(P.COLORS[s.colors[pid] ?? 0])}"></i>${escapeHtml(nameOf(pid))}<b>${s.points[pid]}</b></li>`)
    .join('');
  const root = el(`${header(s)}<div class="center"><h2>${verdict}</h2><p>${escapeHtml(s.sub === 'over' ? 'Schau auf den Fernseher!' : lines)}</p><p class="pc-big">${s.points[id] ?? 0} Punkte</p><ol class="pc-rank">${ranking}</ol></div>`);
  app.append(root);
  return null;
}
