import { BAND, BAND_INFO, BAND_INSTS, type BandInst, type BandNote, type BandState, bandBeatMs, bandBonus, bandChart, bandSong, bandStars } from '../../../shared/band';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, timerText } from '../core';
import { haptic } from '../haptic';
import { toLocalPerf } from '../../timesync';

/**
 * Strand-Band am Handy: Instrument wählen, dann die eigene Notenspur spielen. Bewertet wird hier am Handy gegen
 * die synchronisierte Server-Uhr (wie beim Gespräch der Date Night) – der Server bekommt nur „Note i: perfekt/gut/
 * daneben“. Die Spur rechnet jedes Handy selbst aus dem Song aus (`bandChart`), sie steht nicht im Zustand.
 */

const st = () => (store.state?.mini?.kind === 'band' ? store.state.mini.state : null);
const LANE_COLORS = ['#e46e98', '#f0b13a', '#4fb3e8'];
const LANE_DARK = ['#b0306a', '#c08316', '#2d7fb8'];
const ONE_LANE = '#7cc04a';
const ONE_DARK = '#4a8a2c';

export function pickBand(s: BandState): Screen {
  injectCss();
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du hörst zu', 'Die Band spielt – schau auf den Fernseher!')];
  if (s.sub === 'pick') return me.ready ? ['bd-ready', buildReady] : ['bd-pick', buildPick];
  if (s.sub === 'play') return [`bd-play-${s.playSeq}-${me.inst}`, () => buildPlay(s, me.inst)];
  return ['bd-over', message('Applaus!', 'Die Band hat ausgespielt – schau auf den Fernseher!')];
}

// ------------------------------------------------------------------ Instrument wählen

function buildPick() {
  const s = st()!;
  const root = el(`
    <div class="top-row"><span>🎸 Strand-Band</span><span class="timer"></span></div>
    <p class="bd-song">Heute auf der Bühne: „${escapeHtml(s.title)}“ · ${s.bpm} BPM</p>
    <h2>Dein Instrument</h2>
    <div class="bd-insts">
      ${BAND_INSTS.map((k) => {
        const i = BAND_INFO[k];
        const b = bandBonus(k);
        return `<button class="secondary bd-i" data-i="${k}"><span class="bd-ic">${i.icon}</span><span class="bd-n">${escapeHtml(i.name)}</span><span class="bd-st">${bandStars(k)}${b ? ` <small>+${b}%</small>` : ''}</span><span class="bd-d">${escapeHtml(i.desc)}</span><span class="bd-c"></span></button>`;
      }).join('')}
    </div>
    <button class="bd-ok">Bereit!</button>
    <p class="bd-hint">★ leicht · ★★★ schwer (Bonus in der Wertung). Ton am TV aufdrehen!</p>
  `);
  root.querySelectorAll<HTMLButtonElement>('.bd-i').forEach((b) =>
    b.addEventListener('click', () => {
      const cur = st();
      const inst = b.dataset.i as BandInst;
      if (!cur || cur.players[store.playerId!]?.inst === inst) return;
      if (b.classList.contains('full')) return haptic('bad');
      haptic('tick');
      send('inst', { inst });
    }),
  );
  q<HTMLButtonElement>(root, '.bd-ok').addEventListener('click', () => {
    haptic('tap');
    send('ready');
  });
  app.append(root);
  return () => {
    const cur = st();
    if (!cur) return;
    q(root, '.timer').textContent = timerText();
    const mine = cur.players[store.playerId!]?.inst;
    root.querySelectorAll<HTMLButtonElement>('.bd-i').forEach((b) => {
      const k = b.dataset.i as BandInst;
      const n = cur.order.filter((id) => cur.players[id].inst === k).length;
      const full = k !== mine && n >= cur.cap;
      b.classList.toggle('on', k === mine);
      b.classList.toggle('full', full);
      q(b, '.bd-c').textContent = full ? 'voll' : `${n}/${cur.cap}`;
    });
  };
}

