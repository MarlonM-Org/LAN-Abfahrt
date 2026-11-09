import { SEKT, type SektPlayer, type SektState, fmtM, throwText } from '../../../shared/sekt';
import { type Screen, app, el, q, send, store, toast } from '../core';
import { type MotionSample, enableMotion, motionSupport, onMotion, swingAcc, swingRot } from '../motion';
import { haptic } from '../haptic';
import { kick, pluck, unlockAudio } from '../audio';
import { onInputReset } from '../stick';

/**
 * Sektkorken am Handy (hochkant): großer Korken-Halteknopf, Druckanzeige mit wandernder roter Zone,
 * Schüttel-Rückmeldung (kommt das Schütteln an?) und Haptik. Ohne Sensor: Finger auf das Etikett und reiben.
 * Das Handy schickt nur Halten/Loslassen und alle 100 ms die Schüttel-Stärke – den Druck rechnet der Server.
 */

type Mode = 'motion' | 'touch';

/** Bleibt über Durchgänge und Spiele erhalten (die Sensor-Erlaubnis gilt bis zum Neuladen) */
let mode: Mode | null = null;

/** Reiben: so viele px/s Fingerweg gelten als volle Schüttelstärke */
const RUB_FULL = 1600;
/** Sensor: Beschleunigung (m/s², ohne Schwerkraft) bzw. Drehrate (°/s) für volle Stärke */
const ACC_FULL = 14;
const ROT_FULL = 700;
const SEND_MS = 100;

const cur = () => (store.state?.mini?.kind === 'sekt' ? store.state.mini.state : null);
const mine = (): SektPlayer | undefined => cur()?.players[store.playerId!];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rerender = () => window.dispatchEvent(new Event('kart-rerender'));

function motionPossible() {
  const s = motionSupport();
  return s === 'ok' || s === 'needs-permission';
}

/** Schüttelstärke eines Sensor-Messwerts (0 … ~1,5) */
function shakeLevel(m: MotionSample) {
  return clamp(Math.max((swingAcc(m) - 2) / ACC_FULL, (swingRot(m) - 80) / ROT_FULL), 0, 1.5);
}

export function pickSekt(s: SektState): Screen {
  ensureStyle();
  const me = s.players[store.playerId!];
  if (!me) return ['spectate', () => buildInfo('Du schaust zu', 'Sektkorken läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['sk-over', () => buildOver(s)];
  if (!mode) {
    if (!motionPossible()) mode = 'touch';
    else return ['sk-ask', buildAsk];
  }
  if (s.sub === 'intro') return [`sk-intro-${mode}`, () => buildIntro(mode!)];
  if (s.sub === 'show') return [`sk-show-${s.round}`, () => buildShow(s.round)];
  return [`sk-play-${s.round}-${mode}`, () => buildPlay(s.round, mode!)];
}

function buildInfo(title: string, sub: string) {
  app.append(el(`<div class="sk"><div class="center"><h2>${title}</h2><p>${sub}</p></div></div>`));
  return null;
}

// ------------------------------------------------------------------ Sensor oder Reiben?

/** Knopf, der auf iOS sicher als Nutzergeste zählt (touchend), am Rechner per Klick */
function gestureButton(btn: HTMLElement, fn: () => void) {
  let touched = false;
  btn.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const r = btn.getBoundingClientRect();
    if (t && (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom)) return;
    e.preventDefault();
    touched = true;
    fn();
  });
  btn.addEventListener('click', () => {
    if (touched) return void (touched = false);
    fn();
  });
}

function buildAsk() {
  const root = el(`
    <div class="sk sk-askbox">
      <h2>🍾 Sektkorken</h2>
      <p>Mit Bewegungssensor schüttelst du das Handy wie eine echte Sektflasche – dein Daumen hält dabei den Korken fest.</p>
      <button class="bw-enable sk-motion">Bewegungssensor<br/>aktivieren</button>
      <button class="secondary sk-touch">Lieber reiben (ohne Sensor)</button>
    </div>
  `);
  let busy = false;
  gestureButton(q(root, '.sk-motion'), async () => {
    if (busy) return;
    busy = true;
    unlockAudio();
    const ok = await enableMotion();
    if (!ok) toast('Kein Zugriff auf den Sensor – dann wird gerieben!');
    mode = ok ? 'motion' : 'touch';
    busy = false;
    haptic('tap');
    rerender();
  });
  gestureButton(q(root, '.sk-touch'), () => {
    unlockAudio();
    mode = 'touch';
    haptic('tap');
    rerender();
  });
  app.append(root);
  return null;
}

