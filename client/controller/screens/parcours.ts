import type { ParcoursState } from '../../../shared/types';
import { PARCOURS as P, PART_DEFS, type PartType } from '../../../shared/parcours';
import { partPix } from '../../art/parcours';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton } from '../core';
import { joystick } from './controller';

/**
 * Fallen-Parcours am Handy – durchgehend im Querformat (Wählen, Platzieren, Laufen, Warten, Wertung),
 * damit niemand zwischen den Phasen das Handy drehen muss. Hochkant gibt es den Hinweis „quer halten“
 * (wie beim Kart-Rennen); die Knöpfe funktionieren trotzdem.
 * Alle Knöpfe reagieren auf pointerdown (tapButton) – Screens werden nur bei neuem Screen-Key neu gebaut.
 */

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const pc = () => (store.state?.mini?.kind === 'parcours' ? store.state.mini.state : null);
const secs = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Teil-Bild, das in eine Box der Breite maxW passt (höchstens 3-fach) */
function partIcon(type: PartType, maxW = 84) {
  const c = partPix(type).canvas;
  const scale = Math.min(3, maxW / c.width);
  c.className = 'pc-icon';
  c.style.width = `${c.width * scale}px`;
  c.style.height = `${c.height * scale}px`;
  return c;
}

/** Querformat-Rahmen: Kopfzeile (Runde, Punkte), Inhalt, Dreh-Hinweis. Liefert Root + Updater für die Kopfzeile. */
function frame(s: ParcoursState, mode: string, body: string) {
  const id = store.playerId!;
  const color = hex(P.COLORS[s.colors[id] ?? 0]);
  const root = el(`
    <div class="pcq pcq-${mode}">
      <div class="pcq-top">
        <span><i class="pc-dot" style="background:${color}"></i>Runde ${Math.max(1, s.round)}/${s.rounds}</span>
        <span class="pc-pts">${s.points[id] ?? 0}/${s.target} P</span>
      </div>
      <div class="pcq-body">${body}</div>
    </div>
  `);
  app.append(root);
  const pts = q(root, '.pc-pts');
  const head = () => {
    const st = pc();
    if (st) pts.textContent = `${st.points[store.playerId!] ?? 0}/${st.target} P`;
    return st;
  };
  return { root, head };
}

export function pickParcours(s: ParcoursState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'intro') {
    return [
      'pc-intro',
      () =>
        buildWait(
          s,
          'Fallen-Parcours',
          'Jede Runde baut jeder ein Teil in die Strecke – dann rennen alle vom Handtuch zur Cocktailbar.\n\nPunkte gibt es nur, wenn manche ankommen – aber nicht alle! Halte das Handy quer.',
        ),
    ];
  }
  if (s.sub === 'build') {
    const b = s.builders[id];
    if (!b) return [`pc-watch-${s.round}`, () => buildWait(s, 'Du schaust zu', 'Nächste Runde bist du wieder dabei.')];
    if (b.stage === 'done') {
      return b.skipped
        ? [`pc-skip-${s.round}`, () => buildWait(s, 'Übersprungen', 'Du warst zu lange untätig – diese Runde ohne dein Teil.')]
        : [`pc-done-${s.round}`, () => buildWait(s, 'Eingebaut!', 'Warte auf die anderen ...')];
    }
    if (b.stage === 'pick') return [`pc-pick-${s.round}`, () => buildPick(s)];
    return [`pc-place-${s.round}-${b.pick}`, () => buildPlace(s, b.pick!)];
  }
  if (s.sub === 'countdown' || s.sub === 'run') {
    const r = s.runners[id];
    if (!r) return [`pc-watch-${s.round}`, () => buildWait(s, 'Du schaust zu', 'Nächste Runde bist du wieder dabei.')];
    if (r.st === 'dead') {
      const why = r.zzz
        ? 'Eingeschlafen – du warst zu lange untätig.'
        : r.by && r.by !== id
          ? `${nameOf(r.by)}s Falle hat dich erwischt.`
          : r.by === id
            ? 'Von deiner eigenen Falle ...'
            : 'Platsch – ab ins Wasser!';
      return [`pc-dead-${s.round}`, () => buildWait(s, r.zzz ? 'Zzz ...' : 'Erwischt!', `${why}\nWarte, bis alle fertig sind.`)];
    }
    if (r.st === 'goal') return [`pc-goal-${s.round}`, () => buildWait(s, r.place === 1 ? 'Erster an der Bar!' : 'An der Bar!', 'Prost! Schau, wer es noch schafft.')];
    return [`pc-run-${s.round}`, () => buildRun(s)];
  }
  return [`pc-score-${s.round}-${s.sub}`, () => buildScore(s)];
}

function buildWait(s: ParcoursState, title: string, sub: string) {
  const { head } = frame(s, 'wait', `<div class="pcq-center"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub).replace(/\n/g, '<br>')}</p></div>`);
  return () => void head();
}

function afkText(ms: number, what: 'build' | 'run') {
  if (ms <= 0) return '';
  return what === 'build' ? `Noch ${secs(ms)}s, dann wirst du übersprungen!` : `Beweg dich! In ${secs(ms)}s schläfst du ein.`;
}

