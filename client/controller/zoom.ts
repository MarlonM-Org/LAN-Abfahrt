/**
 * Zoom-Schutz fürs Handy (iPhone + Android):
 *  1. Zoom-Gesten blocken (iOS gesture*, Doppeltipp, Zwei-Finger-Wischen außerhalb von Stick/Knöpfen)
 *  2. Trotzdem eingetretenen Zoom erkennen (visualViewport.scale) → Overlay „Zoom zurücksetzen“ + Viewport-Reset
 *  3. Android: einmal Vollbild versuchen (mehr Platz, keine Browserleisten)
 * Wird einmalig aus main.ts gestartet.
 */
const ZOOM_MAX = 1.05;
const DOUBLE_TAP_MS = 300;

let started = false;
let fullscreenTried = false;

/** Dort laufen Zwei-Finger-Eingaben weiter (zwei Daumen: Stick, Knöpfe, Spielflächen) */
function isControl(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('button, canvas, .lx, .st-zone, .k3-left, .k3-right, input, select, textarea');
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Trick: Viewport kurz neu setzen, damit der Browser auf Skala 1 zurückspringt */
function resetViewport() {
  const m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!m) return;
  const orig = m.content;
  m.content = 'width=device-width, initial-scale=1.0, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover';
  setTimeout(() => {
    m.content = orig;
  }, 120);
}

function tryFullscreen() {
  if (fullscreenTried || isIOS()) return;
  fullscreenTried = true;
  const root = document.documentElement;
  if (!root.requestFullscreen || document.fullscreenElement) return;
  try {
    void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch {
    /* still ignorieren */
  }
}

function buildOverlay(): HTMLElement {
  const o = document.createElement('div');
  o.id = 'zoom-reset';
  o.className = 'zoom-reset hidden';
  o.innerHTML = `
    <div class="zr-box">
      <div class="zr-pinch" aria-hidden="true"><span class="zr-f zr-f1"></span><span class="zr-f zr-f2"></span></div>
      <h2>Zoom zurücksetzen</h2>
      <p>Zwei Finger zusammenziehen</p>
    </div>`;
  document.body.append(o);
  return o;
}

export function initZoomGuard() {
  if (started) return;
  started = true;

  // iOS-Pinch
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }

  // Doppeltipp-Zoom: zweites touchend binnen 300 ms unterdrücken. Knöpfe und Spielflächen lösen auf pointerdown
  // aus und bleiben unberührt (preventDefault auf touchend würde dort nur den click schlucken).
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastEnd < DOUBLE_TAP_MS && e.cancelable && !isControl(e.target)) e.preventDefault();
      lastEnd = now;
    },
    { passive: false },
  );

  // Zwei-Finger-Wischen/Pinch außerhalb der Bedienelemente
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && e.cancelable && !isControl(e.target)) e.preventDefault();
    },
    { passive: false },
  );

  // Android-Vollbild beim ersten Tipp (höchstens einmal)
  document.addEventListener('pointerup', tryFullscreen, { once: true });

  // Zoom erkennen
  const vv = window.visualViewport;
  if (!vv) return;
  let overlay: HTMLElement | null = null;
  let resetTried = 0;
  const check = () => {
    const zoomed = vv.scale > ZOOM_MAX;
    if (zoomed) {
      overlay ??= buildOverlay();
      overlay.classList.remove('hidden');
      const now = Date.now();
      if (now - resetTried > 1500) {
        resetTried = now;
        resetViewport();
      }
    } else overlay?.classList.add('hidden');
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
}

/** Spiel-Screen aktiv? → body/#app erlauben nur noch Scrollen (kein Pinch/Doppeltipp-Zoom) */
export function setInGame(on: boolean) {
  document.documentElement.classList.toggle('in-game', on);
}
