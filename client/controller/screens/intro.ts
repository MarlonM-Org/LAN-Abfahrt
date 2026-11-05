import type { IntroState, MiniKind } from '../../../shared/types';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT, howToPractice, miniInspired } from '../../../shared/games';
import { type Screen, app, avatarCanvas, el, escapeHtml, me, message, q, socket, store } from '../core';
import { onInputReset, stickZone } from '../stick';
import { haptic } from '../haptic';
import { toLocalPerf } from '../../timesync';

/**
 * Regelkarte vor jedem Minispiel (Raum-Phase `intro`): Ziel + 2–3 Steuer-Piktogramme aus `MINI_HOWTO`,
 * darunter ein **Übungsfeld** mit den echten Bedienelementen (schwebender Stick, Knöpfe mit Haptik) und einer
 * Mini-Figur, die darauf reagiert – nichts davon geht an den Server. Großer **BEREIT!**-Knopf (`intro:ready`).
 * Der Screen hat die Haltung des Spiels (drittes Tupel-Element), damit Ansage-Karte und Overlay schon hier greifen.
 */
export function pickIntro(it: IntroState, vip: boolean): Screen {
  const orient = MINI_INFO[it.kind]?.orientation ?? 'any';
  if (!store.playerId || !it.ids.includes(store.playerId)) {
    return ['intro-watch', message('Gleich geht’s los', 'Diese Runde schaust du zu – beim nächsten Spiel bist du dabei!')];
  }
  return [`intro-${it.kind}`, () => buildIntro(it.kind, vip), orient];
}

/** Knöpfe, die die Figur bewegen, solange man sie hält */
const MOVE: Record<string, number> = { '◀': -1, LINKS: -1, '▶': 1, RECHTS: 1 };

