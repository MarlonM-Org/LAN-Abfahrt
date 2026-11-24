import type { FlunkyState, Team } from '../../../shared/types';
import {
  FLUNKY,
  RUN_TAPS,
  TEAM_INFO,
  WIND_WORD,
  clamp,
  computeLanding,
  dist,
  flunkyDev,
  flunkyLevelFor,
  flunkyPowerWindow,
  fmtM,
  otherTeam,
  teamBeer,
  windLevel,
} from '../../../shared/flunky';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton, teamBadge } from '../core';
import type { ThrowResult } from '../bowlingThrow';
import { mountThrowInput } from '../throwInput';
import { motionSupport, onMotion, swingAcc } from '../motion';
import { FLUNKY_SCALE, type FlunkyThrowIn, type FlunkyThrowResult, flunkySwing, flunkySwipe } from '../flunkyThrow';
import {
  type Feedback,
  type FeedbackLine,
  type ThrowInfo,
  failFeedback,
  feedbackCard,
  forgetFeedback,
  lastFeedback,
  pct,
  rememberFeedback,
  timingLine,
  timingTip,
} from '../motionFeedback';
import { haptic } from '../haptic';

export function pickFlunky(f: FlunkyState): Screen {
  const id = store.playerId!;
  const team: Team | null = f.teams.A.includes(id) ? 'A' : f.teams.B.includes(id) ? 'B' : null;
  if (!team) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (f.throws.A + f.throws.B === 0 && !f.lastThrow) forgetFeedback('flunky');
  switch (f.sub) {
    case 'aim':
      return f.throwerId === id ? [`fk-aim-${f.turnTeam}-${f.throws[f.turnTeam]}`, () => buildAim(team)] : ['fk-watch', () => buildWatch(team)];
    case 'flight':
      return ['fk-watch', () => buildWatch(team)];
    case 'chug':
      if (team === f.turnTeam) {
        return (f.beer[id] ?? 0) > 0 ? ['fk-drink', () => buildDrink(team)] : ['fk-drunk', message('Ausgetrunken!', 'Feuer dein Team an!')];
      }
      if (f.runnerId === id) return ['fk-run', () => buildRun(team)];
      return ['fk-watch', () => buildWatch(team)];
    case 'reset':
      return ['fk-watch', () => buildWatch(team)];
    case 'over': {
      if (!f.winner) return ['fk-over', message('UNENTSCHIEDEN!', 'Beide Teams haben gleich viel getrunken.')];
      const won = f.winner === team;
      const why = f.reason === 'empty' ? 'Ihr habt zuerst ausgetrunken.' : 'Ihr habt mehr getrunken.';
      return ['fk-over', message(won ? 'GEWONNEN!' : 'VERLOREN!', won ? why : 'Revanche?')];
    }
  }
}

const flunky = () => (store.state?.mini?.kind === 'flunky' ? store.state.mini.state : null);

