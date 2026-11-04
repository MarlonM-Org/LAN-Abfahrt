import type { EntenState } from '../../../shared/types';
import { ENTEN } from '../../../shared/games';
import { WORLD } from '../../../shared/flunky';
import { type Screen, app, el, message, q, send, store, tapButton, toast } from '../core';
import { enableMotion, motionSupport, onMotion } from '../motion';
import { type AimCalib, orientToAim, smoothAim, trackpadDelta } from '../aim';
import { hat, kick, unlockAudio } from '../audio';

type AimMode = 'ask' | 'motion' | 'touch';

/** Bleibt über mehrere Runden erhalten (Sensor-Erlaubnis gilt bis zum Neuladen) */
let aimMode: AimMode | null = null;
const aim = { x: WORLD.W / 2, y: WORLD.H / 2 };
let calib: AimCalib | null = null;

const FIELD = { w: WORLD.W, h: WORLD.H, yawRange: 22, pitchRange: 13 };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function currentMode(): AimMode {
  if (aimMode) return aimMode;
  const sup = motionSupport();
  aimMode = sup === 'ok' || sup === 'needs-permission' ? 'ask' : 'touch';
  return aimMode;
}

function setAim(x: number, y: number) {
  aim.x = Math.max(0, Math.min(ENTEN.FIELD_W, x));
  aim.y = Math.max(0, Math.min(WORLD.H, y));
}

export function pickEnten(s: EntenState): Screen {
  const me = s.players[store.playerId!];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['en-over', message('Feierabend am Teich!', 'Schau auf den Fernseher!')];
  const mode = currentMode();
  if (mode === 'ask') return ['en-ask', buildAsk];
  return [`en-${mode}`, () => buildGun(mode)];
}

// ------------------------------------------------------------------ Sensor-Abfrage