function buildReady() {
  const root = el(`
    <div class="top-row"><span>🎸 Strand-Band</span><span class="timer"></span></div>
    <div class="center">
      <h2 class="bd-mine"></h2>
      <p>Bereit! Gleich zählt die Band ein – Noten fallen von oben, tippe sie an der Linie.</p>
      <div class="bd-band"></div>
    </div>
  `);
  app.append(root);
  return () => {
    const cur = st();
    if (!cur) return;
    q(root, '.timer').textContent = timerText();
    const mine = cur.players[store.playerId!];
    if (mine) q(root, '.bd-mine').textContent = `${BAND_INFO[mine.inst].icon} ${BAND_INFO[mine.inst].name} ${bandStars(mine.inst)}`;
    q(root, '.bd-band').innerHTML = cur.order
      .map((id) => {
        const p = cur.players[id];
        return `<span class="${p.ready ? 'ok' : ''}">${BAND_INFO[p.inst].icon} ${escapeHtml(nameOf(id).replace(/^Bot\s+/, ''))}${p.ready ? ' ✓' : ' …'}</span>`;
      })
      .join('');
  };
}

// ------------------------------------------------------------------ Spielen

interface Hold {
  i: number;
  pointer: string;
}

function buildPlay(s: BandState, inst: BandInst) {
  const song = bandSong(s.song);
  if (!song) return message('Song fehlt', 'Seite neu laden.')();
  const info = BAND_INFO[inst];
  const notes: BandNote[] = bandChart(song, inst);
  const lanes = info.laneNames.length;
  const beatMs = bandBeatMs(song);
  const startAt = s.startAt;
  /** 0 offen, 1 Kopf getroffen (Halten läuft), 2 erledigt */
  const judged = new Uint8Array(notes.length);
  const songNow = () => performance.now() - toLocalPerf(startAt);

  // Neu aufgebaut mitten im Song (WLAN-Aussetzer): Vergangenes zählt der Server ohnehin als verpasst
  const t0 = songNow();
  notes.forEach((n, i) => {
    if (n.t + BAND.GOOD_MS + 30 < t0) judged[i] = 2;
  });

  const root = el(`
    <div class="bd-top"><span class="bd-me">${info.icon} ${escapeHtml(info.name)}</span><span class="bd-combo"></span><span class="bd-pct"></span></div>
    <div class="bd-stage"><canvas></canvas></div>
    <div class="bd-btns n${lanes}">
      ${info.laneNames.map((name, l) => `<button class="bd-lane l${l}" data-l="${l}">${escapeHtml(name)}</button>`).join('')}
    </div>
  `);
  const stage = q(root, '.bd-stage');
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const comboEl = q(root, '.bd-combo');
  const pctEl = q(root, '.bd-pct');
  const btns = [...root.querySelectorAll<HTMLButtonElement>('.bd-lane')];
  app.append(root);
  const g = canvas.getContext('2d')!;
  let W = 0;
  let H = 0;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(120, Math.floor(r.width - 6));
    H = Math.max(160, Math.floor(r.height - 6));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
  };
  fit();
  window.addEventListener('resize', fit);

  // ---------------------------------------------------------------- Bewertung

  /**
   * Selbst-Kalibrierung: Median der letzten Abweichungen (Tipp − Note) verschiebt das Bewertungsfenster.
   * Gleicht Touch-Verzögerung und einen hinterherhinkenden TV-Ton aus (wer nach Gehör spielt, tippt konstant
   * später). Die fallenden Noten bleiben, wo sie sind – sonst liefe die Korrektur bei Augen-Spielern davon.
   */
  const deltas: number[] = [];
  let bias = 0;
  const learn = (d: number) => {
    deltas.push(d);
    if (deltas.length > 12) deltas.shift();
    const sorted = [...deltas].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    bias = Math.max(BAND.BIAS_MIN, Math.min(BAND.BIAS_MAX, med)) * Math.min(1, deltas.length / 6);
  };

  let combo = 0;
  let score = 0;
  let max = 0;
  const holds = new Map<number, Hold>();
  const flash = new Float64Array(lanes);
  let fb = { text: '', color: '#fff', at: -1e9, lane: 0 };
  const feedback = (text: string, color: string, lane: number) => (fb = { text, color, at: performance.now(), lane });

  const judge = (i: number, qv: 0 | 1 | 2, lane: number, early = false) => {
    const n = notes[i];
    judged[i] = qv > 0 && n.len ? 1 : 2;
    max += 2 + (n.len ? 1 : 0);
    score += qv;
    combo = qv > 0 ? combo + 1 : 0;
    send('hit', { i, q: qv });
    if (qv === 2) feedback('PERFEKT!', '#ffd25e', lane);
    else if (qv === 1) feedback('GUT', '#9ad65a', lane);
    else feedback(early ? 'ZU FRÜH' : 'DANEBEN', '#ff8a7a', lane);
  };

  const tap = (lane: number, pointer: string) => {
    const now = songNow();
    flash[lane] = performance.now();
    haptic('tick');
    // Nächste offene Note dieser Bahn (Fenster um die kalibrierte Zeit)
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (judged[i] || n.lane !== lane) continue;
      const d = now - (n.t + bias);
      if (d > BAND.GOOD_MS + 30) continue;
      if (d < -BAND.EARLY_MS) break;
      if (Math.abs(d) < Math.abs(bestD)) (best = i), (bestD = d);
    }
    if (best < 0) return;
    if (Math.abs(bestD) <= BAND.GOOD_MS) {
      learn(now - notes[best].t);
      judge(best, Math.abs(bestD) <= BAND.PERFECT_MS ? 2 : 1, lane);
      if (notes[best].len) holds.set(lane, { i: best, pointer });
    } else if (bestD < 0) judge(best, 0, lane, true); // zu früh: Note ist verbraucht (Dauertippen lohnt nicht)
  };

  const endHold = (lane: number, ok: boolean) => {
    const h = holds.get(lane);
    if (!h) return;
    holds.delete(lane);
    judged[h.i] = 2;
    if (ok) {
      score += 1;
      feedback('GEHALTEN!', '#ffd25e', lane);
    } else feedback('LOSGELASSEN', '#ff8a7a', lane);
    send('hold', { i: h.i, ok });
  };

  const release = (pointer: string) => {
    const now = songNow();
    for (const [lane, h] of [...holds]) {
      if (h.pointer !== pointer) continue;
      const n = notes[h.i];
      endHold(lane, now >= n.t + bias + n.len! - BAND.HOLD_TOL_MS);
    }
  };

  // ---------------------------------------------------------------- Eingabe: Knöpfe, Bahnen im Bild, Tastatur

  /** Finger festhalten, damit das Loslassen (Halte-Noten) auch neben dem Knopf ankommt */
  const capture = (target: Element, id: number) => {
    try {
      target.setPointerCapture(id);
    } catch {
      /* kein aktiver Zeiger (z. B. synthetische Events) – egal */
    }
  };

  btns.forEach((b, lane) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('down');
      tap(lane, `p${e.pointerId}`);
      capture(b, e.pointerId);
    });
    const up = (e: PointerEvent) => {
      b.classList.remove('down');
      release(`p${e.pointerId}`);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const lane = Math.max(0, Math.min(lanes - 1, Math.floor(((e.clientX - r.left) / r.width) * lanes)));
    tap(lane, `p${e.pointerId}`);
    capture(canvas, e.pointerId);
  });
  const canvasUp = (e: PointerEvent) => release(`p${e.pointerId}`);
  canvas.addEventListener('pointerup', canvasUp);
  canvas.addEventListener('pointercancel', canvasUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const KEYS: Record<number, string[][]> = {
    1: [[' ', 'j', 'f', 'ArrowDown']],
    2: [['f', 'ArrowLeft', '1'], ['j', 'ArrowRight', '2']],
    3: [['f', 'ArrowLeft', '1'], ['j', 'ArrowDown', '2'], ['k', 'ArrowRight', '3']],
  };
  const laneOfKey = (k: string) => KEYS[lanes].findIndex((ks) => ks.includes(k.length === 1 ? k.toLowerCase() : k));
  const onKey = (e: KeyboardEvent) => {
    if (!canvas.isConnected) return cleanup();
    const lane = laneOfKey(e.key);
    if (lane < 0) return;
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) tap(lane, `k${lane}`);
    if (e.type === 'keyup') release(`k${lane}`);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const cleanup = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('resize', fit);
  };

  // ---------------------------------------------------------------- Zeichnen

  const laneColor = (l: number) => (lanes === 1 ? ONE_LANE : LANE_COLORS[l]);
  const laneDark = (l: number) => (lanes === 1 ? ONE_DARK : LANE_DARK[l]);

  const frame = () => {
    if (!canvas.isConnected) return cleanup();
    const now = songNow();
    // Verpasste Noten und fertig gehaltene Halte-Noten
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - now > 4000) break;
      if (judged[i] === 0 && now - (n.t + bias) > BAND.GOOD_MS + 30) judge(i, 0, n.lane);
    }
    for (const [lane, h] of [...holds]) {
      const n = notes[h.i];
      if (now >= n.t + bias + n.len!) endHold(lane, true);
    }

    const laneW = W / lanes;
    const hitY = H - 34;
    const topY = 6;
    const yOf = (t: number) => hitY - ((t - now) / BAND.FALL_MS) * (hitY - topY);
    g.fillStyle = '#1d2440';
    g.fillRect(0, 0, W, H);
    for (let l = 0; l < lanes; l++) {
      g.fillStyle = l % 2 ? '#222b4c' : '#1f2746';
      g.fillRect(l * laneW, 0, laneW, H);
      const fl = Math.max(0, 1 - (performance.now() - flash[l]) / 160);
      if (fl > 0) {
        g.fillStyle = `rgba(255,255,255,${0.12 * fl})`;
        g.fillRect(l * laneW, 0, laneW, H);
      }
    }
    // Taktlinien (jeder Schlag dezent, jeder Takt heller)
    const firstBeat = Math.floor((now - 300) / beatMs);
    for (let b = firstBeat; b < firstBeat + Math.ceil(BAND.FALL_MS / beatMs) + 2; b++) {
      const y = yOf(b * beatMs);
      if (y < 0 || y > hitY) continue;
      g.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      g.fillRect(0, Math.round(y), W, b % 4 === 0 ? 2 : 1);
    }
    // Trefferlinie mit Pads
    g.fillStyle = '#f7e4b5';
    g.fillRect(0, hitY - 1, W, 3);
    for (let l = 0; l < lanes; l++) {
      const cx = l * laneW + laneW / 2;
      const held = [...holds.keys()].includes(l);
      g.strokeStyle = held ? '#fff6dc' : laneColor(l);
      g.lineWidth = 3;
      g.strokeRect(Math.round(cx - laneW * 0.36), hitY - 10, Math.round(laneW * 0.72), 20);
    }
    // Noten (Halte-Noten mit Schweif)
    const nw = Math.min(64, laneW * 0.66);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - now > BAND.FALL_MS + 200) break;
      const active = judged[i] === 1;
      if (judged[i] === 2) continue;
      const cx = n.lane * laneW + laneW / 2;
      const y = active ? hitY : yOf(n.t);
      if (n.len) {
        const yEnd = yOf(n.t + n.len);
        if (yEnd < H) {
          g.fillStyle = laneDark(n.lane);
          g.fillRect(Math.round(cx - 7), Math.round(Math.max(topY, yEnd)), 14, Math.round(y - Math.max(topY, yEnd)));
          g.fillStyle = active ? '#fff6dc' : laneColor(n.lane);
          g.fillRect(Math.round(cx - 4), Math.round(Math.max(topY, yEnd)), 8, Math.round(y - Math.max(topY, yEnd)));
        }
      }
      if (y < -20 || y > H + 20) continue;
      g.fillStyle = '#2d1b12';
      g.fillRect(Math.round(cx - nw / 2 - 2), Math.round(y - 9), Math.round(nw + 4), 18);
      g.fillStyle = active ? '#fff6dc' : laneColor(n.lane);
      g.fillRect(Math.round(cx - nw / 2), Math.round(y - 7), Math.round(nw), 14);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(Math.round(cx - nw / 2), Math.round(y - 7), Math.round(nw), 3);
    }
    // Einzähler
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (now < 0) {
      const left = Math.ceil(-now / beatMs);
      g.fillStyle = '#fff4d6';
      g.font = '32px "Press Start 2P", monospace';
      if (left <= BAND.COUNT_IN) g.fillText(String(left), W / 2, H * 0.4);
      g.font = '8px "Press Start 2P", monospace';
      g.fillText(left <= BAND.COUNT_IN ? 'Die Band zählt ein …' : 'Gleich geht’s los!', W / 2, H * 0.4 + 34);
    }
    // Rückmeldung
    const age = performance.now() - fb.at;
    if (age < 650) {
      g.globalAlpha = Math.max(0, 1 - age / 650);
      g.fillStyle = fb.color;
      g.font = '10px "Press Start 2P", monospace';
      const fx = lanes === 1 ? W / 2 : Math.max(48, Math.min(W - 48, fb.lane * laneW + laneW / 2));
      g.fillText(fb.text, fx, hitY - 28 - age / 40);
      g.globalAlpha = 1;
    }
    comboEl.textContent = combo >= 3 ? `x${combo}` : '';
    pctEl.textContent = max ? `${Math.round((score / max) * 100)}%` : '';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return null;
}