function buildPick(s: ParcoursState) {
  const b = s.builders[store.playerId!];
  const { root, head } = frame(s, 'pick', `<div class="pcq-cards"></div><p class="pcq-hint"></p>`);
  const cards = q(root, '.pcq-cards');
  for (const type of b.choice) {
    const d = PART_DEFS[type];
    const btn = el(`<button class="pc-card"><span class="pc-card-icon"></span><span class="pc-card-text"><b>${d.name}</b><small>${d.desc}</small></span></button>`)
      .firstElementChild as HTMLButtonElement;
    q(btn, '.pc-card-icon').append(partIcon(type));
    tapButton(btn, () => {
      send('pick', { type });
      navigator.vibrate?.(15);
    });
    cards.append(btn);
  }
  const hint = q(root, '.pcq-hint');
  return () => {
    const st = head();
    const me = st?.builders[store.playerId!];
    if (!st || !me) return;
    const warn = afkText(me.afk, 'build');
    hint.textContent = warn || 'Tippe auf ein Teil – dann platzierst du es mit dem Joystick.';
    hint.classList.toggle('warn', !!warn);
  };
}

function buildPlace(s: ParcoursState, type: PartType) {
  const d = PART_DEFS[type];
  const { root, head } = frame(
    s,
    'place',
    `
    <div class="stick-area"></div>
    <div class="pcq-info">
      <span class="pc-card-icon"></span>
      <b>${d.name}</b>
      <small class="pc-status"></small>
      <small class="pcq-hint"></small>
      <button class="secondary small pc-skip">Passt nirgends? Aussetzen</button>
    </div>
    <div class="pcq-btns">
      <div class="pcq-row">
        <button class="secondary pc-back">Zurück</button>
        ${d.rots > 1 ? '<button class="secondary pc-rot">Drehen</button>' : ''}
      </div>
      <button class="big-btn pc-place">PLATZIEREN</button>
    </div>
  `,
  );
  q(root, '.pc-card-icon').append(partIcon(type, 64));
  joystick(q(root, '.stick-area'), (x, y) => send('stick', { x, y }));
  tapButton(q(root, '.pc-back'), () => send('unpick'));
  const rot = root.querySelector<HTMLButtonElement>('.pc-rot');
  if (rot) tapButton(rot, () => send('rotate'));
  const place = q<HTMLButtonElement>(root, '.pc-place');
  tapButton(place, () => {
    if (place.disabled) return;
    send('place');
    navigator.vibrate?.(25);
  });
  confirmTap(q(root, '.pc-skip'), 'Wirklich aussetzen? Nochmal tippen', () => send('skip'));
  const status = q(root, '.pc-status');
  const hint = q(root, '.pcq-hint');
  return () => {
    const st = head();
    const b = st?.builders[store.playerId!];
    if (!st || !b) return;
    place.disabled = !b.ok;
    status.textContent = b.ok ? 'Passt hier!' : 'Hier nicht möglich';
    status.classList.toggle('bad', !b.ok);
    const warn = afkText(b.afk, 'build');
    hint.textContent = warn || 'Schieb den Geist auf dem Fernseher an die richtige Stelle.';
    hint.classList.toggle('warn', !!warn);
  };
}

/** Knopf, der erst beim zweiten Tippen (innerhalb von 3 s) auslöst – gegen versehentliches Aufgeben */
function confirmTap(btn: HTMLButtonElement, ask: string, fn: () => void) {
  const label = btn.textContent ?? '';
  let armedUntil = 0;
  tapButton(btn, () => {
    const now = performance.now();
    if (now < armedUntil) {
      armedUntil = 0;
      btn.textContent = label;
      fn();
      return;
    }
    armedUntil = now + 3000;
    btn.textContent = ask;
    setTimeout(() => {
      if (performance.now() >= armedUntil) btn.textContent = label;
    }, 3100);
  });
}

function buildRun(s: ParcoursState) {
  const { root, head } = frame(
    s,
    'run',
    `
    <div class="stick-area"></div>
    <div class="pc-run-mid">
      <p class="pcq-hint pc-run-hint"></p>
      <button class="secondary small pc-giveup">Festgesteckt? Aufgeben</button>
    </div>
    <button class="big-btn jump pc-jump">SPRINGEN</button>
  `,
  );
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
  const hint = q(root, '.pc-run-hint');
  const giveup = q<HTMLButtonElement>(root, '.pc-giveup');
  confirmTap(giveup, 'Wirklich aufgeben? Nochmal tippen', () => send('giveup'));
  return () => {
    const st = head();
    if (!st) return;
    giveup.classList.toggle('hidden', st.sub !== 'run' || st.runners[store.playerId!]?.st !== 'run');
    const warn = st.sub === 'run' ? afkText(st.runners[store.playerId!]?.afk ?? 0, 'run') : '';
    hint.textContent = st.sub === 'countdown' ? `Gleich geht’s los! ${secs(st.endsIn)}` : warn || 'Ab zur Cocktailbar! Länger drücken = höher springen';
    hint.classList.toggle('warn', !!warn);
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
  frame(
    s,
    'score',
    `<div class="pcq-center"><h2>${verdict}</h2><p>${escapeHtml(s.sub === 'over' ? 'Schau auf den Fernseher!' : lines)}</p><p class="pc-big">${s.points[id] ?? 0} Punkte</p></div><ol class="pc-rank">${ranking}</ol>`,
  );
  return null;
}
