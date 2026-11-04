import type { BowlingState } from '../../../shared/types';
import { scoreFrames } from '../../../shared/bowling';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, toast } from '../core';
import { type MotionSample, enableMotion, motionSupport, onMotion } from '../motion';
import { type BowlThrow, type SwipePoint, swingToThrow, swipeToThrow } from '../bowlingThrow';

const PREF_KEY = 'lanabfahrt.bowlMode';
type Mode = 'motion' | 'touch' | 'ask';

const bowling = () => (store.state?.mini?.kind === 'bowling' ? store.state.mini.state : null);

export function pickBowling(s: BowlingState): Screen {
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    return ['bw-intro', message('Strand-Bowling!', `${s.frames} Frames pro Person. Reihum werfen – am Handy schwingen oder wischen. Strike = alle 10 Pins!`)];
  }
  if (s.sub === 'over') return ['bw-over', () => buildWatch(true)];
  if (s.sub === 'aim' && s.turn === id) return [`bw-aim-${s.aimSeq}`, () => buildAim(s)];
  return ['bw-watch', () => buildWatch(false)];
}

// ------------------------------------------------------------------ Werfen

function initialMode(): Mode {
  const pref = localStorage.getItem(PREF_KEY);
  const sup = motionSupport();
  if (sup === 'insecure' || sup === 'unsupported' || pref === 'touch') return 'touch';
  if (pref === 'motion' && sup === 'ok') return 'motion';
  return 'ask';
}

