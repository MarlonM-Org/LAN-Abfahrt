import type { GolfBallPub, GolfState } from '../../../shared/types';
import { GOLF, type GolfHole, golfAimHit, golfBounds, golfHole, golfIdealPutt, golfOnTee, moverSeg, spinnerBlades } from '../../../shared/golf';
import { type Screen, app, el, escapeHtml, me, message, nameOf, q, send, socket, store, timerText, toast } from '../core';
import { type MotionSample, enableMotion, motionSupport, onMotion } from '../motion';
import { PUTT_SCALE, dragToPutt, swingToPutt } from '../golfPutt';
import { failFeedback, feedbackCard, forgetFeedback, lastFeedback, motionInfo, rememberFeedback } from '../motionFeedback';
import { golfFeedback } from '../throwFeedback';
import { haptic } from '../haptic';
import { localPoint } from '../stick';

/**
 * Urlaubs-Minigolf am Handy – quer wie die Bahn auf dem TV (Welt-x = Bildschirm-x), damit Ziehen und Schlag
 * dieselbe Richtung haben: links die Bahn als Zugfeld (Schleuder: vom Ziel weg zurückziehen, loslassen),
 * rechts Status, Feedback, Bewegungssensor (Erlaubnis per Tipp) und für den VIP „Nächstes Loch“.
 */

const golf = () => (store.state?.mini?.kind === 'golf' ? store.state.mini.state : null);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const MODE_KEY = 'lanabfahrt.golfMode';
const strokesTxt = (n: number) => `${n} ${n === 1 ? 'Schlag' : 'Schläge'}`;
const shortName = (id: string) => nameOf(id).replace(/^Bot\s+/, '');
const total = (s: GolfState, id: string) => (s.scores[id] ?? []).reduce<number>((a, x) => a + (x ?? 0), 0);
/** Wer auf dem aktuellen Loch noch spielt (ohne mich) */
const stillPlaying = (s: GolfState, id: string) => s.order.filter((o) => o !== id && s.balls[o] && !s.balls[o].d);
const namesList = (ids: string[]) => (ids.length > 3 ? `${ids.slice(0, 3).map(shortName).join(', ')} +${ids.length - 3}` : ids.map(shortName).join(', '));
/** Liegt als Hindernis auf der Bahn (gleiche Regel wie der Server: nicht auf dem Abschlag, nicht fertig, nicht unterwegs) */
const solidBall = (h: GolfHole, b: GolfBallPub | undefined): b is GolfBallPub => !!b && !b.d && !b.m && !b.tube && !golfOnTee(h, b);

/** Sensor-Wahl bleibt bis zum Neuladen (die Erlaubnis gilt auch so lange) */
type SensorState = 'off' | 'on' | 'denied' | 'nodata';
let sensor: SensorState = 'off';
function wantMotion() {
  if (sensor === 'on') return motionSupport() === 'ok';
  try {
    return sensor === 'off' && localStorage.getItem(MODE_KEY) === 'motion' && motionSupport() === 'ok';
  } catch {
    return false;
  }
}
function saveMode(m: 'drag' | 'motion') {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* privater Modus */
  }
}

/**
 * Erlaubnis für den Bewegungssensor – muss direkt aus einem Tipp (click) kommen, sonst fragt das iPhone gar nicht.
 * Liefert den neuen Zustand und meldet ihn per Toast.
 */
async function askSensor(): Promise<SensorState> {
  const ok = motionSupport() === 'ok' ? true : await enableMotion();
  sensor = ok ? 'on' : 'denied';
  saveMode(ok ? 'motion' : 'drag');
  if (ok) haptic('win');
  else toast('Sensor nicht erlaubt – du puttest mit dem Finger.');
  return sensor;
}

