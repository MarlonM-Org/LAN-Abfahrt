import type { KartItem, KartState } from '../../../shared/types';
import { KART_TRACKS } from '../../../shared/kart';
import { itemIcon } from '../../art/kartsprites';
import { type Screen, app, el, message, q, secondsLeft, send, store, toast } from '../core';
import { enableMotion, motionSupport, onMotion } from '../motion';
import { steerFromRoll, tiltRoll } from '../tilt';

const OFFROAD = { beach: 'Sand bremst – zurück auf die Strecke!', harbor: 'Kopfsteinpflaster bremst – zurück auf die Strecke!', pool: 'Rasen bremst – zurück auf die Strecke!' };
const ITEM_LABEL: Record<KartItem, string> = { coconut: 'Kokosnuss', banana: 'Banane', ice: 'Turbo-Eis', gull: 'Möwe' };

/** Kipp-Lenkung bleibt über Bildschirmwechsel hinweg aktiv */
const tilt = {
  on: false,
  center: 0,
  roll: 0,
  smooth: 0,
  lastSample: 0,
  unsub: null as (() => void) | null,
};

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((Number(a) % 360) + 360) % 360;
}

async function startTilt(): Promise<boolean> {
  if (!(await enableMotion())) {
    toast('Bewegungssensor nicht erlaubt – Touch-Lenkung');
    return false;
  }
  tilt.unsub?.();
  let first = true;
  tilt.unsub = onMotion((s) => {
    tilt.roll = tiltRoll(s.beta, s.gamma, screenAngle());
    tilt.lastSample = performance.now();
    if (first) {
      first = false;
      tilt.center = tilt.roll;
    }
  });
  // Kommen gar keine Daten (z. B. Laptop ohne Sensor), zurück auf Touch
  const started = performance.now();
  await new Promise((r) => setTimeout(r, 900));
  if (tilt.lastSample < started) {
    tilt.unsub?.();
    tilt.unsub = null;
    toast('Kein Bewegungssensor gefunden');
    return false;
  }
  tilt.on = true;
  return true;
}

function stopTilt() {
  tilt.unsub?.();
  tilt.unsub = null;
  tilt.on = false;
}

export function pickKart(s: KartState): Screen {
  const car = s.karts[store.playerId!];
  if (!car) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['kart-over', message('Rennen vorbei!', 'Schau auf den Fernseher!')];
  if (car.finished) return [`kart-fin-${car.place}`, message(`Im Ziel – Platz ${car.place}!`, 'Ehrenrunde fährt von allein. Schau auf den Fernseher!')];
  const mode = tilt.on ? 'tilt' : 'touch';
  return [`kart-drive-${mode}`, () => buildDrive(mode, () => window.dispatchEvent(new Event('kart-rerender')))];
}

