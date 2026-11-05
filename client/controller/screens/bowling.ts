import type { BowlingState } from '../../../shared/types';
import { scoreFrames } from '../../../shared/bowling';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store } from '../core';
import type { BowlThrow } from '../bowlingThrow';
import { mountThrowInput } from '../throwInput';
import { failFeedback, feedbackCard, forgetFeedback, lastFeedback, rememberFeedback } from '../motionFeedback';
import { bowlingFeedback } from '../throwFeedback';

const bowling = () => (store.state?.mini?.kind === 'bowling' ? store.state.mini.state : null);

export function pickBowling(s: BowlingState): Screen {
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    forgetFeedback('bowling');
    return ['bw-intro', message('Strand-Bowling!', `${s.frames} Frames pro Person. Reihum werfen – am Handy schwingen oder wischen. Strike = alle 10 Pins!`)];
  }
  if (s.sub === 'over') return ['bw-over', () => buildWatch(true)];
  if (s.sub === 'aim' && s.turn === id) return [`bw-aim-${s.aimSeq}`, () => buildAim(s)];
  return ['bw-watch', () => buildWatch(false)];
}

// ------------------------------------------------------------------ Werfen

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
  // Feedback zum letzten Wurf bleibt stehen, bis der nächste beginnt
  const card = feedbackCard();
  area.before(card.root);
  card.set(lastFeedback('bowling'));

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

  // --- Wurf abschicken (genau einmal) – Schwung oder Wischen, siehe throwInput.ts
  const input = mountThrowInput(
    area,
    root,
    {
      ask: 'Wirf wie beim echten Bowling: Handy in die Hand, Knopf halten, Arm nach vorn schwingen, am Ende loslassen.',
      motionHint: 'Halten, Arm nach vorn schwingen, am Ende loslassen. Handgelenk drehen = Effet.',
      padText: 'Kugel nach oben wischen!<br/>Schnell = hart · schräg = Richtung · im Bogen = Effet',
    },
    (t: BowlThrow, info) => {
      navigator.vibrate?.(40);
      send('throw', { seq, start, ...t });
      const fb = bowlingFeedback(t, info);
      rememberFeedback('bowling', fb);
      card.set(fb);
      q(root, '.bw-startbox').classList.add('hidden');
      area.innerHTML = '';
      area.append(el(`<div class="center"><h2>Wurf!</h2><p>Schau auf den Fernseher!</p></div>`));
    },
    { onStart: () => card.dim(), onFail: (reason, info) => card.set(failFeedback(reason, info)) },
  );
  const stopMotion = input.stop;

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
  const card = feedbackCard();
  board.before(card.root);
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
    const fb = lastFeedback('bowling');
    if (fb !== card.current) card.set(fb);

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
