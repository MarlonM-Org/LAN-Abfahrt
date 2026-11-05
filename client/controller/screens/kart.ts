import type { KartItem, KartState } from '../../../shared/types';
import { KART, KART_TRACKS, type KartInput, wrapAngle } from '../../../shared/kart';
import { itemIcon } from '../../art/kartsprites';
import { Mode7Renderer } from '../../kart3d/render';
import { KartWorld } from '../../kart3d/world';
import { type Screen, LS, app, el, message, q, secondsLeft, send, socket, store, toast } from '../core';
import { enableMotion, motionSupport, onMotion } from '../motion';
import { steerFromRoll, tiltRoll } from '../tilt';

/**
 * Kart-Rennen am Handy (quer halten):
 *   links  – schwebender Stick (Daumen irgendwo aufsetzen, nach links/rechts schieben) oder Kipp-Lenkung
 *   rechts – GAS (groß, unten rechts), BREMSE daneben (im Stand rückwärts), DRIFT direkt über GAS
 *            (Daumen von GAS nach oben rutschen lassen; DRIFT gibt mit Gas), ITEM oben rechts
 * Ansicht „Handy“: das Handy rendert seine eigene Verfolger-Ansicht (Mode 7) hinter den Knöpfen.
 * Ansicht „TV“: der TV zeigt den Splitscreen, das Handy nur Platz/Runde/Item.
 * Bis 4 Spieler wählt jeder selbst (Knopf oben in der Mitte, gespeichert für die nächsten Rennen) – das Umschalten
 * baut den Screen nicht neu, damit gehaltene Finger (GAS, Stick) nicht verloren gehen. Ab 5 Spielern immer „Handy“.
 */

const OFFROAD = { beach: 'Sand bremst!', harbor: 'Pflaster bremst!', pool: 'Rasen bremst!' };
const ITEM_LABEL: Record<KartItem, string> = { coconut: 'Kokosnuss', banana: 'Banane', ice: 'Turbo-Eis', gull: 'Möwe' };
const LS_TILT = 'lanabfahrt.kartTilt';

/** Kipp-Lenkung bleibt über Bildschirmwechsel hinweg aktiv */
const tilt = { on: false, center: 0, roll: 0, smooth: 0, lastSample: 0, unsub: null as (() => void) | null };

/** „So fährst du“ nur einmal pro Rennen */
let introFor = 0;

// iOS: Pinch-Zoom-Gesten im Spiel unterbinden
document.addEventListener('gesturestart', (e) => e.preventDefault());

const vibrate = (pattern: number | number[]) => {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* egal */
  }
};

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((Number(a) % 360) + 360) % 360;
}

async function startTilt(): Promise<boolean> {
  if (!(await enableMotion())) {
    toast('Bewegungssensor nicht erlaubt – Stick-Lenkung');
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
  const started = performance.now();
  await new Promise((r) => setTimeout(r, 900));
  if (tilt.lastSample < started) {
    tilt.unsub?.();
    tilt.unsub = null;
    toast('Kein Bewegungssensor gefunden');
    return false;
  }
  tilt.on = true;
  localStorage.setItem(LS_TILT, '1');
  return true;
}

function stopTilt() {
  tilt.unsub?.();
  tilt.unsub = null;
  tilt.on = false;
  localStorage.removeItem(LS_TILT);
}

export function pickKart(s: KartState): Screen {
  const car = s.karts[store.playerId!];
  if (!car) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') {
    leaveFullscreen();
    return ['kart-over', message('Rennen vorbei!', 'Schau auf den Fernseher!')];
  }
  if (car.finished) {
    leaveFullscreen();
    return [`kart-fin-${car.place}`, message(`Im Ziel – Platz ${car.place}!`, 'Ehrenrunde fährt von allein. Schau auf den Fernseher!')];
  }
  const mode = tilt.on ? 'tilt' : 'touch';
  // Die Ansicht (TV/Handy) gehört absichtlich nicht in den Key – sie wird im laufenden Screen umgeschaltet
  return [`kart3-${mode}`, () => buildDrive(mode, () => window.dispatchEvent(new Event('kart-rerender')))];
}

