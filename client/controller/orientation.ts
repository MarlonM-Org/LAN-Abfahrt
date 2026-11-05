import { MINI_INFO, ORIENT_TEXT, type PhoneOrientation } from '../../shared/games';
import type { MiniKind } from '../../shared/types';
import { type Screen, escapeHtml, store } from './core';

/**
 * Handy-Ausrichtung – ein zentraler Baustein für alle Spiele (Haltung steht in `MINI_INFO[kind].orientation`,
 * Screens dürfen per drittem Tupel-Element übersteuern):
 *   - Ansage-Karte `#orient-card` vor jedem Spiel (Icon, Titel, Haltung) – nicht blockierend,
 *     2 s bzw. bei Quer-Spielen bis das Handy quer liegt (+0,6 s)
 *   - blockierendes Overlay `#orient` bei falscher Lage (Dreh-Animation, nach 3 s Hinweis auf die iPhone-Sperre),
 *     beim Einblenden `input-reset` → Sticks senden (0, 0), Halte-Knöpfe lassen los
 *   - Android: beim ersten Tipp in einem Spiel Vollbild + `screen.orientation.lock()`, Vollbild bleibt die Session über
 *   - Laptop/Tablet (feiner Zeiger oder kurze Bildschirmseite > 600 px) werden nie gewarnt oder gesperrt
 *   - Kein Overlay, solange ein Textfeld fokussiert ist (Tastatur verkleinert den Viewport)
 */

/** Sensor-/Tastatur-Spiele: hochkant Pflicht, kein „Trotzdem so“ */
const STRICT: MiniKind[] = ['flunky', 'bowling', 'enten', 'boule', 'darts', 'golf', 'stillepost', 'sprueche', 'wpistole', 'angeln', 'werwars'];

export function deviceOrient(): 'portrait' | 'landscape' {
  const t = screen.orientation?.type;
  if (t) return t.startsWith('landscape') ? 'landscape' : 'portrait';
  const wo = (window as unknown as { orientation?: number }).orientation;
  if (typeof wo === 'number') return Math.abs(wo) === 90 ? 'landscape' : 'portrait';
  return matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
}

/** Laptop (Maus/Touchpad) und Tablets: nie warnen, nie sperren */
export function orientExempt(): boolean {
  if (new URLSearchParams(location.search).has('orient')) return false; // ?orient erzwingt das Verhalten (Tests)
  return matchMedia('(hover: hover) and (pointer: fine)').matches || Math.min(screen.width, screen.height) > 600;
}

function inputFocused() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable);
}

const overlay = document.getElementById('orient');
const card = document.getElementById('orient-card');

let want: PhoneOrientation = 'any';
let nag = false;
let kind: MiniKind | null = null;
/** Spiel, für das die Karte zuletzt gezeigt wurde (pro Spielinstanz einmal) */
let cardKind: MiniKind | null = null;
let cardUntil = 0;
let cardStart = 0;
let cardHolding = false;
let cardTimer: number | undefined;
/** „Trotzdem so“ – gilt bis zum nächsten Spiel */
let allowedFor: MiniKind | null = null;
let overlayOn = false;
let overlayTimer: number | undefined;
let lastOrient = deviceOrient();

const PASSIVE = /(^|-)(over|spectate|watch|wait|out)(-|$)/;

/** Bei jedem Render aufrufen: Haltung aus Phase/Spiel/Screen ableiten, Overlay/Karte/Lock abgleichen */
export function syncOrientation(screenT: Screen) {
  const s = store.state;
  const [key, , override] = screenT;
  // Regelkarte (Phase `intro`) zählt schon zum Spiel: gleiche Haltung, Overlay greift dort bereits
  const gameKind = s?.phase === 'mini' ? s.mini?.kind : s?.phase === 'intro' ? s.intro?.kind : undefined;
  if (store.joined && gameKind && gameKind in MINI_INFO) {
    const k = gameKind;
    if (k !== kind) {
      kind = k;
      allowedFor = null;
    }
    want = override ?? MINI_INFO[k].orientation;
    nag = !PASSIVE.test(key) && !['outdated', 'error', 'offline', 'joining', 'kicked'].includes(key);
    if (cardKind !== k) {
      cardKind = k;
      cardStart = performance.now();
      cardUntil = cardStart + 2000;
      cardHolding = false;
    }
  } else {
    // Lobby, Brett, Ergebnis, Story: hochkant (nur Android-Lock), nie ein Overlay
    want = s && store.joined ? 'portrait' : 'any';
    nag = false;
    kind = null;
    cardKind = null;
    allowedFor = null;
  }
  update();
  relock();
}

function wrong() {
  return want !== 'any' && deviceOrient() !== want && !orientExempt();
}

