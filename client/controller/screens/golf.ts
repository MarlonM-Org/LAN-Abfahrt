import type { GolfState } from '../../../shared/types';
import { GOLF, type GolfHole, golfBounds, golfHole, golfIdealPutt, moverSeg, spinnerBlades } from '../../../shared/golf';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, timerText, toast } from '../core';
import { type MotionSample, enableMotion, motionSupport, onMotion } from '../motion';
import { PUTT_SCALE, dragToPutt, swingToPutt } from '../golfPutt';
import { failFeedback, feedbackCard, forgetFeedback, lastFeedback, motionInfo, rememberFeedback } from '../motionFeedback';
import { golfFeedback } from '../throwFeedback';

const golf = () => (store.state?.mini?.kind === 'golf' ? store.state.mini.state : null);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const MODE_KEY = 'lanabfahrt.golfMode';
const strokesTxt = (n: number) => `${n} ${n === 1 ? 'Schlag' : 'Schläge'}`;

export function pickGolf(s: GolfState): Screen {
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    forgetFeedback('golf');
    return [
      'golf-intro',
      message(
        'Urlaubs-Minigolf!',
        `${s.holes} Löcher, alle putten gleichzeitig. Zieh am Handy vom Ball zurück wie eine Schleuder und lass los – je weiter, desto fester. Wasser kostet einen Schlag, max. ${GOLF.MAX_STROKES} Schläge pro Loch.`,
      ),
    ];
  }
  if (s.sub === 'tee') {
    const h = golfHole(s.hole);
    return [`golf-tee-${s.hole}`, message(`Loch ${s.hole + 1}: ${h.name}`, `Par ${h.par} · Gleich geht's los – schau auf den Fernseher!`)];
  }
  if (s.sub === 'play') return [`golf-play-${s.hole}`, () => buildPlay(s.hole)];
  return [`golf-card-${s.hole}-${s.sub}`, () => buildCard(s)];
}

// ------------------------------------------------------------------ Mini-Karte

interface View {
  sc: number;
  bx: number;
  by: number;
  dpr: number;
}

