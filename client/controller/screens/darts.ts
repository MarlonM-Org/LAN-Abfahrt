import {
  DARTS,
  DART_SEGMENTS,
  type DartsDart,
  type DartsState,
  dartsBump,
  dartsCalm,
  dartsCheckout,
  dartsCheckoutText,
  dartsCross,
  dartsDone,
  dartsLeft,
  dartsPhase,
  dartsRank,
  dartsTarget,
} from '../../../shared/darts';
import type { Point } from '../../../shared/types';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, toast } from '../core';
import { type AimCalib, smoothAim } from '../aim';
import { enableMotion, motionSupport, onMotion } from '../motion';
import { haptic } from '../haptic';
import { serverNow } from '../../timesync';
import { AimTrail, DARTS_AIM, clampAim, dragToMm, sensorAim } from '../dartsThrow';

const darts = () => (store.state?.mini?.kind === 'darts' ? store.state.mini.state : null);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** sichtbarer Ausschnitt am Handy: Radius in mm (Scheibe + etwas Wand) */
const VIEW_MM = 200;

type AimMode = 'touch' | 'sensor';
const MODE_KEY = 'lanabfahrt.dartsAim';

/** Bleibt über Darts und Runden erhalten (Zielpunkt, Atem-Amplitude, Sensor-Mitte) */
const aimState = {
  mode: null as AimMode | null,
  aim: dartsTarget(20, 'triple') as Point,
  /** Amplitude `amp` zum Zeitpunkt `ampAt` (performance.now) – danach beruhigt sie sich wie `dartsCalm` */
  amp: DARTS.AMP_START as number,
  ampAt: 0,
  calib: null as AimCalib | null,
};
const ampNow = (now = performance.now()) => dartsCalm(aimState.amp, now - aimState.ampAt);
const setAmp = (v: number, now = performance.now()) => {
  aimState.amp = Math.max(DARTS.AMP_MIN, Math.min(DARTS.AMP_MAX, v));
  aimState.ampAt = now;
};

function resetAim() {
  aimState.aim = dartsTarget(20, 'triple');
  setAmp(DARTS.AMP_START);
  aimState.calib = null;
}

function startMode(): AimMode {
  if (aimState.mode) return aimState.mode;
  let pref: string | null = null;
  try {
    pref = localStorage.getItem(MODE_KEY);
  } catch {
    /* egal */
  }
  // iPhone braucht nach jedem Neuladen einen Tipp für die Sensor-Erlaubnis → dann erst Touch, Knopf „Sensor“
  return pref === 'sensor' && motionSupport() === 'ok' ? 'sensor' : 'touch';
}

function rememberMode(m: AimMode) {
  aimState.mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* egal */
  }
}