/** Wind in Worten, Richtung wie am TV (▲ = nach oben, ▼ = nach unten) */
function windText(w: number) {
  const n = windLevel(w);
  if (n === 0) return 'Wind: windstill';
  return `Wind: ${WIND_WORD[n]} – treibt den Ball am TV nach ${w < 0 ? 'OBEN' : 'UNTEN'}`;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const fmtDeg = (d: number) => `${Math.abs(d).toFixed(1).replace('.', ',')}°`;
const roundLabel = (f: FlunkyState) => (f.round > f.rounds ? 'Verlängerung' : `Runde ${f.round}/${f.rounds}`);

// ------------------------------------------------------------------ Zielen + Werfen

/** Zielpfeil fein drehen: ein Tipp = 0,5°, gehalten wird es schneller (bis 24°/s) */
const AIM_STEP = (0.5 * Math.PI) / 180;

function buildAim(team: Team) {
  const f0 = flunky()!;
  const spot = { ...f0.spot };
  const range = dist(spot, f0.bottle);
  const root = el(`
    <div class="fk-aim">
      ${teamBadge(team)}
      <div class="fk-head"><b>Du wirfst!</b><span>${roundLabel(f0)}</span></div>
      <p class="fk-info">Abstand zur Flasche: <b>${fmtM(range)}</b></p>
      <p class="fk-wind"></p>
      <div class="fk-aimrow">
        <button class="fk-turn fk-up" aria-label="Pfeil nach oben">▲</button>
        <div class="fk-dialbox"><canvas class="fk-dial"></canvas><span class="fk-aimtxt"></span></div>
        <button class="fk-turn fk-down" aria-label="Pfeil nach unten">▼</button>
      </div>
      <p class="fk-aimhint">1. Pfeil-Knöpfe: Pfeil am TV auf die Flasche drehen (Wind vorhalten!)<br/>2. Werfen – Schwung = Weite</p>
      <div class="bw-area fk-area"></div>
    </div>
  `);
  app.append(root);
  const area = q(root, '.fk-area');
  const card = feedbackCard(true);
  q(root, '.fk-aimhint').after(card.root);
  card.set(lastFeedback('flunky'));

  // ---- Zielen
  let aim = clamp(f0.aim, -FLUNKY.AIM_MAX, FLUNKY.AIM_MAX);
  let lastSent = aim;
  let sentAt = 0;
  let trail = 0;
  const canvas = q<HTMLCanvasElement>(root, '.fk-dial');
  const aimTxt = q(root, '.fk-aimtxt');
  const sendAim = (force = false) => {
    if (aim === lastSent) return;
    const now = performance.now();
    window.clearTimeout(trail);
    if (!force && now - sentAt < 90) {
      trail = window.setTimeout(() => sendAim(true), 90 - (now - sentAt));
      return;
    }
    sentAt = now;
    lastSent = aim;
    send('aim', { aim: Math.round(aim * 1000) / 1000 });
  };
  const setAim = (a: number) => {
    const next = clamp(a, -FLUNKY.AIM_MAX, FLUNKY.AIM_MAX);
    if (next === aim) return;
    if ((next === FLUNKY.AIM_MAX || next === -FLUNKY.AIM_MAX) && next !== aim) haptic('bad');
    aim = next;
    drawDial();
    sendAim();
  };
  const drawDial = () => {
    const d = deg(aim);
    aimTxt.textContent = Math.abs(d) < 0.25 ? 'geradeaus' : `${fmtDeg(d)} nach ${d < 0 ? 'oben' : 'unten'}`;
    drawAimDial(canvas, team, aim);
  };
  requestAnimationFrame(drawDial);
  drawDial();

  // Halten = weiterdrehen (erst langsam, dann schneller)
  let hold: { dir: number; t0: number; last: number; raf: number } | null = null;
  const stopHold = () => {
    if (hold) cancelAnimationFrame(hold.raf);
    hold = null;
    sendAim(true);
  };
  const holdFrame = (now: number) => {
    if (!hold) return;
    const held = now - hold.t0;
    if (held > 280) {
      const speed = Math.min(24, 5 + (held - 280) / 60); // °/s
      setAim(aim + (hold.dir * speed * (now - hold.last) * Math.PI) / 180 / 1000);
    }
    hold.last = now;
    hold.raf = requestAnimationFrame(holdFrame);
  };
  for (const [sel, dir] of [['.fk-up', -1], ['.fk-down', 1]] as const) {
    const b = q<HTMLButtonElement>(root, sel);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (input.thrown) return;
      b.setPointerCapture(e.pointerId);
      haptic('tick');
      setAim(aim + dir * AIM_STEP);
      stopHold();
      const now = performance.now();
      hold = { dir, t0: now, last: now, raf: requestAnimationFrame(holdFrame) };
    });
    b.addEventListener('pointerup', stopHold);
    b.addEventListener('pointercancel', stopHold);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // Ziehen auf der Anzeige: hoch/runter = Pfeil hoch/runter (0,2° pro px)
  let drag: { id: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (input.thrown) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag.y = e.clientY;
    setAim(aim + (dy * 0.2 * Math.PI) / 180);
  });
  const endDrag = () => {
    drag = null;
    sendAim(true);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  const onReset = () => {
    if (!root.isConnected) return window.removeEventListener('input-reset', onReset);
    stopHold();
    drag = null;
  };
  window.addEventListener('input-reset', onReset);

  // ---- Werfen (Sensor oder Wischen, Wahl gilt für alle Wurfspiele)
  let detail: FlunkyThrowIn | null = null;
  const adapt = (r: FlunkyThrowResult): ThrowResult => {
    if (!r.ok) return r;
    detail = r.t;
    return { ok: true, t: { speed: r.t.power, angle: 0, spin: 0 } };
  };
  const input = mountThrowInput(
    area,
    root,
    {
      ask: 'Erst mit den Pfeil-Knöpfen den Pfeil am TV auf die Flasche drehen, dann werfen wie beim echten Flunkyball: Knopf halten, kräftig durchschwingen, loslassen. Schwung = Weite.',
      motionHint: 'Halten, ausholen, kräftig werfen, loslassen. Mehr Abstand = mehr Schwung.',
      padText: 'Ball nach oben schnippen!<br/>Schnell = weit · gerade wischen',
      padClass: 'fk-pad',
      button: 'HALTEN &amp;<br/>WERFEN',
      holding: 'WERFEN …<br/><small>und loslassen!</small>',
      swing: (s) => adapt(flunkySwing(s)),
      swipe: (p, h) => adapt(flunkySwipe(p, h)),
      scale: FLUNKY_SCALE,
    },
    (_t, info) => {
      const d = detail!;
      const f = flunky();
      stopHold();
      sendAim(true);
      const dev = d.slantDeg === null ? 0 : flunkyDev(team, d.slantDeg);
      haptic('hit');
      send('throw', { aim: Math.round(aim * 1000) / 1000, dev: Math.round(dev * 1000) / 1000, power: d.power });
      if (f) {
        const fb = flunkyFeedback(f, team, aim, dev, d, info);
        rememberFeedback('flunky', fb);
        card.set(fb);
      }
      root.classList.add('fk-thrown');
      area.innerHTML = '';
      area.append(el(`<div class="center"><h2>Wurf!</h2><p>Kraft ${pct(d.power)} – schau auf den Fernseher!</p></div>`));
    },
    { onStart: () => card.dim(), onFail: (reason, info) => card.set(failFeedback(reason, info)) },
  );

  return () => {
    const f = flunky();
    if (f) q(root, '.fk-wind').textContent = windText(f.wind);
    if (!f || f.sub !== 'aim') {
      input.stop();
      stopHold();
    }
  };
}