function buildIntro(kind: MiniKind, vipAtBuild: boolean) {
  injectCss();
  const info = MINI_INFO[kind];
  const how = MINI_HOWTO[kind];
  const { sticks, buttons } = howToPractice(kind);
  const insp = miniInspired(kind);
  const moveBtns = sticks === 0 ? buttons.filter((b) => b in MOVE) : [];
  const actBtns = buttons.filter((b) => !moveBtns.includes(b));
  const practice = sticks > 0 || buttons.length > 0;
  const sensor = !practice && how.controls.some((c) => c.icon === '📱');
  const iconOf = (label: string) => how.controls.find((c) => c.text.startsWith(label) || c.text.includes(` ${label}`) || c.text.includes(`${label} `))?.icon ?? '✨';

  const root = el(`
    <div class="it">
      <div class="it-head">
        <span class="it-icon">${info.icon}</span>
        <div class="it-title"><b>${escapeHtml(info.title)}</b>${insp ? `<small>${escapeHtml(insp)}</small>` : ''}</div>
        <span class="it-timer"></span>
      </div>
      <div class="it-info">
        <p class="it-goal">${escapeHtml(how.goal)}</p>
        <ul class="it-ctrls">${how.controls.map((c) => `<li><span>${c.icon}</span>${escapeHtml(c.text)}</li>`).join('')}</ul>
        <p class="it-orient">${ORIENT_TEXT[info.orientation]}</p>
      </div>
      <div class="it-pad${practice ? '' : ' none'}">
        <div class="it-left">${sticks > 0 ? '<div class="it-stick"><span class="st-label">STICK · Daumen aufsetzen</span></div>' : ''}</div>
        <div class="it-stage">
          <span class="it-tag">${practice ? 'ÜBUNGSFELD' : 'GLEICH IM SPIEL'}</span>
          <div class="it-fig"><i class="it-aim hidden"></i></div>
          ${practice ? '' : `<p class="it-noprac">${sensor ? '📱 Sensor-Spiel – das Handy-Schwingen probierst du gleich im Spiel aus.' : '👆 Hier gibt’s nichts zu üben – einfach antippen, sobald es losgeht.'}</p>`}
        </div>
        <div class="it-right"></div>
      </div>
      <div class="it-foot">
        <button class="big-btn it-ready">BEREIT!</button>
        <p class="it-status"></p>
        <button class="secondary small it-go${vipAtBuild ? '' : ' hidden'}">▶ Jetzt starten</button>
      </div>
    </div>
  `);
  const fig = q(root, '.it-fig');
  const stage = q(root, '.it-stage');
  const look = me()?.look ?? store.look;
  fig.prepend(avatarCanvas(2, look));
  const aim = q(root, '.it-aim');

  // ---------------------------------------------------------------- Mini-Figur
  const pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  let held = 0; // ◀/▶ gehalten
  let aimDir: { x: number; y: number } | null = null;
  let last = performance.now();
  const frame = (now: number) => {
    if (!fig.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = stage.clientWidth / 2 - 22;
    const h = stage.clientHeight / 2 - 30;
    const vx = held !== 0 ? held : vel.x;
    pos.x = Math.max(-w, Math.min(w, pos.x + vx * 150 * dt));
    pos.y = Math.max(-h, Math.min(h, pos.y + vel.y * 150 * dt));
    fig.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    if (Math.abs(vx) > 0.05) fig.classList.toggle('flip', vx < 0);
    fig.classList.toggle('walk', Math.hypot(vx, vel.y) > 0.05);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /** Kleines Effekt-Emoji an der Figur (fliegt optional in eine Richtung) */
  const puff = (icon: string, dir?: { x: number; y: number }) => {
    const p = document.createElement('span');
    p.className = 'it-puff';
    p.textContent = icon;
    p.style.left = `calc(50% + ${pos.x}px)`;
    p.style.top = `calc(50% + ${pos.y}px)`;
    if (dir) {
      p.style.setProperty('--dx', `${dir.x * 110}px`);
      p.style.setProperty('--dy', `${dir.y * 110}px`);
      p.classList.add('fly');
    }
    stage.append(p);
    setTimeout(() => p.remove(), 700);
  };
  const act = (label: string) => {
    haptic('tap');
    fig.classList.remove('hop', 'duck', 'spin');
    void fig.offsetWidth;
    fig.classList.add(label === '▼' ? 'duck' : label === '⟳' ? 'spin' : 'hop');
    puff(iconOf(label));
    const b = document.createElement('span');
    b.className = 'it-bubble';
    b.textContent = label;
    b.style.left = `calc(50% + ${pos.x}px)`;
    b.style.top = `calc(50% + ${pos.y}px)`;
    stage.append(b);
    setTimeout(() => b.remove(), 600);
  };

  // ---------------------------------------------------------------- Bedienelemente
  if (sticks > 0) stickZone(q(root, '.it-stick'), (x, y) => {
    vel.x = x;
    vel.y = y;
    if (Math.hypot(x, y) > 0.9) haptic('tick');
  });
  const right = q(root, '.it-right');
  if (sticks > 1) {
    // Zweiter Stick (z. B. Wasserbomben): zielen, loslassen = Wurf
    const z = el(`<div class="it-stick it-stick2"><span class="st-label">ZIELEN · loslassen = Wurf</span></div>`).firstElementChild as HTMLElement;
    right.append(z);
    stickZone(z, (x, y) => {
      aimDir = Math.hypot(x, y) > 0.2 ? { x, y } : null;
      aim.classList.toggle('hidden', !aimDir);
      if (aimDir) aim.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
    }, {
      onRelease: (x, y, ok) => {
        aim.classList.add('hidden');
        aimDir = null;
        if (!ok || Math.hypot(x, y) < 0.2) return;
        haptic('hit');
        puff(how.controls.find((c, i) => i > 0 && c.icon !== '🕹️')?.icon ?? '💦', { x, y });
      },
    });
  }
  const left = q(root, '.it-left');
  for (const label of moveBtns) {
    const b = el(`<button class="big-btn it-btn it-move">${escapeHtml(label)}</button>`).firstElementChild as HTMLButtonElement;
    const dir = MOVE[label];
    const release = () => {
      if (held === dir) held = 0;
      b.classList.remove('held');
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      held = dir;
      b.classList.add('held');
      haptic('tap');
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    onInputReset(b, release);
    left.append(b);
  }
  for (const label of actBtns) {
    const b = el(`<button class="big-btn it-btn">${escapeHtml(label)}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('held');
      act(label);
    });
    const up = () => b.classList.remove('held');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    right.append(b);
  }
  root.querySelector('.it')!.classList.toggle('it-nostick', sticks === 0 && moveBtns.length === 0);
  root.querySelector('.it')!.classList.toggle('it-nobtn', sticks < 2 && actBtns.length === 0);

  // ---------------------------------------------------------------- Bereit / VIP
  const ready = q<HTMLButtonElement>(root, '.it-ready');
  ready.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (ready.disabled) return;
    socket.emit('intro:ready');
    haptic('win');
    ready.disabled = true;
    ready.textContent = '✓ BEREIT';
  });
  const go = q<HTMLButtonElement>(root, '.it-go');
  go.addEventListener('click', () => socket.emit('vip:continue'));

  app.append(root);
  return () => {
    const s = store.state;
    const st = s?.phase === 'intro' ? s.intro : null;
    if (!st) return;
    const id = store.playerId!;
    const sec = Math.max(0, Math.ceil((toLocalPerf(st.endsAt) - performance.now()) / 1000));
    q(root, '.it-timer').textContent = `${sec}s`;
    const online = st.ids.filter((pid) => s!.players.find((p) => p.id === pid)?.connected);
    const nReady = online.filter((pid) => st.ready.includes(pid)).length;
    const mine = st.ready.includes(id);
    if (mine && !ready.disabled) {
      ready.disabled = true;
      ready.textContent = '✓ BEREIT';
    }
    const missing = online.length - nReady;
    q(root, '.it-status').textContent = st.short
      ? `Kennt ihr schon – gleich geht’s los! (${nReady}/${online.length} bereit)`
      : mine
        ? missing > 0 ? `Warte auf ${missing} … (${nReady}/${online.length} bereit)` : 'Alle bereit – los geht’s!'
        : `${nReady}/${online.length} bereit${practice ? ' · Probier die Steuerung aus!' : ''}`;
    go.classList.toggle('hidden', !me()?.isVip);
  };
}

// ------------------------------------------------------------------ Stil (eigenes <style>, damit style.css unberührt bleibt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.it { flex: 1; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(170px, 1fr) auto; grid-template-areas: "head" "info" "pad" "foot"; user-select: none; -webkit-user-select: none; }
.it:has(.it-pad.none) { flex: none; grid-template-rows: auto; }
.it-head { grid-area: head; display: flex; align-items: center; gap: 10px; min-width: 0; }
.it-icon { font-size: 30px; line-height: 1; flex: none; }
.it-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.it-title b { font-weight: normal; font-size: 11px; line-height: 1.4; color: var(--red); }
.it-title small { font-size: 7px; color: var(--ink-soft); }
.it-timer { flex: none; font-size: 12px; color: var(--red); }
.it-info { grid-area: info; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.it-goal { font-size: 9px; line-height: 1.6; color: var(--ink); text-align: left; }
.it-ctrls { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.it-ctrls li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; font-size: 8px; line-height: 1.5; color: var(--ink); background: var(--paper-light); border: 2px solid var(--paper-dark); }
.it-ctrls li span { font-size: 16px; line-height: 1; flex: none; width: 22px; text-align: center; }
.it-orient { font-size: 7px; color: var(--ink-soft); text-align: left; }
.it-pad { grid-area: pad; display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr); grid-template-areas: "left stage right"; min-height: 0; max-height: 360px; }
.it-nostick .it-pad { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); grid-template-areas: "stage right"; }
.it-nobtn .it-pad { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); grid-template-areas: "left stage"; }
.it-pad.none { grid-template-columns: minmax(0, 1fr); grid-template-areas: "stage"; height: 110px; }
.it-nostick .it-left, .it-nobtn .it-right, .it-pad.none .it-left, .it-pad.none .it-right { display: none; }
.it-left { grid-area: left; display: grid; gap: 6px; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); min-height: 0; }
.it-right { grid-area: right; display: grid; gap: 6px; grid-auto-rows: minmax(0, 1fr); grid-template-columns: repeat(var(--it-cols, 1), minmax(0, 1fr)); min-height: 0; }
.it-right:has(> :nth-child(3)) { --it-cols: 2; }
.it-stick { position: relative; min-height: 0; height: 100%; }
.it-stick2.st-zone { background: repeating-linear-gradient(-45deg, rgba(45, 100, 168, 0.1) 0 8px, transparent 8px 16px), #cfe8f7; border-color: #2d64a8; }
.it-stage { grid-area: stage; position: relative; overflow: hidden; min-height: 0; border: 3px solid var(--wood-dark);
  background: radial-gradient(circle at 50% 60%, #f6dca0 0 40%, transparent 41%), repeating-linear-gradient(0deg, #e9cf92 0 6px, #e3c584 6px 12px); }
.it-tag { position: absolute; left: 4px; top: 4px; font-size: 6px; color: var(--wood-darker); opacity: 0.8; }
.it-fig { position: absolute; left: 50%; top: 50%; width: 32px; height: 54px; margin: -27px 0 0 -16px; pointer-events: none; }
.it-fig canvas { margin: 0; }
.it-fig.flip canvas { transform: scaleX(-1); }
.it-fig.walk canvas { animation: it-walk 0.28s steps(2) infinite; }
.it-fig.hop canvas { animation: it-hop 0.35s ease-out; }
.it-fig.duck canvas { animation: it-duck 0.35s ease-out; transform-origin: 50% 100%; }
.it-fig.spin canvas { animation: it-spin 0.35s ease-out; }
.it-aim { position: absolute; left: 16px; top: 30px; width: 46px; height: 4px; margin-top: -2px; background: #2d64a8; transform-origin: 0 50%; border-radius: 2px; }
.it-aim.hidden { display: none; }
.it-puff { position: absolute; font-size: 18px; line-height: 1; transform: translate(-50%, -50%); pointer-events: none; animation: it-puff 0.7s ease-out forwards; }
.it-puff.fly { animation: it-fly 0.7s ease-out forwards; }
.it-bubble { position: absolute; transform: translate(-50%, -260%); font-size: 7px; padding: 3px 5px 2px; background: var(--paper-light); color: var(--ink); border: 2px solid var(--outline); pointer-events: none; white-space: nowrap; animation: it-bub 0.6s ease-out forwards; }
.it-noprac { position: absolute; left: 8px; right: 8px; bottom: 8px; font-size: 7px; line-height: 1.6; color: var(--ink); }
.it-pad.none .it-fig { top: 42%; }
.big-btn.it-btn { min-height: 0; height: 100%; font-size: 11px; padding: 4px; flex: none; touch-action: none; -webkit-touch-callout: none; background: #f0973a; box-shadow: inset 0 4px 0 #ffb867, inset 0 -6px 0 #c06a1f, 0 3px 0 var(--outline); }
.it-right .big-btn.it-btn:nth-child(4n + 2) { background: #e0503f; box-shadow: inset 0 4px 0 #f08a7d, inset 0 -6px 0 #a8342a, 0 3px 0 var(--outline); }
.it-right .big-btn.it-btn:nth-child(4n + 3) { background: #2fb5a5; box-shadow: inset 0 4px 0 #6fdccd, inset 0 -6px 0 #1f7f73, 0 3px 0 var(--outline); }
.it-right .big-btn.it-btn:nth-child(4n + 4) { background: #9b5fc0; box-shadow: inset 0 4px 0 #c08ee0, inset 0 -6px 0 #6b3a8e, 0 3px 0 var(--outline); }
.big-btn.it-btn.it-move { font-size: 15px; background: #3f8fe0; box-shadow: inset 0 4px 0 #7fbcf0, inset 0 -6px 0 #2d64a8, 0 3px 0 var(--outline); }
.big-btn.it-btn.held { transform: translateY(3px); filter: brightness(1.15); box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.3), 0 0 0 var(--outline); }
.it-foot { grid-area: foot; display: flex; flex-direction: column; gap: 6px; }
.big-btn.it-ready { min-height: 64px; flex: none; font-size: 18px; background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.big-btn.it-ready:disabled { opacity: 1; filter: none; background: #2f7d32; color: #d8f5d0; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.3); transform: translateY(2px); }
.it-status { font-size: 7px; line-height: 1.6; color: var(--ink-soft); }
.it-go { align-self: center; }
.it-go.hidden { display: none; }
@keyframes it-walk { 50% { translate: 0 -2px; } }
@keyframes it-hop { 40% { translate: 0 -18px; } }
@keyframes it-duck { 40% { scale: 1.15 0.6; } }
@keyframes it-spin { to { rotate: 360deg; } }
@keyframes it-puff { from { opacity: 1; } to { opacity: 0; translate: 0 -24px; scale: 1.4; } }
@keyframes it-fly { from { opacity: 1; } 80% { opacity: 1; } to { opacity: 0; translate: var(--dx) var(--dy); } }
@keyframes it-bub { from { opacity: 0; translate: 0 6px; } 20% { opacity: 1; translate: 0 0; } to { opacity: 0; translate: 0 -10px; } }

/* Handy quer: Gamepad-Layout wie .lx (links Stick, Mitte Regeln + Figur, rechts Knöpfe + BEREIT), ausgelegt auf 300 px Höhe */
/* war: @media (orientation: landscape) and (max-height: 520px) – jetzt Klasse von orientation.ts (gilt auch bei Pseudo-Quer) */
:where(html.land-short) #app:has(.it) { padding: 0; border: 0; box-shadow: none; min-height: 0; background: none; }
:where(html.land-short) .it { position: fixed; inset: 0; z-index: 1; overflow: hidden; gap: 4px 10px;
  grid-template-columns: minmax(0, 30%) minmax(0, 1fr) minmax(0, 28%); grid-template-rows: 28px minmax(0, 1fr) minmax(70px, 34%);
  grid-template-areas: "head head head" "left info right" "left stage foot";
  padding: max(3px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
  background: var(--paper); background-image: radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.35) 0 1px, transparent 2px); background-size: 9px 9px;
  border: 3px solid var(--wood-dark); box-shadow: inset 0 0 0 2px var(--wood); touch-action: none; }
:where(html.land-short) .it:has(.it-pad.none) { grid-template-rows: 28px minmax(0, 1fr) minmax(70px, 34%); }
:where(html.land-short) .it.it-nostick { grid-template-columns: 0 minmax(0, 1fr) minmax(0, 34%); column-gap: 0 10px; }
:where(html.land-short) .it.it-nobtn { grid-template-areas: "head head head" "left info foot" "left stage foot"; }
:where(html.land-short) #app:has(> .abort) .it-head { padding-right: 92px; }
:where(html.land-short) .it-pad, :where(html.land-short) .it-pad.none { display: contents; }
:where(html.land-short) .it-icon { font-size: 20px; }
:where(html.land-short) .it-title { flex-direction: row; align-items: baseline; gap: 10px; }
:where(html.land-short) .it-title b { font-size: 9px; }
:where(html.land-short) .it-info { overflow: hidden; gap: 4px; justify-content: center; }
:where(html.land-short) .it-goal { font-size: 8px; line-height: 1.5; }
:where(html.land-short) .it-ctrls { gap: 3px; }
:where(html.land-short) .it-ctrls li { padding: 2px 5px; font-size: 7px; line-height: 1.4; }
:where(html.land-short) .it-ctrls li span { font-size: 13px; }
:where(html.land-short) .it-orient { display: none; }
:where(html.land-short) .it-left, :where(html.land-short) .it-right { min-height: 0; }
:where(html.land-short) .it-left { grid-auto-flow: row; grid-auto-rows: minmax(0, 1fr); grid-auto-columns: auto; }
:where(html.land-short) .it-left:has(> .it-move:nth-child(2)) { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
:where(html.land-short) .it-nobtn .it-right { display: none; }
:where(html.land-short) .it-nostick .it-left { display: none; }
:where(html.land-short) .it-right:has(> :nth-child(3)) { --it-cols: 2; }
:where(html.land-short) .it-foot { justify-content: flex-end; gap: 4px; min-height: 0; }
:where(html.land-short) .big-btn.it-ready { min-height: 0; flex: 1; font-size: 14px; }
:where(html.land-short) .it-status { font-size: 6px; line-height: 1.4; }
:where(html.land-short) .it-go { padding: 4px 8px; font-size: 7px; }
`;
