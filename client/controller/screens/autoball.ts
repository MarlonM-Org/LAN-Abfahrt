import type { Team } from '../../../shared/types';
import type { AfbState } from '../../../shared/autoball';
import { TEAM_INFO } from '../../../shared/flunky';
import { onInputReset, stickZone } from '../stick';
import { type Screen, app, el, message, q, secondsLeft, send, store } from '../core';
import { haptic } from '../haptic';

/**
 * Auto-Fußball am Handy (quer halten, gemeinsames Querlayout `.lx`):
 *   links  – normaler Joystick (`stickZone`) in TV-Richtung: Stick nach links = Auto fährt auf dem TV nach links,
 *            egal wie es gerade steht (es dreht im Bogen dorthin). Loslassen = Richtung halten.
 *   Mitte  – Spielstand, Countdown, Hinweise
 *   rechts – BREMSE (hoch, links), BOOST oben + GAS unten (Daumen von GAS hochrutschen); man kann zwischen den
 *            Knöpfen rutschen, ohne abzusetzen.
 * Der TV zeigt das Spielfeld, das Handy nur Spielstand, Uhr und Boost-Tank.
 */

type Btn = 'gas' | 'brake' | 'boost';

const teamName = (t: Team) => TEAM_INFO[t].name;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function pickAutoball(s: AfbState): Screen {
  const car = s.cars[store.playerId!];
  if (!car) return ['spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const res = s.winner ? (s.winner === car.t ? 'Gewonnen!' : 'Verloren ...') : 'Unentschieden!';
    return ['afb-over', message(`Abpfiff – ${res}`, `${s.score.A}:${s.score.B} · Schau auf den Fernseher!`)];
  }
  return ['afb-drive', () => buildDrive(car.t)];
}

function buildDrive(team: Team) {
  const st0 = store.state?.mini?.kind === 'autoball' ? store.state.mini.state : null;
  if (!st0) return null;
  const dirText = team === 'A' ? 'spielt nach rechts →' : '← spielt nach links';
  const root = el(`
    <div class="lx afb-lx afb-${team}">
      <div class="lx-head">
        <span class="lx-tag team-${team}">${teamName(team).toUpperCase()}</span>
        <span class="afb-dir grow">${dirText}</span>
        <span class="timer afb-clock">3:00</span>
      </div>
      <div class="lx-left afb-stick"><span class="st-label">Stick = Richtung wie auf dem TV</span></div>
      <div class="lx-mid afb-mid">
        <div class="afb-score"><span class="sa">0</span><i>:</i><span class="sb">0</span></div>
        <div class="afb-center"></div>
        <div class="afb-msg"></div>
      </div>
      <div class="lx-right afb-pad">
        <div class="afb-btn afb-brake" data-b="brake">BREMSE<small>im Stand<br/>rückwärts</small></div>
        <div class="afb-btn afb-boost" data-b="boost">BOOST<div class="afb-bar"><i></i></div></div>
        <div class="afb-btn afb-gas" data-b="gas">GAS</div>
      </div>
    </div>
  `);
  app.append(root);
  const lx = q(root, '.lx');
  lx.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- Eingaben: Stick (x/y in TV-Richtung) + Knöpfe, alles in einer Nachricht
  const inp = { x: 0, y: 0, gas: false, brake: false, boost: false };
  let lastSent = 0;
  const push = () => {
    lastSent = performance.now();
    send('steer', { ...inp });
  };
  // stickZone drosselt selbst und wiederholt gehaltene Ausschläge alle 250 ms (auch bei input-reset → 0/0)
  stickZone(
    q(root, '.afb-stick'),
    (x, y) => {
      inp.x = x;
      inp.y = y;
      push();
    },
    { radius: 52 },
  );

  // Rechts: GAS / BREMSE / BOOST mit Rüberrutschen (Knöpfe selbst ohne Pointer-Events, Treffer per Rechteck)
  const pad = q(root, '.afb-pad');
  const btns: Record<Btn, HTMLElement> = { gas: q(root, '.afb-gas'), brake: q(root, '.afb-brake'), boost: q(root, '.afb-boost') };
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
    let bd = 14;
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
  const applyButtons = () => {
    const down = new Set<Btn>();
    for (const b of fingers.values()) if (b) down.add(b);
    let changed = false;
    for (const b of Object.keys(btns) as Btn[]) {
      const on = down.has(b);
      btns[b].classList.toggle('down', on);
      if (inp[b] !== on) {
        if (on) haptic('tick');
        inp[b] = on;
        changed = true;
      }
    }
    if (changed) push();
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    measure();
    fingers.set(e.pointerId, hit(e.clientX, e.clientY));
    applyButtons();
  });
  pad.addEventListener('pointermove', (e) => {
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
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', release);
  // Handy gedreht / Ausrichtungs-Overlay eingeblendet: gehaltene Knöpfe loslassen (den Stick lässt stickZone selbst los)
  onInputReset(pad, () => {
    fingers.clear();
    applyButtons();
  });
  window.addEventListener('resize', measure);
  // Gehaltene Knöpfe regelmäßig wiederholen (der Raum lässt nach 700 ms ohne Nachschub los)
  const keepAlive = setInterval(() => {
    if (!root.isConnected) {
      window.removeEventListener('resize', measure);
      return clearInterval(keepAlive);
    }
    if ((inp.gas || inp.brake || inp.boost) && performance.now() - lastSent > 280) push();
  }, 100);

  // ---- Anzeige
  const center = q(root, '.afb-center');
  const msgEl = q(root, '.afb-msg');
  const bar = q(root, '.afb-bar i');
  let centerUntil = 0;
  let lastSub = '';
  let seenGoal = st0.lastGoal?.seq ?? 0;
  let touches = st0.cars[store.playerId!]?.k ?? 0;
  const flash = (text: string, cls = '', ms = 900) => {
    center.textContent = text;
    center.className = `afb-center ${cls}`;
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
    btns.brake.classList.toggle('charged', c.ch);
    if (c.k !== touches) {
      touches = c.k;
      haptic(10);
    }
    // Tor
    const g = st.lastGoal;
    if (g && g.seq !== seenGoal) {
      seenGoal = g.seq;
      const mine = g.team === team;
      flash(mine ? 'TOR!' : 'GEGENTOR', mine ? 'go' : 'hit', 2600);
      haptic(mine ? [60, 40, 60, 40, 120] : 120);
    }
    // Countdown / LOS
    const now = performance.now();
    if (st.sub === 'countdown') {
      const s = secondsLeft();
      center.textContent = s > 3 ? (st.overtime ? 'Golden Goal!' : 'Gleich ist Anstoß') : String(Math.max(1, s));
      center.className = `afb-center ${s > 3 ? 'small' : 'count'}`;
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
        ? st.first
          ? 'Stick zeigt die Richtung – wie auf dem TV. GAS halten = fahren!'
          : 'GAS gedrückt halten – gleich geht’s los!'
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
    if (msgEl.textContent !== msg) msgEl.textContent = msg;
  };
}
