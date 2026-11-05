/**
 * Bewegungs-Feedback am Handy (Bowling, Boule, Darts, Minigolf …):
 * Nach jedem Wurf/Schwung zeigt eine Karte, was der Sensor bzw. die Wischgeste wahrgenommen hat –
 * Verlauf der Schwungstärke mit markierter Spitze, Kraft-Balken mit Idealbereich, Werte in Klartext
 * und ein Tipp für den nächsten Versuch. Die Karte bleibt stehen, bis der nächste Wurf beginnt.
 *
 * Aufbau:
 * - `motionInfo()` / `swipeInfo()` fassen die Rohdaten eines Versuchs zusammen (reine Funktionen)
 * - `feedbackCard()` ist das wiederverwendbare DOM-Element (einmal bauen, dann nur `set()`)
 * - `rememberFeedback()` / `lastFeedback()` halten die letzte Karte pro Spiel über Screen-Wechsel hinweg
 */
import { el, q } from './core';
import { type MotionSample, type SwingScale } from './motion';
import { SWIPE_WINDOW_MS, type SwipePoint, swipeLevel, wrapDeg } from './bowlingThrow';

// ------------------------------------------------------------------ Rohdaten zusammenfassen

export interface TracePoint {
  /** ms relativ zum Loslassen (≤ 0) */
  t: number;
  /** Roh-Stärke (gleiche Skala wie die Wurf-Umrechnung, 1 = Maximum) */
  v: number;
}

export interface ThrowInfo {
  source: 'motion' | 'swipe';
  trace: TracePoint[];
  /** so viele ms vor dem Loslassen wertet die Umrechnung aus */
  windowMs: number;
  /** Index der Spitze in `trace` (innerhalb des Zeitfensters), −1 = keine */
  peakIdx: number;
  /** Roh-Stärke der Spitze */
  peak: number;
  /** Abstand Spitze → Loslassen in ms */
  peakToRelease: number;
  /**
   * Sensor: Drehung des Handys um die Hochachse zwischen Drücken und Loslassen (°, positiv = nach rechts),
   * null = Kompass unzuverlässig. Wischen: Schräge der Geste (°, positiv = nach rechts).
   */
  yawDeg: number | null;
  /** Gesamtdauer (Halten bzw. Wischen) in ms */
  durMs: number;
}

const median = (vals: number[]) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Sensor-Messwerte eines Schwungs (chronologisch, Drücken … Loslassen) → Zusammenfassung */
export function motionInfo(samples: MotionSample[], scale: SwingScale): ThrowInfo {
  if (!samples.length) return { source: 'motion', trace: [], windowMs: scale.windowMs, peakIdx: -1, peak: 0, peakToRelease: 0, yawDeg: null, durMs: 0 };
  const tEnd = samples[samples.length - 1].t;
  const trace = samples.map((s) => ({ t: s.t - tEnd, v: scale.level(s) }));
  let peakIdx = -1;
  trace.forEach((p, i) => {
    if (p.t >= -scale.windowMs && (peakIdx < 0 || p.v > trace[peakIdx].v)) peakIdx = i;
  });
  // gleiche Rechnung wie in den Wurf-Umrechnungen: Median der ersten/letzten drei Kompasswerte
  let yaw: number | null = null;
  if (samples.length >= 3) {
    const d = wrapDeg(median(samples.slice(-3).map((s) => s.alpha)) - median(samples.slice(0, 3).map((s) => s.alpha)));
    // alpha wächst bei Drehung nach links → nach rechts = −d
    yaw = Math.abs(d) > scale.yawLimit ? null : -d;
  }
  return {
    source: 'motion',
    trace,
    windowMs: scale.windowMs,
    peakIdx,
    peak: peakIdx >= 0 ? trace[peakIdx].v : 0,
    peakToRelease: peakIdx >= 0 ? -trace[peakIdx].t : 0,
    yawDeg: yaw,
    durMs: tEnd - samples[0].t,
  };
}