/** Kleine Anzeige des Zielpfeils – so gedreht wie am TV (Team Sonne wirft nach rechts, Team Meer nach links) */
function drawAimDial(c: HTMLCanvasElement, team: Team, aim: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(120, c.clientWidth);
  const h = Math.max(48, c.clientHeight);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#f1d49a';
  g.fillRect(0, 0, w, h);
  const dir = team === 'A' ? 1 : -1;
  const x0 = team === 'A' ? 16 : w - 16;
  const y0 = h / 2;
  // geradeaus (gestrichelt)
  g.fillStyle = 'rgba(61, 36, 20, 0.35)';
  for (let x = 0; x < w - 24; x += 8) g.fillRect(team === 'A' ? x0 + 8 + x : x0 - 12 - x, y0, 4, 1);
  const len = w - 40;
  const ex = x0 + dir * Math.cos(aim) * len;
  const ey = y0 + Math.sin(aim) * len;
  g.strokeStyle = '#2d1b12';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(ex, ey);
  g.stroke();
  g.strokeStyle = TEAM_INFO[team].color;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(ex, ey);
  g.stroke();
  // Spitze
  const a = Math.atan2(ey - y0, ex - x0);
  g.fillStyle = '#2d1b12';
  g.beginPath();
  g.moveTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4);
  g.lineTo(ex + Math.cos(a + 2.4) * 11, ey + Math.sin(a + 2.4) * 11);
  g.lineTo(ex + Math.cos(a - 2.4) * 11, ey + Math.sin(a - 2.4) * 11);
  g.closePath();
  g.fill();
  g.fillStyle = TEAM_INFO[team].color;
  g.beginPath();
  g.moveTo(ex + Math.cos(a) * 1.5, ey + Math.sin(a) * 1.5);
  g.lineTo(ex + Math.cos(a + 2.4) * 7.5, ey + Math.sin(a + 2.4) * 7.5);
  g.lineTo(ex + Math.cos(a - 2.4) * 7.5, ey + Math.sin(a - 2.4) * 7.5);
  g.closePath();
  g.fill();
  // Werfer
  g.fillStyle = '#2d1b12';
  g.beginPath();
  g.arc(x0, y0, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = TEAM_INFO[team].color;
  g.beginPath();
  g.arc(x0, y0, 4, 0, Math.PI * 2);
  g.fill();
}

/**
 * Feedback-Karte nach dem Wurf: Der Wurf ist ohne Zufall, das Handy rechnet genau wie der Server und kann sagen,
 * wo der Ball aufkommt, welcher Kraftbereich getroffen hätte und wie weit Pfeil/Schwung danebenlagen.
 */