function buildDrive(mode: 'tilt' | 'touch', rerender: () => void) {
  const support = motionSupport();
  const canTilt = support === 'ok' || support === 'needs-permission';
  const root = el(`
    <div class="kart kart-${mode}">
      <div class="kart-top">
        <span class="k-pos">–</span>
        <span class="k-lap"></span>
        <span class="k-item"><canvas width="16" height="16"></canvas><small></small></span>
      </div>
      <p class="k-hint"></p>
      <div class="kart-steer">
        ${
          mode === 'tilt'
            ? `<div class="k-wheel"><div class="k-wheel-in"></div></div>
               <div class="k-tilt-btns"><button class="small k-center">Zentrieren</button><button class="small secondary k-touch">Touch</button></div>`
            : `<div class="k-pad"><span>◀</span><div class="k-knob"></div><span>▶</span></div>
               ${canTilt ? '<button class="small k-motion">Bewegungssensor aktivieren</button>' : ''}`
        }
      </div>
      <button class="big-btn k-brake">BREMSE<br/><small>+ lenken = DRIFT</small></button>
      <button class="big-btn k-use">ITEM</button>
    </div>
  `);
  app.append(root);

  let steer = 0;
  let brake = false;
  let last = { steer: 9, brake: false, t: 0 };
  const push = (force = false) => {
    const now = performance.now();
    if (!force && Math.abs(steer - last.steer) < 0.04 && brake === last.brake && now - last.t < 250) return;
    last = { steer, brake, t: now };
    send('steer', { x: steer, brake });
  };

  // ---- Lenkung
  if (mode === 'touch') {
    const pad = q(root, '.k-pad');
    const knob = q(root, '.k-knob');
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const v = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.36);
      steer = Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
      knob.style.transform = `translateX(${steer * r.width * 0.36}px)`;
      push();
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      active = e.pointerId;
      move(e);
    });
    pad.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      steer = 0;
      knob.style.transform = '';
      push(true);
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    root.querySelector('.k-motion')?.addEventListener('click', async () => {
      if (await startTilt()) {
        toast('Handy quer halten wie ein Lenkrad!');
        rerender();
      }
    });
  } else {
    q(root, '.k-center').addEventListener('click', () => {
      tilt.center = tilt.roll;
      toast('Mitte gesetzt');
    });
    q(root, '.k-touch').addEventListener('click', () => {
      stopTilt();
      rerender();
    });
  }

  // ---- Knöpfe (gedrückt halten)
  const hold = (btn: HTMLElement, onDown: () => void, onUp?: () => void) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('down');
      onDown();
    });
    const up = () => {
      btn.classList.remove('down');
      onUp?.();
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold(
    q(root, '.k-brake'),
    () => {
      brake = true;
      push(true);
    },
    () => {
      brake = false;
      push(true);
    },
  );
  hold(q(root, '.k-use'), () => {
    send('item');
    navigator.vibrate?.(25);
  });

  // ---- Kipp-Lenkung regelmäßig senden
  const wheel = root.querySelector('.k-wheel-in') as HTMLElement | null;
  const loop = setInterval(() => {
    if (!root.isConnected) return clearInterval(loop);
    if (mode === 'tilt') {
      const target = steerFromRoll(tilt.roll, tilt.center);
      tilt.smooth += (target - tilt.smooth) * 0.5;
      steer = Math.round(tilt.smooth * 100) / 100;
      if (wheel) wheel.style.transform = `rotate(${steer * 90}deg)`;
    }
    push();
  }, 50);

  const icon = q<HTMLCanvasElement>(root, '.k-item canvas');
  let shownItem: string | undefined;
  return () => {
    const st = store.state?.mini?.kind === 'kart' ? store.state.mini.state : null;
    const c = st?.karts[store.playerId!];
    if (!st || !c) return;
    const n = Object.keys(st.karts).length;
    q(root, '.k-pos').textContent = `${c.place}./${n}`;
    q(root, '.k-lap').textContent = `Runde ${Math.max(1, c.lap)}/${st.laps}`;
    if (shownItem !== (c.item ?? '')) {
      shownItem = c.item ?? '';
      const ctx = icon.getContext('2d')!;
      ctx.clearRect(0, 0, 16, 16);
      ctx.drawImage(itemIcon(c.item).canvas, 0, 0);
      q(root, '.k-item small').textContent = c.item ? ITEM_LABEL[c.item] : 'kein Item';
      if (c.item) navigator.vibrate?.(15);
    }
    q<HTMLButtonElement>(root, '.k-use').disabled = !c.item;
    const hint =
      st.sub === 'countdown'
        ? mode === 'tilt'
          ? `Start in ${secondsLeft()} – Handy gerade halten, „Zentrieren“ drücken.`
          : `Start in ${secondsLeft()} – Gas gibt das Kart von allein!`
        : c.spin > 0
          ? 'Uiii – du drehst dich!'
          : c.charged
            ? 'Mini-Turbo bereit – BREMSE loslassen!'
            : c.drift
              ? 'Drift ...'
              : c.offroad
                ? OFFROAD[KART_TRACKS[st.track]?.theme ?? 'beach']
                : st.closing
                  ? `Noch ${Math.ceil(st.endsIn / 1000)}s bis Rennende!`
                  : '';
    q(root, '.k-hint').textContent = hint;
  };
}

/** Die Seite baut den Screen neu, wenn sich der Lenk-Modus ändert (Key wechselt) */
export function onKartRerender(fn: () => void) {
  window.addEventListener('kart-rerender', fn);
}
