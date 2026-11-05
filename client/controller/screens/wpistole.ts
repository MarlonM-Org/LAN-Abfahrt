import type { Look } from '../../../shared/types';
import { WP, type WpDuel, type WpSide, type WpistoleState, wpSec, wpTargetAt } from '../../../shared/wpistole';
import { AV_H, AV_W, drawAvatar } from '../../../shared/avatar';
import { type Screen, app, el, message, q, send, store, toast } from '../core';
import { enableMotion, motionSupport, onMotion } from '../motion';
import { type AimCalib, orientToAim, smoothAim } from '../aim';
import { hat, kick, unlockAudio } from '../audio';
import { gnome } from '../../art/wpistole';

type Mode = 'ask' | 'motion' | 'touch';

/** Bleibt über Runden und Spiele erhalten (Sensor-Erlaubnis gilt bis zum Neuladen) */
let mode: Mode | null = null;

/** Zielfläche fürs Handy-Zielen: ± yawRange° links/rechts, ± pitchRange° hoch/runter = ganzer Kasten */
const FIELD = { w: WP.BOX_W, h: WP.BOX_H, yawRange: 14, pitchRange: 10 };
/** Holster: Oberkante zeigt nach unten (Neigung unter HOLSTER_DEG), gezogen ab DRAW_DEG */
const HOLSTER_DEG = -50;
const DRAW_DEG = -25;
const SCALE = 2;

const canMotion = () => {
  const s = motionSupport();
  return s === 'ok' || s === 'needs-permission';
};
const rerender = () => window.dispatchEvent(new Event('kart-rerender'));

function currentMode(): Mode {
  if (mode) return mode;
  mode = canMotion() ? 'ask' : 'touch';
  return mode;
}

/** Neigung der Handy-Oberkante gegenüber der Waagerechten (°): +90 = nach oben, −90 = nach unten */
function elevation(beta: number) {
  if (beta > 90) return 180 - beta;
  if (beta < -90) return -180 - beta;
  return beta;
}

/**
 * iOS fragt die Sensor-Erlaubnis nur aus einer echten Nutzergeste heraus ab.
 * `touchend` zählt dort sicher (pointerdown nicht); Maus/Laptop über pointerup.
 */
function gestureButton(btn: HTMLElement, fn: () => void) {
  btn.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const r = btn.getBoundingClientRect();
    if (t && (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom)) return;
    e.preventDefault();
    fn();
  });
  btn.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') fn();
  });
}

async function switchToMotion() {
  unlockAudio();
  const ok = await enableMotion();
  if (!ok) toast('Kein Zugriff auf den Sensor – Touch aktiv.');
  mode = ok ? 'motion' : 'touch';
  rerender();
}

export function pickWpistole(s: WpistoleState): Screen {
  const id = store.playerId!;
  if (!s.players[id]) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['wp-over', message('Duell vorbei!', 'Schau auf den Fernseher!')];
  const m = currentMode();
  if (m === 'ask') return ['wp-ask', buildAsk];
  if (s.sub === 'table') {
    return s.finalists.includes(id)
      ? ['wp-table-fin', message('Du bist im FINALE!', 'Gleich geht es um den Sheriff-Stern. Hand ans Holster!')]
      : ['wp-table', message('Zwischenstand', 'Schau auf den Fernseher – gleich kommt das Finale.')];
  }
  const inDuel = s.duels.some((d) => d.a.id === id || d.b.id === id);
  if (s.sub !== 'intro' && !inDuel) return ['wp-watch', message(s.final ? 'Finale!' : 'Pause', 'Schau auf den Fernseher und feuere an!')];
  return [`wp-${m}`, () => buildDuel(m)];
}

// ------------------------------------------------------------------ Sensor-Abfrage

