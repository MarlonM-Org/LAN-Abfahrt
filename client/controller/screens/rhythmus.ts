import {
  RH, type RhythmState, feinAbgleich, markAt, rhBeatMs, rhSong, rhythmusNoten, tippWerten, verpassteNoten,
} from '../../../shared/rhythmus';
import { type Screen, app, el, message, nameOf, q, send, socket, store } from '../core';
import { toLocalPerf, toServerMs } from '../../timesync';

/**
 * Das erste Gespräch am Handy: Soundcheck (im Takt zum Klick vom TV tippen → Ton-Versatz), dann vier Tasten
 * à la Klavier-Kacheln. Die Spur rechnet das Handy selbst aus (`rhythmusNoten`), die Songzeit kommt aus der
 * synchronisierten Uhr minus dem Ton-Versatz des TVs – dann erreicht die Note die Linie, wenn der Ton aus dem
 * Fernseher kommt. Jeder Tipp geht mit seiner Songzeit an den Server, der mit derselben Funktion wertet; das Handy
 * zeigt die Wertung sofort selbst an und übernimmt danach die des Servers.
 *
 * Kein Ton am Handy (der käme mit der Lautsprecher-Verzögerung des Handys und klänge neben dem TV wie daneben) –
 * Rückmeldung per Vibration und Bild.
 */

const st = () => (store.state?.mini?.kind === 'rhythm' ? store.state.mini.state : null);
const LANE_COLORS = ['#e46e98', '#f0b13a', '#4fb3e8', '#7cc04a'];
const LANE_DARK = ['#b0306a', '#c08316', '#2d7fb8', '#4a8a2c'];
/** Zeitpunkt der Berührung selbst (nicht erst, wenn der Handler drankommt) */
const when = (e: Event) => (Math.abs(e.timeStamp - performance.now()) < 500 ? e.timeStamp : performance.now());
const buzz = (ms: number) => navigator.vibrate?.(ms);

export function pickRhythm(s: RhythmState, vip: boolean): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  if (s.sub === 'ready') return me.ready ? [`rh-wait-${s.kalAt}-${vip}`, () => buildWait(vip)] : [`rh-kal-${s.kalAt}-${vip}`, () => buildKal(vip)];
  if (s.sub === 'play') return [`rh-play-${s.playSeq}`, () => buildPlay(s)];
  return ['rh-over', message('Gespräch vorbei', 'Schau auf den Fernseher!')];
}

// ------------------------------------------------------------------ Soundcheck

function versatzText(s: RhythmState) {
  if (s.versatzQuelle === 'keiner') return 'TV noch nicht eingemessen';
  return `TV-Versatz ${s.versatz} ms${s.versatzQuelle === 'gespeichert' ? ' (gespeichert)' : ''}`;
}

function buildKal(vip: boolean) {
  const root = el(`
    <div class="rh-top"><span>💬 Soundcheck</span><span class="rh-v"></span></div>
    <p class="rh-info">Hör auf den <b>Klick vom Fernseher</b> (oder schau auf den Blitz dort) und tippe im Takt mit – mindestens ${RH.KAL_MIN}-mal. So weiß das Spiel, wie spät der Ton am TV ankommt.</p>
    <button class="rh-pad">TIPP</button>
    <p class="rh-stat">&nbsp;</p>
    <button class="rh-ok">Bereit!</button>
    <button class="secondary rh-ohne">Ohne Einmessen weiter</button>
    ${vip ? '<button class="secondary small rh-neu">Für alle neu einmessen</button>' : ''}
  `);
  const pad = q<HTMLButtonElement>(root, '.rh-pad');
  const ok = q<HTMLButtonElement>(root, '.rh-ok');
  const ohne = q<HTMLButtonElement>(root, '.rh-ohne');
  const stat = q(root, '.rh-stat');
  const tipp = (at: number) => {
    send('kal', { at: Math.round(toServerMs(at)) });
    buzz(8);
    pad.classList.add('on');
    window.setTimeout(() => pad.classList.remove('on'), 90);
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tipp(when(e));
  });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  const onKey = (e: KeyboardEvent) => {
    if (!pad.isConnected) return window.removeEventListener('keydown', onKey);
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      tipp(when(e));
    }
  };
  window.addEventListener('keydown', onKey);
  ok.addEventListener('click', () => !ok.disabled && send('ready'));
  ohne.addEventListener('click', () => send('ready'));
  root.querySelector('.rh-neu')?.addEventListener('click', () => socket.emit('vip:mini', 'kalibrieren'));
  app.append(root);
  return () => {
    const s = st();
    const me = s?.players[store.playerId!];
    if (!s || !me) return;
    q(root, '.rh-v').textContent = versatzText(s);
    const k = me.kal;
    if (k.stabil && k.wert !== null) stat.textContent = `Dein Takt: ${k.wert} ms ✓`;
    else if (k.n >= RH.KAL_MIN) stat.textContent = `Noch ungleichmäßig (±${Math.round(k.streu / 2)} ms) – weiter im Takt tippen`;
    else if (k.n) stat.textContent = `${k.n} / ${RH.KAL_MIN} Tipps …`;
    else stat.textContent = s.pflicht ? 'Bitte neu einmessen: im Takt tippen.' : s.versatzQuelle === 'keiner' ? 'Noch keine Tipps.' : 'Tippen misst neu – oder gleich „Bereit!“';
    const can = k.stabil || (s.versatzQuelle !== 'keiner' && !s.pflicht);
    ok.disabled = !can;
    ohne.style.display = can ? 'none' : '';
  };
}