/** Schüttel-Messung (Sensor oder Reiben) – liefert alle 100 ms die Stärke; fällt ohne Sensordaten auf Reiben zurück */
function shakeSource(root: HTMLElement, m: Mode, pad: HTMLElement | null, onLevel: (lvl: number) => void) {
  let acc = 0;
  let n = 0;
  let path = 0;
  let got = false;
  let unsub: (() => void) | null = null;
  if (m === 'motion') {
    unsub = onMotion((x) => {
      if (!root.isConnected) return unsub?.();
      if (x.ax || x.ay || x.az || x.rotAlpha || x.rotBeta || x.rotGamma) got = true;
      acc += shakeLevel(x);
      n += 1;
    });
    window.setTimeout(() => {
      if (root.isConnected && !got && mode === 'motion') {
        toast('Keine Sensordaten – reib stattdessen!');
        mode = 'touch';
        rerender();
      }
    }, 1500);
  } else if (pad) {
    // Reiben: Fingerweg des ersten Fingers
    let pid: number | null = null;
    let lx = 0;
    let ly = 0;
    pad.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      path += Math.hypot(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === pid) pid = null;
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  }
  const iv = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(iv);
      unsub?.();
      return;
    }
    let lvl = 0;
    if (m === 'motion') lvl = n ? acc / n : 0;
    else lvl = path / (SEND_MS / 1000) / RUB_FULL;
    acc = 0;
    n = 0;
    path = 0;
    onLevel(clamp(lvl, 0, SEKT.S_MAX));
  }, SEND_MS);
}

// ------------------------------------------------------------------ Intro

function buildIntro(m: Mode) {
  const root = el(`
    <div class="sk sk-introbox">
      <h2>Gleich wird geschüttelt!</h2>
      <ol class="sk-steps">
        <li><b>${m === 'motion' ? 'Daumen auf den Korken' : 'Finger aufs Etikett'}</b> – halten, solange du willst.</li>
        <li><b>${m === 'motion' ? 'Schütteln' : 'Schnell reiben'}</b> = Druck. Er sinkt langsam wieder.</li>
        <li><b>Loslassen = PLOPP!</b> Mehr Druck = weiter. Zu lange im <span class="sk-r">Roten</span> = PENG, 0 m.</li>
      </ol>
      ${m === 'motion' ? '<div class="sk-test"><span>Test: schüttel mal!</span><div class="sk-meter"><i></i></div></div>' : ''}
      <p class="sk-hint">${SEKT.ROUNDS} Durchgänge – der beste Wurf zählt.</p>
    </div>
  `);
  app.append(root);
  const bar = root.querySelector<HTMLElement>('.sk-meter i');
  let show = 0;
  if (bar) {
    shakeSource(root, m, null, (lvl) => {
      show = Math.max(lvl, show * 0.75);
      bar.style.width = `${Math.round(clamp(show / 1.2, 0, 1) * 100)}%`;
    });
  }
  return null;
}

// ------------------------------------------------------------------ Durchgang

