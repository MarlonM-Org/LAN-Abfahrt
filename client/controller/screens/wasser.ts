import type { WasserState } from '../../../shared/wasser';
import { TEAM_INFO } from '../../../shared/flunky';
import { type Screen, app, el, message, q, send, store } from '../core';
import { joystick } from './controller';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Ziel-Stick: Ziehen = Richtung + Weite (Vorschau auf dem TV), Loslassen = werfen.
 * Kurz antippen (fast keine Auslenkung) bricht ab.
 */
function aimStick(container: HTMLElement, onAim: (x: number, y: number) => void, onRelease: (x: number, y: number) => void) {
  const pad = el(`<div class="stick-pad aim"><div class="stick-knob"></div><div class="aim-ring"></div></div>`).firstElementChild as HTMLElement;
  const knob = pad.querySelector('.stick-knob') as HTMLElement;
  container.append(pad);
  let active: number | null = null;
  let cx = 0;
  let cy = 0;
  let R = 60;
  let cur = { x: 0, y: 0 };
  let last = { x: 0, y: 0, t: 0 };
  const emit = (force = false) => {
    const now = performance.now();
    if (!force && now - last.t < 50 && Math.hypot(cur.x - last.x, cur.y - last.y) < 0.04) return;
    last = { ...cur, t: now };
    onAim(Math.round(cur.x * 100) / 100, Math.round(cur.y * 100) / 100);
  };
  const move = (e: PointerEvent) => {
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    cur = { x: dx / R, y: dy / R };
    emit();
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    active = e.pointerId;
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    R = r.width * 0.36;
    pad.classList.add('active');
    move(e);
  });
  pad.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
  const up = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    knob.style.transform = '';
    pad.classList.remove('active');
    const v = { x: Math.round(cur.x * 100) / 100, y: Math.round(cur.y * 100) / 100 };
    cur = { x: 0, y: 0 };
    if (e.type === 'pointerup' && Math.hypot(v.x, v.y) >= 0.2) onRelease(v.x, v.y);
    else onAim(0, 0);
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  const keepAlive = setInterval(() => {
    if (!pad.isConnected) return clearInterval(keepAlive);
    if (active !== null) emit(true);
  }, 300);
  return pad;
}

export function pickWasser(s: WasserState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['ws-over', message('Zeit um!', `${me.h} Treffer · ${me.n}× nass – schau auf den Fernseher!`)];
  return [
    `ws-${s.sub}`,
    () => {
      const team = me.t ? TEAM_INFO[me.t] : null;
      const side = me.t === 'A' ? 'links' : 'rechts';
      const badge = team
        ? `<div class="team-badge team-${me.t}">${team.name} – Lager ${side}</div>`
        : `<div class="team-badge" style="background:${hex(me.c)};color:#fff4d6">Jeder gegen jeden!</div>`;
      const root = el(`
        <div class="ws">
          ${badge}
          <div class="top-row"><span class="timer"></span><span class="score"></span></div>
          <div class="ws-status">
            <div class="ws-wet"><span>NÄSSE</span><div class="ws-meter"><div></div></div></div>
            <div class="ws-ammo"><i></i><i></i><i></i></div>
          </div>
          <p class="ws-hint"></p>
          <div class="ws-sticks">
            <div class="ws-col"><div class="ws-move"></div><small>LAUFEN</small></div>
            <div class="ws-col"><div class="ws-aim"></div><small class="ws-aim-label">ZIELEN · LOSLASSEN</small></div>
          </div>
        </div>
      `);
      joystick(q(root, '.ws-move'), (x, y) => send('stick', { x, y }));
      aimStick(
        q(root, '.ws-aim'),
        (x, y) => send('aim', { x, y }),
        (x, y) => {
          send('throw', { x, y });
          navigator.vibrate?.(15);
        },
      );
      app.append(root);
      const wrap = q(root, '.ws');
      const fill = q(root, '.ws-meter > div');
      const dots = [...root.querySelectorAll<HTMLElement>('.ws-ammo i')];
      let prevWet = me.w;
      let prevSoaked = me.n;
      return () => {
        const st = store.state?.mini?.kind === 'wasser' ? store.state.mini.state : null;
        const p = st?.players[id];
        if (!st || !p) return;
        q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
        q(root, '.score').textContent = st.ffa ? `${p.k}× nass gemacht` : `Sonne ${st.score.A} : ${st.score.B} Meer`;
        fill.style.width = `${p.s === 'drying' ? Math.round((1 - p.dp) * 100) : p.w}%`;
        fill.className = p.w > 70 || p.s !== 'ok' ? 'danger' : '';
        dots.forEach((d, i) => {
          d.className = i < p.a ? 'full' : '';
          d.style.background = i < p.a ? hex(p.c) : '';
        });
        const towel = p.t ? `eurem Handtuch (${p.t === 'A' ? 'links' : 'rechts'})` : 'einem Handtuch';
        const bucket = p.t ? `Eimer (${p.t === 'A' ? 'links' : 'rechts'})` : 'Eimer';
        let hint = 'Rechts ziehen = zielen, loslassen = werfen. Hinter Hecken bist du sicher!';
        if (st.sub === 'countdown') hint = 'Gleich geht’s los! Links laufen, rechts zielen + loslassen.';
        else if (p.s === 'soaked') hint = `KLATSCHNASS! Lauf zu ${towel}.`;
        else if (p.s === 'drying') hint = 'Abtrocknen ... gleich geht’s weiter!';
        else if (p.pi > 0) hint = `WASSERPISTOLE! Rechts zielen = spritzen (${Math.ceil(p.pi / 1000)}s)`;
        else if (p.a === 0) hint = `Leer! Nachfüllen am ${bucket} oder am Schlauch (Mitte, schneller).`;
        else if (p.w > 70) hint = 'Fast klatschnass – ab in Deckung!';
        q(root, '.ws-hint').textContent = hint;
        q(root, '.ws-aim-label').textContent = p.pi > 0 ? 'SPRITZEN!' : 'ZIELEN · LOSLASSEN';
        wrap.classList.toggle('soaked', p.s !== 'ok');
        wrap.classList.toggle('pistol', p.pi > 0);
        if (p.n > prevSoaked) navigator.vibrate?.([80, 60, 160]);
        else if (p.w > prevWet + 5) navigator.vibrate?.(40);
        prevWet = p.w;
        prevSoaked = p.n;
      };
    },
  ];
}
