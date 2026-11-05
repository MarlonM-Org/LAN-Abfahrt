import { KOFFER_ITEMS, type KofferState } from '../../../shared/koffer';
import { kofferPiece } from '../../art/koffer';
import { haptic } from '../haptic';
import { onInputReset } from '../stick';
import { type Screen, app, el, message, q, send, store } from '../core';

const ICON = {
  left: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M16 3 L5 12 L16 21 Z" fill="currentColor"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 3 L19 12 L8 21 Z" fill="currentColor"/></svg>`,
  rot: `<svg viewBox="0 0 24 24" width="38" height="38"><path d="M12 4 A8 8 0 1 1 4.5 9.5" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M12 0 L17 4.5 L12 9 Z" fill="currentColor"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 6 L20 6 L12 18 Z" fill="currentColor"/></svg>`,
};

const koffer = () => (store.state?.mini?.kind === 'koffer' ? store.state.mini.state : null);
const myCar = (s: KofferState) => s.cars.find((c) => c.owners.includes(store.playerId!));
const nameOf = (id: string) => store.state?.players.find((p) => p.id === id)?.name ?? '?';

/** Knopf, der beim Gedrückthalten wiederholt auslöst */
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
  onInputReset(btn, stop);
}

function paintNext(c: HTMLCanvasElement, item: number, v: number) {
  const pix = kofferPiece(item, v, 9);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pix.canvas, Math.round((c.width - pix.w) / 2), Math.round((c.height - pix.h) / 2));
}

export function pickKoffer(s: KofferState): Screen {
  const me = myCar(s);
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'settle' || s.sub === 'over')
    return [`koffer-over-${s.sub}`, () => {
      app.append(
        el(`<div class="center koffer-over">
          <h2>${s.sub === 'over' ? 'Klappe zu!' : 'Zeit um!'}</h2>
          <p class="koffer-big">${me.liters} Liter</p>
          <p>${me.count} Teile · ${me.pct} % voll</p>
          ${me.lost ? `<p>${me.lost}× rausgefallen</p>` : ''}
          <p>Schau auf den Fernseher!</p>
        </div>`),
      );
      return null;
    }];

  return ['koffer-play', () => {
    const partner = me.owners.find((o) => o !== store.playerId);
    // Quer wie der Wackelturm: links ◀ ▶, rechts DREHEN über REIN DAMIT, Mitte Füllstand/Nächstes/Meldung
    const root = el(`
      <div class="lx turm-lx koffer-lx">
        <div class="lx-head"><span class="timer"></span><span class="ltr"></span>${partner ? `<span class="koffer-team grow">Team mit ${nameOf(partner)} – ihr packt abwechselnd</span>` : '<span class="grow"></span>'}</div>
        <div class="lx-left turm-move koffer-pad">
          <button class="big-btn turm-btn shift" data-dir="-1">${ICON.left}</button>
          <button class="big-btn turm-btn shift" data-dir="1">${ICON.right}</button>
        </div>
        <div class="lx-mid turm-info koffer-info">
          <div class="koffer-fill"><div class="koffer-bar"><i></i></div><small class="pct"></small></div>
          <div class="turm-next"><small>Nächstes:</small><canvas width="54" height="36"></canvas><small class="next-name"></small></div>
          <p class="turm-msg"></p>
        </div>
        <div class="lx-right turm-act koffer-pad">
          <button class="big-btn turm-btn rot">${ICON.rot}<span>DREHEN</span></button>
          <button class="big-btn turm-btn drop">${ICON.drop}<span>REIN DAMIT</span></button>
        </div>
      </div>
    `);
    for (const b of root.querySelectorAll<HTMLButtonElement>('.shift')) {
      const dir = Number(b.dataset.dir);
      repeatButton(b, () => {
        send('shift', { dir });
        haptic(5);
      });
    }
    const rot = q<HTMLButtonElement>(root, '.rot');
    rot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      send('rotate');
      haptic(8);
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
    onInputReset(drop, () => {
      if (!drop.classList.contains('held')) return;
      drop.classList.remove('held');
      send('drop', { on: false });
    });
    app.append(root);

    const canvas = q<HTMLCanvasElement>(root, 'canvas');
    const pads = [...root.querySelectorAll<HTMLElement>('.koffer-pad')];
    let nextKey = '';
    let lostSeq = me.lostSeq;
    let lostAt = 0;
    let wasMine = false;
    return () => {
      const st = koffer();
      const car = st && myCar(st);
      if (!st || !car) return;
      const sec = Math.ceil(st.endsIn / 1000);
      q(root, '.timer').textContent = st.sub === 'countdown' ? 'Start ...' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      q(root, '.timer').classList.toggle('alert', st.sub === 'play' && sec <= 20);
      q(root, '.ltr').textContent = `${car.liters} L`;
      q(root, '.pct').textContent = `${car.pct} % voll`;
      q<HTMLElement>(root, '.koffer-bar i').style.width = `${car.pct}%`;
      const nk = car.next.join('-');
      if (nk !== nextKey) {
        nextKey = nk;
        paintNext(canvas, car.next[0], car.next[1]);
        q(root, '.next-name').textContent = KOFFER_ITEMS[car.next[0]].name;
      }
      if (car.lostSeq !== lostSeq) {
        lostSeq = car.lostSeq;
        lostAt = performance.now();
        haptic([60, 40, 60]);
      }
      const mine = !!car.active && car.active.owner === store.playerId;
      if (mine && !wasMine && partner) haptic(30);
      wasMine = mine;
      for (const pad of pads) pad.classList.toggle('waiting', !!partner && !mine);
      const msg = q(root, '.turm-msg');
      const text =
        st.sub === 'countdown'
          ? `Gleich geht’s los! (${Math.max(1, Math.ceil(st.endsIn / 1000))})`
          : performance.now() - lostAt < 1600
            ? 'Rums! Da ist was rausgefallen!'
            : car.full
              ? 'Bis unters Dach voll!'
              : partner && !mine
                ? `${nameOf(partner)} packt gerade ...`
                : car.active
                  ? `${KOFFER_ITEMS[car.active.item].name} – wohin damit?`
                  : 'Packt den Kofferraum voll!';
      msg.textContent = text;
      msg.classList.toggle('alert', st.sub === 'play' && (performance.now() - lostAt < 1600 || sec <= 20));
    };
  }];
}