/** Wischgeste → Zusammenfassung (Fingertempo über die Zeit, Schräge) */
export function swipeInfo(pts: SwipePoint[]): ThrowInfo {
  if (pts.length < 2) return { source: 'swipe', trace: [], windowMs: SWIPE_WINDOW_MS, peakIdx: -1, peak: 0, peakToRelease: 0, yawDeg: null, durMs: 0 };
  const tEnd = pts[pts.length - 1].t;
  const trace: TracePoint[] = [];
  for (let i = 1; i < pts.length; i++) {
    // Tempo über ~3 Punkte geglättet (Pointer-Events kommen unregelmäßig)
    const a = pts[Math.max(0, i - 2)];
    const b = pts[i];
    const dt = Math.max(8, b.t - a.t);
    trace.push({ t: b.t - tEnd, v: swipeLevel(Math.hypot(b.x - a.x, b.y - a.y) / dt) });
  }
  let peakIdx = -1;
  trace.forEach((p, i) => {
    if (peakIdx < 0 || p.v > trace[peakIdx].v) peakIdx = i;
  });
  const a = pts[0];
  const b = pts[pts.length - 1];
  const up = a.y - b.y;
  return {
    source: 'swipe',
    trace,
    windowMs: SWIPE_WINDOW_MS,
    peakIdx,
    peak: peakIdx >= 0 ? trace[peakIdx].v : 0,
    peakToRelease: peakIdx >= 0 ? -trace[peakIdx].t : 0,
    yawDeg: up > 0 ? (Math.atan2(b.x - a.x, up) * 180) / Math.PI : null,
    durMs: tEnd - a.t,
  };
}

// ------------------------------------------------------------------ Inhalt einer Karte

export type Tone = 'ok' | 'warn' | 'bad';

export interface FeedbackBar {
  /** Beschriftung links, z. B. „Kraft“ */
  label: string;
  /** 0 … 1 */
  value: number;
  /** Idealbereich 0 … 1 */
  lo: number;
  hi: number;
  /** Text rechts, z. B. „68 % (ideal 54–66 %)“ */
  text: string;
}

export interface FeedbackLine {
  k: string;
  v: string;
  tone?: Tone;
}

export interface Feedback {
  /** Überschrift, z. B. „Dein Schwung“ */
  title: string;
  info?: ThrowInfo;
  bar?: FeedbackBar;
  lines: FeedbackLine[];
  /** Ein-Satz-Tipp für das nächste Mal */
  tip: string;
  tone: Tone;
}

// ------------------------------------------------------------------ Merken über Screen-Wechsel

const memo = new Map<string, Feedback>();
export const rememberFeedback = (game: string, fb: Feedback) => void memo.set(game, fb);
export const lastFeedback = (game: string): Feedback | null => memo.get(game) ?? null;
export const forgetFeedback = (game: string) => void memo.delete(game);

// ------------------------------------------------------------------ Karte (DOM)

export interface FeedbackCard {
  /** einhängbares Element */
  root: HTMLElement;
  /** Inhalt setzen (null = ausblenden) – baut nichts neu, ändert nur Werte */
  set(fb: Feedback | null): void;
  /** Karte abblenden (nächster Versuch beginnt) */
  dim(): void;
  readonly current: Feedback | null;
}

const GRAPH_MS = 1600;

/** Kompakte Karten (Darts, Minigolf): Details erst nach Antippen – Zustand gilt für alle Karten */
let compactOpen = false;