function buildAim(s: BowlingState) {
  const seq = s.aimSeq;
  const pinsLeft = s.rack.filter(Boolean).length;
  const root = el(`
    <h2>Du bist dran!</h2>
    <div class="top-row"><span>Frame ${s.frame + 1}/${s.frames} · Wurf ${s.ball + 1}</span><span class="bw-pins">${pinsLeft} Pins</span></div>
    <div class="bw-startbox">
      <p class="label-left">Startposition</p>
      <div class="bw-start">
        <button class="small secondary bw-left">◀</button>
        <div class="bw-strip"><div class="bw-gutter l"></div><div class="bw-gutter r"></div><div class="bw-marker"></div></div>
        <button class="small secondary bw-right">▶</button>
      </div>
    </div>
    <div class="bw-area"></div>
  `);
  app.append(root);
  const area = q(root, '.bw-area');
  const strip = q(root, '.bw-strip');
  const marker = q(root, '.bw-marker');

  // --- Startposition
  let start = 0;
  let lastSent = 0;
  let sendTimer: number | undefined;
  const setStart = (v: number) => {
    start = Math.max(-1, Math.min(1, Math.round(v * 20) / 20));
    marker.style.left = `${50 + start * 38}%`;
    const now = performance.now();
    clearTimeout(sendTimer);
    if (now - lastSent > 90) {
      lastSent = now;
      send('aim', { start });
    } else sendTimer = window.setTimeout(() => send('aim', { start }), 100);
  };
  marker.style.left = '50%';
  q(root, '.bw-left').addEventListener('click', () => setStart(start - 0.1));
  q(root, '.bw-right').addEventListener('click', () => setStart(start + 0.1));
  const fromPointer = (e: PointerEvent) => {
    const r = strip.getBoundingClientRect();
    setStart(((e.clientX - r.left) / r.width - 0.5) / 0.38);
  };
  strip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  strip.addEventListener('pointermove', (e) => strip.hasPointerCapture(e.pointerId) && fromPointer(e));

  // --- Wurf abschicken (genau einmal)
  let thrown = false;
  const doThrow = (t: BowlThrow) => {
    if (thrown) return;
    thrown = true;
    navigator.vibrate?.(40);
    send('throw', { seq, start, ...t });
    q(root, '.bw-startbox').classList.add('hidden');
    area.innerHTML = '';
    area.append(el(`<div class="center"><h2>Wurf!</h2><p>Tempo ${Math.round(t.speed * 100)}%${t.spin ? ` · Effet ${t.spin > 0 ? 'rechts' : 'links'}` : ''}</p><p>Schau auf den Fernseher!</p></div>`));
  };

  // --- Steuerungs-Varianten
  let unsub: (() => void) | null = null;
  const stopMotion = () => {
    unsub?.();
    unsub = null;
  };
  const show = (mode: Mode) => {
    stopMotion();
    area.innerHTML = '';
    if (mode === 'ask') showAsk();
    else if (mode === 'motion') showMotion();
    else showTouch();
  };

  const showAsk = () => {
    const box = el(`
      <div class="bw-ask">
        <p>Wirf wie beim echten Bowling: Handy in die Hand, Knopf halten, Arm nach vorn schwingen, am Ende loslassen.</p>
        <button class="bw-enable">Bewegungssensor aktivieren</button>
        <button class="secondary small bw-touch">Lieber wischen</button>
      </div>
    `);
    q(box, '.bw-enable').addEventListener('click', async () => {
      const ok = await enableMotion();
      if (!ok) {
        toast('Kein Zugriff auf den Bewegungssensor – dann wischen!');
        localStorage.setItem(PREF_KEY, 'touch');
        return show('touch');
      }
      localStorage.setItem(PREF_KEY, 'motion');
      show('motion');
    });
    q(box, '.bw-touch').addEventListener('click', () => {
      localStorage.setItem(PREF_KEY, 'touch');
      show('touch');
    });
    area.append(box);
  };

  const showMotion = () => {
    const box = el(`
      <p class="bw-hint">Halten, Arm nach vorn schwingen, am Ende loslassen. Handgelenk drehen = Effet.</p>
      <button class="big-btn bw-swing">HALTEN &amp;<br/>SCHWINGEN</button>
      <button class="secondary small bw-switch">Lieber wischen</button>
    `);
    area.append(box);
    const btn = q<HTMLButtonElement>(box, '.bw-swing');
    const hint = q(box, '.bw-hint');
    let samples: MotionSample[] = [];
    let recording = false;
    let gotSample = false;
    unsub = onMotion((m) => {
      if (!root.isConnected) return stopMotion();
      if (m.t > 0 && (m.ax || m.ay || m.az || m.rotAlpha || m.rotBeta || m.rotGamma)) gotSample = true;
      if (recording) samples.push({ ...m });
    });
    // Kommen gar keine Sensordaten (z. B. Laptop), auf Wischen umschalten
    window.setTimeout(() => {
      if (root.isConnected && !gotSample && !thrown && area.contains(btn)) {
        toast('Kein Bewegungssensor gefunden – wisch stattdessen!');
        show('touch');
      }
    }, 1500);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (thrown) return;
      btn.setPointerCapture(e.pointerId);
      samples = [];
      recording = true;
      btn.classList.add('holding');
      btn.innerHTML = 'SCHWINGEN …<br/><small>und loslassen!</small>';
      navigator.vibrate?.(15);
    });
    const release = () => {
      if (!recording) return;
      recording = false;
      btn.classList.remove('holding');
      btn.innerHTML = 'HALTEN &amp;<br/>SCHWINGEN';
      const r = swingToThrow(samples);
      if (r.ok) doThrow(r.t);
      else hint.textContent = r.reason;
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    q(box, '.bw-switch').addEventListener('click', () => {
      localStorage.setItem(PREF_KEY, 'touch');
      show('touch');
    });
  };

  const showTouch = () => {
    const sup = motionSupport();
    const box = el(`
      <div class="swipe-pad bw-pad">
        <p class="pad-text">Kugel nach oben wischen!<br/>Schnell = hart · schräg = Richtung · im Bogen = Effet</p>
        <div class="bw-ball"></div>
      </div>
      ${sup === 'ok' || sup === 'needs-permission' ? '<button class="secondary small bw-switch">Mit Schwung werfen (Sensor)</button>' : ''}
      ${sup === 'insecure' ? '<p class="bw-hint">Schwung-Steuerung geht nur über HTTPS – hier wird gewischt.</p>' : ''}
    `);
    area.append(box);
    const pad = q(box, '.bw-pad');
    const ball = q(box, '.bw-ball');
    const text = q(box, '.pad-text');
    let pts: SwipePoint[] = [];
    let pid: number | null = null;
    let origin = { x: 0, y: 0 };
    pad.addEventListener('pointerdown', (e) => {
      if (thrown) return;
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      pts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      const r = pad.getBoundingClientRect();
      origin = { x: r.left, y: r.top };
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      ball.style.left = `${e.clientX - origin.x}px`;
      ball.style.top = `${e.clientY - origin.y}px`;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      ball.style.left = '';
      ball.style.top = '';
      const r = swipeToThrow(pts, pad.clientHeight);
      if (r.ok) doThrow(r.t);
      else text.textContent = r.reason;
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    box.querySelector('.bw-switch')?.addEventListener('click', async () => {
      const ok = motionSupport() === 'ok' ? true : await enableMotion();
      if (!ok) return toast('Kein Zugriff auf den Bewegungssensor.');
      localStorage.setItem(PREF_KEY, 'motion');
      show('motion');
    });
  };

  show(initialMode());

  return () => {
    const st = bowling();
    if (!st) return;
    if (st.sub !== 'aim' || st.aimSeq !== seq) stopMotion();
  };
}

// ------------------------------------------------------------------ Zuschauen

const MARK_TEXT: Record<string, string> = { strike: 'STRIKE!', spare: 'SPARE!', gutter: 'Rinne …', miss: 'Daneben!' };

function nextPlayer(s: BowlingState): string | null {
  const i = s.order.indexOf(s.turn);
  for (let k = 1; k <= s.order.length; k++) {
    const id = s.order[(i + k) % s.order.length];
    const rolls = s.rolls[id] ?? [];
    if (scoreFrames(rolls, s.frames).frames[s.frames - 1].total === null) return id;
  }
  return null;
}

function buildWatch(over: boolean) {
  const root = el(`
    <div class="center bw-watch">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <div class="panel bw-board"></div>
  `);
  app.append(root);
  const board = q(root, '.bw-board');
  let boardKey = '';
  return () => {
    const s = bowling();
    if (!s) return;
    const id = store.playerId!;
    const last = s.last;
    let head = '';
    let sub = '';
    if (over) {
      const totals = s.order.map((p) => scoreFrames(s.rolls[p], s.frames).total);
      const best = Math.max(...totals);
      const mine = scoreFrames(s.rolls[id], s.frames).total;
      head = mine === best ? 'Du hast gewonnen!' : 'Spiel vorbei!';
      sub = `Du hast ${mine} Pins.`;
    } else if (s.sub === 'roll' && last) {
      head = last.playerId === id ? 'Deine Kugel rollt …' : `${nameOf(last.playerId)} wirft …`;
      sub = 'Schau auf den Fernseher!';
    } else {
      const mineNext = s.turn !== id && nextPlayer(s) === id;
      head = mineNext ? 'Gleich bist du dran!' : `${nameOf(s.turn)} ist dran`;
      const lines = [];
      if (mineNext) lines.push(`Erst noch ${nameOf(s.turn)}.`);
      if (last) lines.push(`Zuletzt ${nameOf(last.playerId)}: ${MARK_TEXT[last.mark] ?? `${last.knocked} Pins`}`);
      sub = lines.join('\n');
    }
    q(root, '.headline').textContent = head;
    q(root, '.sub').textContent = sub;

    // Während die Kugel rollt, das Ergebnis noch nicht verraten (der TV zeigt es gleich)
    const rolls = { ...s.rolls };
    if (s.sub === 'roll' && last) rolls[last.playerId] = rolls[last.playerId].slice(0, -1);
    const key = JSON.stringify([rolls, s.turn]);
    if (key === boardKey) return;
    boardKey = key;
    const rows = s.order
      .map((p) => ({ p, sc: scoreFrames(rolls[p], s.frames) }))
      .sort((a, b) => b.sc.total - a.sc.total);
    board.innerHTML = rows
      .map(({ p, sc }) => {
        const marks = sc.frames.map((f) => `<span class="bw-f">${f.marks.join('') || '·'}</span>`).join('');
        return `<div class="bw-row ${p === id ? 'me' : ''} ${p === s.turn && !over ? 'turn' : ''}"><span class="bw-name">${escapeHtml(nameOf(p).replace(/^Bot\s+/, ''))}</span><span class="bw-fs">${marks}</span><b>${sc.total}</b></div>`;
      })
      .join('');
  };
}