function buildWait(vip: boolean) {
  const root = el(`
    <div class="center">
      <h2>Bereit!</h2>
      <p class="rh-v"></p>
      <p class="rh-wait"></p>
    </div>
    ${vip ? '<button class="secondary small rh-neu">Für alle neu einmessen</button>' : ''}
  `);
  root.querySelector('.rh-neu')?.addEventListener('click', () => socket.emit('vip:mini', 'kalibrieren'));
  app.append(root);
  return () => {
    const s = st();
    if (!s) return;
    q(root, '.rh-v').textContent = versatzText(s);
    const missing = s.order.filter((id) => !s.players[id].ready).map((id) => nameOf(id));
    q(root, '.rh-wait').textContent = missing.length ? `Warte auf ${missing.join(', ')} …` : 'Gleich geht’s los!';
  };
}

// ------------------------------------------------------------------ Spielen

function buildPlay(s: RhythmState) {
  const id = store.playerId!;
  const song = rhSong();
  const chart = rhythmusNoten(s.order, id, s.wettkampf, song);
  const lanes = RH.LANES;
  const beat = rhBeatMs(song);
  const startAt = s.startAt;
  const V = s.versatz;
  /** Songzeit, wie sie am TV zu hören ist: synchronisierte Uhr − Ton-Versatz des TVs */
  const songNow = (perf = performance.now()) => perf - toLocalPerf(startAt) - V;
  /** Eigene Wertung (sofort), danach die des Servers: 0 offen, 1 daneben, 2 gut, 3 perfekt */
  const local = new Uint8Array(chart.length);
  let lastSrv = '';
  // Fein-Abgleich (nur das Bewertungsfenster): Start = eigene Soundcheck-Messung relativ zum Raum-Versatz
  const me0 = s.players[id];
  const start0 = me0?.kal.stabil && me0.kal.wert !== null ? me0.kal.wert - V : 0;
  const abw: number[] = [];
  let bias = feinAbgleich(abw, start0);

  const root = el(`
    <div class="rh-top"><span class="rh-talk"></span><span class="rh-combo"></span><span class="rh-pct"></span></div>
    <div class="rh-stage"><canvas></canvas></div>
    <div class="rh-keys">${Array.from({ length: lanes }, (_, l) => `<button class="rh-key rh-k${l}" data-l="${l}" aria-label="Taste ${l + 1}"></button>`).join('')}</div>
  `);
  const stage = q(root, '.rh-stage');
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const talk = q(root, '.rh-talk');
  const comboEl = q(root, '.rh-combo');
  const pctEl = q(root, '.rh-pct');
  const keys = [...root.querySelectorAll<HTMLButtonElement>('.rh-key')];
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

  // ---------------------------------------------------------------- Wertung

  let combo = 0;
  const flash = new Float64Array(lanes);
  const burst = new Float64Array(lanes).fill(-1e9);
  let fb = { text: '', color: '#fff', at: -1e9, lane: 0 };
  const feedback = (text: string, color: string, lane: number) => (fb = { text, color, at: performance.now(), lane });
  const show = (mark: number, lane: number, early = false) => {
    if (mark === 3) feedback('PERFEKT!', '#c98a10', lane);
    else if (mark === 2) feedback('GUT', '#2f7d32', lane);
    else feedback(early ? 'ZU FRÜH' : 'DANEBEN', '#a8342a', lane);
  };

  const tap = (lane: number, at: number) => {
    const raw = songNow(at);
    flash[lane] = performance.now();
    buzz(6);
    const t = raw - bias;
    const r = tippWerten(chart, local, lane, t);
    // Abweichung für den Fein-Abgleich: die getroffene Note – sonst die nächste nicht getroffene dieser Taste
    let dev: number | null = r ? raw - chart[r.i].t : null;
    if (!r) {
      for (let i = 0; i < chart.length; i++) {
        const n = chart[i];
        if (n.lane !== lane || local[i] >= 2) continue;
        const d = raw - n.t;
        if (d < -250) break;
        if (d <= 250 && (dev === null || Math.abs(d) < Math.abs(dev))) dev = d;
      }
    }
    if (dev !== null) {
      abw.push(dev);
      if (abw.length > 20) abw.shift();
      bias = feinAbgleich(abw, start0);
    }
    if (r) {
      local[r.i] = r.mark;
      combo = r.mark > 1 ? combo + 1 : 0;
      show(r.mark, lane, r.mark === 1);
      if (r.mark > 1) burst[lane] = performance.now();
    } else {
      combo = 0;
      feedback('DANEBEN', '#a8342a', lane);
    }
    send('tipp', { l: lane, t: Math.round(t * 10) / 10 });
  };

  // ---------------------------------------------------------------- Eingabe: Tasten, Bahnen im Bild, Tastatur

  keys.forEach((b, lane) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('down');
      tap(lane, when(e));
    });
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    tap(Math.max(0, Math.min(lanes - 1, Math.floor(((e.clientX - r.left) / r.width) * lanes))), when(e));
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const KEYS = [['d', '1', 'ArrowLeft'], ['f', '2', 'ArrowDown'], ['j', '3', 'ArrowUp'], ['k', '4', 'ArrowRight']];
  const onKey = (e: KeyboardEvent) => {
    if (!canvas.isConnected) return cleanup();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const lane = KEYS.findIndex((ks) => ks.includes(k));
    if (lane < 0) return;
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) {
      keys[lane]?.classList.add('down');
      tap(lane, when(e));
    } else if (e.type === 'keyup') keys[lane]?.classList.remove('down');
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const cleanup = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('resize', fit);
  };

  // ---------------------------------------------------------------- Zeichnen

  const frame = () => {
    if (!canvas.isConnected) return cleanup();
    const cur = st();
    const now = songNow();
    // Wertung des Servers übernehmen (er hat das letzte Wort)
    const srv = cur?.players[id]?.marks ?? '';
    if (srv !== lastSrv) {
      lastSrv = srv;
      for (let i = 0; i < chart.length; i++) {
        const m = markAt(srv, i);
        if (m && local[i] !== m) local[i] = m;
      }
    }
    // Selbst verpasste Noten (Anzeige sofort, der Server zählt mit etwas Puffer)
    for (const i of verpassteNoten(chart, local, now - bias, 20)) {
      local[i] = 1;
      if (now - chart[i].t < 1000) {
        combo = 0;
        show(1, chart[i].lane);
      }
    }

    const laneW = W / lanes;
    const hitY = H - 28;
    const yOf = (t: number) => hitY - ((t - now) / RH.FALL_MS) * hitY;
    // Bahnen (Pergament, wie Klaviertasten)
    for (let l = 0; l < lanes; l++) {
      g.fillStyle = l % 2 ? '#f3e4bf' : '#fbf1d8';
      g.fillRect(l * laneW, 0, laneW, H);
      const fl = Math.max(0, 1 - (performance.now() - flash[l]) / 140);
      if (fl > 0) {
        g.fillStyle = `rgba(255,255,255,${0.55 * fl})`;
        g.fillRect(l * laneW, 0, laneW, H);
      }
      g.fillStyle = '#c9a66b';
      if (l) g.fillRect(Math.round(l * laneW) - 1, 0, 2, H);
    }
    // Taktlinien (jeder Schlag dezent, jeder Takt kräftiger)
    const first = Math.floor((now - 300) / beat);
    for (let b = first; b < first + Math.ceil(RH.FALL_MS / beat) + 2; b++) {
      const y = yOf(b * beat);
      if (y < 0 || y > hitY) continue;
      g.fillStyle = b % 4 === 0 ? 'rgba(61,36,20,0.22)' : 'rgba(61,36,20,0.08)';
      g.fillRect(0, Math.round(y), W, b % 4 === 0 ? 2 : 1);
    }
    // Trefferlinie mit Feldern
    g.fillStyle = '#5e3518';
    g.fillRect(0, hitY - 1, W, 3);
    for (let l = 0; l < lanes; l++) {
      const x = l * laneW;
      const age = performance.now() - burst[l];
      g.strokeStyle = LANE_COLORS[l];
      g.lineWidth = 3;
      g.strokeRect(Math.round(x + 4), hitY - 12, Math.round(laneW - 8), 24);
      if (age < 200) {
        g.fillStyle = LANE_COLORS[l];
        g.globalAlpha = 1 - age / 200;
        const grow = (age / 200) * 8;
        g.fillRect(Math.round(x + 4 - grow), hitY - 12 - grow, Math.round(laneW - 8 + grow * 2), 24 + grow * 2);
        g.globalAlpha = 1;
      }
    }
    // Kacheln
    const tw = Math.max(16, laneW - 10);
    const th = Math.min(30, Math.max(16, H / 14));
    for (let i = 0; i < chart.length; i++) {
      const n = chart[i];
      if (n.t - now > RH.FALL_MS + 200) break;
      const m = local[i];
      if (m >= 2) continue;
      const y = yOf(n.t);
      if (y < -th || y > H + th) continue;
      const x = n.lane * laneW + (laneW - tw) / 2;
      g.fillStyle = m === 1 ? '#9a8f86' : '#2d1b12';
      g.fillRect(Math.round(x), Math.round(y - th / 2), Math.round(tw), Math.round(th));
      g.fillStyle = m === 1 ? '#bdb3aa' : LANE_COLORS[n.lane];
      g.fillRect(Math.round(x + 2), Math.round(y - th / 2 + 2), Math.round(tw - 4), 4);
      g.fillStyle = m === 1 ? '#8a8078' : LANE_DARK[n.lane];
      g.fillRect(Math.round(x + 2), Math.round(y + th / 2 - 4), Math.round(tw - 4), 2);
    }
    // Einzähler (passend zu den Klicks vom TV)
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (now < 0) {
      const left = Math.ceil(-now / beat);
      g.fillStyle = '#3d2414';
      g.font = '32px "Press Start 2P", monospace';
      if (left <= RH.COUNT_IN) g.fillText(String(left), W / 2, H * 0.4);
      g.font = '8px "Press Start 2P", monospace';
      g.fillText(left <= RH.COUNT_IN ? 'Im Takt bleiben …' : 'Gleich geht’s los!', W / 2, H * 0.4 + 34);
    }
    // Rückmeldung
    const age = performance.now() - fb.at;
    if (age < 650) {
      g.globalAlpha = Math.max(0, 1 - age / 650);
      g.fillStyle = fb.color;
      g.font = '10px "Press Start 2P", monospace';
      const fx = Math.max(44, Math.min(W - 44, fb.lane * laneW + laneW / 2));
      g.fillText(fb.text, fx, hitY - 30 - age / 40);
      g.globalAlpha = 1;
    }
    // Kopfzeile: Gespräch / Serie / Trefferquote (vom Server)
    if (cur) {
      const ph = cur.phrases.find((p) => now >= p.from && now < p.to);
      if (cur.wettkampf) talk.textContent = now < 0 ? 'Gleich geht’s los …' : '💬 Wer trifft am besten?';
      else if (now < 0) talk.textContent = 'Gleich geht’s los …';
      else if (ph) talk.textContent = ph.speaker === id ? `Du redest: „${ph.topic}“` : `${nameOf(ph.speaker)} redet – nick mit!`;
      else talk.textContent = '';
      const p = cur.players[id];
      const judged = p ? p.perfect + p.good + p.miss : 0;
      pctEl.textContent = judged ? `${Math.round(((p!.perfect + p!.good) / judged) * 100)}%` : '';
    }
    comboEl.textContent = combo >= 3 ? `x${combo}` : '';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return null;
}