function flunkyFeedback(f: FlunkyState, team: Team, aim: number, dev: number, d: FlunkyThrowIn, info: ThrowInfo): Feedback {
  const r = computeLanding(team, f.spot, aim + dev, d.power, f.wind, f.bottle);
  const win = flunkyPowerWindow(team, f.spot, f.bottle, f.wind);
  const motion = info.source === 'motion';
  const lines: FeedbackLine[] = [];
  const short = r.along < -FLUNKY.HIT_NEAR * 0.6;
  const long = r.along > FLUNKY.HIT_FAR * 0.6;
  const up = r.lat < -FLUNKY.HIT_LAT * 0.6;
  const down = r.lat > FLUNKY.HIT_LAT * 0.6;
  lines.push({ k: 'Weite', v: short ? `${fmtM(r.along)} zu kurz` : long ? `${fmtM(r.along)} zu weit` : 'passt', tone: r.hit ? 'ok' : short || long ? 'warn' : 'ok' });
  lines.push({ k: 'Seite', v: up ? `${fmtM(r.lat)} oben vorbei` : down ? `${fmtM(r.lat)} unten vorbei` : 'passt', tone: r.hit ? 'ok' : up || down ? 'warn' : 'ok' });
  // Pfeil gegenüber der perfekten Richtung (Wind schon vorgehalten)
  const offDeg = deg(aim + dev - win.aim);
  if (Math.abs(offDeg) >= 0.5) lines.push({ k: 'Pfeil', v: `${fmtDeg(offDeg)} zu weit ${offDeg < 0 ? 'oben' : 'unten'}`, tone: Math.abs(offDeg) >= 2 ? 'warn' : 'ok' });
  if (d.slantDeg !== null && dev !== 0) lines.push({ k: 'Wischer', v: `${fmtDeg(d.slantDeg)} schräg → Ball ${fmtDeg(deg(dev))} ${dev < 0 ? 'hoch' : 'runter'}`, tone: 'warn' });
  if (motion) lines.push({ k: 'Schwung', v: d.gyro ? `${d.peakRot} °/s` : `${d.peakAcc} m/s²` });
  const tl = timingLine(info);
  if (tl) lines.push(tl);
  // Wie viel mehr/weniger Schwung bis zur Flasche?
  const ratio = flunkyLevelFor(win.ideal) / flunkyLevelFor(d.power);
  const more = Math.round((ratio - 1) * 100);
  const tip = r.hit
    ? 'TREFFER! Genau so – nächstes Mal stehst du woanders.'
    : short || long
      ? motion
        ? `${short ? 'Zu kurz' : 'Zu weit'} – etwa ${Math.abs(more)} % ${more > 0 ? 'mehr' : 'weniger'} Schwung.`
        : `${short ? 'Zu kurz' : 'Zu weit'} – etwa ${Math.abs(more)} % ${more > 0 ? 'schneller' : 'langsamer'} wischen.`
      : (timingTip(info) ??
        (dev !== 0
          ? 'Gerade nach oben wischen – schräg verzieht den Ball.'
          : `Pfeil etwa ${fmtDeg(offDeg)} weiter nach ${offDeg > 0 ? 'oben' : 'unten'} drehen${f.wind ? ' (Wind vorhalten)' : ''}.`));
  return {
    title: r.hit ? 'Treffer!' : motion ? 'Dein Wurf' : 'Dein Wischer',
    info,
    bar: { label: 'Kraft', value: d.power, lo: win.lo, hi: win.hi, text: `${pct(d.power)} (Treffer: ${pct(win.lo)}–${pct(win.hi)})` },
    lines,
    tip,
    tone: r.hit ? 'ok' : 'warn',
  };
}

// ------------------------------------------------------------------ Trinken / Laufen

/**
 * Schütteln zählt wie Tippen (Trinken/Laufen), sobald der Bewegungssensor schon freigegeben ist
 * (meldet sich selbst ab, wenn der Screen weg ist). Liefert den Hinweistext (leer ohne Sensor).
 */
function shakeToTap(root: HTMLElement, onShake: () => void): string {
  if (motionSupport() !== 'ok') return '';
  let last = 0;
  let armed = true;
  const off = onMotion((m) => {
    if (!root.isConnected) return off();
    const a = swingAcc(m);
    // Spitze über 7 m/s² zählt, danach erst wieder nach Beruhigung (< 3) – ein Schüttler = ein Tipp
    if (armed && a > 7 && m.t - last > 110) {
      armed = false;
      last = m.t;
      onShake();
    } else if (a < 3) armed = true;
  });
  return '<p style="text-align: center; color: var(--ink-soft); font-size: 9px">… oder Handy schütteln!</p>';
}