export function pickDarts(s: DartsState): Screen {
  const id = store.playerId!;
  if (!s.players.some((p) => p.id === id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    resetAim();
    return ['da-intro', () => buildIntro(s)];
  }
  if (s.sub === 'throw') return [`da-round-${s.round}`, () => buildRound(s)];
  return ['da-watch', () => buildWatch()];
}

function buildIntro(s: DartsState) {
  app.append(
    el(`
      <div class="center da-intro">
        <h2>Darts – ${s.start} Single Out</h2>
        <p>Jeder startet bei ${s.start} und muss <b>genau auf 0</b>. Alle werfen gleichzeitig, ${DARTS.DARTS_PER_ROUND} Darts pro Runde.</p>
        <p>👆 Finger aufs Handy halten, <b>ziehen = zielen</b>, <b>loslassen = werfen</b>.<br/>📱 Oder Sensor-Modus: Handy bewegen, tippen = werfen.</p>
        <p>Das Fadenkreuz atmet – ruhig halten, im richtigen Moment werfen!</p>
        <p>Unter 0 = <b>überworfen</b>: die Runde zählt nicht. Höchstens ${s.rounds} Runden.</p>
      </div>
    `),
  );
  return null;
}

// ------------------------------------------------------------------ Scheibe zeichnen

function paintBoard(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  const W = c.width;
  const k = W / 2 / VIEW_MM;
  const cx = W / 2;
  g.fillStyle = '#c9a35a';
  g.fillRect(0, 0, W, W);
  for (let x = 0; x < W; x += Math.round(W / 24)) {
    g.fillStyle = '#b08a47';
    g.fillRect(x, 0, Math.max(1, W / 220), W);
  }
  const disc = (r: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(cx, cx, r * k, 0, Math.PI * 2);
    g.fill();
  };
  disc(194, '#9aa0a8');
  disc(191, '#1f1916');
  const band = (r0: number, r1: number, i: number, col: string) => {
    const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
    const a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
    g.fillStyle = col;
    g.beginPath();
    g.arc(cx, cx, r1 * k, a0, a1);
    g.arc(cx, cx, r0 * k, a1, a0, true);
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 20; i++) {
    const even = i % 2 === 0;
    const single = even ? '#2a2420' : '#ecdcb4';
    const score = even ? '#d0412f' : '#2f9150';
    band(DARTS.BULL_OUT, DARTS.TRIPLE_IN, i, single);
    band(DARTS.TRIPLE_IN, DARTS.TRIPLE_OUT, i, score);
    band(DARTS.TRIPLE_OUT, DARTS.DOUBLE_IN, i, single);
    band(DARTS.DOUBLE_IN, DARTS.DOUBLE_OUT, i, score);
  }
  disc(DARTS.BULL_OUT, '#2f9150');
  disc(DARTS.BULL_IN, '#d0412f');
  g.fillStyle = '#f2ead8';
  g.font = `${Math.round(W / 34)}px "Press Start 2P", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  DART_SEGMENTS.forEach((n, i) => {
    const a = (i * 18 * Math.PI) / 180;
    g.fillText(String(n), cx + Math.sin(a) * 181 * k, cx - Math.cos(a) * 181 * k + 1);
  });
}

/** Ergebnis eines eigenen Darts als kurze Zeile */
function dartText(d: DartsDart): { text: string; cls: string } {
  if (d.out) return { text: `CHECKOUT! ${d.label}`, cls: 'big win' };
  if (d.bust) return { text: `ÜBERWORFEN! (${d.label}) · Rest bleibt ${d.rest}`, cls: 'big bad' };
  if (d.ring === 'miss') return { text: `DANEBEN! · Rest ${d.rest}`, cls: '' };
  const big = d.ring === 'bull' || d.ring === 'triple';
  return { text: `${d.ring === 'single' ? 'Single ' : ''}${d.label}${big ? '!' : ''} · -${d.points} → Rest ${d.rest}${d.auto ? ' (automatisch)' : ''}`, cls: big ? 'big' : '' };
}

// ------------------------------------------------------------------ Werfen

function buildRound(s0: DartsState) {
  const id = store.playerId!;
  const round = s0.round;
  const phase = dartsPhase(id, round);
  const root = el(`
    <div class="da-play">
      <div class="top-row"><span class="da-round"></span><b class="da-rest"></b></div>
      <div class="da-board-wrap"><canvas class="da-board"></canvas></div>
      <p class="da-result"></p>
      <p class="da-hint"></p>
      <div class="da-quick">
        <button class="small secondary" data-t="T20">T20</button>
        <button class="small secondary" data-t="BULL">BULL</button>
        <button class="small secondary da-q3" data-t="T19">T19</button>
      </div>
      <div class="da-pad"><b class="da-pad-big"></b><span class="da-pad-small"></span></div>
      <div class="da-tools"></div>
    </div>
  `);
  app.append(root);
  const canvas = q<HTMLCanvasElement>(root, '.da-board');
  const pad = q(root, '.da-pad');
  const padBig = q(root, '.da-pad-big');
  const padSmall = q(root, '.da-pad-small');
  const tools = q(root, '.da-tools');
  const quick = q(root, '.da-quick');
  const q3 = q<HTMLButtonElement>(root, '.da-q3');
  const result = q(root, '.da-result');
  const hint = q(root, '.da-hint');
  const restEl = q(root, '.da-rest');
  const roundEl = q(root, '.da-round');

  // Größe: quadratisch, passt in Breite und ~34 % der Höhe
  const css = Math.floor(Math.min(app.clientWidth - 24, window.innerHeight * 0.34, 340));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.style.width = canvas.style.height = `${css}px`;
  canvas.width = canvas.height = Math.round(css * dpr);
  const bg = document.createElement('canvas');
  bg.width = bg.height = canvas.width;
  paintBoard(bg);
  document.fonts?.ready.then(() => paintBoard(bg)).catch(() => undefined);
  const k = canvas.width / 2 / VIEW_MM; // Canvas-Pixel pro mm
  const toCv = (p: Point) => ({ x: canvas.width / 2 + p.x * k, y: canvas.width / 2 + p.y * k });

  const me = () => darts()?.players.find((p) => p.id === id);
  const t0 = () => darts()?.t0 ?? s0.t0;
  let mode: AimMode = startMode();
  /** Finger liegt auf (Touch) */
  let press: { id: number; x: number; y: number; t: number; since: number } | null = null;
  /** Wurf unterwegs (bis der Server den Dart bestätigt): Fadenkreuz bleibt dort stehen */
  let pending: { n: number; cross: Point; since: number } | null = null;
  let cooldownUntil = 0;
  let shown = s0.darts.filter((d) => d.owner === id).length; // so viele eigene Darts sind schon angezeigt
  const trail = new AimTrail();
  trail.reset(performance.now(), aimState.aim);

  /** Darf gezielt werden (Runde läuft, eigene Darts übrig)? */
  const canAim = () => {
    const st = darts();
    const p = me();
    return !!st && st.sub === 'throw' && st.round === round && !!p && !dartsDone(p);
  };
  /** … und jetzt geworfen werden (kein Wurf mehr unterwegs; Sensor: kurze Pause gegen Doppel-Tipps)? */
  const canThrow = () => canAim() && !pending && (mode !== 'sensor' || performance.now() >= cooldownUntil);
  const setResult = (text: string, cls = '') => {
    result.className = `da-result ${cls} flash`;
    result.textContent = text;
  };

  const moveAim = (next: Point, now: number) => {
    const p = clampAim(next);
    setAmp(dartsBump(ampNow(now), Math.hypot(p.x - aimState.aim.x, p.y - aimState.aim.y)), now);
    aimState.aim = p;
    trail.push(now, p);
  };

  // ---- Wurf: genau dorthin, wo das Fadenkreuz (Zielpunkt + Atmen) jetzt steht
  const throwNow = (aimPt: Point, now: number) => {
    const p = me();
    if (!p || !canThrow()) return;
    const at = Math.round(serverNow());
    const amp = ampNow(now);
    pending = { n: p.thrown, cross: dartsCross(aimPt, at - t0(), amp, phase), since: now };
    aimState.aim = aimPt;
    send('throw', { n: p.thrown, ax: r1(aimPt.x), ay: r1(aimPt.y), amp: r1(amp), at });
    // die Hand zittert nach (der Server rechnet dasselbe für den TV)
    setAmp(Math.max(amp, DARTS.AMP_AFTER), now);
    cooldownUntil = now + DARTS_AIM.COOLDOWN_MS;
    haptic('tap');
    syncPad();
  };

  // ---- Touch: halten + ziehen = zielen, loslassen = werfen
  const down = (e: PointerEvent) => {
    if (mode === 'sensor') {
      // Sensor: Tippen wirft (die Position von kurz vor dem Tipp – das Antippen ruckelt)
      e.preventDefault();
      const now = performance.now();
      if (canThrow()) throwNow(trail.at(now - DARTS_AIM.TAP_LOOKBACK_MS) ?? aimState.aim, now);
      return;
    }
    if (press) return; // zweiter Finger
    e.preventDefault();
    if (!canAim()) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    const now = performance.now();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now, since: now };
    trail.reset(now, aimState.aim);
    haptic('tick');
    syncPad();
  };
  const move = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    e.preventDefault();
    const now = performance.now();
    const d = dragToMm(e.clientX - press.x, e.clientY - press.y, now - press.t);
    press.x = e.clientX;
    press.y = e.clientY;
    press.t = now;
    moveAim({ x: aimState.aim.x + d.x, y: aimState.aim.y + d.y }, now);
  };
  const up = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const now = performance.now();
    const held = now - press.since;
    press = null;
    const at = trail.at(now - DARTS_AIM.RELEASE_LOOKBACK_MS) ?? aimState.aim;
    aimState.aim = at;
    if (held < DARTS_AIM.MIN_HOLD_MS) {
      setResult('Gedrückt halten, ziehen – erst Loslassen wirft.');
      syncPad();
      return;
    }
    if (!canThrow()) {
      setResult('Moment – der letzte Dart fliegt noch.');
      syncPad();
      return;
    }
    throwNow(at, now);
  };
  const cancel = (e: PointerEvent) => {
    if (press?.id !== e.pointerId) return;
    press = null;
    syncPad();
  };
  for (const zone of [pad, canvas]) {
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', cancel);
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- Schnellwahl (Touch): setzt den Zielpunkt, Feinarbeit per Ziehen
  quick.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      const f = b.dataset.t ?? 'T20';
      const target =
        f === 'BULL' ? dartsTarget(25, 'bull') : f === '25' ? dartsTarget(25, 'outerbull') : f.startsWith('T') ? dartsTarget(Number(f.slice(1)), 'triple') : f.startsWith('D') ? dartsTarget(Number(f.slice(1)), 'double') : dartsTarget(Number(f), 'single');
      const now = performance.now();
      aimState.aim = clampAim(target);
      setAmp(ampNow(now) + 6, now);
      trail.reset(now, aimState.aim);
      haptic('tick');
    }),
  );

  // ---- Sensor: Handy bewegen = zielen
  let offMotion: (() => void) | null = null;
  let sensorRun = 0;
  const stopSensor = () => {
    offMotion?.();
    offMotion = null;
  };
  const startSensor = () => {
    stopSensor();
    const run = ++sensorRun;
    let smoothed: Point | null = null;
    let got = false;
    offMotion = onMotion((m) => {
      if (!root.isConnected) return stopSensor();
      // Manche Browser ohne echten Sensor liefern nur Nullen → ignorieren
      if (!got && m.alpha === 0 && m.beta === 0 && m.gamma === 0) return;
      got = true;
      if (!aimState.calib) {
        aimState.calib = { alpha: m.alpha, beta: m.beta };
        smoothed = null;
      }
      smoothed = smoothAim(smoothed, sensorAim(m, aimState.calib), 0.35);
      moveAim(smoothed, performance.now());
    });
    window.setTimeout(() => {
      if (root.isConnected && mode === 'sensor' && run === sensorRun && !got) {
        toast('Keine Sensordaten – zurück zum Touch-Zielen.');
        setMode('touch');
      }
    }, 2500);
  };

  /** Modus setzen; `calibrate` = beim Umschalten: so wie das Handy jetzt zeigt = Bull */
  const setMode = (m: AimMode, calibrate = false) => {
    mode = m;
    rememberMode(m);
    press = null;
    stopSensor();
    const sup = motionSupport();
    quick.classList.toggle('hidden', m === 'sensor');
    if (m === 'sensor') {
      tools.innerHTML = '<button class="small secondary da-center">Mitte</button><button class="small secondary da-switch">👆 Touch</button>';
      q(tools, '.da-center').addEventListener('click', () => {
        aimState.calib = null; // nächste Messung = Bull
        haptic('tick');
        setResult('Mitte gesetzt: Handy zeigt jetzt aufs Bull.');
      });
      if (calibrate) aimState.calib = null;
      startSensor();
    } else {
      tools.innerHTML =
        sup === 'ok' || sup === 'needs-permission'
          ? '<button class="small secondary da-switch">📱 Sensor-Modus</button>'
          : sup === 'insecure'
            ? '<p class="da-note">Sensor-Modus geht nur über HTTPS.</p>'
            : '';
    }
    // Kurzanleitung, solange noch kein eigener Dart steckt
    if (!shown) setResult(m === 'sensor' ? 'Handy bewegen = zielen · tippen = werfen' : 'Finger halten + ziehen = zielen · loslassen = werfen');
    tools.querySelector('.da-switch')?.addEventListener('click', async () => {
      if (mode === 'sensor') return setMode('touch');
      const ok = motionSupport() === 'ok' ? true : await enableMotion();
      if (!ok) return toast('Kein Zugriff auf den Bewegungssensor.');
      setMode('sensor', true);
    });
    syncPad();
  };

  // ---- Wurffeld beschriften
  let padKey = '';
  function syncPad() {
    const p = me();
    const done = !p || dartsDone(p);
    const state = done ? (p?.out ? 'out' : p?.bust ? 'bust' : p?.skipped ? 'skip' : 'done') : pending ? 'fly' : mode === 'sensor' ? 'sensor' : press ? 'hold' : 'touch';
    const key = `${state}|${p?.thrown ?? 0}|${p?.rest ?? 0}`;
    if (key === padKey) return;
    padKey = key;
    pad.className = `da-pad ${state}`;
    const dart = `Dart ${Math.min(DARTS.DARTS_PER_ROUND, (p?.thrown ?? 0) + 1)}/${DARTS.DARTS_PER_ROUND}`;
    const [big, small] =
      state === 'out'
        ? ['AUSGECHECKT!', 'Warte, ob noch jemand in dieser Runde auscheckt …']
        : state === 'bust'
          ? ['ÜBERWORFEN!', `Die Runde zählt nicht – nächste Runde wieder ab ${p?.rest}.`]
          : state === 'skip'
            ? ['Runde beendet', 'Deine restlichen Darts verfallen.']
            : state === 'done'
              ? ['Fertig!', 'Warte auf die anderen …']
              : state === 'fly'
                ? ['Wurf!', '']
                : state === 'sensor'
                  ? ['TIPPEN = WERFEN', `${dart} · Handy wie eine Fernbedienung auf den TV richten`]
                  : state === 'hold'
                    ? ['LOSLASSEN = WERFEN', 'ziehen = zielen · ruhig halten = ruhiger']
                    : ['FINGER DRAUF', `${dart} · halten + ziehen = zielen, loslassen = werfen`];
    padBig.textContent = big;
    padSmall.textContent = small;
  }

  // ---- Zielposition fürs TV senden (gedrosselt, nur bei Änderung)
  let sent: { x: number; y: number; amp: number; on: boolean; t: number } | null = null;
  const sendIv = window.setInterval(() => {
    if (!root.isConnected) return window.clearInterval(sendIv);
    const st = darts();
    const p = me();
    if (!st || st.sub !== 'throw' || st.round !== round || !p || dartsDone(p)) return;
    const now = performance.now();
    const a = aimState.aim;
    const amp = ampNow(now);
    const on = mode === 'sensor' || !!press;
    if (sent && Math.abs(a.x - sent.x) < 0.3 && Math.abs(a.y - sent.y) < 0.3 && Math.abs(amp - dartsCalm(sent.amp, now - sent.t)) < 0.8 && on === sent.on) return;
    sent = { x: a.x, y: a.y, amp, on, t: now };
    send('aim', { x: r1(a.x), y: r1(a.y), amp: r1(amp), on });
  }, DARTS.AIM_SEND_MS);

  // ---- Zeichnen
  const draw = () => {
    if (!root.isConnected) return stopSensor();
    requestAnimationFrame(draw);
    const now = performance.now();
    const g = canvas.getContext('2d')!;
    g.drawImage(bg, 0, 0);
    const st = darts();
    if (!st) return;
    for (const d of st.darts) {
      const p = toCv(d);
      const mine = d.owner === id;
      g.fillStyle = hex(st.players.find((x) => x.id === d.owner)?.color ?? 0xffffff);
      g.strokeStyle = '#2d1b12';
      g.lineWidth = dpr;
      g.beginPath();
      g.arc(p.x, p.y, (mine ? 4.5 : 2.5) * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (mine) {
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + 9 * dpr, p.y - 9 * dpr);
        g.lineWidth = 2 * dpr;
        g.stroke();
      }
    }
    const p = me();
    if (!p || (dartsDone(p) && !pending)) return;
    // Fadenkreuz: Zielpunkt + Atmen (Serverzeit seit Rundenbeginn – dieselbe Stelle wie am TV)
    const amp = ampNow(now);
    const c = toCv(pending ? pending.cross : dartsCross(aimState.aim, serverNow() - st.t0, amp, phase));
    if (!pending) {
      const a = toCv(aimState.aim);
      g.strokeStyle = 'rgba(255, 244, 214, 0.35)';
      g.lineWidth = dpr;
      g.beginPath();
      g.arc(a.x, a.y, amp * k, 0, Math.PI * 2);
      g.stroke();
    }
    const active = !!pending || !!press || mode === 'sensor';
    const R = (active ? 10 : 8) * dpr;
    g.globalAlpha = active ? 1 : 0.75;
    for (const [col, w] of [['#2d1b12', 4], [pending ? '#ffd25e' : '#ffffff', 2]] as [string, number][]) {
      g.strokeStyle = col;
      g.lineWidth = w * dpr;
      g.beginPath();
      g.arc(c.x, c.y, R * 0.6, 0, Math.PI * 2);
      g.moveTo(c.x - R, c.y);
      g.lineTo(c.x - R * 0.3, c.y);
      g.moveTo(c.x + R * 0.3, c.y);
      g.lineTo(c.x + R, c.y);
      g.moveTo(c.x, c.y - R);
      g.lineTo(c.x, c.y - R * 0.3);
      g.moveTo(c.x, c.y + R * 0.3);
      g.lineTo(c.x, c.y + R);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  requestAnimationFrame(draw);

  setMode(mode);

  // ---- Updates vom Server
  return () => {
    const st = darts();
    if (!st || st.round !== round) return;
    const p = st.players.find((x) => x.id === id);
    if (!p) return;
    roundEl.textContent = `Runde ${round}/${st.rounds}${round === st.rounds ? ' · LETZTE' : ''}`;
    restEl.textContent = `Rest ${p.rest}`;
    const mine = st.darts.filter((d) => d.owner === id).sort((a, b) => a.n - b.n);
    if (mine.length > shown) {
      shown = mine.length;
      pending = null;
      const d = mine[mine.length - 1];
      const r = dartText(d);
      setResult(r.text, r.cls);
      if (d.out) haptic('win');
      else if (d.bust) haptic('bad');
      else if (d.ring === 'bull' || d.ring === 'triple') haptic('hit');
    }
    // Wurf verloren gegangen (keine Bestätigung) → wieder freigeben, der Server verwirft Doppelte
    if (pending && performance.now() - pending.since > 2500) pending = null;
    const left = dartsLeft(p);
    const way = left ? dartsCheckout(p.rest, left) : null;
    const co = left ? dartsCheckoutText(p.rest, left) : null;
    hint.textContent = left ? (co ? `Checkout: ${co}` : `Noch ${left} ${left === 1 ? 'Dart' : 'Darts'} in dieser Runde`) : '';
    // dritte Schnellwahl: erstes Feld des Checkout-Wegs, sonst T19
    const f = way && p.rest <= DARTS.HINT_FROM ? way[0].short : 'T19';
    if (q3.dataset.t !== f) {
      q3.dataset.t = f;
      q3.textContent = f;
    }
    syncPad();
  };
}

// ------------------------------------------------------------------ Zuschauen (Auswertung, Ende)

function buildWatch() {
  const root = el(`
    <div class="center bw-watch">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <div class="panel da-list"></div>
  `);
  app.append(root);
  const list = q(root, '.da-list');
  let key = '';
  return () => {
    const s = darts();
    if (!s) return;
    const id = store.playerId!;
    const me = s.players.find((p) => p.id === id);
    const ranked = [...s.players].sort(dartsRank);
    const place = me ? ranked.findIndex((p) => dartsRank(p, me) === 0) + 1 : 0;
    let head = '';
    let sub = '';
    if (s.sub === 'over') {
      head = me && s.winners.includes(id) ? 'Du hast gewonnen!' : 'Spiel vorbei!';
      sub = me ? `${me.out ? `Ausgecheckt nach ${me.out} Darts` : `Rest ${me.rest}`} – Platz ${place}` : '';
    } else {
      head = `Runde ${s.round} vorbei`;
      if (me) {
        sub = me.bust ? `ÜBERWORFEN – Rest bleibt ${me.rest}` : `Diese Runde: -${me.scored} → Rest ${me.rest}`;
        sub += `\nPlatz ${place}`;
        const co = dartsCheckoutText(me.rest);
        if (co) sub += `\nCheckout: ${co}`;
      }
      if (s.round + 1 === s.rounds) sub += '\nGleich LETZTE Runde – danach gewinnt der niedrigste Rest!';
    }
    q(root, '.headline').textContent = head;
    q(root, '.sub').textContent = sub;
    const k = JSON.stringify(ranked.map((p) => [p.id, p.rest, p.scored, p.bust, p.out]));
    if (k === key) return;
    key = k;
    list.innerHTML = ranked
      .map((p) => {
        const rd = p.out ? 'CHECKOUT' : p.bust ? 'überw.' : `-${p.scored}`;
        return `<div class="bo-row ${p.id === id ? 'me' : ''}"><i class="bo-sw" style="background:${hex(p.color)}"></i><span class="bw-name">${escapeHtml(nameOf(p.id))}</span><span class="da-rd ${p.bust ? 'bad' : ''}">${rd}</span><b>${p.out ? 0 : p.rest}</b></div>`;
      })
      .join('');
  };
}
