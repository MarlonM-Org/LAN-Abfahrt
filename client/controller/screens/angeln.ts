import type { AngelnState, AngelPlayer, AngelLost } from '../../../shared/angeln';
import { ANGELN, FISH, fmtKg, zoneName } from '../../../shared/angeln';
import { type Screen, app, el, message, q, send, store, toast } from '../core';
import { type MotionSample, enableMotion, motionSupport, onMotion } from '../motion';
import { type SwipePoint, swingToThrow, swipeToThrow } from '../bowlingThrow';
import { steerFromRoll, tiltRoll } from '../tilt';
import { kick, pluck, unlockAudio } from '../audio';
import { catchSprite } from '../../art/angeln';

/**
 * Angeln am Handy: Auswerfen (Schwung oder Wischen) → Biss abwarten → Anschlagen (Ruck nach oben oder Tippen)
 * → Drill (halten = kurbeln, Spannung im Grünen halten, gegen den Zug kippen).
 */

type Mode = 'motion' | 'touch';

/** Bleibt über mehrere Würfe erhalten (die Sensor-Erlaubnis gilt bis zum Neuladen) */
let mode: Mode | null = null;

const angeln = () => (store.state?.mini?.kind === 'angeln' ? store.state.mini.state : null);
const mine = () => angeln()?.players[store.playerId!];
const vib = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* iOS kann nicht vibrieren */
  }
};

function motionPossible() {
  const s = motionSupport();
  return s === 'ok' || s === 'needs-permission';
}