/** Text + Ton für die Sensor-Zeile (aktiv / verweigert → so geht’s / nicht verfügbar) */
function sensorStatus(): { text: string; tone: '' | 'ok' | 'bad' } {
  const sup = motionSupport();
  if (sup === 'unsupported') return { text: 'Kein Bewegungssensor – du puttest mit dem Finger.', tone: '' };
  if (sup === 'insecure') return { text: 'Sensor geht nur über https:// (QR-Code am TV) – hier wird gezogen.', tone: '' };
  if (sensor === 'denied') return { text: 'Verweigert. Tab schließen, Seite neu öffnen, „Erlauben“ tippen.', tone: 'bad' };
  if (sensor === 'nodata') return { text: 'Keine Sensordaten – du puttest mit dem Finger.', tone: 'bad' };
  if (sensor === 'on') return { text: 'Sensor aktiv ✓', tone: 'ok' };
  return { text: sup === 'needs-permission' ? 'Bewegungssensor: dein Handy fragt einmal nach der Erlaubnis.' : 'Bewegungssensor (optional): putten mit Schwung.', tone: '' };
}
const sensorPossible = () => {
  const sup = motionSupport();
  return sup === 'ok' || sup === 'needs-permission';
};

export function pickGolf(s: GolfState): Screen {
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    forgetFeedback('golf');
    return ['golf-intro', () => buildIntro(s)];
  }
  if (s.sub === 'tee') {
    const h = golfHole(s.hole);
    return [`golf-tee-${s.hole}`, message(`Loch ${s.hole + 1}: ${h.name}`, `Par ${h.par} · Gleich geht's los – Handy quer halten und auf den Fernseher schauen!`)];
  }
  if (s.sub === 'play') return [`golf-play-${s.hole}`, () => buildPlay(s.hole)];
  // Scorekarte: „wait“ im Key → kein Dreh-Overlay (zwischen den Löchern darf das Handy liegen, wie es will)
  return [s.sub === 'over' ? 'golf-final-wait' : `golf-card-${s.hole}-wait`, () => buildCard(s)];
}

// ------------------------------------------------------------------ Erklärung (+ Sensor vorab erlauben)