function buildPlay(round: number, m: Mode) {
  const root = el(`
    <div class="sk sk-${m}">
      <div class="sk-top"><span>Durchgang ${round}/${SEKT.ROUNDS}</span><span class="sk-best"></span><span class="sk-time"></span></div>
      <div class="sk-call"></div>
      <div class="sk-mid">
        <div class="sk-gauge"><i class="sk-red"></i><i class="sk-fill"></i><i class="sk-edge"></i><b class="sk-pct"></b></div>
        <div class="sk-info">
          <div class="sk-bot">🍾</div>
          <div class="sk-sense"><span class="sk-lbl">${m === 'motion' ? 'Schütteln' : 'Reiben'}</span><div class="sk-meter"><i></i></div></div>
          <p class="sk-ok"></p>
        </div>
      </div>
      <div class="sk-pad">
        ${m === 'motion' ? '<div class="sk-cork"></div><b>DAUMEN DRAUF</b><small>halten &amp; schütteln<br/>loslassen = PLOPP!</small>' : '<b>FINGER DRAUF</b><small>und schnell hoch &amp; runter reiben<br/>loslassen = PLOPP!</small>'}
      </div>
      ${m === 'motion' ? '<button class="secondary small sk-switch">Lieber reiben</button>' : motionPossible() ? '<button class="secondary small sk-switch">Mit Bewegungssensor</button>' : ''}
    </div>
  `);
  app.append(root);
  const box = q(root, '.sk');
  const pad = q(root, '.sk-pad');
  const call = q(root, '.sk-call');
  const red = q(root, '.sk-red');
  const fill = q(root, '.sk-fill');
  const edge = q(root, '.sk-edge');
  const pct = q(root, '.sk-pct');
  const meter = q(root, '.sk-meter i');
  const bot = q(root, '.sk-bot');
  const ok = q(root, '.sk-ok');
  const best = q(root, '.sk-best');
  const time = q(root, '.sk-time');
  const padB = q(pad, 'b');
  const switchBtn = root.querySelector<HTMLElement>('.sk-switch');

  // ---- Halten / Loslassen
  const pointers = new Set<number>();
  let held = false;
  const setHeld = (v: boolean) => {
    if (v === held) return;
    const p = mine();
    // Schon geknallt/geplatzt: nichts mehr senden
    if (v && p && p.st !== 'wait' && p.st !== 'in') return;
    held = v;
    pad.classList.toggle('held', v);
    send('cork', { down: v });
    if (v) haptic('tap');
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* synthetische Events ohne echten Zeiger */
    }
    pointers.add(e.pointerId);
    setHeld(true);
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) setHeld(false);
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('lostpointercapture', up);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  // Handy gedreht, Overlay, App im Hintergrund: der Daumen ist weg → zählt wie Loslassen
  onInputReset(pad, () => {
    pointers.clear();
    setHeld(false);
  });
  root.querySelector('.sk-switch')?.addEventListener('click', async () => {
    if (held) return;
    if (m === 'motion') mode = 'touch';
    else {
      const okay = motionSupport() === 'ok' ? true : await enableMotion();
      if (!okay) return toast('Kein Zugriff auf den Bewegungssensor.');
      mode = 'motion';
    }
    rerender();
  });

  // ---- Schütteln messen und senden
  let level = 0;
  let sentZero = true;
  shakeSource(root, m, pad, (lvl) => {
    level = Math.max(lvl, level * 0.7);
    meter.style.width = `${Math.round(clamp(level / 1.2, 0, 1) * 100)}%`;
    bot.style.transform = `rotate(${Math.round(Math.sin(performance.now() / 45) * level * 22)}deg)`;
    const p = mine();
    if (!held || p?.st !== 'in') return;
    if (lvl > 0.02 || !sentZero) send('shake', { s: Math.round(lvl * 100) / 100 });
    sentZero = lvl <= 0.02;
  });

  // ---- Anzeige
  let lastSt = mine()?.st;
  let lastStep = 0;
  let lastBuzz = 0;
  let wasDanger = false;
  let lastSub = cur()?.sub;
  const update = () => {
    const s = cur();
    const p = mine();
    if (!s || !p || s.round !== round) return;
    const sec = Math.max(0, Math.ceil((store.endsAt - performance.now()) / 1000));
    time.textContent = s.sub === 'countdown' || s.sub === 'shake' ? `⏱${sec}` : '';
    best.textContent = p.best > 0 ? `Best ${fmtM(p.best)}` : '';
    const live = p.st === 'in';
    const pv = p.st === 'wait' ? 0 : p.p;
    red.style.height = `${Math.round((1 - s.red) * 1000) / 10}%`;
    edge.style.bottom = `calc(${Math.round(s.red * 1000) / 10}% - 1px)`;
    fill.style.height = `${Math.round(pv * 1000) / 10}%`;
    fill.className = `sk-fill ${p.st === 'burst' || (live && p.danger > 0) ? 'danger' : pv < 0.45 ? '' : pv < 0.7 ? 'mid' : 'high'}`;
    pct.textContent = pv > 0 ? `${Math.round(pv * 100)}%` : '';
    // Kommt das Schütteln an? (Echo vom Server)
    ok.textContent = live && s.sub === 'shake' ? (p.s > 0.05 ? '✓ kommt an!' : m === 'motion' ? 'schüttel kräftiger!' : 'reib schneller!') : m === 'motion' ? (level > 0.05 ? 'Sensor ✓' : '') : '';
    ok.classList.toggle('on', live && p.s > 0.05);

    // Ansage
    let text = '';
    let cls = '';
    if (p.st === 'pop') {
      const mm = p.throws[round - 1] ?? 0;
      text = `PLOPP! ${throwText(mm)}`;
      cls = 'win';
    } else if (p.st === 'burst') {
      text = 'PENG! Geplatzt – 0 m';
      cls = 'bad';
    } else if (p.st === 'fizzle') {
      text = 'Pfft … kein Druck';
      cls = 'bad';
    } else if (s.sub === 'countdown') {
      text = live ? `Gleich geht’s los … ${sec}` : m === 'motion' ? 'Daumen auf den Korken!' : 'Finger aufs Etikett!';
      cls = live ? 'go' : '';
    } else if (!live) {
      text = m === 'motion' ? 'Daumen drauf – sonst kein Druck!' : 'Finger drauf und reiben!';
    } else if (p.danger > 0) {
      text = 'ROT! LOSLASSEN!';
      cls = 'hot';
    } else if (p.p > s.red - 0.08) {
      text = 'Gleich rot … jetzt?';
      cls = 'warn';
    } else {
      text = m === 'motion' ? 'SCHÜTTELN!' : 'REIBEN!';
      cls = 'go';
    }
    if (call.textContent !== text) call.textContent = text;
    call.className = `sk-call ${cls}`;
    const done = p.st === 'pop' || p.st === 'burst' || p.st === 'fizzle';
    pad.classList.toggle('off', done);
    box.classList.toggle('done', done);
    const padText = done ? 'WARTE …' : live ? 'HALTEN …' : m === 'motion' ? 'DAUMEN DRAUF' : 'FINGER DRAUF';
    if (padB.textContent !== padText) padB.textContent = padText;
    switchBtn?.classList.toggle('gone', done || live);

    // Haptik: Startschuss, Druck-Ticks, Warnung im Roten, Knall
    const now = performance.now();
    if (s.sub === 'shake' && lastSub === 'countdown' && live) haptic('hit');
    lastSub = s.sub;
    const step = live ? Math.floor(p.p * 20) : 0;
    if (live && step > lastStep && s.sub === 'shake') haptic('tick');
    lastStep = step;
    const danger = live && p.danger > 0;
    if (danger && !wasDanger) haptic('bad');
    else if (danger && now - lastBuzz > 220) {
      lastBuzz = now;
      haptic('hit');
    }
    wasDanger = danger;
    if (p.st !== lastSt) {
      if (p.st === 'pop') {
        haptic('win');
        const ac = unlockAudio();
        if (ac) {
          kick(ac.currentTime);
          pluck(1046.5);
        }
      } else if (p.st === 'burst') {
        haptic('bad');
        box.classList.add('boom');
        window.setTimeout(() => box.classList.remove('boom'), 450);
      }
      lastSt = p.st;
    }
  };
  update();
  return update;
}