// ------------------------------------------------------------------ Vollbild / Querformat

let fullscreenTried = false;
async function tryFullscreen() {
  if (fullscreenTried) return;
  fullscreenTried = true;
  try {
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.());
  } catch {
    /* iPhone kann kein Vollbild – egal */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* nur in Vollbild auf Android – sonst Hinweis „quer halten“ */
  }
}

function leaveFullscreen() {
  fullscreenTried = false;
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
  } catch {
    /* egal */
  }
}

// ------------------------------------------------------------------ Fahr-Screen

type Btn = 'gas' | 'brake' | 'drift';

function buildDrive(mode: 'tilt' | 'touch', rerender: () => void) {
  const st0 = store.state?.mini?.kind === 'kart' ? store.state.mini.state : null;
  if (!st0) return null;
  const support = motionSupport();
  const canTilt = support === 'ok' || support === 'needs-permission';
  const root = el(`
    <div class="k3 k3-${mode}">
      <div class="k3-hud">
        <div class="k3-place">–</div>
        <div class="k3-lap"></div>
        <p class="k3-tv">Dein Kart läuft auf dem TV</p>
        <div class="k3-msg"></div>
      </div>
      <div class="k3-center"></div>
      <button class="k3-viewsw" aria-label="Ansicht wechseln"><span class="k3-seg k3-seg-tv">📺 TV</span><span class="k3-seg k3-seg-phone">📱 Handy</span></button>
      <div class="k3-viewnote">📱 Ab 5 Spielern fährt jeder am Handy</div>
      <div class="k3-top">
        ${canTilt ? `<button class="k3-small k3-tilt">${mode === 'tilt' ? 'STICK' : 'KIPPEN'}</button>` : '<span></span>'}
        <button class="k3-item" disabled><canvas width="16" height="16"></canvas><small>ITEM</small></button>
      </div>
      <div class="k3-left">
        ${
          mode === 'tilt'
            ? '<div class="k3-wheel"><div class="k3-wheel-in"></div></div><div class="k3-leftlabel">Handy kippen = lenken<br/>Tippen = Mitte setzen</div>'
            : '<div class="k3-stick"><div class="k3-base"></div><div class="k3-knob"></div></div><div class="k3-leftlabel">◀ Daumen schieben ▶</div>'
        }
      </div>
      <div class="k3-right">
        <div class="k3-btn k3-drift" data-b="drift">DRIFT<small>halten + lenken</small></div>
        <div class="k3-btn k3-brake" data-b="brake">BREMSE<small>im Stand: zurück</small></div>
        <div class="k3-btn k3-gas" data-b="gas">GAS</div>
      </div>
      <div class="k3-portrait">Dreh dein Handy quer!</div>
      <div class="k3-intro hidden">
        <h2>So fährst du</h2>
        <div class="k3-intro-grid">
          <div><b>◀ ▶</b> Links: Daumen schieben = lenken${canTilt ? ' – oder KIPPEN antippen und das Handy wie ein Lenkrad drehen' : ''}</div>
          <div><b>GAS</b> gedrückt halten – <b>BREMSE</b> bremst, im Stand geht's rückwärts</div>
          <div><b>DRIFT</b>: Daumen von GAS nach oben rutschen + lenken → Funken blau → orange → loslassen = Mini-Turbo!</div>
          <div><b>ITEM</b> oben rechts antippen</div>
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
  const inp: KartInput = { steer: 0, gas: false, brake: false, drift: false };
  let last = { steer: 9, gas: false, brake: false, drift: false, t: 0 };
  const push = (force = false) => {
    const now = performance.now();
    const boolChanged = inp.gas !== last.gas || inp.brake !== last.brake || inp.drift !== last.drift;
    const steerChanged = Math.abs(inp.steer - last.steer) >= 0.03 && now - last.t >= 33;
    if (!force && !boolChanged && !steerChanged && now - last.t < 300) return;
    last = { steer: inp.steer, gas: inp.gas, brake: inp.brake, drift: inp.drift, t: now };
    send('steer', { x: inp.steer, gas: inp.gas, brake: inp.brake, drift: inp.drift });
  };

  // Linke Hälfte: schwebender Stick bzw. Kipp-Lenkung
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
      // Stick „wandert“ mit, wenn der Daumen weit über den Anschlag hinausgeht
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
  root.querySelector('.k3-tilt')?.addEventListener('click', async () => {
    if (mode === 'tilt') {
      stopTilt();
      rerender();
    } else if (await startTilt()) {
      toast('Handy wie ein Lenkrad drehen!');
      rerender();
    }
  });

  // Rechte Hälfte: GAS / BREMSE / DRIFT mit Rüberrutschen (jeder Finger aktiviert den Knopf, über dem er gerade ist)
  const right = q(root, '.k3-right');
  const btns: Record<Btn, HTMLElement> = { gas: q(root, '.k3-gas'), brake: q(root, '.k3-brake'), drift: q(root, '.k3-drift') };
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
    let bd = 18; // Toleranz: Lücken zwischen den Knöpfen zählen zum nächsten
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
  /** Aufräumen, wenn der Screen ersetzt wurde (Fensterlistener) */
  const cleanup: (() => void)[] = [() => window.removeEventListener('resize', measure)];

  // Item
  const itemBtn = q<HTMLButtonElement>(root, '.k3-item');
  itemBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (itemBtn.disabled) return;
    send('item');
    vibrate(25);
  });

  // Intro „So fährst du“ (3 s, einmal pro Rennen)
  const intro = q(root, '.k3-intro');
  if (st0.sub === 'countdown' && introFor !== store.endsAt) {
    introFor = store.endsAt;
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
    setTimeout(hide, 3200);
  }

  // ---- Ansicht am Handy: Mode-7-Renderer + Vorhersage (die Vorhersage läuft immer – auch für Haptik/Drift-Anzeige)
  const world = new KartWorld(st0.track, store.playerId!);
  world.onSnapshot(st0);
  let renderer: Mode7Renderer | null = null;
  let camA = st0.karts[store.playerId!]?.angle ?? 0;
  let lastFrame = performance.now();
  let frameMs = 0;
  const fit = () => {
    if (!renderer) return;
    const W = rootEl.clientWidth || 320;
    const H = rootEl.clientHeight || 148;
    const base = W >= H ? 320 : 224;
    renderer.resize(base, Math.round((base * H) / W));
  };
  window.addEventListener('resize', fit);
  cleanup.push(() => window.removeEventListener('resize', fit));

  /** Eigene Verfolger-Ansicht ein-/ausschalten – ohne den Screen neu zu bauen (gehaltene Finger bleiben gültig) */
  let phoneOn: boolean | null = null;
  const viewBtn = q<HTMLButtonElement>(root, '.k3-viewsw');
  const setPhoneView = (on: boolean) => {
    if (on === phoneOn) return;
    phoneOn = on;
    rootEl.classList.toggle('k3-phone', on);
    rootEl.classList.toggle('k3-split', !on);
    viewBtn.classList.toggle('on-phone', on);
    if (on && !renderer) {
      renderer = new Mode7Renderer(st0.track, 320, 148);
      renderer.canvas.className = 'k3-view';
      rootEl.prepend(renderer.canvas);
      fit();
      // Kamera direkt hinter das Kart setzen statt von der alten Richtung einzuschwenken
      const mine = world.poses().find((p) => p.id === store.playerId);
      if (mine) camA = mine.angle;
    } else if (!on && renderer) {
      renderer.canvas.remove();
      renderer = null;
    }
  };
  /** Gerade angetippt, Server hat's noch nicht bestätigt */
  let pending: { on: boolean; until: number } | null = null;
  const effectiveView = (st: KartState) => {
    const server = !!st.karts[store.playerId!]?.phoneView;
    if (pending && (server === pending.on || performance.now() > pending.until || !st.splitOk)) pending = null;
    return pending ? pending.on : server;
  };
  setPhoneView(effectiveView(st0));
  // Antippen = Finger auf der Pille aufsetzen UND dort loslassen (ein Daumen, der beim Lenken drüberrutscht, schaltet nicht um).
  // Kein 'click': .k3 unterdrückt touchstart, dann feuern Handys keinen click.
  let swPointer: number | null = null;
  viewBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    swPointer = e.pointerId;
    viewBtn.classList.add('down');
  });
  viewBtn.addEventListener('pointercancel', () => {
    swPointer = null;
    viewBtn.classList.remove('down');
  });
  viewBtn.addEventListener('pointerup', (e) => {
    if (e.pointerId !== swPointer) return;
    swPointer = null;
    viewBtn.classList.remove('down');
    const r = viewBtn.getBoundingClientRect();
    if (e.clientX < r.left - 8 || e.clientX > r.right + 8 || e.clientY < r.top - 8 || e.clientY > r.bottom + 8) return;
    const st = store.state?.mini?.kind === 'kart' ? store.state.mini.state : null;
    if (!st?.splitOk || st.sub === 'over') return;
    const want = !phoneOn;
    localStorage.setItem(LS.kartView, want ? 'phone' : 'tv');
    socket.emit('kart:view', want ? 'phone' : 'tv');
    pending = { on: want, until: performance.now() + 2500 };
    setPhoneView(want);
    // Kein Toast: der würde mitten im Rennen über BREMSE/GAS liegen – die Pille zeigt den Zustand
    vibrate(12);
  });
  // Diagnose (Playwright): Renderzeit pro Frame und Korrekturen der Vorhersage
  (window as unknown as { __kartDebug?: () => unknown }).__kartDebug = () => ({ frameMs, corrections: [...world.corrections], diag: { ...world.diag } });
  const lookOf = (id: string) => store.state?.players.find((p) => p.id === id)?.look;

  let lastSnapT = 0;
  let wasCharged = false;
  let wasDrift = 0;
  let seenEvent = st0.events[st0.events.length - 1]?.seq ?? 0;
  let centerUntil = 0;
  const center = q(root, '.k3-center');
  const flash = (text: string, cls = '', ms = 900) => {
    center.textContent = text;
    center.className = `k3-center ${cls}`;
    centerUntil = performance.now() + ms;
  };

  const frame = () => {
    if (!root.isConnected) {
      for (const fn of cleanup) fn();
      return;
    }
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    const st = store.state?.mini?.kind === 'kart' ? store.state.mini.state : null;
    if (!st) return;
    if (st.t !== lastSnapT) {
      lastSnapT = st.t;
      world.onSnapshot(st);
    }
    // Kipp-Lenkung
    if (mode === 'tilt') {
      const target = steerFromRoll(tilt.roll, tilt.center);
      tilt.smooth += (target - tilt.smooth) * Math.min(1, dt / 40);
      inp.steer = Math.round(tilt.smooth * 100) / 100;
      const wheel = root.querySelector('.k3-wheel-in') as HTMLElement | null;
      if (wheel) wheel.style.transform = `rotate(${inp.steer * 90}deg)`;
    }
    push();
    // Vorhersage + Haptik
    const fired = world.predict(inp, dt);
    const own = world.ownPhys;
    if (own) {
      const charged = own.driftDir !== 0 && own.driftCharge >= KART.DRIFT_CHARGE_S;
      if (own.driftDir && !wasDrift) vibrate(8);
      if (charged && !wasCharged) vibrate([15, 40, 15]);
      wasCharged = charged;
      wasDrift = own.driftDir;
    }
    if (fired) {
      vibrate(30);
      flash('TURBO!', 'turbo', 600);
    }
    if (!renderer) return;
    const t0 = performance.now();
    const poses = world.poses();
    const mine = poses.find((p) => p.id === store.playerId);
    if (mine) {
      camA += wrapAngle(mine.angle - camA) * (1 - Math.exp(-dt / 160));
      renderer.render(Mode7Renderer.chase(mine, camA), st, poses, { lookOf, now });
    }
    frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  };
  requestAnimationFrame(frame);

  // ---- HUD (wird bei jedem Server-Stand und alle 250 ms aufgerufen)
  const icon = q<HTMLCanvasElement>(root, '.k3-item canvas');
  let shownItem: string | undefined;
  let lastSub = '';
  return () => {
    const st = store.state?.mini?.kind === 'kart' ? store.state.mini.state : null;
    const c = st?.karts[store.playerId!];
    if (!st || !c) return;
    const n = Object.keys(st.karts).length;
    setPhoneView(effectiveView(st));
    // Umschalter nur, wenn es TV-Splitscreen gibt (≤ 4 Spieler); sonst einmal kurz der Hinweis im Countdown
    rootEl.classList.toggle('k3-nosplit', !st.splitOk);
    rootEl.classList.toggle('k3-racing', st.sub !== 'countdown');
    q(root, '.k3-place').innerHTML = `${c.place}.<small>/${n}</small>`;
    q(root, '.k3-lap').textContent = `Runde ${Math.max(1, c.lap)}/${st.laps}`;
    if (shownItem !== (c.item ?? '')) {
      shownItem = c.item ?? '';
      const ctx = icon.getContext('2d')!;
      ctx.clearRect(0, 0, 16, 16);
      ctx.drawImage(itemIcon(c.item).canvas, 0, 0);
      q(root, '.k3-item small').textContent = c.item ? ITEM_LABEL[c.item] : 'ITEM';
      itemBtn.disabled = !c.item;
      itemBtn.classList.toggle('has', !!c.item);
      if (c.item) vibrate(15);
    }
    // Eigene Treffer
    const ev = st.events[st.events.length - 1];
    if (ev && ev.seq !== seenEvent) {
      seenEvent = ev.seq;
      if (ev.who === store.playerId && (ev.kind === 'hit' || ev.kind === 'gull')) {
        flash(ev.kind === 'gull' ? 'KRAH!' : 'AUA!', 'hit');
        vibrate([40, 30, 40]);
      }
    }
    // Mitte: Countdown / LOS / Meldungen
    const now = performance.now();
    if (st.sub === 'countdown') {
      const s = secondsLeft();
      center.textContent = s > 3 ? `${KART_TRACKS[st.track]?.name ?? ''} · ${st.laps} Runden` : String(Math.max(1, s));
      center.className = `k3-center ${s > 3 ? 'small' : 'count'}`;
    } else if (lastSub === 'countdown') {
      flash('LOS!', 'go', 800);
    } else if (centerUntil && now > centerUntil) {
      center.textContent = '';
      centerUntil = 0;
    }
    lastSub = st.sub;
    const own = world.ownPhys;
    const drifting = own ? own.driftDir !== 0 : c.drift !== 0;
    const charged = own ? own.driftDir !== 0 && own.driftCharge >= KART.DRIFT_CHARGE_S : c.charged;
    const msg =
      st.sub === 'countdown'
        ? mode === 'tilt'
          ? 'Handy gerade halten – links tippen setzt die Mitte'
          : 'Gleich geht’s los – GAS gedrückt halten!'
        : c.spin > 0
          ? 'Uiii – du drehst dich!'
          : charged
            ? 'Turbo bereit – DRIFT loslassen!'
            : drifting
              ? 'Drift …'
              : c.offroad
                ? OFFROAD[KART_TRACKS[st.track]?.theme ?? 'beach']
                : st.closing
                  ? `Noch ${Math.ceil(st.endsIn / 1000)}s!`
                  : '';
    q(root, '.k3-msg').textContent = msg;
    rootEl.classList.toggle('charged', charged);
    rootEl.classList.toggle('drifting', drifting);
  };
}

/** Die Seite baut den Screen neu, wenn sich der Lenk-Modus ändert (Key wechselt) */
export function onKartRerender(fn: () => void) {
  window.addEventListener('kart-rerender', fn);
}