/** `compact` = platzsparend (Details-Zeilen aufklappbar), z. B. wenn der Wurf-Knopf sonst aus dem Bild rutscht */
export function feedbackCard(compact = false): FeedbackCard {
  const extraClass = compact ? 'mf-compact' : '';
  const wrap = el(`
    <div class="mf hidden ${extraClass}">
      <div class="mf-head"><b class="mf-title"></b><span class="mf-src"></span><span class="mf-more"></span></div>
      <canvas class="mf-graph"></canvas>
      <div class="mf-barrow"><span class="mf-barlbl"></span><div class="mf-bar"><i class="mf-zone"></i><i class="mf-mark"></i></div></div>
      <p class="mf-bartxt"></p>
      <div class="mf-lines"></div>
      <p class="mf-tip"></p>
    </div>
  `);
  const root = q(wrap, '.mf');
  const canvas = q<HTMLCanvasElement>(root, '.mf-graph');
  let current: Feedback | null = null;
  if (compact) {
    const more = q(root, '.mf-more');
    const sync = () => {
      root.classList.toggle('open', compactOpen);
      more.textContent = compactOpen ? 'Details −' : 'Details +';
    };
    sync();
    root.addEventListener('click', () => {
      compactOpen = !compactOpen;
      sync();
    });
  }

  const set = (fb: Feedback | null) => {
    current = fb;
    root.classList.remove('dim');
    root.classList.toggle('hidden', !fb);
    if (!fb) return;
    root.className = root.className.replace(/\bmf-(ok|warn|bad)\b/g, '').trim() + ` mf-${fb.tone}`;
    q(root, '.mf-title').textContent = fb.title;
    q(root, '.mf-src').textContent = fb.info ? (fb.info.source === 'motion' ? 'Sensor' : 'Wischen') : '';
    const bar = fb.bar;
    q(root, '.mf-barrow').classList.toggle('hidden', !bar);
    q(root, '.mf-bartxt').classList.toggle('hidden', !bar);
    if (bar) {
      q(root, '.mf-barlbl').textContent = bar.label;
      const zone = q(root, '.mf-zone');
      zone.style.left = `${Math.max(0, bar.lo) * 100}%`;
      zone.style.width = `${Math.max(0.01, Math.min(1, bar.hi) - Math.max(0, bar.lo)) * 100}%`;
      const mark = q(root, '.mf-mark');
      mark.style.left = `${Math.max(0, Math.min(1, bar.value)) * 100}%`;
      mark.className = `mf-mark ${bar.value < bar.lo || bar.value > bar.hi ? 'off' : 'in'}`;
      q(root, '.mf-bartxt').textContent = bar.text;
    }
    const lines = q(root, '.mf-lines');
    lines.replaceChildren(
      ...fb.lines.map((l) => {
        const row = document.createElement('div');
        row.className = `mf-line ${l.tone ?? ''}`;
        const k = document.createElement('span');
        k.textContent = l.k;
        const v = document.createElement('b');
        v.textContent = l.v;
        row.append(k, v);
        return row;
      }),
    );
    q(root, '.mf-tip').textContent = fb.tip;
    // ohne nennenswerte Bewegung gibt es nichts zu zeigen
    const hasGraph = !!fb.info && fb.info.trace.length > 1 && fb.info.peak > 0.02;
    canvas.classList.toggle('hidden', !hasGraph);
    if (hasGraph) {
      // Breite steht erst fest, wenn die Karte im DOM hängt
      if (root.isConnected && canvas.clientWidth) drawGraph(canvas, fb.info!);
      else requestAnimationFrame(() => current === fb && drawGraph(canvas, fb.info!));
    }
  };

  return {
    root,
    set,
    dim: () => current && root.classList.add('dim'),
    get current() {
      return current;
    },
  };
}