// ------------------------------------------------------------------ Zwischenstand / Ende

function rankOf(s: SektState, id: string) {
  const mineBest = s.players[id]?.best ?? 0;
  return 1 + Object.values(s.players).filter((p) => p.best > mineBest).length;
}

function buildShow(round: number) {
  const s = cur();
  const p = mine();
  if (!s || !p) return buildInfo('Moment …', '');
  const m = p.throws[round - 1] ?? 0;
  const n = Object.keys(s.players).length;
  const last = round >= s.rounds;
  const root = el(`
    <div class="sk">
      <div class="center sk-showbox">
        <h2>Durchgang ${round}/${s.rounds}</h2>
        <div class="sk-big ${m < 0 ? 'bad' : ''}">${m < 0 ? 'PENG!' : m > 0 ? fmtM(m) : '–'}</div>
        <p>${m < 0 ? 'Flasche geplatzt – 0 m.' : m > 0 ? 'So weit flog dein Korken.' : 'Kein Wurf in diesem Durchgang.'}</p>
        <p class="sk-standing">Bestweite: <b>${p.best > 0 ? fmtM(p.best) : '–'}</b> · Platz ${rankOf(s, store.playerId!)} von ${n}</p>
        <p class="sk-hint">${last ? 'Gleich kommt die Siegerehrung – schau auf den Fernseher!' : 'Schau auf den Fernseher – gleich geht’s weiter. Daumen bereit!'}</p>
      </div>
    </div>
  `);
  app.append(root);
  return null;
}