function buildAsk() {
  const root = el(`
    <h2>Wasserpistolen-Duell</h2>
    <p>Mit Bewegungssensor hältst du das Handy wie eine Pistole im Holster (Oberkante nach unten) und reißt es bei „ZIEHT!“ hoch.</p>
    <button class="big-btn wp-ask-motion">Handy als<br/>Wasserpistole</button>
    <button class="secondary wp-ask-touch">Lieber Touch (halten + tippen)</button>
  `);
  gestureButton(q(root, '.wp-ask-motion'), () => void switchToMotion());
  q(root, '.wp-ask-touch').addEventListener('click', () => {
    unlockAudio();
    mode = 'touch';
    rerender();
  });
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Duell

/** Figur-Bilder fürs Zielfenster (einmal gezeichnet) */
const figCache = new Map<string, HTMLCanvasElement>();
function figureCanvas(id: string, look: Look | undefined): HTMLCanvasElement {
  const key = id === WP.GNOME_ID || !look ? 'gnome' : JSON.stringify(look);
  let c = figCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = AV_W * SCALE;
  c.height = AV_H * SCALE;
  const g = c.getContext('2d')!;
  if (key === 'gnome') {
    g.imageSmoothingEnabled = false;
    g.drawImage(gnome().canvas, 0, 0, AV_W * SCALE, AV_H * SCALE);
  } else drawAvatar(g, look!, 0, 0, SCALE);
  figCache.set(key, c);
  return c;
}

function buildDuel(m: 'motion' | 'touch') {
  const id = store.playerId!;
  const root = el(`
    <div class="top-row"><span class="wp-round"></span><span class="wp-wins"></span></div>
    <div class="wp-call"></div>
    <canvas class="wp-box" width="${WP.BOX_W * SCALE}" height="${WP.BOX_H * SCALE}"></canvas>
    <div class="wp-info"><span class="wp-tank">${'<i></i>'.repeat(WP.SHOTS)}</span><span class="wp-msg"></span></div>
    ${
      m === 'touch'
        ? `<div class="wp-pad wp-holster"><b>HOLSTER</b><small>gedrückt halten – bei ZIEHT! loslassen und oben auf den Gegner tippen</small></div>`
        : `<div class="wp-pad wp-fire"><b>SPRITZ!</b><small>Holster = Oberkante nach unten. Bei ZIEHT! hochreißen, auf den TV zielen, hier tippen</small></div>`
    }
    ${m === 'motion' || canMotion() ? `<div class="wp-tools"><button class="secondary small wp-switch">${m === 'motion' ? 'Lieber Touch' : 'Bewegungssensor'}</button></div>` : ''}
  `);
  app.append(root);
  const canvas = q<HTMLCanvasElement>(root, '.wp-box');
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const callEl = q(root, '.wp-call');
  const msgEl = q(root, '.wp-msg');
  const pad = q(root, '.wp-pad');

  // ---- Zustand dieser Runde (lokal)
  let rk = '';
  /** Wann dieses Handy das „ZIEHT!“ gesehen hat (performance.now) */
  let seen = { seq: -1, at: 0 };
  let drawn = false;
  let fouled = false;
  let shotsUsed = 0;
  let lastShotAt = 0;
  let holding = false;
  let holstered = false;
  let frozenT: number | null = null;
  const aim = { x: WP.BOX_W / 2, y: 22 };
  let calib: AimCalib | null = null;
  let calibAt = 0;
  let smoothed: { x: number; y: number } | null = null;
  let splashes: { x: number; y: number; hit: boolean; at: number }[] = [];
  let lastCallSeq = -1;
  let callUntil = 0;
  let callText = '';

  const st = () => (store.state?.mini?.kind === 'wpistole' ? store.state.mini.state : null);
  const mine = (): { s: WpistoleState; d: WpDuel; me: WpSide; other: WpSide } | null => {
    const s = st();
    const d = s?.duels.find((x) => x.a.id === id || x.b.id === id);
    if (!s || !d) return null;
    return d.a.id === id ? { s, d, me: d.a, other: d.b } : { s, d, me: d.b, other: d.a };
  };
  const tNow = () => performance.now() - seen.at;

  const foulLocal = (action: 'draw' | 'shoot') => {
    if (fouled) return;
    fouled = true;
    send(action, { seq: seen.seq, t: 0, x: aim.x, y: aim.y, m });
    navigator.vibrate?.([200, 80, 200]);
    update();
  };

  const doDraw = () => {
    const c = mine();
    if (!c || fouled || drawn || c.d.done) return;
    if (c.s.sub === 'wait') return foulLocal('draw');
    if (c.s.sub !== 'draw') return;
    drawn = true;
    send('draw', { seq: seen.seq, t: Math.round(tNow()) });
    navigator.vibrate?.(20);
    update();
  };

  const shoot = (x: number, y: number) => {
    const c = mine();
    if (!c || fouled || c.d.done || c.me.foul) return;
    if (c.s.sub === 'wait') return foulLocal('shoot');
    if (c.s.sub !== 'draw') return;
    const now = performance.now();
    if (shotsUsed >= WP.SHOTS || now - lastShotAt < WP.SHOT_COOLDOWN_MS || c.me.hitMs !== null) return;
    drawn = true;
    shotsUsed += 1;
    lastShotAt = now;
    const px = Math.round(x * 10) / 10;
    const py = Math.round(y * 10) / 10;
    send('shoot', { seq: seen.seq, t: Math.round(tNow()), x: px, y: py, m });
    splashes.push({ x: px, y: py, hit: false, at: now });
    navigator.vibrate?.(25);
    const ac = unlockAudio();
    if (ac) hat(ac.currentTime);
    update();
  };

  const setArm = (on: boolean) => {
    const s = st()?.sub;
    if (s === 'arm' || s === 'wait' || s === 'intro') send('arm', { on });
  };

  // ---- Touch: Holster halten, loslassen = ziehen, aufs Ziel tippen = spritzen
  if (m === 'touch') {
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockAudio();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      holding = true;
      setArm(true);
      update();
    });
    const release = () => {
      if (!holding) return;
      holding = false;
      const s = st()?.sub;
      if (s === 'wait' || s === 'draw') doDraw();
      else setArm(false);
      update();
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  } else {
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockAudio();
      shoot(aim.x, aim.y);
    });
  }
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  // Auf den Gegner tippen (geht in beiden Modi – mit Sensor zählt aber das Fadenkreuz-Zielen am TV mehr Spaß)
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (m === 'motion') return shoot(aim.x, aim.y);
    const r = canvas.getBoundingClientRect();
    shoot(((e.clientX - r.left) / r.width) * WP.BOX_W, ((e.clientY - r.top) / r.height) * WP.BOX_H);
  });

  const sw = root.querySelector<HTMLElement>('.wp-switch');
  if (sw) {
    if (m === 'motion') {
      sw.addEventListener('click', () => {
        mode = 'touch';
        rerender();
      });
    } else gestureButton(sw, () => void switchToMotion());
  }

  // ---- Bewegungssensor: Holster erkennen, Ziehen erkennen, zielen
  if (m === 'motion') {
    let gotSample = false;
    let lastAimSent = 0;
    const off = onMotion((smp) => {
      if (!root.isConnected) return off();
      if (!gotSample && smp.alpha === 0 && smp.beta === 0 && smp.gamma === 0) return;
      gotSample = true;
      const e = elevation(smp.beta);
      const s = st()?.sub;
      if (e < HOLSTER_DEG) {
        if (!holstered) {
          holstered = true;
          setArm(true);
          update();
        }
      } else if (e > DRAW_DEG && holstered) {
        holstered = false;
        if (s === 'wait' || s === 'draw') {
          doDraw();
          calib = null;
          calibAt = performance.now() + 150;
        } else setArm(false);
        update();
      }
      if (s !== 'draw' || fouled || e < DRAW_DEG) return;
      const now = performance.now();
      if (!calib) {
        if (now < calibAt) return;
        calib = { alpha: smp.alpha, beta: smp.beta };
        smoothed = null;
      }
      smoothed = smoothAim(smoothed, orientToAim(smp, calib, FIELD), 0.45);
      aim.x = smoothed.x;
      aim.y = smoothed.y;
      if (now - lastAimSent > 50) {
        lastAimSent = now;
        send('aim', { x: Math.round(aim.x * 10) / 10, y: Math.round(aim.y * 10) / 10 });
      }
    });
    setTimeout(() => {
      if (root.isConnected && !gotSample) {
        toast('Keine Sensordaten – Touch aktiv.');
        mode = 'touch';
        off();
        rerender();
      }
    }, 2500);
  }

  // ---- Zeichnen (eigene Bildrate, unabhängig von Server-Updates)
  const frame = () => {
    if (!root.isConnected) return;
    requestAnimationFrame(frame);
    const c = mine();
    const W = canvas.width;
    const H = canvas.height;
    // Hecke + Rasen
    g.fillStyle = '#2d6a28';
    g.fillRect(0, 0, W, H * 0.55);
    g.fillStyle = '#3f8a32';
    for (let i = 0; i < 26; i++) g.fillRect((i * 37) % W, (i * 13) % Math.floor(H * 0.5), 6, 4);
    g.fillStyle = '#7cc04a';
    g.fillRect(0, H * 0.55, W, H * 0.45);
    g.fillStyle = '#4a8a2c';
    g.fillRect(0, Math.floor(H * 0.55), W, 2);
    if (!c) return;
    const s = c.s;
    let t = 0;
    if (s.sub === 'draw' && seen.seq === s.drawSeq) t = c.d.done ? (frozenT ??= tNow()) : tNow();
    else if (s.sub === 'result') t = frozenT ?? 0;
    const pos = wpTargetAt(c.other.path, t);
    const fig = figureCanvas(c.other.id, store.state?.players.find((p) => p.id === c.other.id)?.look);
    const fx = Math.round(pos.x * SCALE - AV_W);
    const fy = Math.round(pos.y * SCALE - 15 * SCALE);
    g.drawImage(fig, fx, fy);
    if (c.other.wet) {
      g.fillStyle = 'rgba(80, 160, 255, 0.45)';
      for (let i = 0; i < 6; i++) g.fillRect(fx + ((i * 7 + Math.floor(performance.now() / 90)) % 30), fy + ((i * 11 + Math.floor(performance.now() / 40)) % 50), 2, 4);
    }
    // Fadenkreuz (Sensor)
    if (m === 'motion' && s.sub === 'draw' && calib && !c.d.done) {
      const ax = aim.x * SCALE;
      const ay = aim.y * SCALE;
      g.strokeStyle = '#2d1b12';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ax, ay, WP.HIT_R_MOTION * SCALE * 0.7, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.stroke();
    }
    // eigene Spritzer
    const now = performance.now();
    splashes = splashes.filter((sp) => now - sp.at < 500);
    for (const sp of splashes) {
      const k = (now - sp.at) / 500;
      g.strokeStyle = `rgba(234, 248, 255, ${1 - k})`;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(sp.x * SCALE, sp.y * SCALE, 4 + k * 14, 3 + k * 8, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // Ruf groß im Zielfenster
    if (now < callUntil) {
      g.fillStyle = 'rgba(45, 27, 18, 0.7)';
      g.fillRect(0, H / 2 - 14, W, 28);
      g.fillStyle = callText === 'ZIEHT!' ? '#ffd25e' : '#ffffff';
      g.font = `${callText.length > 10 ? 8 : 16}px "Press Start 2P", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(callText, W / 2, H / 2 + 1);
    }
  };
  requestAnimationFrame(frame);

  function update() {
    const s = st();
    if (!s) return;
    const key = `${s.final}-${s.round}`;
    if (key !== rk) {
      rk = key;
      drawn = false;
      fouled = false;
      shotsUsed = 0;
      frozenT = null;
      calib = null;
      splashes = [];
      if (holding || holstered) setArm(true);
    }
    // „ZIEHT!“ gesehen → sofort bestätigen (Grundlage der fairen Zeitmessung)
    if (s.sub === 'draw' && s.drawSeq !== seen.seq) {
      seen = { seq: s.drawSeq, at: performance.now() };
      send('ack', { seq: s.drawSeq });
      navigator.vibrate?.(60);
      const ac = unlockAudio();
      if (ac) kick(ac.currentTime);
      // Wer beim „ZIEHT!“ schon gezogen hat (Sensor schon oben), zieht jetzt
      if (m === 'motion' && !holstered) {
        calib = null;
        calibAt = performance.now() + 150;
      }
    }
    if (s.callSeq !== lastCallSeq) {
      lastCallSeq = s.callSeq;
      if (s.call) {
        callText = s.call;
        callUntil = performance.now() + (s.callReal ? 900 : WP.FAKE_MS);
      }
    }
    const c = mine();
    const p = s.players[id];
    const oppP = c ? s.players[c.other.id] : undefined;
    q(root, '.wp-round').textContent =
      s.sub === 'intro' ? 'Gleich geht es los' : s.final ? `${s.rounds ? 'Finale' : 'Duell'} ${p?.fw ?? 0}:${oppP?.fw ?? 0}` : `Runde ${s.round}/${s.rounds}`;
    q(root, '.wp-wins').textContent = p ? (s.final ? `${p.fw}/${s.finalTo} Siege` : `${p.wins} Siege`) : '';
    const left = c ? WP.SHOTS - Math.max(shotsUsed, c.me.shots) : WP.SHOTS;
    root.querySelectorAll('.wp-tank i').forEach((el2, i) => el2.classList.toggle('full', i < left));

    let call = '';
    let cls = '';
    let msg = '';
    const opp = c ? (c.other.id === WP.GNOME_ID ? 'Gartenzwerg Gustav' : (store.state?.players.find((x) => x.id === c.other.id)?.name ?? '?')) : '';
    const ready = m === 'touch' ? holding : holstered;
    if (s.sub === 'intro') {
      call = m === 'touch' ? 'Übe schon mal: Knopf halten!' : 'Übe schon mal: Handy nach unten!';
      msg = ready ? 'Holster OK' : '';
    } else if (!c) {
      call = 'Schau auf den TV';
    } else if (c.me.foul || fouled) {
      call = 'FRÜHSTART!';
      cls = 'bad';
      msg = 'Eimer Wasser über den Kopf ...';
    } else if (s.sub === 'arm') {
      call = ready ? 'Bereit ... Hand am Holster' : m === 'touch' ? 'HOLSTER drücken + halten!' : 'Handy nach unten halten!';
      cls = ready ? 'ok' : '';
      msg = `Gegner: ${opp}`;
    } else if (s.sub === 'wait') {
      call = 'Warte auf ZIEHT! ...';
      msg = 'Nicht zucken – auch nicht bei ZIEGE!';
    } else if (s.sub === 'draw' && !c.d.done) {
      call = 'ZIEHT!';
      cls = 'go';
      msg = c.me.hitMs !== null ? `Treffer ${wpSec(c.me.hitMs)}!` : left <= 0 ? 'Tank leer!' : m === 'touch' ? (drawn ? 'Tipp auf den Gegner!' : 'Loslassen + tippen!') : 'Zielen + SPRITZ!';
    } else {
      const won = c.d.winner === id;
      const lost = c.d.winner !== null && !won;
      call = won ? 'TROCKEN GEBLIEBEN!' : lost ? 'PLATSCH – nass!' : 'Patt';
      cls = won ? 'ok' : lost ? 'bad' : '';
      msg = won && c.me.hitMs !== null ? `Getroffen nach ${wpSec(c.me.hitMs)}` : c.d.note;
    }
    callEl.textContent = call;
    callEl.className = `wp-call ${cls}`;
    msgEl.textContent = msg;
    pad.classList.toggle('held', m === 'touch' ? holding : holstered);
    pad.classList.toggle('go', s.sub === 'draw' && !!c && !c.d.done && !fouled);
  }

  update();
  return update;
}