function clock(s: AngelnState) {
  const secs = Math.ceil(s.endsIn / 1000);
  if (s.sub === 'intro') return `Start in ${secs}s`;
  if (s.sub === 'last') return 'Zeit um!';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export function pickAngeln(s: AngelnState): Screen {
  const me = s.players[store.playerId!];
  if (!me) return ['spectate', message('Du schaust zu', 'Angeln läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['an-over', message('Petri Heil!', `Du hast ${me.score} Punkte geangelt. Schau auf den Fernseher!`)];
  if (!mode) {
    if (!motionPossible()) mode = 'touch';
    else return ['an-ask', buildAsk];
  }
  if (s.sub === 'intro') return ['an-intro', buildIntro];
  if (s.sub === 'last' && (me.st === 'idle' || me.st === 'cast' || me.st === 'wait')) return ['an-last', message('Zeit um!', 'Die letzten Drills laufen noch – schau auf den Fernseher!')];
  switch (me.st) {
    case 'idle':
      return [`an-cast-${me.castSeq}-${mode}`, () => buildCast(me.castSeq)];
    case 'cast':
    case 'wait':
    case 'bite':
      return [`an-wait-${me.castSeq}`, () => buildWait(me.castSeq)];
    case 'reel':
      return [`an-reel-${me.castSeq}`, () => buildReel(me.castSeq)];
    case 'caught':
    case 'lost':
      return [`an-res-${me.castSeq}-${me.st}`, () => buildResult(me)];
  }
  return ['an-wait', message('Moment …')];
}

// ------------------------------------------------------------------ Sensor-Abfrage

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
    <h2>Angeln</h2>
    <p>Mit Bewegungssensor wirfst du mit echtem Schwung aus, reißt die Rute beim Biss hoch und kippst das Handy gegen den Zug des Fischs.</p>
    <button class="bw-enable an-motion">Bewegungssensor<br/>aktivieren</button>
    <button class="secondary an-touch">Lieber wischen &amp; tippen</button>
  `);
  let busy = false;
  gestureButton(q(root, '.an-motion'), async () => {
    if (busy) return;
    busy = true;
    unlockAudio();
    const ok = await enableMotion();
    if (!ok) toast('Kein Zugriff auf den Sensor – dann wischen & tippen!');
    mode = ok ? 'motion' : 'touch';
    busy = false;
  });
  gestureButton(q(root, '.an-touch'), () => {
    unlockAudio();
    mode = 'touch';
  });
  app.append(root);
  return null;
}

function buildIntro() {
  const root = el(`
    <div class="top-row"><span class="an-clock"></span><span>Angeln</span></div>
    <h2>Gleich geht’s los!</h2>
    <ol class="an-steps">
      <li><b>Auswerfen:</b> ${mode === 'motion' ? 'Knopf halten, Handy nach vorn schwingen, loslassen' : 'Köder nach oben wischen'} – je kräftiger, desto weiter. Weit draußen ist es tief: größere Fische!</li>
      <li><b>Biss:</b> Die Pose taucht ab, das Handy brummt bzw. piept – sofort ${mode === 'motion' ? 'Handy ruckartig hochreißen oder ' : ''}<b>ANSCHLAGEN</b> tippen. Zu früh verscheucht ihn!</li>
      <li><b>Drill:</b> Halten = kurbeln. Die Spannung muss im <span class="an-green">grünen</span> Bereich bleiben – zu fest reißt die Schnur, zu locker ist er weg.</li>
    </ol>
  `);
  app.append(root);
  return () => {
    const s = angeln();
    if (s) q(root, '.an-clock').textContent = clock(s);
  };
}

// ------------------------------------------------------------------ Auswerfen

function header(root: HTMLElement) {
  const s = angeln();
  const p = mine();
  if (!s || !p) return;
  q(root, '.an-clock').textContent = clock(s);
  q(root, '.an-score').textContent = `${p.score} P. · ${p.count} ${p.count === 1 ? 'Fang' : 'Fänge'}`;
}

function buildCast(seq: number) {
  const root = el(`
    <div class="top-row"><span class="an-clock"></span><span class="an-score"></span></div>
    <h2>Auswerfen!</h2>
    <div class="an-cast"></div>
  `);
  app.append(root);
  const area = q(root, '.an-cast');
  let done = false;
  let unsub: (() => void) | null = null;
  const stop = () => {
    unsub?.();
    unsub = null;
  };
  const cast = (power: number, aim: number) => {
    if (done) return;
    const s = angeln();
    if (!s || s.sub !== 'play') return toast('Noch nicht – gleich geht’s los!');
    done = true;
    stop();
    send('cast', { seq, power: Math.round(power * 100) / 100, aim: Math.round(aim * 100) / 100 });
    vib(30);
    const ac = unlockAudio();
    if (ac) pluck(392);
    area.innerHTML = `<div class="center"><h2>Wusch!</h2><p>Weite ${Math.round(power * 100)} %</p></div>`;
  };

  const showMotion = () => {
    stop();
    area.innerHTML = '';
    const box = el(`
      <p class="bw-hint an-hint">Knopf halten, Handy wie eine Rute nach vorn schwingen und loslassen. Schwung = Weite.</p>
      <button class="big-btn bw-swing an-swing">HALTEN &amp;<br/>SCHWINGEN</button>
      <button class="secondary small an-switch">Lieber wischen</button>
    `);
    area.append(box);
    const btn = q(box, '.an-swing');
    const hint = q(box, '.an-hint');
    let samples: MotionSample[] = [];
    let recording = false;
    let gotSample = false;
    unsub = onMotion((m) => {
      if (!root.isConnected) return stop();
      if (m.ax || m.ay || m.az || m.rotAlpha || m.rotBeta || m.rotGamma) gotSample = true;
      if (recording) samples.push({ ...m });
    });
    window.setTimeout(() => {
      if (root.isConnected && !gotSample && !done && area.contains(btn)) {
        toast('Keine Sensordaten – wisch stattdessen!');
        mode = 'touch';
        showTouch();
      }
    }, 1500);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (done) return;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      unlockAudio();
      samples = [];
      recording = true;
      btn.classList.add('holding');
      btn.innerHTML = 'SCHWINGEN …<br/><small>und loslassen!</small>';
      vib(15);
    });
    const release = () => {
      if (!recording) return;
      recording = false;
      btn.classList.remove('holding');
      btn.innerHTML = 'HALTEN &amp;<br/>SCHWINGEN';
      const r = swingToThrow(samples);
      if (r.ok) cast(r.t.speed, r.t.angle);
      else hint.textContent = r.reason.replace('nach vorn', 'wie eine Angel nach vorn');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    q(box, '.an-switch').addEventListener('click', () => {
      mode = 'touch';
      showTouch();
    });
  };

  const showTouch = () => {
    stop();
    area.innerHTML = '';
    const box = el(`
      <div class="swipe-pad an-pad">
        <p class="pad-text">Köder nach OBEN wischen!<br/>Schnell = weit = tief</p>
        <div class="an-lure"></div>
      </div>
      ${motionPossible() ? '<button class="secondary small an-switch">Mit Schwung (Sensor)</button>' : ''}
      ${motionSupport() === 'insecure' ? '<p class="bw-hint">Schwung-Steuerung geht nur über HTTPS – hier wird gewischt.</p>' : ''}
    `);
    area.append(box);
    const pad = q(box, '.an-pad');
    const lure = q(box, '.an-lure');
    const text = q(box, '.pad-text');
    let pts: SwipePoint[] = [];
    let pid: number | null = null;
    let origin = { x: 0, y: 0 };
    pad.addEventListener('pointerdown', (e) => {
      if (done) return;
      e.preventDefault();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      unlockAudio();
      pid = e.pointerId;
      pts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      const r = pad.getBoundingClientRect();
      origin = { x: r.left, y: r.top };
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      lure.style.left = `${e.clientX - origin.x}px`;
      lure.style.top = `${e.clientY - origin.y}px`;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      lure.style.left = '';
      lure.style.top = '';
      const r = swipeToThrow(pts, pad.clientHeight);
      if (r.ok) cast(r.t.speed, r.t.angle);
      else text.textContent = r.reason;
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    box.querySelector('.an-switch')?.addEventListener('click', async () => {
      const ok = motionSupport() === 'ok' ? true : await enableMotion();
      if (!ok) return toast('Kein Zugriff auf den Bewegungssensor.');
      mode = 'motion';
      showMotion();
    });
  };

  if (mode === 'motion') showMotion();
  else showTouch();
  header(root);
  return () => {
    header(root);
    if (!root.isConnected) stop();
  };
}

// ------------------------------------------------------------------ Warten & Anschlagen

function buildWait(seq: number) {
  const root = el(`
    <div class="top-row"><span class="an-clock"></span><span class="an-score"></span></div>
    <p class="an-depth"></p>
    <h2 class="an-head">Warte auf einen Biss …</h2>
    <button class="big-btn an-strike">ANSCHLAGEN</button>
    <p class="hint an-hint">${mode === 'motion' ? 'Biss? Handy ruckartig hochreißen oder tippen!' : 'Biss? Sofort tippen!'} Zu früh verscheucht den Fisch.</p>
    <button class="secondary small an-in">Einholen &amp; neu auswerfen</button>
  `);
  app.append(root);
  const btn = q(root, '.an-strike');
  const head = q(root, '.an-head');
  let struck = false;
  let nibbles = mine()?.nibbles ?? 0;
  let st = mine()?.st;
  const strike = () => {
    if (struck) return;
    const p = mine();
    if (!p || p.castSeq !== seq || (p.st !== 'wait' && p.st !== 'bite' && p.st !== 'cast')) return;
    if (p.st === 'cast') return;
    struck = true;
    send('strike', { seq });
    vib(40);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    strike();
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  q(root, '.an-in').addEventListener('click', () => send('reelIn', { seq }));

  // Anschlagen per Ruck: nur während eines Bisses (kein versehentliches Zu-früh)
  let unsub: (() => void) | null = null;
  if (mode === 'motion') {
    unsub = onMotion((m) => {
      if (!root.isConnected) return unsub?.();
      if (mine()?.st !== 'bite') return;
      const jerk = Math.max(Math.abs(m.rotBeta), Math.abs(m.rotGamma) * 0.6);
      const acc = Math.abs(Math.hypot(m.ax, m.ay, m.az) - 9.81);
      if (jerk > 200 || acc > 9) strike();
    });
  }

  const update = () => {
    header(root);
    const p = mine();
    if (!p) return;
    if (!root.isConnected) unsub?.();
    q(root, '.an-depth').textContent = p.st === 'cast' ? 'Wusch …' : `Tiefe: ${zoneName(p.depth)} · Weite ${Math.round(p.depth * 100)} %`;
    if (p.nibbles > nibbles && p.st === 'wait') {
      vib(25);
      const ac = unlockAudio();
      if (ac) pluck(330);
      head.textContent = 'Da zupft was …';
      btn.classList.add('nibble');
      window.setTimeout(() => {
        btn.classList.remove('nibble');
        if (mine()?.st === 'wait') head.textContent = 'Warte auf einen Biss …';
      }, 500);
    }
    nibbles = p.nibbles;
    if (p.st === 'bite' && st !== 'bite') {
      vib([180, 60, 180, 60, 180]);
      const ac = unlockAudio();
      if (ac) {
        kick(ac.currentTime);
        pluck(880);
        window.setTimeout(() => pluck(1046.5), 90);
      }
    }
    st = p.st;
    const bite = p.st === 'bite';
    btn.classList.toggle('bite', bite);
    btn.textContent = bite ? 'JETZT!' : 'ANSCHLAGEN';
    if (bite) head.textContent = 'BISS!';
  };
  update();
  return update;
}

// ------------------------------------------------------------------ Drill

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((Number(a) % 360) + 360) % 360;
}

const SIZE_TEXT = ['Fühlt sich leicht an …', 'Ein kleiner Zappler!', 'Der zieht ordentlich!', 'EIN RIESE!'];

function buildReel(seq: number) {
  const root = el(`
    <div class="top-row"><span class="an-clock"></span><span class="an-score"></span></div>
    <h2 class="an-head">Drill!</h2>
    <div class="an-tension">
      <div class="an-zone" style="left:${ANGELN.GREEN_LO * 100}%;width:${(ANGELN.GREEN_HI - ANGELN.GREEN_LO) * 100}%"></div>
      <div class="an-needle"></div>
      <span class="an-lbl l">locker</span><span class="an-lbl r">reißt!</span>
    </div>
    <div class="an-pull"><span class="an-arrow"></span></div>
    <div class="an-dist"><div></div></div>
    <div class="big-btn an-reel"><b>HALTEN</b><small>= kurbeln</small></div>
    ${mode === 'motion' ? '<p class="hint">Zieht der Fisch zur Seite? Handy in die andere Richtung kippen!</p>' : ''}
  `);
  app.append(root);
  const pad = q(root, '.an-reel');
  const needle = q(root, '.an-needle');
  const tensionEl = q(root, '.an-tension');
  const arrow = q(root, '.an-arrow');
  const dist = q<HTMLElement>(root, '.an-dist > div');
  const head = q(root, '.an-head');

  const pointers = new Set<number>();
  let hold = false;
  let tilt = 0;
  let sentTilt = 0;
  const push = () => send('reel', { seq, hold, tilt: Math.round(tilt * 100) / 100 });
  const setHold = (v: boolean) => {
    if (v === hold) return;
    hold = v;
    pad.classList.toggle('held', v);
    push();
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    pointers.add(e.pointerId);
    setHold(true);
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) setHold(false);
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  // Kippen gegen den Zug (Mitte = Haltung beim Anschlagen)
  let unsub: (() => void) | null = null;
  if (mode === 'motion') {
    let center: number | null = null;
    unsub = onMotion((m) => {
      if (!root.isConnected) return unsub?.();
      const roll = tiltRoll(m.beta, m.gamma, screenAngle());
      if (center === null) center = roll;
      tilt = steerFromRoll(roll, center, 25, 4);
    });
  }
  const iv = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(iv);
      unsub?.();
      return;
    }
    if (Math.abs(tilt - sentTilt) > 0.08) {
      sentTilt = tilt;
      push();
    }
  }, 120);

  let lastBuzz = 0;
  const update = () => {
    header(root);
    const p = mine();
    if (!p || p.st !== 'reel') return;
    needle.style.left = `${p.tension * 100}%`;
    const high = p.tension > ANGELN.GREEN_HI;
    const low = p.tension < ANGELN.GREEN_LO;
    tensionEl.classList.toggle('high', high);
    tensionEl.classList.toggle('low', low);
    dist.style.width = `${Math.round((1 - p.prog) * 100)}%`;
    const now = performance.now();
    if (high && now - lastBuzz > 260) {
      lastBuzz = now;
      vib(40);
    }
    if (p.pull) {
      const counter = mode === 'motion' ? (p.pull > 0 ? ' – kipp nach LINKS!' : ' – kipp nach RECHTS!') : '';
      arrow.textContent = p.pull < 0 ? `◀ zieht nach links${counter}` : `zieht nach rechts ▶${counter}`;
      arrow.className = 'an-arrow on';
    } else {
      arrow.textContent = SIZE_TEXT[p.size] ?? '';
      arrow.className = 'an-arrow';
    }
    head.textContent = high ? 'Zu fest! Loslassen!' : p.slack > 300 ? 'Zu locker! Kurbeln!' : 'Drill!';
  };
  update();
  return update;
}

// ------------------------------------------------------------------ Ergebnis

const LOST_INFO: Record<Exclude<AngelLost, null>, [string, string]> = {
  early: ['Zu früh!', 'Du hast angeschlagen, bevor er richtig gebissen hat – der Fisch ist weg.'],
  late: ['Zu spät!', 'Der Fisch hat den Köder geklaut. Beim nächsten Brummen schneller anschlagen!'],
  snap: ['Schnur gerissen!', 'Zu fest gekurbelt. Wenn der Balken rot wird: loslassen!'],
  slack: ['Entwischt!', 'Die Schnur war zu locker – öfter halten!'],
  time: ['Feierabend!', 'Die Zeit ist um.'],
};

function buildResult(p: AngelPlayer) {
  if (p.st === 'caught' && p.last) {
    const c = p.last;
    const f = FISH[c.kind];
    const root = el(`
      <div class="center an-catch ${f.rare ? 'rare' : ''}">
        <h2>${f.junk ? 'Na toll …' : f.rare ? 'WAHNSINN!' : 'Gefangen!'}</h2>
        <div class="an-fish"></div>
        <p class="an-fishname">${f.name}</p>
        <p>${fmtKg(c.kg)} · <b>+${c.pts} Punkte</b></p>
      </div>
    `);
    const pix = catchSprite(c.kind);
    const cv = pix.canvas;
    cv.style.width = `${pix.w * 5}px`;
    cv.style.height = `${pix.h * 5}px`;
    q(root, '.an-fish').append(cv);
    app.append(root);
    vib(f.rare ? [60, 40, 60, 40, 200] : [60, 40, 60]);
    const ac = unlockAudio();
    if (ac) [523.25, 659.25, 783.99].forEach((fq, i) => window.setTimeout(() => pluck(fq), i * 90));
    return null;
  }
  const [title, sub] = LOST_INFO[p.lost ?? 'slack'];
  if (p.lost === 'snap') vib([120, 50, 120]);
  return message(title, sub)();
}