function buildIntro(s: GolfState) {
  const possible = sensorPossible();
  const root = el(`
    <div class="center gf-intro">
      <h2>Urlaubs-Minigolf!</h2>
      <p>${s.holes} Löcher, alle putten gleichzeitig. Halte das Handy quer: Finger aufs grüne Feld, vom Ziel weg zurückziehen wie eine Schleuder, loslassen – je weiter, desto fester. Bälle stoßen sich an! Wasser kostet einen Schlag, max. ${GOLF.MAX_STROKES} Schläge pro Loch.</p>
      ${possible ? '<button class="gf-ask">📱 Bewegungssensor aktivieren</button><small class="gf-sstat"></small>' : `<small class="gf-sstat">${escapeHtml(sensorStatus().text)}</small>`}
    </div>
  `);
  app.append(root);
  const btn = root.querySelector<HTMLButtonElement>('.gf-ask');
  const stat = q(root, '.gf-sstat');
  const sync = () => {
    const st = sensorStatus();
    stat.textContent = st.text;
    stat.className = `gf-sstat ${st.tone}`;
    if (btn) {
      btn.classList.toggle('hidden', sensor === 'on');
      btn.textContent = sensor === 'denied' ? '📱 Nochmal fragen' : '📱 Bewegungssensor aktivieren';
    }
  };
  // „click“ statt pointerdown: nur so zählt der Tipp fürs iPhone als Erlaubnis-Geste
  btn?.addEventListener('click', async () => {
    await askSensor();
    sync();
  });
  sync();
  return null;
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
  // andere Bälle: echte Hindernisse kräftig mit Rand, Bälle auf dem Abschlag / aufgegebene blass
  const me = store.playerId!;
  for (const id of s.order) {
    const b = s.balls[id];
    if (!b || id === me || b.d === 1 || b.tube) continue;
    const solid = !b.d && !golfOnTee(h, b);
    g.globalAlpha = solid ? 1 : 0.45;
    g.fillStyle = hex(s.colors[id] ?? 0xffffff);
    g.beginPath();
    g.arc(b.x, b.y, GOLF.BALL_R + 0.4, 0, Math.PI * 2);
    g.fill();
    if (solid) {
      g.lineWidth = 0.9;
      g.strokeStyle = '#2d1b12';
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

interface Aim {
  a: number;
  p: number;
  /** Länge der Zugleine hinter dem Ball (Welt-px), 0 = keine */
  pull: number;
}

function drawMine(c: HTMLCanvasElement, v: View, h: GolfHole, s: GolfState, aim: Aim | null) {
  const g = c.getContext('2d')!;
  const b = s.balls[store.playerId!];
  if (!b || b.d === 1 || b.tube) return;
  const col = hex(s.colors[store.playerId!] ?? 0xffffff);
  const k = v.sc * v.dpr;
  g.setTransform(k, 0, 0, k, -v.bx * k, -v.by * k);
  if (aim) {
    const ux = Math.cos(aim.a);
    const uy = Math.sin(aim.a);
    // Zugleine nach hinten (Schleuder)
    if (aim.pull > 0) {
      g.strokeStyle = 'rgba(45,27,18,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - ux * aim.pull, b.y - uy * aim.pull);
      g.stroke();
    }
    // gestrichelte Schlaglinie nach vorn – Länge = Kraft; endet am ersten Ball, der im Weg liegt
    const len = 12 + aim.p * 90;
    const others = s.order.filter((o) => o !== store.playerId).map((o) => s.balls[o]).filter((o) => solidBall(h, o));
    const hit = golfAimHit(b, aim.a, len, others);
    const end = hit ? hit.d : len;
    g.setLineDash([3, 3]);
    g.lineWidth = 2.5;
    g.strokeStyle = '#2d1b12';
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(b.x + ux * end, b.y + uy * end);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = col;
    g.stroke();
    g.setLineDash([]);
    if (hit) {
      // eigener Ball an der Kontaktstelle (Ring) + Pfeil, wohin der getroffene Ball rollt
      g.lineWidth = 1.2;
      g.strokeStyle = col;
      g.beginPath();
      g.arc(hit.x, hit.y, GOLF.BALL_R, 0, Math.PI * 2);
      g.stroke();
      const sx = hit.ball.x + hit.nx * (GOLF.BALL_R + 1);
      const sy = hit.ball.y + hit.ny * (GOLF.BALL_R + 1);
      const ex = sx + hit.nx * 12;
      const ey = sy + hit.ny * 12;
      g.strokeStyle = '#fff6dc';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      g.stroke();
      const na = Math.atan2(hit.ny, hit.nx);
      g.fillStyle = '#fff6dc';
      g.beginPath();
      g.moveTo(ex + Math.cos(na) * 3, ey + Math.sin(na) * 3);
      g.lineTo(ex + Math.cos(na + 2.4) * 3, ey + Math.sin(na + 2.4) * 3);
      g.lineTo(ex + Math.cos(na - 2.4) * 3, ey + Math.sin(na - 2.4) * 3);
      g.closePath();
      g.fill();
    } else {
      const ex = b.x + ux * len;
      const ey = b.y + uy * len;
      g.beginPath();
      g.moveTo(ex + ux * 5, ey + uy * 5);
      g.lineTo(ex + Math.cos(aim.a + 2.5) * 5, ey + Math.sin(aim.a + 2.5) * 5);
      g.lineTo(ex + Math.cos(aim.a - 2.5) * 5, ey + Math.sin(aim.a - 2.5) * 5);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      g.strokeStyle = '#2d1b12';
      g.lineWidth = 1;
      g.stroke();
    }
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

// ------------------------------------------------------------------ VIP: „Nächstes Loch“

/**
 * VIP-Knopf (Server prüft den VIP über `vip:mini`). Mit `armText` braucht er zwei Tipps (im Spiel: Schutz vor
 * Versehen, das Loch endet für alle), sonst einen. Liefert den Updater (Sichtbarkeit/Text).
 */
function vipNextButton(btn: HTMLButtonElement, armText: (() => string) | null) {
  let armedUntil = 0;
  btn.addEventListener('click', () => {
    if (armText && performance.now() > armedUntil) {
      armedUntil = performance.now() + 3000;
      haptic('tap');
      sync();
      window.setTimeout(sync, 3050);
      return;
    }
    armedUntil = 0;
    socket.emit('vip:mini', 'next');
    haptic('hit');
    sync();
  });
  const sync = () => {
    const s = golf();
    const show = !!s && !!me()?.isVip && (s.sub === 'card' || (s.sub === 'play' && s.order.some((o) => !s.balls[o]?.d)));
    btn.classList.toggle('hidden', !show);
    if (!s || !show) return;
    const last = s.hole >= s.holes - 1;
    const armed = performance.now() < armedUntil;
    btn.classList.toggle('armed', armed);
    btn.textContent = armed && armText ? armText() : s.sub === 'card' ? (last ? '⏭ Zum Endstand' : `⏭ Weiter zu Loch ${s.hole + 2}`) : last ? '⏭ Loch beenden → Endstand' : '⏭ Nächstes Loch';
  };
  return sync;
}

// ------------------------------------------------------------------ Putten

function buildPlay(hole: number) {
  const id = store.playerId!;
  const h = golfHole(hole);
  const root = el(`
    <div class="lx gf-lx">
      <div class="lx-head"><i class="gf-sw"></i><b class="gf-hole">Loch ${hole + 1}/${golf()?.holes ?? 6}</b><span class="grow">${escapeHtml(h.name)} · Par ${h.par}</span><b class="gf-strokes"></b><span class="gf-total"></span><span class="timer gf-time"></span></div>
      <div class="lx-left gf-pad">
        <canvas class="gf-map"></canvas>
        <div class="gf-under"><span>Kraft</span><div class="gf-power"><div></div></div><b class="gf-pct">–</b></div>
        <p class="gf-hint"></p>
        <i class="gf-touch gf-t0 hidden"></i><i class="gf-touch gf-t1 hidden"></i>
      </div>
      <div class="lx-right gf-side">
        <div class="gf-status"><b class="gf-msg"></b><small class="gf-sub"></small></div>
        <button class="big-btn bw-swing gf-swing hidden">HALTEN &amp;<br/>SCHWINGEN</button>
        <div class="gf-sensor"><button class="secondary small gf-mode"></button><small class="gf-sstat"></small></div>
        <button class="gf-vip hidden"></button>
      </div>
    </div>
  `);
  app.append(root);
  const pad = q(root, '.gf-pad');
  const canvas = q<HTMLCanvasElement>(root, '.gf-map');
  const under = q(root, '.gf-under');
  const hint = q(root, '.gf-hint');
  const msg = q(root, '.gf-msg');
  const sub = q(root, '.gf-sub');
  const strokesEl = q(root, '.gf-strokes');
  const totalEl = q(root, '.gf-total');
  const timeEl = q(root, '.gf-time');
  const powerBar = q(root, '.gf-power > div');
  const pctEl = q(root, '.gf-pct');
  const swingBtn = q<HTMLButtonElement>(root, '.gf-swing');
  const sensorBox = q(root, '.gf-sensor');
  const modeBtn = q<HTMLButtonElement>(root, '.gf-mode');
  const sensorStat = q(root, '.gf-sstat');
  const t0 = q(root, '.gf-t0');
  const t1 = q(root, '.gf-t1');
  q(root, '.gf-sw').style.background = hex(golf()?.colors[id] ?? 0xffffff);
  // Feedback zum letzten Putt (bleibt stehen, bis der nächste beginnt)
  const card = feedbackCard(true);
  swingBtn.before(card.root);
  card.set(lastFeedback('golf'));
  const showFb = (fb: ReturnType<typeof golfFeedback>) => {
    rememberFeedback('golf', fb);
    card.set(fb);
  };
  const vipSync = vipNextButton(q<HTMLButtonElement>(root, '.gf-vip'), () => `Nochmal tippen! Wer noch spielt: +2, mind. ${h.par + 1}`);

  // Karte einpassen (Welt → Bildschirm, nicht gedreht: rechts auf dem Handy = rechts auf dem TV)
  const bounds = golfBounds(h);
  const M = 12;
  const view: View = { sc: 1, bx: bounds.x - M, by: bounds.y - M - 8, dpr: Math.min(3, window.devicePixelRatio || 1) };
  const bw = bounds.w + 2 * M;
  const bh = bounds.h + 2 * M + 8;
  const fit = () => {
    const land = document.documentElement.classList.contains('land');
    const cssW = Math.max(160, pad.clientWidth - 10);
    const free = pad.clientHeight - under.offsetHeight - hint.offsetHeight - 20;
    const cssH = land ? Math.max(80, free) : Math.min(cssW * (bh / bw), window.innerHeight * 0.4);
    view.sc = Math.min(cssW / bw, cssH / bh);
    const w = bw * view.sc;
    const hh = bh * view.sc;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    canvas.width = Math.round(w * view.dpr);
    canvas.height = Math.round(hh * view.dpr);
  };
  fit();
  // Adressleiste blendet aus/ein → neu einpassen (Drehen baut den Screen ohnehin neu, siehe main.ts)
  let fitQueued = 0;
  const onResize = () => {
    if (!root.isConnected) return window.removeEventListener('resize', onResize);
    cancelAnimationFrame(fitQueued);
    fitQueued = requestAnimationFrame(fit);
  };
  window.addEventListener('resize', onResize);

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

  let mode: 'drag' | 'motion' = wantMotion() ? 'motion' : 'drag';
  let aim: Aim | null = null;
  let motionAim: number | null = null;
  let aimStroke = -1;
  /** zuletzt gesendeter Schlag – lehnt der Server ab (Ball wurde gerade angestoßen), gibt es nach 2,5 s frei */
  let sent: { s: number; x: number; y: number; at: number } | null = null;
  let lastAimSend = 0;
  const myBall = () => golf()?.balls[id];
  const pending = (b: GolfBallPub) => !!sent && sent.s === b.s && Math.abs(sent.x - b.x) < 0.5 && Math.abs(sent.y - b.y) < 0.5 && performance.now() - sent.at < 2500;
  const canPutt = () => {
    const s = golf();
    const b = s?.balls[id];
    return !!s && s.sub === 'play' && s.hole === hole && !!b && !b.d && !b.m && !pending(b);
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
    sent = { s: b.s, x: b.x, y: b.y, at: performance.now() };
    haptic('hit');
    send('putt', { seq: b.s, a, p });
    aim = null;
  };
  const toWorld = (e: PointerEvent) => {
    const p = localPoint(canvas, e);
    return { x: view.bx + p.x / view.sc, y: view.by + p.y / view.sc };
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
  const touchDots = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => {
    t0.classList.toggle('hidden', !a);
    t1.classList.toggle('hidden', !b);
    if (a) t0.style.transform = `translate(${a.x}px, ${a.y}px)`;
    if (b) t1.style.transform = `translate(${b.x}px, ${b.y}px)`;
  };

  // ---- Zurückziehen (Schleuder) bzw. Zielen (Sensor-Modus). Pseudo-Quer: localPoint dreht die Finger-Koordinaten mit.
  let pid: number | null = null;
  let start = { x: 0, y: 0 };
  /** Ziehweg für 100 % – auf ~300 px Höhe gut mit dem Daumen erreichbar */
  const maxLen = () => Math.max(110, Math.min(210, Math.min(pad.clientWidth, pad.clientHeight) * 0.72));
  pad.addEventListener('pointerdown', (e) => {
    if (!canPutt()) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    pid = e.pointerId;
    start = localPoint(pad, e);
    if (mode === 'motion') aimAt(e);
    else {
      card.dim();
      touchDots(start, null);
    }
  });
  const aimAt = (e: PointerEvent) => {
    const b = myBall();
    if (!b) return;
    const w = toWorld(e);
    if (Math.hypot(w.x - b.x, w.y - b.y) < 4) return;
    motionAim = Math.atan2(w.y - b.y, w.x - b.x);
    sendAim(motionAim, 0.5);
  };
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    if (mode === 'motion') return aimAt(e);
    const p = localPoint(pad, e);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    touchDots(start, p);
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
    touchDots(null, null);
    if (mode === 'motion') {
      sendAim(motionAim, 0.5, true);
      return;
    }
    const p = localPoint(pad, e);
    const r = dragToPutt(p.x - start.x, p.y - start.y, maxLen());
    if (r.ok && canPutt() && e.type === 'pointerup') {
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
  // Overlay/Drehen: gehaltenen Zug abbrechen statt zu schlagen
  const onReset = () => {
    if (!root.isConnected) return window.removeEventListener('input-reset', onReset);
    pid = null;
    aim = null;
    touchDots(null, null);
  };
  window.addEventListener('input-reset', onReset);

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
        sensor = 'nodata';
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
    haptic('tick');
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

  const syncSensor = () => {
    const st = sensorStatus();
    sensorStat.textContent = mode === 'motion' ? 'Sensor aktiv ✓ – Ziel antippen, Knopf halten, pendeln.' : st.text;
    sensorStat.className = `gf-sstat ${mode === 'motion' ? 'ok' : st.tone}`;
    modeBtn.classList.toggle('hidden', !sensorPossible());
    modeBtn.textContent = mode === 'motion' ? '✋ Lieber ziehen' : sensor === 'denied' ? '📱 Nochmal fragen' : '📱 Sensor aktivieren';
  };
  const setMode = (m: 'drag' | 'motion') => {
    mode = m;
    swingBtn.classList.toggle('hidden', m !== 'motion');
    root.classList.toggle('gf-motion', m === 'motion');
    if (m === 'motion') startMotion();
    else stopMotion();
    aim = null;
    syncSensor();
  };
  // „click“ statt pointerdown: nur so fragt das iPhone nach der Erlaubnis (DeviceMotionEvent.requestPermission)
  modeBtn.addEventListener('click', async () => {
    if (mode === 'motion') {
      saveMode('drag');
      sensor = 'off';
      return setMode('drag');
    }
    const st = await askSensor();
    setMode(st === 'on' ? 'motion' : 'drag');
  });
  setMode(mode);
  sensorBox.classList.toggle('gf-nosensor', !sensorPossible());

  // ---- Zeichnen (eigene Schleife, damit Flügel/Surfbrett flüssig laufen)
  const frame = () => {
    if (!root.isConnected) return stopMotion();
    const s = golf();
    if (s && s.hole === hole) {
      drawHole(canvas, view, h, s, holeT(s));
      const b = s.balls[id];
      // Schleuder beim Ziehen, Zielpfeil im Sensor-Modus
      let show = aim && b && aimStroke === b.s && canPutt() ? aim : null;
      if (!show && mode === 'motion' && canPutt()) show = { a: motionAim ?? defaultAim(), p: 0.5, pull: 0 };
      drawMine(canvas, view, h, s, show);
      const p = aim && pid !== null ? aim.p : 0;
      powerBar.style.width = `${Math.round(p * 100)}%`;
      pctEl.textContent = p ? `${Math.round(p * 100)} %` : '–';
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  let lastStroke = -1;
  let lastPos = '';
  return () => {
    const s = golf();
    if (!s) return;
    const b = s.balls[id];
    vipSync();
    timeEl.textContent = s.sub === 'play' ? timerText((sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`) : '';
    const done = s.scores[id]?.slice(0, hole).reduce<number>((a, x) => a + (x ?? 0), 0) ?? 0;
    const parSoFar = s.par.slice(0, hole).reduce((a, x) => a + x, 0);
    totalEl.textContent = hole > 0 ? `Ges. ${done}${done === parSoFar ? ' (Par)' : done > parSoFar ? ` (+${done - parSoFar})` : ` (${done - parSoFar})`}` : '';
    if (!b) return;
    // neuer Schlag oder angestoßen (andere Stelle) → Sensor-Ziel zurücksetzen
    const pos = `${b.s}|${b.x}|${b.y}`;
    if (b.s !== lastStroke || (!b.m && pos !== lastPos)) {
      lastStroke = b.s;
      motionAim = null;
    }
    if (!b.m) lastPos = pos;
    strokesEl.textContent = b.d ? strokesTxt(s.scores[id]?.[hole] ?? b.s) : `Schlag ${b.s + 1}`;
    const others = stillPlaying(s, id);
    const waitTxt = others.length ? `Noch dran: ${namesList(others)}` : 'Alle fertig – gleich kommt die Scorekarte.';
    let m = '';
    let st = '';
    let ht = '';
    if (b.d === 1) {
      const n = s.scores[id]?.[hole] ?? b.s;
      m = n === 1 ? 'HOLE-IN-ONE!' : 'Eingelocht!';
      st = `${strokesTxt(n)} auf der Karte. ${waitTxt}`;
      ht = 'Du bist fertig mit diesem Loch – schau den anderen zu.';
    } else if (b.d === 2) {
      m = 'Schluss für dieses Loch';
      st = `${s.scores[id]?.[hole] ?? GOLF.MAX_SCORE} auf der Karte. ${waitTxt}`;
      ht = 'Nächstes Loch geht gleich los.';
    } else if (b.m) {
      m = b.k ? 'Angestoßen!' : b.tube ? 'Wusch – durchs Looping!' : 'Ball rollt …';
      st = b.k ? 'Ein anderer Ball hat deinen getroffen – kostet dich nichts.' : 'Schau auf den Fernseher!';
      ht = b.k ? 'Gleich kannst du von der neuen Stelle aus putten.' : 'Gleich bist du wieder dran.';
    } else if (pending(b)) {
      m = 'Schlag unterwegs …';
      st = 'Schau auf den Fernseher!';
    } else {
      m = 'Dein Schlag!';
      st = others.length ? `Alle putten gleichzeitig – ${namesList(others)} auch.` : 'Nur noch du auf diesem Loch.';
      ht =
        mode === 'motion'
          ? 'Ziel auf der Karte antippen, rechts den Knopf halten, wie ein Putter pendeln, loslassen.'
          : 'Finger aufs Feld, vom Ziel weg zurückziehen (Schleuder) und loslassen. Weiter ziehen = fester.';
    }
    if (b.auto && !b.d) st = `🤖 Dein Handy war weg – ${b.auto}× hat der Computer für dich geputtet. ${st}`;
    msg.textContent = m;
    sub.textContent = st;
    if (pid === null && !recording) hint.textContent = ht;
    pad.classList.toggle('locked', !canPutt());
    swingBtn.disabled = !canPutt();
  };
}

// ------------------------------------------------------------------ Scorecard

function buildCard(s: GolfState) {
  const id = store.playerId!;
  const rows = [...s.order].sort((a, b) => total(s, a) - total(s, b));
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
  const note = s.ended && !over ? `<p class="gf-ended">Loch vorzeitig beendet: Wer noch spielte, bekommt Schläge + 2, mindestens ${s.par[s.hole] + 1}.</p>` : '';
  const root = el(`
    <div class="center gf-cardhead"><h2>${escapeHtml(head)}</h2><p>${over ? `Du: ${strokesTxt(total(s, id))} (${rel(total(s, id))})` : `Gesamt: ${strokesTxt(total(s, id))} (${rel(total(s, id))}) · Schau auf den Fernseher – gleich geht es weiter!`}</p>${note}</div>
    <button class="gf-vip hidden"></button>
    <div class="panel gf-card">
      <div class="gf-row gf-head"><span></span><i></i><span>Spieler</span><span class="gf-this">L${s.hole + 1}</span><b>Ges.</b></div>
      ${rows
        .map(
          (p, i) =>
            `<div class="gf-row ${p === id ? 'me' : ''}"><span>${i + 1}.</span><i class="gf-sw" style="background:${hex(s.colors[p] ?? 0xffffff)}"></i><span class="bw-name">${escapeHtml(shortName(p))}</span><span class="gf-this">${s.scores[p]?.[s.hole] ?? '–'}</span><b>${total(s, p)}</b></div>`,
        )
        .join('')}
    </div>
  `);
  app.append(root);
  const vip = root.querySelector<HTMLButtonElement>('.gf-vip');
  if (!vip || over) return null;
  // Scorekarte: ein Tipp genügt (es wird nur die Wartezeit verkürzt)
  return vipNextButton(vip, null);
}
