import type { Team } from '../../../shared/types';
import type { AfbState } from '../../../shared/autoball';
import { TEAM_INFO } from '../../../shared/flunky';
import { type Screen, app, el, message, q, secondsLeft, send, store, toast } from '../core';
import { motionSupport } from '../motion';
import { steerFromRoll } from '../tilt';
import { leaveFullscreen, startTilt, stopTilt, tilt, tryFullscreen, vibrate } from './kart';

/**
 * Auto-Fußball am Handy (quer halten) – gleiches Layout wie das Kart-Rennen:
 *   links  – schwebender Stick (oder Kipp-Lenkung)
 *   rechts – GAS (groß), BREMSE daneben (im Stand rückwärts, in voller Fahrt + lenken = Drift),
 *            BOOST direkt über GAS (Daumen hochrutschen), HÜPFER über BREMSE
 * Der TV zeigt das Spielfeld, das Handy nur Spielstand, Uhr und Boost-Tank.
 */

type Btn = 'gas' | 'brake' | 'boost' | 'hop';

/** „So spielst du“ nur beim ersten Anstoß eines Spiels */
let introDone = false;

const teamName = (t: Team) => TEAM_INFO[t].name;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function pickAutoball(s: AfbState): Screen {
  const car = s.cars[store.playerId!];
  if (!car) return ['spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  if (!s.first) introDone = false;
  if (s.sub === 'over') {
    leaveFullscreen();
    const res = s.winner ? (s.winner === car.t ? 'Gewonnen!' : 'Verloren ...') : 'Unentschieden!';
    return ['afb-over', message(`Abpfiff – ${res}`, `${s.score.A}:${s.score.B} · Schau auf den Fernseher!`)];
  }
  const mode = tilt.on ? 'tilt' : 'touch';
  return [`afb-${mode}`, () => buildDrive(car.t, mode, () => window.dispatchEvent(new Event('kart-rerender')))];
}

function buildDrive(team: Team, mode: 'tilt' | 'touch', rerender: () => void) {
  const st0 = store.state?.mini?.kind === 'autoball' ? store.state.mini.state : null;
  if (!st0) return null;
  const support = motionSupport();
  const canTilt = support === 'ok' || support === 'needs-permission';
  const dirText = team === 'A' ? 'spielt nach rechts →' : '← spielt nach links';
  const root = el(`
    <div class="k3 k3-split afb afb-${team} k3-${mode}">
      <div class="k3-hud afb-hud">
        <div class="afb-score"><span class="sa">0</span><i>:</i><span class="sb">0</span></div>
        <div class="afb-clock">3:00</div>
        <div class="afb-team">Du: <b>${teamName(team)}</b> ${dirText}</div>
        <div class="k3-msg"></div>
      </div>
      <div class="k3-center"></div>
      <div class="k3-top">
        ${canTilt ? `<button class="k3-small k3-tilt">${mode === 'tilt' ? 'STICK' : 'KIPPEN'}</button>` : '<span></span>'}
      </div>
      <div class="k3-left">
        ${
          mode === 'tilt'
            ? '<div class="k3-wheel"><div class="k3-wheel-in"></div></div><div class="k3-leftlabel">Handy kippen = lenken<br/>Tippen = Mitte setzen</div>'
            : '<div class="k3-stick"><div class="k3-base"></div><div class="k3-knob"></div></div><div class="k3-leftlabel">◀ Daumen schieben ▶</div>'
        }
      </div>
      <div class="k3-right">
        <div class="k3-btn afb-hop" data-b="hop">HÜPFER</div>
        <div class="k3-btn k3-drift afb-boost" data-b="boost">BOOST<div class="afb-bar"><i></i></div></div>
        <div class="k3-btn k3-brake" data-b="brake">BREMSE<small>+ lenken<br/>= Drift</small></div>
        <div class="k3-btn k3-gas" data-b="gas">GAS</div>
      </div>
      <div class="k3-portrait">Dreh dein Handy quer!</div>
      <div class="k3-intro hidden">
        <h2>So spielst du</h2>
        <div class="k3-intro-grid">
          <div><b>${teamName(team)}</b> ${dirText} – schiebt den Wasserball ins andere Tor!</div>
          <div><b>◀ ▶</b> Links: Daumen schieben = lenken${canTilt ? ' (oder KIPPEN)' : ''}</div>
          <div><b>GAS</b> halten – <b>BREMSE</b> bremst, im Stand geht's rückwärts</div>
          <div><b>BOOST</b>: Daumen von GAS hochrutschen – der Tank lädt sich von selbst</div>
          <div><b>HÜPFER</b>: über Autos springen, Ball härter treffen</div>
          <div><b>BREMSE</b> in voller Fahrt + lenken = Drift, loslassen = Mini-Turbo</div>
        </div>
        <p>Tippen zum Weiter</p>
      </div>
    </div>
  `);
  app.append(root);
  const rootEl = q(root, '.k3');
  rootEl.addEventListener('contextmenu', (e) => e.preventDefault());
  rootEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  rootEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---- Eingaben
  const inp = { steer: 0, gas: false, brake: false, boost: false };
  let last = { steer: 9, gas: false, brake: false, boost: false, t: 0 };
  const push = (force = false) => {
    const now = performance.now();
    const boolChanged = inp.gas !== last.gas || inp.brake !== last.brake || inp.boost !== last.boost;
    const steerChanged = Math.abs(inp.steer - last.steer) >= 0.03 && now - last.t >= 33;
    if (!force && !boolChanged && !steerChanged && now - last.t < 300) return;
    last = { ...inp, t: now };
    send('steer', { x: inp.steer, gas: inp.gas, brake: inp.brake, boost: inp.boost });
  };

  // Links: schwebender Stick bzw. Kipp-Lenkung
  const left = q(root, '.k3-left');
  if (mode === 'touch') {
    const stick = q(root, '.k3-stick');
    const knob = q(root, '.k3-knob');
    let active: number | null = null;
    let baseX = 0;
    const DEAD = 6;
    const FULL = 58;
    left.addEventListener('pointerdown', (e) => {
      if (active !== null) return;
      e.preventDefault();
      left.setPointerCapture(e.pointerId);
      active = e.pointerId;
      baseX = e.clientX;
      const r = left.getBoundingClientRect();
      stick.style.left = `${e.clientX - r.left}px`;
      stick.style.top = `${e.clientY - r.top}px`;
      stick.classList.add('on');
      knob.style.transform = '';
      void tryFullscreen();
    });
    left.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const d = e.clientX - baseX;
      const mag = Math.max(0, Math.abs(d) - DEAD) / (FULL - DEAD);
      inp.steer = Math.round(Math.sign(d) * Math.min(1, mag) * 100) / 100;
      knob.style.transform = `translateX(${Math.max(-FULL, Math.min(FULL, d))}px)`;
      if (Math.abs(d) > FULL + 24) baseX = e.clientX - Math.sign(d) * (FULL + 24);
      push();
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      inp.steer = 0;
      stick.classList.remove('on');
      push(true);
    };
    left.addEventListener('pointerup', up);
    left.addEventListener('pointercancel', up);
  } else {
    left.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tilt.center = tilt.roll;
      toast('Mitte gesetzt');
      void tryFullscreen();
    });
  }
  // Knöpfe in .k3 reagieren auf pointerdown (touchstart ist dort abgeschaltet → kein click)
  root.querySelector('.k3-tilt')?.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    if (mode === 'tilt') {
      stopTilt();
      rerender();
    } else if (await startTilt()) {
      toast('Handy wie ein Lenkrad drehen!');
      rerender();
    }
  });

  // Rechts: GAS / BREMSE / BOOST / HÜPFER mit Rüberrutschen
  const right = q(root, '.k3-right');
  const btns: Record<Btn, HTMLElement> = { gas: q(root, '.k3-gas'), brake: q(root, '.k3-brake'), boost: q(root, '.afb-boost'), hop: q(root, '.afb-hop') };
  let rects: { b: Btn; x: number; y: number; w: number; h: number }[] = [];
  const measure = () => {
    rects = (Object.keys(btns) as Btn[]).map((b) => {
      const r = btns[b].getBoundingClientRect();
      return { b, x: r.left, y: r.top, w: r.width, h: r.height };
    });
  };
  const hit = (x: number, y: number): Btn | null => {
    if (!rects.length) measure();
    let best: Btn | null = null;
    let bd = 18;
    for (const r of rects) {
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      const d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = r.b;
      }
    }
    return best;
  };
  const fingers = new Map<number, Btn | null>();
  let hopDown = false;
  const applyButtons = () => {
    const down = new Set<Btn>();
    for (const b of fingers.values()) if (b) down.add(b);
    let changed = false;
    for (const b of Object.keys(btns) as Btn[]) {
      const on = down.has(b);
      btns[b].classList.toggle('down', on);
      if (b === 'hop') {
        // Hüpfer: nur beim Drauftippen/Draufrutschen
        if (on && !hopDown) {
          send('hop');
          vibrate(12);
        }
        hopDown = on;
      } else if (inp[b] !== on) {
        inp[b] = on;
        changed = true;
      }
    }
    if (changed) push(true);
  };
  right.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    right.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, hit(e.clientX, e.clientY));
    applyButtons();
    void tryFullscreen();
  });
  right.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    const b = hit(e.clientX, e.clientY);
    if (b !== fingers.get(e.pointerId)) {
      fingers.set(e.pointerId, b);
      applyButtons();
    }
  });
  const release = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId)) return;
    applyButtons();
  };
  right.addEventListener('pointerup', release);
  right.addEventListener('pointercancel', release);
  window.addEventListener('resize', measure);

  // Intro „So spielst du“ (einmal pro Spiel, beim ersten Anstoß)
  const intro = q(root, '.k3-intro');
  if (st0.first && st0.sub === 'countdown' && !introDone) {
    introDone = true;
    intro.classList.remove('hidden');
    rootEl.classList.add('introing');
    const hide = () => {
      intro.classList.add('hidden');
      rootEl.classList.remove('introing');
    };
    intro.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
    });
    setTimeout(hide, 4200);
  }

  // Kipp-Lenkung + Senden im Bildtakt
  let lastFrame = performance.now();
  const frame = () => {
    if (!root.isConnected) {
      window.removeEventListener('resize', measure);
      return;
    }
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    if (mode === 'tilt') {
      const target = steerFromRoll(tilt.roll, tilt.center);
      tilt.smooth += (target - tilt.smooth) * Math.min(1, dt / 40);
      inp.steer = Math.round(tilt.smooth * 100) / 100;
      const wheel = root.querySelector('.k3-wheel-in') as HTMLElement | null;
      if (wheel) wheel.style.transform = `rotate(${inp.steer * 90}deg)`;
    }
    push();
  };
  requestAnimationFrame(frame);

  // ---- HUD
  const center = q(root, '.k3-center');
  const bar = q(root, '.afb-bar i');
  let centerUntil = 0;
  let lastSub = '';
  let seenGoal = st0.lastGoal?.seq ?? 0;
  let touches = st0.cars[store.playerId!]?.k ?? 0;
  const flash = (text: string, cls = '', ms = 900) => {
    center.textContent = text;
    center.className = `k3-center ${cls}`;
    centerUntil = performance.now() + ms;
  };
  return () => {
    const st = store.state?.mini?.kind === 'autoball' ? store.state.mini.state : null;
    const c = st?.cars[store.playerId!];
    if (!st || !c) return;
    q(root, '.sa').textContent = String(st.score.A);
    q(root, '.sb').textContent = String(st.score.B);
    const secs = st.sub === 'play' ? secondsLeft() : Math.ceil(st.clock / 1000);
    q(root, '.afb-clock').textContent = `${st.overtime ? 'Golden Goal ' : ''}${fmtClock(secs)}`;
    bar.style.width = `${Math.round(c.b)}%`;
    btns.boost.classList.toggle('empty', c.b < 3);
    btns.hop.classList.toggle('cool', c.hc > 0);
    if (c.k !== touches) {
      touches = c.k;
      vibrate(10);
    }
    // Tor
    const g = st.lastGoal;
    if (g && g.seq !== seenGoal) {
      seenGoal = g.seq;
      const mine = g.team === team;
      flash(mine ? 'TOR!' : 'GEGENTOR', mine ? 'go' : 'hit', 2600);
      vibrate(mine ? [60, 40, 60, 40, 120] : 120);
    }
    // Mitte: Countdown / LOS
    const now = performance.now();
    if (st.sub === 'countdown') {
      const s = secondsLeft();
      center.textContent = s > 3 ? (st.overtime ? 'Golden Goal!' : 'Gleich ist Anstoß') : String(Math.max(1, s));
      center.className = `k3-center ${s > 3 ? 'small' : 'count'}`;
    } else if (st.sub === 'play' && lastSub === 'countdown') {
      flash('LOS!', 'go', 800);
    } else if (centerUntil && now > centerUntil) {
      center.textContent = '';
      centerUntil = 0;
    }
    lastSub = st.sub;
    const name = g?.scorer ? store.state?.players.find((p) => p.id === g.scorer)?.name : null;
    const msg =
      st.sub === 'countdown'
        ? 'GAS gedrückt halten – gleich geht’s los!'
        : st.sub === 'goal' && g
          ? g.own
            ? `Eigentor${name ? ` von ${name}` : ''}!`
            : name
              ? `${name} trifft!`
              : ''
          : c.ch
            ? 'Turbo bereit – BREMSE loslassen!'
            : c.d
              ? 'Drift …'
              : c.b < 3 && inp.boost
                ? 'Boost leer – lädt sich auf'
                : '';
    q(root, '.k3-msg').textContent = msg;
    btns.brake.classList.toggle('afb-charged', c.ch);
  };
}