/** Pixel-Säulen: Schwungstärke der letzten 1,6 s vor dem Loslassen, ausgewertetes Fenster dunkel, Spitze rot */
function drawGraph(c: HTMLCanvasElement, info: ThrowInfo) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = Math.max(120, c.clientWidth);
  const cssH = Math.max(30, c.clientHeight);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  // Zeitachse = ganze Aufnahme (mind. 0,3 s, höchstens 1,6 s vor dem Loslassen)
  const span = Math.min(GRAPH_MS, Math.max(300, -(info.trace[0]?.t ?? 0) * 1.08));
  // etwa eine Säule pro Messwert (~16 ms), höchstens eine pro 6 px
  const N = Math.max(12, Math.min(Math.floor(cssW / 6), Math.round(span / 16)));
  const bw = cssW / N;
  const top = 10;
  const base = cssH - 2;
  const H = base - top;
  // y-Achse an die Spitze anpassen (sanfte Schwünge bleiben lesbar); gestrichelt = 100 % Stärke
  const maxV = Math.max(0.4, info.peak * 1.15);
  const buckets = new Array<number>(N).fill(-1);
  for (const p of info.trace) {
    if (p.t < -span) continue;
    const i = Math.min(N - 1, Math.floor(((p.t + span) / span) * N));
    buckets[i] = Math.max(buckets[i], p.v);
  }
  const peakT = info.peakIdx >= 0 ? info.trace[info.peakIdx].t : null;
  const peakB = peakT !== null && peakT >= -span ? Math.min(N - 1, Math.floor(((peakT + span) / span) * N)) : -1;
  // ausgewertetes Zeitfenster hinterlegen
  const winX = ((span - Math.min(span, info.windowMs)) / span) * cssW;
  g.fillStyle = 'rgba(240, 177, 58, 0.22)';
  g.fillRect(winX, top - 2, cssW - winX, H + 2);
  // Linie „voll“ (= 100 % Roh-Stärke)
  if (maxV >= 1) {
    const yFull = base - (1 / maxV) * H;
    g.fillStyle = 'rgba(61, 36, 20, 0.35)';
    for (let x = 0; x < cssW; x += 6) g.fillRect(x, Math.round(yFull), 3, 1);
  }
  for (let i = 0; i < N; i++) {
    const v = buckets[i];
    if (v < 0) continue;
    const h = Math.max(2, Math.round((Math.max(0, Math.min(maxV, v)) / maxV) * H));
    const x = Math.round(i * bw);
    const inWin = x + bw > winX;
    g.fillStyle = i === peakB ? '#a8342a' : inWin ? '#8d5629' : '#d6b27a';
    g.fillRect(x, base - h, Math.max(1, Math.round(bw) - 1), h);
  }
  // Spitze markieren (Dreieck darüber)
  if (peakB >= 0) {
    const cx = Math.round(peakB * bw + bw / 2);
    const h = Math.round((Math.max(0, Math.min(maxV, buckets[peakB])) / maxV) * H);
    const y = Math.max(top, base - h - 3);
    g.fillStyle = '#a8342a';
    g.beginPath();
    g.moveTo(cx - 4, y - 6);
    g.lineTo(cx + 4, y - 6);
    g.lineTo(cx, y);
    g.closePath();
    g.fill();
  }
  // Loslassen = rechter Rand
  g.fillStyle = '#2d1b12';
  g.fillRect(cssW - 2, top - 4, 2, H + 4);
}

// ------------------------------------------------------------------ Text-Bausteine

export const pct = (v: number) => `${Math.round(v * 100)} %`;
export const lr = (deg: number) => (deg < 0 ? 'links' : 'rechts');

/** Effet −1 … 1 in Worten */
export function spinText(spin: number): string {
  const a = Math.abs(spin);
  if (a < 0.05) return 'keiner';
  return `${a < 0.35 ? 'leicht ' : a < 0.7 ? '' : 'stark '}${spin < 0 ? 'links' : 'rechts'}`;
}

/** Zeitpunkt des Loslassens relativ zur Spitze */
export function timingLine(info: ThrowInfo): FeedbackLine | null {
  if (info.source !== 'motion' || info.peakIdx < 0) return null;
  const ms = Math.round(info.peakToRelease);
  if (ms > info.windowMs * 0.6) return { k: 'Loslassen', v: `${ms} ms nach der Spitze – zu spät`, tone: 'warn' };
  if (ms < 25 && info.trace.length > 4) return { k: 'Loslassen', v: 'mitten im Schwung', tone: 'warn' };
  return { k: 'Loslassen', v: `${ms} ms nach der Spitze`, tone: 'ok' };
}

/** Tipp zum Zeitpunkt, falls der auffällig war (sonst null) */
export function timingTip(info: ThrowInfo): string | null {
  if (info.source !== 'motion' || info.peakIdx < 0) return null;
  if (info.peakToRelease > info.windowMs * 0.6) return 'Zu spät losgelassen – lass direkt am Ende des Schwungs los.';
  if (info.peakToRelease < 25 && info.trace.length > 4) return 'Zu früh losgelassen – erst loslassen, wenn der Schwung durch ist.';
  return null;
}

/** Karte für einen Versuch, der nicht als Wurf zählte */
export function failFeedback(reason: string, info: ThrowInfo | null, title = 'Kein Wurf erkannt'): Feedback {
  const lines: FeedbackLine[] = [];
  if (info && info.trace.length) {
    lines.push({ k: 'Spitze', v: info.peak > 0.02 ? pct(Math.min(1, info.peak)) : 'kaum Bewegung', tone: 'bad' });
    lines.push({ k: 'Dauer', v: `${(info.durMs / 1000).toFixed(1).replace('.', ',')} s` });
  }
  return { title, info: info ?? undefined, lines, tip: reason, tone: 'bad' };
}
