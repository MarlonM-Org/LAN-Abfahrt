/**
 * Ein schwebender Stick für alle Joystick-Spiele: Wo der Daumen in der Zone aufsetzt, ist die Mitte.
 * So muss man keinen Kreis treffen und kann auf den TV schauen. Zieht der Daumen über den Rand hinaus,
 * wandert der Ring mit (`trailing`), man muss nie „zurückgreifen“.
 *
 * - Deadzone 0,18 (danach auf 0…1 umskaliert), Werte auf 2 Nachkommastellen gerundet
 * - gedrosselt: große Richtungswechsel sofort, kleine höchstens alle 50 ms, beim Halten alle 250 ms erneut
 * - hört auf `input-reset` (Handy gedreht, Overlay eingeblendet) → (0, 0)
 * - Randabstand: die Zone selbst liegt im `.lx`-Layout ≥ 24 px vom Bildschirmrand (Zurück-Wischgeste)
 */
export interface StickOpts {
  /** 'x' = nur links/rechts (y bleibt 0) */
  axis?: 'x' | 'xy';
  /** Auslenkung in px für vollen Ausschlag (Standard 46) */
  radius?: number;
  /** Ring folgt dem Daumen, wenn er über den Radius hinauszieht (Standard: an) */
  trailing?: boolean;
  /** Statt automatisch (0, 0) zu senden: Loslassen selbst behandeln (z. B. Wurf beim Loslassen). `ok` = echtes pointerup */
  onRelease?: (x: number, y: number, ok: boolean) => void;
}

const DEAD = 0.18;

export function stickZone(zone: HTMLElement, onMove: (x: number, y: number) => void, opts: StickOpts = {}) {
  const R = opts.radius ?? 46;
  const axis = opts.axis ?? 'xy';
  const trailing = opts.trailing ?? true;
  zone.classList.add('st-zone');
  const ring = document.createElement('div');
  ring.className = `st-ring${axis === 'x' ? ' st-x' : ''}`;
  ring.style.setProperty('--st-r', `${R}px`);
  const knob = document.createElement('div');
  knob.className = 'st-knob';
  ring.append(knob);
  zone.append(ring);

  let active: number | null = null;
  let cx = 0;
  let cy = 0;
  let cur = { x: 0, y: 0 };
  let sent = { x: 0, y: 0, t: 0 };
  const emit = (force = false) => {
    const now = performance.now();
    const changed = Math.hypot(cur.x - sent.x, cur.y - sent.y);
    if (!force && changed < 0.08) return;
    if (!force && changed < 0.45 && now - sent.t < 50) return;
    sent = { ...cur, t: now };
    onMove(cur.x, cur.y);
  };
  const place = () => {
    const r = zone.getBoundingClientRect();
    ring.style.left = `${cx - r.left}px`;
    ring.style.top = `${cy - r.top}px`;
  };
  const move = (e: PointerEvent) => {
    let dx = e.clientX - cx;
    let dy = axis === 'x' ? 0 : e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      if (trailing) {
        const over = d - R;
        cx += (dx / d) * over;
        cy += (dy / d) * over;
        place();
      }
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.hypot(dx, dy) / R;
    const k = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD) / m;
    cur = { x: Math.round((dx / R) * k * 100) / 100, y: Math.round((dy / R) * k * 100) / 100 };
    emit();
  };
  const finish = (ok: boolean) => {
    if (active === null) return;
    active = null;
    const last = cur;
    cur = { x: 0, y: 0 };
    ring.style.left = '';
    ring.style.top = '';
    knob.style.transform = '';
    ring.classList.remove('on');
    zone.classList.remove('st-active');
    if (opts.onRelease) {
      sent = { x: 0, y: 0, t: performance.now() };
      opts.onRelease(last.x, last.y, ok);
    } else emit(true);
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active !== null) return;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    active = e.pointerId;
    cx = e.clientX;
    cy = e.clientY;
    place();
    ring.classList.add('on');
    zone.classList.add('st-active');
    move(e);
  });
  zone.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
  const up = (e: PointerEvent) => e.pointerId === active && finish(e.type === 'pointerup');
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('lostpointercapture', up);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());
  const reset = () => {
    if (!zone.isConnected) return window.removeEventListener('input-reset', reset);
    finish(false);
  };
  window.addEventListener('input-reset', reset);
  const keepAlive = setInterval(() => {
    if (!zone.isConnected) {
      window.removeEventListener('input-reset', reset);
      return clearInterval(keepAlive);
    }
    if (active !== null) emit(true);
  }, 250);
  /** aktuelle Richtung (z. B. für „Schlag in Stick-Richtung“) */
  return () => cur;
}

/** Hilfe für Halte-Knöpfe: ruft `release` bei `input-reset` und Fenster-Blur, solange `el` im DOM hängt */
export function onInputReset(el: HTMLElement, release: () => void) {
  const fn = () => {
    if (!el.isConnected) {
      window.removeEventListener('input-reset', fn);
      window.removeEventListener('blur', fn);
      return;
    }
    release();
  };
  window.addEventListener('input-reset', fn);
  window.addEventListener('blur', fn);
}