function buildAsk() {
  const root = el(`
    <h2>Ententeich</h2>
    <p>Halte dein Handy wie eine Lichtpistole: Oberkante zeigt auf den Fernseher, Display nach oben.</p>
    <button class="big-btn en-motion">Bewegungssensor<br/>aktivieren</button>
    <button class="secondary en-touch">Lieber Touchpad</button>
  `);
  q(root, '.en-motion').addEventListener('click', async () => {
    unlockAudio();
    const ok = await enableMotion();
    if (!ok) toast('Kein Zugriff auf den Sensor – Touchpad aktiv.');
    aimMode = ok ? 'motion' : 'touch';
    calib = null;
    setAim(WORLD.W / 2, WORLD.H / 2);
  });
  q(root, '.en-touch').addEventListener('click', () => {
    unlockAudio();
    aimMode = 'touch';
  });
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Waffe

function buildGun(mode: 'motion' | 'touch') {
  const me = () => (store.state?.mini?.kind === 'enten' ? store.state.mini.state.players[store.playerId!] : undefined);
  const color = hex(me()?.color ?? 0xffffff);
  const root = el(`
    <div class="top-row"><span class="en-wave"></span><span class="en-score"></span></div>
    <div class="en-status">
      <span class="en-swatch" style="background:${color}"></span>
      <span class="en-ammo"></span>
      <span class="en-msg"></span>
    </div>
    ${
      mode === 'motion'
        ? `<div class="en-tools"><button class="secondary small en-center">Zentrieren</button><button class="secondary small en-switch">Touchpad</button></div>
           <p class="hint">Auf die TV-Mitte zielen, dann „Zentrieren“ tippen.</p>`
        : `<div class="en-pad"><div class="en-pad-dot" style="background:${color}"></div><span>Touchpad – wischen zum Zielen</span></div>`
    }
    <div class="en-fire"><b>SCHUSS</b><small>nach unten wischen = nachladen</small></div>
    <div class="en-tools">
      <button class="secondary small en-reload">Nachladen</button>
      ${mode === 'touch' && (motionSupport() === 'ok' || motionSupport() === 'needs-permission') ? '<button class="secondary small en-switch">Sensor</button>' : ''}
    </div>
  `);
  app.append(root);
  const ammoEl = q(root, '.en-ammo');
  const msgEl = q(root, '.en-msg');
  const fire = q(root, '.en-fire');

  // ---- lokale Vorhersage für Munition (Server bestätigt)
  let localAmmo = me()?.ammo ?? ENTEN.AMMO;
  let localReload = false;
  let lastAction = 0;

  const reload = () => {
    const p = me();
    if (!p || p.reloading || localReload || localAmmo >= ENTEN.AMMO) return;
    localReload = true;
    lastAction = performance.now();
    send('reload');
    navigator.vibrate?.([15, 60, 15]);
    update();
  };

  const shoot = () => {
    const st = store.state?.mini?.kind === 'enten' ? store.state.mini.state : null;
    if (!st || st.sub !== 'play') return;
    if (localReload) return;
    if (localAmmo <= 0) {
      msgEl.textContent = 'LEER!';
      fire.classList.add('empty');
      navigator.vibrate?.(5);
      return;
    }
    localAmmo -= 1;
    lastAction = performance.now();
    send('shoot', { x: Math.round(aim.x * 10) / 10, y: Math.round(aim.y * 10) / 10 });
    navigator.vibrate?.(25);
    const ac = unlockAudio();
    if (ac) {
      kick(ac.currentTime);
      hat(ac.currentTime);
    }
    fire.classList.remove('bang');
    void fire.offsetWidth;
    fire.classList.add('bang');
    update();
  };

  // ---- Feuerknopf: Tippen = Schuss, nach unten wischen = Nachladen
  let swipe: { id: number; y: number; done: boolean } | null = null;
  fire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      fire.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    swipe = { id: e.pointerId, y: e.clientY, done: false };
    shoot();
  });
  fire.addEventListener('pointermove', (e) => {
    if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
    if (e.clientY - swipe.y > 50) {
      swipe.done = true;
      reload();
    }
  });
  const endSwipe = () => (swipe = null);
  fire.addEventListener('pointerup', endSwipe);
  fire.addEventListener('pointercancel', endSwipe);
  fire.addEventListener('contextmenu', (e) => e.preventDefault());
  tapButton(q(root, '.en-reload'), reload);

  root.querySelector('.en-switch')?.addEventListener('click', async () => {
    if (mode === 'motion') {
      aimMode = 'touch';
    } else {
      const ok = await enableMotion();
      if (!ok) return toast('Kein Zugriff auf den Sensor.');
      calib = null;
      aimMode = 'motion';
    }
  });

  // ---- Zielen
  let gotSample = false;
  if (mode === 'motion') {
    q(root, '.en-center').addEventListener('click', () => {
      calib = null;
      setAim(WORLD.W / 2, WORLD.H / 2);
      navigator.vibrate?.(10);
    });
    let smoothed: { x: number; y: number } | null = null;
    const off = onMotion((s) => {
      if (!root.isConnected) return off();
      // Manche Browser ohne echten Sensor liefern nur Nullen → ignorieren
      if (!gotSample && s.alpha === 0 && s.beta === 0 && s.gamma === 0) return;
      gotSample = true;
      if (!calib) {
        calib = { alpha: s.alpha, beta: s.beta };
        smoothed = null;
      }
      smoothed = smoothAim(smoothed, orientToAim(s, calib, FIELD), 0.35);
      setAim(smoothed.x, smoothed.y);
    });
    // Kein einziger Messwert (z. B. Laptop ohne Sensor) → Touchpad
    setTimeout(() => {
      if (root.isConnected && !gotSample) {
        toast('Keine Sensordaten – Touchpad aktiv.');
        aimMode = 'touch';
        off();
      }
    }, 2500);
  } else {
    const pad = q(root, '.en-pad');
    let last: { id: number; x: number; y: number; t: number } | null = null;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      last = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    });
    pad.addEventListener('pointermove', (e) => {
      if (!last || last.id !== e.pointerId) return;
      const now = performance.now();
      const d = trackpadDelta(e.clientX - last.x, e.clientY - last.y, now - last.t);
      setAim(aim.x + d.dx, aim.y + d.dy);
      last = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now };
    });
    const up = () => (last = null);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  }

  // ---- Zielposition gedrosselt senden (max. 20/s, nur bei Änderung)
  let sent = { x: -1, y: -1 };
  const iv = setInterval(() => {
    if (!root.isConnected) return clearInterval(iv);
    if (Math.abs(aim.x - sent.x) + Math.abs(aim.y - sent.y) < 0.4) return;
    sent = { ...aim };
    send('aim', { x: Math.round(aim.x * 10) / 10, y: Math.round(aim.y * 10) / 10 });
    const dot = root.querySelector<HTMLElement>('.en-pad-dot');
    if (dot) {
      dot.style.left = `${(aim.x / ENTEN.FIELD_W) * 100}%`;
      dot.style.top = `${(aim.y / WORLD.H) * 100}%`;
    }
  }, 50);

  function update() {
    const st = store.state?.mini?.kind === 'enten' ? store.state.mini.state : null;
    const p = me();
    if (!st || !p) return;
    // Server-Wert übernehmen, wenn gerade keine eigene Aktion unterwegs ist
    if (performance.now() - lastAction > 300) {
      localAmmo = p.ammo;
      localReload = p.reloading;
    }
    if (!p.reloading && localReload && performance.now() - lastAction > ENTEN.RELOAD_MS + 400) localReload = false;
    q(root, '.en-wave').textContent = st.sub === 'intro' ? `Start in ${Math.ceil(st.endsIn / 1000)}s` : `Welle ${st.wave}/${st.waves} · ${Math.ceil(st.endsIn / 1000)}s`;
    q(root, '.en-score').textContent = `${p.score} P.`;
    ammoEl.innerHTML = Array.from({ length: ENTEN.AMMO }, (_, i) => `<i class="${i < localAmmo && !localReload ? 'full' : ''}"></i>`).join('');
    const empty = localAmmo <= 0 && !localReload;
    fire.classList.toggle('empty', empty);
    fire.classList.toggle('wait', st.sub !== 'play');
    msgEl.textContent =
      st.sub === 'intro' ? 'Zielt schon mal!' : st.sub === 'banner' ? st.waveName : localReload || p.reloading ? 'Lade ...' : empty ? 'LEER – wischen!' : p.combo > 1 ? `Combo x${p.combo}` : '';
  }

  update();
  return update;
}
