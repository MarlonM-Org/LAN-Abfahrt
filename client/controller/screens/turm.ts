import type { TurmState } from '../../../shared/types';
import { TURM, TURM_SHAPES } from '../../../shared/games';
import { turmPiece } from '../../art/turm';
import { type Screen, app, el, message, q, send, store } from '../core';

const meters = (h: number) => `${(h / TURM.BLOCK).toFixed(1).replace('.', ',')} m`;

const ICON = {
  left: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M16 3 L5 12 L16 21 Z" fill="currentColor"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 3 L19 12 L8 21 Z" fill="currentColor"/></svg>`,
  rot: `<svg viewBox="0 0 24 24" width="38" height="38"><path d="M12 4 A8 8 0 1 1 4.5 9.5" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M12 0 L17 4.5 L12 9 Z" fill="currentColor"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 6 L20 6 L12 18 Z" fill="currentColor"/></svg>`,
};

/** Knopf, der beim Gedrückthalten wiederholt auslöst (Teil schnell verschieben) */
function repeatButton(btn: HTMLElement, fire: () => void) {
  let t1: number | undefined;
  let t2: number | undefined;
  const stop = () => {
    clearTimeout(t1);
    clearInterval(t2);
    btn.classList.remove('held');
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('held');
    fire();
    t1 = window.setTimeout(() => (t2 = window.setInterval(fire, 110)), 260);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Nächstes Teil als Pixel-Art auf ein Canvas malen */
function paintNext(c: HTMLCanvasElement, shape: number, v: number) {
  const cell = 10;
  const pix = turmPiece(shape, v, cell);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pix.canvas, Math.round((c.width - pix.w) / 2), Math.round((c.height - pix.h) / 2));
}

export function pickTurm(s: TurmState): Screen {
  const me = s.lanes.find((l) => l.id === store.playerId);
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['turm-over', message(me.place ? `Gipfel! Platz ${me.place}` : 'Zeit um!', `Dein Turm: ${meters(me.height)}\nSchau auf den Fernseher!`)];
  if (me.place) return [`turm-done-${me.place}`, message(`Gipfel erreicht – Platz ${me.place}!`, 'Schau zu, wie die anderen wackeln ...')];
  if (me.frozen) return ['turm-frozen', message('Keine Leben mehr!', `Dein Turm ist eingefroren bei ${meters(me.height)}.`)];

  return ['turm-play', () => {
    const root = el(`
      <div class="top-row"><span class="timer"></span><span class="hgt"></span></div>
      <div class="turm-info">
        <div class="turm-lives"></div>
        <div class="turm-next"><small>Nächstes:</small><canvas width="48" height="36"></canvas><small class="next-name"></small></div>
      </div>
      <p class="turm-msg"></p>
      <div class="turm-pad">
        <button class="big-btn turm-btn shift" data-dir="-1">${ICON.left}</button>
        <button class="big-btn turm-btn rot">${ICON.rot}</button>
        <button class="big-btn turm-btn shift" data-dir="1">${ICON.right}</button>
        <button class="big-btn turm-btn drop">${ICON.drop}<span>FALLEN</span></button>
      </div>
    `);
    for (const b of root.querySelectorAll<HTMLButtonElement>('.shift')) {
      const dir = Number(b.dataset.dir);
      repeatButton(b, () => {
        send('shift', { dir });
        navigator.vibrate?.(5);
      });
    }
    const rot = q<HTMLButtonElement>(root, '.rot');
    rot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      send('rotate');
      navigator.vibrate?.(8);
    });
    rot.addEventListener('contextmenu', (e) => e.preventDefault());
    const drop = q<HTMLButtonElement>(root, '.drop');
    drop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      drop.setPointerCapture(e.pointerId);
      drop.classList.add('held');
      send('drop', { on: true });
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      drop.addEventListener(ev, () => {
        if (!drop.classList.contains('held')) return;
        drop.classList.remove('held');
        send('drop', { on: false });
      });
    }
    drop.addEventListener('contextmenu', (e) => e.preventDefault());
    app.append(root);

    const canvas = q<HTMLCanvasElement>(root, 'canvas');
    let nextKey = '';
    let livesKey = -1;
    let lostSeq = me.lostSeq;
    let lostAt = 0;
    return () => {
      const st = store.state?.mini?.kind === 'turm' ? store.state.mini.state : null;
      const lane = st?.lanes.find((l) => l.id === store.playerId);
      if (!st || !lane) return;
      const sec = Math.ceil(st.endsIn / 1000);
      q(root, '.timer').textContent = st.sub === 'countdown' ? 'Start ...' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      q(root, '.hgt').textContent = `${meters(lane.height)} / ${TURM.GOAL} m`;
      const nk = lane.next.join('-');
      if (nk !== nextKey) {
        nextKey = nk;
        paintNext(canvas, lane.next[0], lane.next[1]);
        q(root, '.next-name').textContent = TURM_SHAPES[lane.next[0]].name;
      }
      if (lane.lives !== livesKey) {
        livesKey = lane.lives;
        q(root, '.turm-lives').innerHTML = Array.from({ length: TURM.LIVES }, (_, i) => `<span class="${i < lane.lives ? 'on' : 'off'}">♥</span>`).join('');
      }
      if (lane.lostSeq !== lostSeq) {
        lostSeq = lane.lostSeq;
        lostAt = performance.now();
        navigator.vibrate?.([60, 40, 60]);
      }
      const msg = q(root, '.turm-msg');
      const text =
        st.sub === 'countdown'
          ? `Gleich geht’s los! (${Math.max(1, Math.ceil(st.endsIn / 1000))})`
          : performance.now() - lostAt < 1600
            ? 'Platsch! Teil verloren!'
            : lane.gust
              ? 'Windböe! Festhalten!'
              : lane.hold > 0
                ? 'Über dem Ziel – halten!'
                : 'Stapel bis zum Gipfelkreuz!';
      msg.textContent = text;
      msg.classList.toggle('alert', text !== 'Stapel bis zum Gipfelkreuz!' && st.sub === 'play');
    };
  }];
}