function update() {
  const now = performance.now();
  const bad = wrong();
  // Overlay
  const showOverlay = nag && bad && !inputFocused() && allowedFor !== kind;
  if (overlay && showOverlay !== overlayOn) {
    overlayOn = showOverlay;
    clearTimeout(overlayTimer);
    if (showOverlay) {
      renderOverlay();
      overlay.classList.remove('hidden', 'late');
      window.dispatchEvent(new Event('input-reset'));
      overlayTimer = window.setTimeout(() => overlay.classList.add('late'), 3000);
    } else overlay.classList.add('hidden');
  }
  // Ansage-Karte: Quer-Spiele halten sie, bis das Handy richtig liegt
  if (cardKind) {
    // (höchstens 8 s – wer nur zuschaut, darf hochkant bleiben; das Overlay kommt, sobald er dran ist)
    const hold = bad && want === 'landscape' && now - cardStart < 8000;
    if (cardHolding && !hold) cardUntil = Math.max(cardUntil, now + 600);
    cardHolding = hold;
  }
  const showCard = !!cardKind && !overlayOn && (cardHolding || now < cardUntil);
  if (card) {
    if (showCard && card.dataset.kind !== `${cardKind}-${want}`) {
      const info = MINI_INFO[cardKind!];
      card.dataset.kind = `${cardKind}-${want}`;
      card.innerHTML = `<span class="oc-icon">${info.icon}</span><div><b>${escapeHtml(info.title)}</b><small class="oc-${want}">${ORIENT_TEXT[want]}</small></div>`;
    }
    card.classList.toggle('hidden', !showCard);
  }
  clearTimeout(cardTimer);
  if (showCard) cardTimer = window.setTimeout(update, cardHolding ? Math.max(50, cardStart + 8000 - now + 20) : Math.max(50, cardUntil - now + 20));
}

function renderOverlay() {
  if (!overlay) return;
  const info = kind ? MINI_INFO[kind] : null;
  const canSkip = want === 'portrait' && !!kind && !STRICT.includes(kind);
  overlay.innerHTML = `
    <div class="or-box">
      <div class="or-phone or-${want}"><i></i></div>
      ${info ? `<p class="or-game">${info.icon} ${escapeHtml(info.title)}</p>` : ''}
      <h2>${ORIENT_TEXT[want]}</h2>
      <p class="or-lock">Dreht sich nicht? Ausrichtungssperre im Kontrollzentrum ausschalten 🔒</p>
      ${canSkip ? '<button class="secondary small or-skip">Trotzdem so</button>' : ''}
    </div>`;
  overlay.querySelector('.or-skip')?.addEventListener('click', () => {
    allowedFor = kind;
    update();
  });
}

// ---------------------------------------------------------------- Android: Vollbild + Lock

type LockableOrientation = ScreenOrientation & { lock?: (t: string) => Promise<void>; unlock?: () => void };
let fsWanted = false;
let fsBusy = false;
let locked: PhoneOrientation | null = null;

function hasFullscreen() {
  return typeof document.documentElement.requestFullscreen === 'function';
}

async function enterFullscreen() {
  if (fsBusy || document.fullscreenElement || !hasFullscreen()) return;
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (ua && !ua.isActive) return; // pointerdown bei Touch zählt nicht als Geste → pointerup versucht es
  fsBusy = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    fsWanted = true;
  } catch {
    /* nicht erlaubt – nächster Tipp versucht es wieder */
  }
  fsBusy = false;
  locked = null;
  relock();
}

function relock() {
  if (!document.fullscreenElement || orientExempt()) return;
  const target: PhoneOrientation = want;
  if (target === locked) return;
  locked = target;
  const o = screen.orientation as LockableOrientation | undefined;
  try {
    if (target === 'any') o?.unlock?.();
    else void o?.lock?.(target).catch(() => (locked = null));
  } catch {
    locked = null;
  }
}

function onTap() {
  if (orientExempt() || !hasFullscreen()) return;
  // Erst im Spiel ins Vollbild (Lobby mit Namensfeld bleibt normal); danach bleibt es die Session über
  const inGame = store.state?.phase === 'mini' || store.state?.phase === 'intro';
  if (!document.fullscreenElement && (inGame ? want !== 'any' : fsWanted)) void enterFullscreen();
}
document.addEventListener('pointerdown', onTap, true);
document.addEventListener('pointerup', onTap, true);
document.addEventListener('fullscreenchange', () => {
  locked = null;
  // Zurück-Geste beendet das Vollbild → beim nächsten Tipp neu versuchen (fsWanted bleibt)
  if (document.fullscreenElement) relock();
});

// ---------------------------------------------------------------- Drehen

const onRotateCbs: (() => void)[] = [];
/** Rückruf bei jeder Drehung (z. B. Screens mit einmalig berechneten Größen neu bauen) */
export function onRotate(cb: () => void) {
  onRotateCbs.push(cb);
  return () => onRotateCbs.splice(onRotateCbs.indexOf(cb), 1);
}

function rotated() {
  const o = deviceOrient();
  if (o !== lastOrient) {
    lastOrient = o;
    // Wer beim Drehen einen Stick/Knopf hält, soll nicht weiterlaufen
    window.dispatchEvent(new Event('input-reset'));
    for (const cb of [...onRotateCbs]) cb();
  }
  update();
}
screen.orientation?.addEventListener?.('change', rotated);
matchMedia('(orientation: landscape)').addEventListener?.('change', rotated);
window.addEventListener('resize', rotated);
document.addEventListener('focusin', () => update());
document.addEventListener('focusout', () => setTimeout(update, 50));