function drawHole(c: HTMLCanvasElement, v: View, h: GolfHole, s: GolfState, t: number) {
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#f1d49a';
  g.fillRect(0, 0, c.width, c.height);
  const k = v.sc * v.dpr;
  g.setTransform(k, 0, 0, k, -v.bx * k, -v.by * k);
  const poly = (pts: { x: number; y: number }[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  // Bahn mit Holzbande
  poly(h.shape);
  g.lineJoin = 'miter';
  g.lineWidth = 7;
  g.strokeStyle = '#8d5629';
  g.stroke();
  g.fillStyle = '#4fa63c';
  g.fill();
  for (const sl of h.slopes) {
    g.fillStyle = Math.hypot(sl.ax, sl.ay) > 150 ? 'rgba(255,231,160,0.35)' : 'rgba(255,255,220,0.16)';
    g.fillRect(sl.x, sl.y, sl.w, sl.h);
    const len = Math.hypot(sl.ax, sl.ay) || 1;
    g.strokeStyle = 'rgba(255,255,220,0.7)';
    g.lineWidth = 1.5;
    for (let y = sl.y + 10; y < sl.y + sl.h - 4; y += 18) {
      for (let x = sl.x + 10; x < sl.x + sl.w - 4; x += 20) {
        const ux = sl.ax / len;
        const uy = sl.ay / len;
        g.beginPath();
        g.moveTo(x - ux * 4 - uy * 3, y - uy * 4 + ux * 3);
        g.lineTo(x, y);
        g.lineTo(x - ux * 4 + uy * 3, y - uy * 4 - ux * 3);
        g.stroke();
      }
    }
  }
  for (const r of h.sand) {
    g.fillStyle = '#f1d49a';
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const r of h.water) {
    g.fillStyle = '#3f8fe0';
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const r of h.bridges) {
    g.fillStyle = '#b8783f';
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const b of h.blocks) {
    poly(b);
    g.fillStyle = '#8d5629';
    g.fill();
  }
  for (const tb of h.tubes) {
    g.strokeStyle = '#f0973a';
    g.lineWidth = 3;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(tb.x, tb.y);
    g.quadraticCurveTo((tb.x + tb.out.x) / 2, Math.min(tb.y, tb.out.y) - 46, tb.out.x, tb.out.y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#1d1410';
    g.beginPath();
    g.arc(tb.x, tb.y, tb.r, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(tb.out.x, tb.out.y, 5, 0, Math.PI * 2);
    g.fill();
  }
  for (const b of h.bumpers) {
    g.fillStyle = '#f07aa8';
    g.beginPath();
    g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
  for (const sp of h.spinners) {
    g.strokeStyle = '#f4efe2';
    g.lineWidth = 3.5;
    for (const bl of spinnerBlades(sp, t)) {
      g.beginPath();
      g.moveTo(bl[0], bl[1]);
      g.lineTo(bl[2], bl[3]);
      g.stroke();
    }
    g.fillStyle = '#e0503f';
    g.beginPath();
    g.arc(sp.x, sp.y, sp.hub, 0, Math.PI * 2);
    g.fill();
  }
  for (const m of h.movers) {
    const sg = moverSeg(m, t);
    g.strokeStyle = '#2fb5a5';
    g.lineWidth = m.thick;
    g.beginPath();
    g.moveTo(sg[0], sg[1]);
    g.lineTo(sg[2], sg[3]);
    g.stroke();
  }
  g.lineCap = 'butt';
  // Loch + Fahne
  g.fillStyle = '#1d1410';
  g.beginPath();
  g.arc(h.cup.x, h.cup.y, GOLF.CUP_R + 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4efe2';
  g.fillRect(h.cup.x - 0.75, h.cup.y - 16, 1.5, 16);
  g.fillStyle = '#e0503f';
  g.beginPath();
  g.moveTo(h.cup.x + 0.75, h.cup.y - 16);
  g.lineTo(h.cup.x + 10, h.cup.y - 13);
  g.lineTo(h.cup.x + 0.75, h.cup.y - 10);
  g.fill();
  // andere Bälle (blass), dann der eigene (groß, mit Ring)
  const me = store.playerId!;
  for (const id of s.order) {
    const b = s.balls[id];
    if (!b || id === me || b.d === 1 || b.tube) continue;
    g.globalAlpha = 0.55;
    g.fillStyle = hex(s.colors[id] ?? 0xffffff);
    g.beginPath();
    g.arc(b.x, b.y, GOLF.BALL_R, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
}

function drawMine(c: HTMLCanvasElement, v: View, s: GolfState, aim: { a: number; p: number; pull: number } | null) {
  const g = c.getContext('2d')!;
  const b = s.balls[store.playerId!];
  if (!b || b.d === 1 || b.tube) return;
  const col = hex(s.colors[store.playerId!] ?? 0xffffff);
  const k = v.sc * v.dpr;
  g.setTransform(k, 0, 0, k, -v.bx * k, -v.by * k);
  if (aim) {
    // Zugleine nach hinten (Schleuder), gestrichelte Schlaglinie nach vorn
    g.strokeStyle = 'rgba(45,27,18,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(b.x - Math.cos(aim.a) * aim.pull, b.y - Math.sin(aim.a) * aim.pull);
    g.stroke();
    const len = 12 + aim.p * 90;
    g.setLineDash([3, 3]);
    g.lineWidth = 2.5;
    g.strokeStyle = '#2d1b12';
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(b.x + Math.cos(aim.a) * len, b.y + Math.sin(aim.a) * len);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = col;
    g.stroke();
    g.setLineDash([]);
    const ex = b.x + Math.cos(aim.a) * len;
    const ey = b.y + Math.sin(aim.a) * len;
    g.beginPath();
    g.moveTo(ex + Math.cos(aim.a) * 5, ey + Math.sin(aim.a) * 5);
    g.lineTo(ex + Math.cos(aim.a + 2.5) * 5, ey + Math.sin(aim.a + 2.5) * 5);
    g.lineTo(ex + Math.cos(aim.a - 2.5) * 5, ey + Math.sin(aim.a - 2.5) * 5);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = '#2d1b12';
    g.lineWidth = 1;
    g.stroke();
  }
  g.fillStyle = col;
  g.beginPath();
  g.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.lineWidth = 0.8;
  g.strokeStyle = '#2d1b12';
  g.beginPath();
  g.arc(b.x, b.y, 5.6, 0, Math.PI * 2);
  g.stroke();
}

// ------------------------------------------------------------------ Putten

function buildPlay(hole: number) {
  const id = store.playerId!;
  const h = golfHole(hole);
  const sup = motionSupport();
  const motionOk = sup === 'ok' || sup === 'needs-permission';
  let mode: 'drag' | 'motion' = localStorage.getItem(MODE_KEY) === 'motion' && sup === 'ok' ? 'motion' : 'drag';
  const root = el(`
    <div class="top-row"><span class="gf-hole">Loch ${hole + 1}/${GOLF_HOLE_COUNT()} · Par ${h.par}</span><span class="gf-time"></span></div>
    <div class="gf-status"><i class="gf-sw"></i><span class="gf-msg"></span><b class="gf-strokes"></b></div>
    <div class="gf-pad">
      <canvas class="gf-map"></canvas>
      <div class="gf-power"><div></div></div>
      <p class="gf-hint"></p>
    </div>
    <button class="big-btn bw-swing gf-swing hidden">HALTEN &amp;<br/>SCHWINGEN</button>
    <button class="secondary small gf-mode ${motionOk ? '' : 'hidden'}"></button>
    ${sup === 'insecure' ? '<p class="gf-note">Schwung-Putten mit Bewegungssensor geht nur über HTTPS.</p>' : ''}
  `);
  app.append(root);
  const pad = q(root, '.gf-pad');
  const canvas = q<HTMLCanvasElement>(root, '.gf-map');
  const hint = q(root, '.gf-hint');
  const msg = q(root, '.gf-msg');
  const strokesEl = q(root, '.gf-strokes');
  const timeEl = q(root, '.gf-time');
  const powerBar = q(root, '.gf-power > div');
  const swingBtn = q<HTMLButtonElement>(root, '.gf-swing');
  const modeBtn = q<HTMLButtonElement>(root, '.gf-mode');
  q(root, '.gf-sw').style.background = hex(golf()?.colors[id] ?? 0xffffff);
  // Feedback zum letzten Putt (bleibt stehen, bis der nächste beginnt)
  const card = feedbackCard(true);
  swingBtn.before(card.root);
  card.set(lastFeedback('golf'));
  const showFb = (fb: ReturnType<typeof golfFeedback>) => {
    rememberFeedback('golf', fb);
    card.set(fb);
  };

  // Karte einpassen (Welt → Bildschirm, nicht gedreht)
  const bounds = golfBounds(h);
  const M = 12;
  const view: View = { sc: 1, bx: bounds.x - M, by: bounds.y - M - 8, dpr: Math.min(3, window.devicePixelRatio || 1) };
  const bw = bounds.w + 2 * M;
  const bh = bounds.h + 2 * M + 8;
  const fit = () => {
    const cssW = Math.max(200, pad.clientWidth - 6);
    const cssH = Math.min(cssW * (bh / bw), window.innerHeight * 0.42);
    view.sc = Math.min(cssW / bw, cssH / bh);
    const w = bw * view.sc;
    const hh = bh * view.sc;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    canvas.width = Math.round(w * view.dpr);
    canvas.height = Math.round(hh * view.dpr);
  };
  fit();

  // Lochzeit lokal weiterzählen (für Leuchtturm/Surfbrett)
  let lastT = -1;
  let recvAt = performance.now();
  const holeT = (s: GolfState) => {
    if (s.t !== lastT) {
      lastT = s.t;
      recvAt = performance.now();
    }
    return s.t + (s.sub === 'play' ? Math.min(GOLF.HOLE_S ?? Infinity, (performance.now() - recvAt) / 1000) : 0);
  };

  let aim: { a: number; p: number; pull: number } | null = null;
  let motionAim: number | null = null;
  let aimStroke = -1;
  let sentStroke = -1;
  let lastAimSend = 0;
  const myBall = () => golf()?.balls[id];
  const canPutt = () => {
    const s = golf();
    const b = s?.balls[id];
    return !!s && s.sub === 'play' && s.hole === hole && !!b && !b.d && !b.m && sentStroke !== b.s;
  };
  const sendAim = (a: number | null, p: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastAimSend < 110) return;
    lastAimSend = now;
    send('aim', a === null ? {} : { a, p });
  };
  const putt = (a: number, p: number) => {
    const b = myBall();
    if (!b || !canPutt()) return;
    sentStroke = b.s;
    navigator.vibrate?.(35);
    send('putt', { seq: b.s, a, p });
    aim = null;
  };
  const toWorld = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    return { x: view.bx + (cx - r.left) / view.sc, y: view.by + (cy - r.top) / view.sc };
  };
  const defaultAim = () => {
    const b = myBall();
    return b ? Math.atan2(h.cup.y - b.y, h.cup.x - b.x) : 0;
  };
  /** geschätzt nötige Kraft vom aktuellen Ball aus (fürs Feedback) */
  const idealPower = () => {
    const b = myBall();
    return b ? golfIdealPutt(h, b).power : 0.5;
  };

  // ---- Zurückziehen (Schleuder) bzw. Zielen (Sensor-Modus)
  let pid: number | null = null;
  let start = { x: 0, y: 0 };
  const maxLen = () => Math.max(110, Math.min(230, pad.clientWidth * 0.55));
  pad.addEventListener('pointerdown', (e) => {
    if (!canPutt()) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    pid = e.pointerId;
    start = { x: e.clientX, y: e.clientY };
    if (mode === 'motion') aimAt(e);
    else card.dim();
  });
  const aimAt = (e: PointerEvent) => {
    const b = myBall();
    if (!b) return;
    const w = toWorld(e.clientX, e.clientY);
    if (Math.hypot(w.x - b.x, w.y - b.y) < 4) return;
    motionAim = Math.atan2(w.y - b.y, w.x - b.x);
    sendAim(motionAim, 0.5);
  };
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    if (mode === 'motion') return aimAt(e);
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const r = dragToPutt(dx, dy, maxLen());
    if (r.ok) {
      aim = { a: r.putt.angle, p: r.putt.power, pull: Math.min(Math.hypot(dx, dy), maxLen()) / view.sc / 2 };
      aimStroke = myBall()?.s ?? -1;
      sendAim(aim.a, aim.p);
    } else aim = null;
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (mode === 'motion') {
      sendAim(motionAim, 0.5, true);
      return;
    }
    const r = dragToPutt(e.clientX - start.x, e.clientY - start.y, maxLen());
    if (r.ok && canPutt()) {
      const fb = golfFeedback(r.putt.power, idealPower(), null, null);
      putt(r.putt.angle, r.putt.power);
      showFb(fb);
    } else {
      aim = null;
      sendAim(null, 0, true);
      if (!r.ok) hint.textContent = r.reason;
    }
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);

  // ---- Putter-Schwung (Bewegungssensor)
  let unsub: (() => void) | null = null;
  let samples: MotionSample[] = [];
  let recording = false;
  let gotSample = false;
  const stopMotion = () => {
    unsub?.();
    unsub = null;
  };
  const startMotion = () => {
    stopMotion();
    gotSample = false;
    unsub = onMotion((m) => {
      if (!root.isConnected) return stopMotion();
      if (m.t > 0 && (m.ax || m.ay || m.az || m.rotAlpha || m.rotBeta || m.rotGamma)) gotSample = true;
      if (recording) samples.push({ ...m });
    });
    window.setTimeout(() => {
      if (root.isConnected && mode === 'motion' && !gotSample) {
        toast('Kein Bewegungssensor gefunden – zieh stattdessen zurück!');
        setMode('drag');
      }
    }, 1500);
  };
  swingBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!canPutt()) return;
    swingBtn.setPointerCapture(e.pointerId);
    samples = [];
    recording = true;
    swingBtn.classList.add('holding');
    card.dim();
    swingBtn.innerHTML = 'PENDELN …<br/><small>und loslassen!</small>';
    navigator.vibrate?.(15);
  });
  const release = () => {
    if (!recording) return;
    recording = false;
    swingBtn.classList.remove('holding');
    swingBtn.innerHTML = 'HALTEN &amp;<br/>SCHWINGEN';
    const aimA = motionAim ?? defaultAim();
    const r = swingToPutt(samples, aimA);
    const info = motionInfo(samples, PUTT_SCALE);
    if (r.ok) {
      const fb = canPutt() ? golfFeedback(r.putt.power, idealPower(), info, ((r.putt.angle - aimA) * 180) / Math.PI) : null;
      putt(r.putt.angle, r.putt.power);
      if (fb) showFb(fb);
    } else {
      hint.textContent = r.reason;
      card.set(failFeedback(r.reason, info));
    }
  };
  swingBtn.addEventListener('pointerup', release);
  swingBtn.addEventListener('pointercancel', release);
  swingBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  const setMode = (m: 'drag' | 'motion') => {
    mode = m;
    localStorage.setItem(MODE_KEY, m);
    swingBtn.classList.toggle('hidden', m !== 'motion');
    modeBtn.textContent = m === 'motion' ? 'Lieber zurückziehen' : 'Mit Schwung putten (Sensor)';
    pad.classList.toggle('motion', m === 'motion');
    if (m === 'motion') startMotion();
    else stopMotion();
    aim = null;
  };
  modeBtn.addEventListener('click', async () => {
    if (mode === 'motion') return setMode('drag');
    const ok = motionSupport() === 'ok' ? true : await enableMotion();
    if (!ok) return toast('Kein Zugriff auf den Bewegungssensor.');
    setMode('motion');
  });
  setMode(mode);

  // ---- Zeichnen (eigene Schleife, damit Flügel/Surfbrett flüssig laufen)
  const frame = () => {
    if (!root.isConnected) return stopMotion();
    const s = golf();
    if (s && s.hole === hole) {
      drawHole(canvas, view, h, s, holeT(s));
      const b = s.balls[id];
      // Zielpfeil im Sensor-Modus, Schleuder beim Ziehen
      let show = aim && b && aimStroke === b.s && canPutt() ? aim : null;
      if (!show && mode === 'motion' && canPutt()) show = { a: motionAim ?? defaultAim(), p: 0.5, pull: 0 };
      drawMine(canvas, view, s, show);
      powerBar.style.width = `${Math.round((aim && pid !== null ? aim.p : 0) * 100)}%`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  let lastStroke = -1;
  return () => {
    const s = golf();
    if (!s) return;
    const b = s.balls[id];
    timeEl.textContent = s.sub === 'play' ? timerText((sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`) : '';
    if (!b) return;
    if (b.s !== lastStroke) {
      lastStroke = b.s;
      motionAim = null;
    }
    strokesEl.textContent = b.d ? strokesTxt(s.scores[id]?.[hole] ?? b.s) : `Schlag ${b.s + 1}`;
    let m = '';
    let ht = '';
    if (b.d === 1) {
      m = b.s === 1 ? 'HOLE-IN-ONE!' : 'Eingelocht!';
      ht = 'Warte auf die anderen …';
    } else if (b.d === 2) {
      m = 'Schluss für dieses Loch';
      ht = `${s.scores[id]?.[hole] ?? GOLF.MAX_SCORE} auf der Karte`;
    } else if (b.m || sentStroke === b.s) {
      m = b.tube ? 'Wusch – durchs Looping!' : 'Ball rollt …';
      ht = 'Schau auf den Fernseher!';
    } else {
      m = 'Du bist dran!';
      ht = mode === 'motion' ? 'Ziel auf der Karte antippen, dann Knopf halten, wie ein Putter pendeln, loslassen.' : 'Finger aufs grüne Feld, vom Ziel weg zurückziehen (wie eine Schleuder), loslassen. Weiter ziehen = fester.';
    }
    msg.textContent = m;
    if (pid === null && !recording) hint.textContent = ht;
    pad.classList.toggle('locked', !canPutt());
    swingBtn.disabled = !canPutt();
  };
}

const GOLF_HOLE_COUNT = () => golf()?.holes ?? 6;

// ------------------------------------------------------------------ Scorecard

function buildCard(s: GolfState) {
  const id = store.playerId!;
  const total = (p: string) => (s.scores[p] ?? []).reduce<number>((a, x) => a + (x ?? 0), 0);
  const rows = [...s.order].sort((a, b) => total(a) - total(b));
  const over = s.sub === 'over';
  const mine = s.scores[id]?.[s.hole];
  const parSum = s.par.slice(0, over ? s.holes : s.hole + 1).reduce((a, p) => a + p, 0);
  const rel = (n: number) => (n === parSum ? 'Par' : n > parSum ? `+${n - parSum}` : `${n - parSum}`);
  const head = over
    ? rows[0] === id
      ? 'Du gewinnst!'
      : 'Endstand'
    : mine === 1
      ? 'HOLE-IN-ONE!'
      : mine !== null && mine !== undefined
        ? `Loch ${s.hole + 1}: ${strokesTxt(mine)} (Par ${s.par[s.hole]})`
        : `Loch ${s.hole + 1}`;
  const root = el(`
    <div class="center gf-cardhead"><h2>${escapeHtml(head)}</h2><p>${over ? `Du: ${strokesTxt(total(id))} (${rel(total(id))})` : 'Schau auf den Fernseher – gleich geht es weiter!'}</p></div>
    <div class="panel gf-card">
      <div class="gf-row gf-head"><span></span><i></i><span>Spieler</span><span class="gf-this">L${s.hole + 1}</span><b>Ges.</b></div>
      ${rows
        .map(
          (p, i) =>
            `<div class="gf-row ${p === id ? 'me' : ''}"><span>${i + 1}.</span><i class="gf-sw" style="background:${hex(s.colors[p] ?? 0xffffff)}"></i><span class="bw-name">${escapeHtml(nameOf(p).replace(/^Bot\s+/, ''))}</span><span class="gf-this">${s.scores[p]?.[s.hole] ?? '–'}</span><b>${total(p)}</b></div>`,
        )
        .join('')}
    </div>
  `);
  app.append(root);
  return null;
}
