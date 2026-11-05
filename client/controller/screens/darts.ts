import { DARTS, DART_SEGMENTS, type DartsState, POWER_TEXT, dartsCalm, dartsPhase, dartsPowerHint, dartsTarget, dartsWobble } from '../../../shared/darts';
import type { Point } from '../../../shared/types';
import { type Screen, app, el, escapeHtml, message, nameOf, q, secondsLeft, send, store } from '../core';
import type { BowlThrow } from '../bowlingThrow';
import { flickToThrow } from '../dartsThrow';
import { onMotion } from '../motion';
import { mountThrowInput } from '../throwInput';

const darts = () => (store.state?.mini?.kind === 'darts' ? store.state.mini.state : null);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const pts = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
/** sichtbarer Ausschnitt am Handy: Radius in mm (Scheibe + etwas Wand) */
const VIEW_MM = 200;

export function pickDarts(s: DartsState): Screen {
  const id = store.playerId!;
  if (!s.players.some((p) => p.id === id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    return [
      'da-intro',
      message(
        'Darts an der Strandbar!',
        `Alle werfen gleichzeitig: ${s.rounds} Runden mit je ${DARTS.DARTS_PER_ROUND} Darts. Zielen, ruhig halten, werfen – höchste Punktzahl gewinnt. Doppel x2, Triple x3, Bull 50. Die letzte Runde zählt doppelt!`,
      ),
    ];
  }
  if (s.sub === 'throw') return [`da-round-${s.round}`, () => buildRound(s)];
  return ['da-watch', () => buildWatch()];
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

// ------------------------------------------------------------------ Werfen

function buildRound(s0: DartsState) {
  const id = store.playerId!;
  const round = s0.round;
  const final = s0.mult > 1;
  const root = el(`
    <div class="top-row"><span class="da-round">Runde ${round}/${s0.rounds}${final ? ' · FINALE x2' : ''}</span><b class="da-score"></b></div>
    <div class="da-board-wrap"><canvas class="da-board"></canvas></div>
    <div class="da-quick">
      <button class="small secondary" data-t="t20">T20</button>
      <button class="small secondary" data-t="bull">BULL</button>
      <button class="small secondary" data-t="t19">T19</button>
    </div>
    <p class="da-result">Ziehen = zielen · ruhig halten = ruhiger</p>
    <div class="bw-area da-area"></div>
  `);
  app.append(root);
  const canvas = q<HTMLCanvasElement>(root, '.da-board');
  const area = q(root, '.da-area');
  const result = q(root, '.da-result');
  const scoreEl = q(root, '.da-score');
  const roundEl = q(root, '.da-round');

  // Größe: quadratisch, passt in Breite und ~36 % der Höhe
  const css = Math.floor(Math.min(app.clientWidth - 28, window.innerHeight * 0.36, 360));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.style.width = canvas.style.height = `${css}px`;
  canvas.width = canvas.height = Math.round(css * dpr);
  const bg = document.createElement('canvas');
  bg.width = bg.height = canvas.width;
  paintBoard(bg);
  document.fonts?.ready.then(() => paintBoard(bg)).catch(() => undefined);
  const k = canvas.width / 2 / VIEW_MM; // Canvas-Pixel pro mm
  const toCv = (p: Point) => ({ x: canvas.width / 2 + p.x * k, y: canvas.width / 2 + p.y * k });

  // ---- Zielen
  let aim: Point = dartsTarget(20, 'triple');
  let amp: number = DARTS.AMP_START;
  let t0 = performance.now();
  let last = t0;
  let held = false; // Wurf-Knopf/Wischfeld gedrückt → Bewegung beim Schnippen zählt nicht als Zittern
  let n = myThrown(); // Nummer des nächsten Darts
  let flying: Point | null = null; // Fadenkreuz beim letzten Wurf
  let shown = n; // so viele eigene Darts sind schon angezeigt
  let input: { stop(): void } | null = null;

  const phase = () => dartsPhase(id, round, n);
  const cross = (now: number) => {
    const w = dartsWobble(now - t0, amp, phase());
    return { x: aim.x + w.x, y: aim.y + w.y };
  };
  const bump = (mm: number) => (amp = Math.min(DARTS.AMP_MAX, amp + mm));

  let drag: { id: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = ((e.clientX - drag.x) * dpr) / k;
    const dy = ((e.clientY - drag.y) * dpr) / k;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const L = VIEW_MM - 5;
    aim = { x: Math.max(-L, Math.min(L, aim.x + dx * 0.8)), y: Math.max(-L, Math.min(L, aim.y + dy * 0.8)) };
    bump(Math.hypot(dx, dy) * 0.35);
  });
  const endDrag = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  root.querySelectorAll<HTMLButtonElement>('.da-quick button').forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.t;
      aim = t === 'bull' ? { x: 0, y: 0 } : dartsTarget(t === 't19' ? 19 : 20, 'triple');
      bump(8);
    }),
  );

  // Zittern durch Handybewegung (nur wenn der Sensor freigegeben ist)
  const unsub = onMotion((m) => {
    if (!root.isConnected) return unsub();
    const w = Math.hypot(m.rotAlpha, m.rotBeta, m.rotGamma);
    if (!held && w > 35 && w < 260) bump((w - 35) * 0.01);
  });
  area.addEventListener('pointerdown', () => (held = true), true);
  area.addEventListener('pointerup', () => (held = false), true);
  area.addEventListener('pointercancel', () => (held = false), true);

  // ---- Wurf-Eingabe (pro Dart neu)
  const mount = () => {
    input?.stop();
    area.innerHTML = '';
    if (n >= DARTS.DARTS_PER_ROUND) {
      const me = darts()?.players.find((p) => p.id === id);
      area.append(el(`<div class="center"><h2>Fertig!</h2><p>Diese Runde: +${me?.round ?? 0}${final ? ' (doppelt!)' : ''}</p><p>Warte auf die anderen …</p></div>`));
      return;
    }
    t0 = performance.now();
    amp = Math.max(amp, DARTS.AMP_START * 0.8);
    flying = null;
    const left = DARTS.DARTS_PER_ROUND - n;
    input = mountThrowInput(
      area,
      root,
      {
        ask: 'Wirf wie einen echten Dart: Handy aufrecht halten, Knopf drücken, aus dem Handgelenk nach vorn schnippen und loslassen.',
        motionHint: `Dart ${n + 1}/${DARTS.DARTS_PER_ROUND}: halten, ruhig zielen, nach vorn schnippen + loslassen.`,
        padText: `Dart ${n + 1}/${DARTS.DARTS_PER_ROUND} (noch ${left}) – nach oben wischen!<br/>Tempo = Kraft · schräg = daneben`,
        padClass: 'da-pad',
        button: 'HALTEN &amp;<br/>WERFEN',
        holding: 'SCHNIPPEN …<br/><small>und loslassen!</small>',
        swing: flickToThrow,
      },
      (t: BowlThrow) => {
        held = false;
        navigator.vibrate?.(30);
        const now = performance.now();
        flying = cross(now);
        send('throw', { n, ax: r1(aim.x), ay: r1(aim.y), t: Math.round(now - t0), amp: r1(amp), power: t.speed, side: t.angle });
        const hint = dartsPowerHint(t.speed);
        area.innerHTML = '';
        area.append(el(`<div class="center"><h2>Wurf!</h2><p>Kraft ${Math.round(t.speed * 100)} % – ${POWER_TEXT[hint]}${hint === 'low' ? ' (landet tiefer)' : hint === 'high' ? ' (landet höher)' : ''}</p></div>`));
      },
    );
  };
  mount();

  // ---- Zeichnen
  const draw = () => {
    if (!root.isConnected) return;
    requestAnimationFrame(draw);
    const now = performance.now();
    amp = dartsCalm(amp, now - last);
    last = now;
    const g = canvas.getContext('2d')!;
    g.drawImage(bg, 0, 0);
    const st = darts();
    if (st) {
      for (const d of st.darts) {
        const p = toCv(d);
        const mine = d.owner === id;
        const col = hex(st.players.find((x) => x.id === d.owner)?.color ?? 0xffffff);
        g.fillStyle = col;
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
      roundEl.textContent = `Runde ${round}/${st.rounds}${final ? ' · FINALE x2' : ''} · ${secondsLeft()} s`;
    }
    // Fadenkreuz
    if (n < DARTS.DARTS_PER_ROUND || flying) {
      const c = toCv(flying ?? cross(now));
      const a = toCv(aim);
      if (!flying) {
        g.strokeStyle = 'rgba(255, 244, 214, 0.35)';
        g.lineWidth = dpr;
        g.beginPath();
        g.arc(a.x, a.y, amp * k, 0, Math.PI * 2);
        g.stroke();
      }
      const R = 9 * dpr;
      for (const [col, w] of [['#2d1b12', 4], [flying ? '#ffd25e' : '#ffffff', 2]] as [string, number][]) {
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
    }
  };
  requestAnimationFrame(draw);

  // ---- Updates vom Server
  return () => {
    const st = darts();
    if (!st || st.round !== round) return;
    const me = st.players.find((p) => p.id === id);
    if (!me) return;
    scoreEl.textContent = `${me.total} P.`;
    const mine = st.darts.filter((d) => d.owner === id).sort((a, b) => a.n - b.n);
    if (mine.length > shown) {
      const d = mine[mine.length - 1];
      shown = mine.length;
      n = me.thrown;
      const big = d.ring === 'bull' || d.ring === 'triple';
      result.className = `da-result ${big ? 'big' : ''} flash`;
      result.textContent = d.ring === 'miss' ? 'DANEBEN!' : `${d.ring === 'single' ? 'Single ' : ''}${d.label}${big ? '!' : ''} · +${d.points} P.${d.auto ? ' (automatisch)' : ''}`;
      if (big) navigator.vibrate?.([40, 60, 40]);
      window.setTimeout(() => {
        if (!root.isConnected) return;
        flying = null;
        mount();
      }, n >= DARTS.DARTS_PER_ROUND ? 0 : 900);
    }
  };

  function myThrown() {
    return s0.players.find((p) => p.id === id)?.thrown ?? 0;
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;

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
    const ranked = [...s.players].sort((a, b) => b.total - a.total);
    const place = me ? ranked.findIndex((p) => p.total === me.total) + 1 : 0;
    let head = '';
    let sub = '';
    if (s.sub === 'over') {
      head = me && place === 1 ? 'Du hast gewonnen!' : 'Spiel vorbei!';
      sub = me ? `${pts(me.total)} – Platz ${place}` : '';
    } else {
      head = `Runde ${s.round} vorbei`;
      sub = me ? `Diese Runde: +${me.round}\nGesamt: ${pts(me.total)} (Platz ${place})` : '';
      if (s.round + 1 === s.rounds) sub += '\nGleich FINALE: doppelte Punkte!';
      if (s.tally && s.tally.points > 0) sub += `\nBeste Runde: ${s.tally.best.map((b) => (b === id ? 'du' : nameOf(b))).join(' & ')} (+${s.tally.points})`;
    }
    q(root, '.headline').textContent = head;
    q(root, '.sub').textContent = sub;
    const k = JSON.stringify(ranked.map((p) => [p.id, p.total, p.round]));
    if (k === key) return;
    key = k;
    list.innerHTML = ranked
      .map(
        (p) =>
          `<div class="bo-row ${p.id === id ? 'me' : ''}"><i class="bo-sw" style="background:${hex(p.color)}"></i><span class="bw-name">${escapeHtml(nameOf(p.id))}</span><span class="da-rd">+${p.round}</span><b>${p.total}</b></div>`,
      )
      .join('');
  };
}