function buildOver(s: SektState) {
  const p = s.players[store.playerId!];
  const best = p?.best ?? 0;
  const rank = rankOf(s, store.playerId!);
  const root = el(`
    <div class="sk">
      <div class="center sk-showbox">
        <h2>${rank === 1 && best > 0 ? 'Prost, Champion! 🥂' : 'Prost! 🥂'}</h2>
        <div class="sk-big">${best > 0 ? fmtM(best) : '0 m'}</div>
        <p>Deine Bestweite · Platz ${rank} von ${Object.keys(s.players).length}</p>
        <p class="sk-hint">${(p?.throws ?? []).map((m, i) => `${i + 1}: ${throwText(m)}`).join(' · ')}</p>
      </div>
    </div>
  `);
  app.append(root);
  if (rank === 1 && best > 0) haptic('win');
  return null;
}

// ------------------------------------------------------------------ Styles

function ensureStyle() {
  if (document.getElementById('sk-style')) return;
  const st = document.createElement('style');
  st.id = 'sk-style';
  st.textContent = `
.sk { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; user-select: none; -webkit-user-select: none; }
.sk .center { margin: auto 0; display: flex; flex-direction: column; gap: 10px; }
.sk-askbox, .sk-introbox { justify-content: center; gap: 14px; }
.sk-steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 9px; line-height: 1.7; color: var(--ink); }
.sk-r { color: #c0392b; }
.sk-hint { font-size: 8px; }
.sk-test { display: flex; flex-direction: column; gap: 6px; font-size: 9px; color: var(--ink-soft); text-align: center; }
.sk-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 8px; color: var(--ink-soft); }
.sk-best { color: var(--ink); }
.sk-time { min-width: 34px; text-align: right; color: var(--red); }
.sk-call { min-height: 44px; display: flex; align-items: center; justify-content: center; padding: 4px 6px; text-align: center; font-size: 12px; line-height: 1.5; color: var(--ink); border: 3px solid transparent; }
.sk-call.go { color: #2f7d32; }
.sk-call.warn { color: #c06a1f; }
.sk-call.win { color: var(--red); font-size: 15px; }
.sk-call.bad { color: #fff4d6; background: #8a2a22; border-color: var(--outline); }
.sk-call.hot { color: #fff4d6; background: #d8473c; border-color: var(--outline); animation: sk-blink 0.24s steps(2) infinite; }
@keyframes sk-blink { 50% { background: #ff7a5a; } }
.sk-mid { display: flex; gap: 12px; align-items: stretch; height: 30vh; min-height: 140px; }
.sk-gauge { position: relative; width: 62px; flex: none; overflow: hidden; background: #4a3424; border: 3px solid var(--outline); box-shadow: inset 0 0 0 2px #6a4a34; }
.sk-red { position: absolute; left: 0; right: 0; top: 0; height: 12%; background: repeating-linear-gradient(-45deg, #c0392b 0 6px, #9f2c22 6px 12px); transition: height 90ms linear; }
.sk-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: #46b04a; box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.45); transition: height 80ms linear; }
.sk-fill.mid { background: #ffd25e; }
.sk-fill.high { background: #f0973a; }
.sk-fill.danger { background: #ff4030; animation: sk-flick 0.2s steps(2) infinite; }
@keyframes sk-flick { 50% { background: #fff4d6; } }
.sk-edge { position: absolute; left: 0; right: 0; height: 3px; background: #fff4d6; box-shadow: 0 0 0 1px var(--outline); transition: bottom 90ms linear; }
.sk-pct { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; font-size: 9px; font-weight: normal; color: #fff4d6; text-shadow: 1px 1px 0 var(--outline); }
.sk-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.sk-bot { font-size: 54px; line-height: 1; text-align: center; transition: transform 90ms linear; transform-origin: 50% 90%; }
.sk-sense { display: flex; flex-direction: column; gap: 4px; }
.sk-lbl { font-size: 8px; color: var(--ink-soft); }
.sk-meter { position: relative; height: 16px; background: var(--paper-dark); border: 3px solid var(--wood-darker); }
.sk-meter i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: linear-gradient(90deg, #7fd4ff, #2f74f0); transition: width 90ms linear; }
.sk-ok { min-height: 14px; font-size: 8px; color: var(--ink-soft); }
.sk-ok.on { color: #2f7d32; }
.sk-pad { flex: 1; min-height: 28vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 10px; text-align: center; touch-action: none; -webkit-touch-callout: none; cursor: pointer;
  color: #fff4d6; text-shadow: 1px 1px 0 var(--outline); border: 3px solid var(--outline);
  background: #c98a4a radial-gradient(circle at 20% 30%, #a96c34 0 2px, transparent 3px) 0 0 / 14px 14px;
  box-shadow: inset 0 5px 0 #e2ab6a, inset 0 -7px 0 #8d5629, 0 3px 0 var(--outline); }
.sk-pad b { font-size: 16px; font-weight: normal; }
.sk-pad small { font-size: 8px; line-height: 1.7; }
.sk-pad.held { background-color: #a5672f; box-shadow: inset 0 7px 0 #7a4a22, 0 1px 0 var(--outline); transform: translateY(2px); }
.sk-pad.off { filter: grayscale(0.8); opacity: 0.55; }
.sk-touch .sk-pad { color: var(--ink); text-shadow: none; background: #fbf3dc repeating-linear-gradient(0deg, transparent 0 18px, var(--me-color, #e8323a) 18px 30px, transparent 30px 48px);
  box-shadow: inset 0 4px 0 #fff, inset 0 -6px 0 #d9c79a, 0 3px 0 var(--outline); }
.sk-touch .sk-pad b, .sk-touch .sk-pad small { background: rgba(251, 243, 220, 0.9); padding: 2px 6px; }
.sk-touch .sk-pad.held { background-color: #efe2bd; }
.sk-cork { width: 86px; height: 62px; border: 3px solid var(--outline); border-radius: 46% 46% 14% 14% / 62% 62% 14% 14%;
  background: #d9a868 radial-gradient(circle at 30% 40%, #b07a40 0 2px, transparent 3px) 0 0 / 11px 11px; box-shadow: inset 0 5px 0 #f0cf98, inset 0 -6px 0 #b07a40; }
.sk-pad.held .sk-cork { transform: scale(0.94); }
.sk.done .sk-bot { opacity: 0.5; }
.sk.boom { animation: sk-boom 0.45s ease-out; }
@keyframes sk-boom { 0% { background: #ff7a5a; transform: translateX(-6px); } 25% { transform: translateX(6px); } 50% { transform: translateX(-3px); } 100% { background: transparent; transform: none; } }
.sk-switch { align-self: center; }
.sk-switch.gone { visibility: hidden; }
.sk-showbox { gap: 12px; }
.sk-big { text-align: center; font-size: 30px; line-height: 1.3; color: var(--red); }
.sk-big.bad { color: #c0392b; }
.sk-standing { color: var(--ink); }
`;
  document.head.append(st);
}