// ------------------------------------------------------------------ Stil (eigenes <style>, damit style.css unberührt bleibt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.bd-song { font-size: 9px; line-height: 1.6; margin: 0; }
.bd-hint { font-size: 8px; line-height: 1.6; margin: 0; }
.bd-insts { display: flex; flex-direction: column; gap: 7px; }
.bd-i { display: grid; grid-template-columns: 32px 1fr auto; grid-template-areas: "ic n st" "ic d c"; align-items: center; column-gap: 8px; row-gap: 2px; text-align: left; padding: 7px 10px; }
.bd-i.on { background: #fff1b0; border-color: var(--gold); box-shadow: inset 0 -3px 0 #e8c25a, 0 3px 0 var(--wood-darker); }
.bd-i.full { opacity: 0.45; }
.bd-ic { grid-area: ic; font-size: 22px; text-align: center; }
.bd-n { grid-area: n; font-size: 11px; }
.bd-st { grid-area: st; font-size: 10px; color: var(--red); white-space: nowrap; }
.bd-st small { font-size: 7px; color: var(--ink-soft); }
.bd-d { grid-area: d; font-size: 7px; color: var(--ink-soft); line-height: 1.5; }
.bd-c { grid-area: c; font-size: 8px; color: var(--ink-soft); text-align: right; }
.bd-ok { font-size: 14px; padding: 16px 8px; background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.bd-mine { font-size: 13px; }
.bd-band { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.bd-band span { font-size: 8px; padding: 5px 6px; background: var(--paper-light); border: 2px solid var(--wood-dark); color: var(--ink-soft); }
.bd-band span.ok { color: var(--ink); border-color: var(--green); }
.bd-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 10px; margin-bottom: -6px; }
.bd-combo { color: var(--red); }
.bd-pct { color: var(--ink-soft); min-width: 4ch; text-align: right; }
.bd-stage { flex: 1; min-height: 220px; position: relative; border: 3px solid var(--wood-darker); background: #1d2440; }
.bd-stage canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; touch-action: none; image-rendering: pixelated; }
.bd-btns { display: grid; gap: 8px; }
.bd-btns.n1 { grid-template-columns: 1fr; }
.bd-btns.n2 { grid-template-columns: 1fr 1fr; }
.bd-btns.n3 { grid-template-columns: 1fr 1fr 1fr; }
.bd-lane { min-height: 15vh; font-size: 11px; padding: 8px 2px; touch-action: none; }
.bd-btns.n3 .bd-lane { font-size: 9px; }
.bd-lane.l0 { background: #e46e98; box-shadow: inset 0 3px 0 #f59ab9, inset 0 -5px 0 #b0306a, 0 3px 0 var(--outline); }
.bd-lane.l1 { background: #f0b13a; box-shadow: inset 0 3px 0 #ffd27a, inset 0 -5px 0 #c08316, 0 3px 0 var(--outline); }
.bd-lane.l2 { background: #4fb3e8; box-shadow: inset 0 3px 0 #8fd2f5, inset 0 -5px 0 #2d7fb8, 0 3px 0 var(--outline); }
.bd-btns.n1 .bd-lane { background: #7cc04a; box-shadow: inset 0 3px 0 #a6dd7a, inset 0 -5px 0 #4a8a2c, 0 3px 0 var(--outline); }
.bd-lane.down { transform: translateY(2px); filter: brightness(1.15); }
`;