function buildDrink(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>TREFFER! Trinken!</h2>
    <p class="fk-sip">So schnell tippen wie du kannst – höchstens ${FLUNKY.SIP_MAX} % pro Treffer!</p>
    <button class="big-btn drink">TRINKEN!</button>
    <p>Dein Bier</p>
    <div class="meter fk-meter"><div></div><i class="fk-floor"></i></div>
  `);
  app.append(root);
  const tap = () => {
    send('tap');
    navigator.vibrate?.(8);
  };
  tapButton(q(root, '.big-btn'), tap);
  q(root, '.big-btn').insertAdjacentHTML('afterend', shakeToTap(root, tap));
  const fill = q(root, '.meter > div');
  const floor = q(root, '.fk-floor');
  const sip = q(root, '.fk-sip');
  return () => {
    const f = flunky();
    if (!f) return;
    const id = store.playerId!;
    const beer = f.beer[id] ?? 0;
    const lim = f.sipFloor[id] ?? 0;
    fill.style.width = `${beer}%`;
    floor.style.left = `${lim}%`;
    const left = Math.max(0, Math.round(beer - lim));
    sip.textContent = left > 0 ? `So schnell tippen wie du kannst – noch ${left} % in diesem Treffer!` : 'Schluck-Limit erreicht – gleich steht die Flasche wieder.';
  };
}

function buildRun(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>LAUF! Stell die Flasche auf!</h2>
    <p>Tippen = Laufen. Je schneller, desto weniger trinken die anderen!</p>
    <button class="big-btn run">LAUFEN!</button>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  const tap = () => {
    send('tap');
    navigator.vibrate?.(8);
  };
  tapButton(q(root, '.big-btn'), tap);
  q(root, '.big-btn').insertAdjacentHTML('afterend', shakeToTap(root, tap));
  const fill = q(root, '.meter > div');
  fill.style.background = 'var(--sea)';
  return () => {
    fill.style.width = `${((flunky()?.runProgress ?? 0) / RUN_TAPS) * 100}%`;
  };
}

// ------------------------------------------------------------------ Zuschauen (eigenes Team / anderes Team)

function buildWatch(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <div class="center fk-watch">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <div class="fk-teams">
      <div class="fk-trow"><span>${TEAM_INFO.A.name}</span><div class="meter"><div class="fk-tA"></div></div><b class="fk-hA"></b></div>
      <div class="fk-trow"><span>${TEAM_INFO.B.name}</span><div class="meter"><div class="fk-tB"></div></div><b class="fk-hB"></b></div>
    </div>
    <p class="fk-round"></p>
    <p>Dein Bier</p>
    <div class="meter"><div class="fk-mine"></div></div>
  `);
  app.append(root);
  const card = feedbackCard(true);
  q(root, '.fk-teams').before(card.root);
  q(root, '.fk-tA').style.background = TEAM_INFO.A.color;
  q(root, '.fk-tB').style.background = TEAM_INFO.B.color;
  return () => {
    const f = flunky();
    if (!f) return;
    const id = store.playerId!;
    let head = '';
    let sub = '';
    if (f.sub === 'aim') {
      head = `${nameOf(f.throwerId)} zielt ...`;
      sub = f.turnTeam === team ? 'Dein Team ist dran – gebt Tipps!' : 'Hoffentlich daneben!';
    } else if (f.sub === 'flight') {
      const t = f.lastThrow;
      head = t?.throwerId === id ? 'Dein Ball fliegt ...' : `${nameOf(f.throwerId)} wirft ...`;
      sub = 'Schau auf den Fernseher!';
    } else if (f.sub === 'reset') {
      head = 'Flasche steht wieder!';
      sub = 'Wechsel ...';
    } else {
      head = `${TEAM_INFO[f.turnTeam].name} trinkt!`;
      sub = `${nameOf(f.runnerId)} läuft für ${TEAM_INFO[otherTeam(f.turnTeam)].name} – anfeuern!`;
    }
    q(root, '.headline').textContent = head;
    q(root, '.sub').textContent = sub;
    for (const t of ['A', 'B'] as Team[]) {
      q(root, `.fk-t${t}`).style.width = `${teamBeer(f, t)}%`;
      q(root, `.fk-h${t}`).textContent = `${f.hits[t]}🎯`;
    }
    q(root, '.fk-round').textContent = `${roundLabel(f)} · Bier im Schnitt (voll = 100 %)`;
    q(root, '.fk-mine').style.width = `${f.beer[id] ?? 0}%`;
    const fb = lastFeedback('flunky');
    if (fb !== card.current) card.set(fb);
  };
}
