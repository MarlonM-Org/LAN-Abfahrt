import type { DescentState, DateRunState, RhythmState, StarsState, WrapState } from '../../../shared/types';
import { INGREDIENT_NAMES, RHYTHM, WRAP_RECIPE } from '../../../shared/dategames';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, socket, store, tapButton } from '../core';
import { PENTA, pluck, unlockAudio } from '../audio';
import { toLocalPerf } from '../../timesync';
import { ingredient } from '../../art/food';
import { Pix } from '../../art/pix';

const other = () => {
  const c = store.state?.date?.couple ?? store.state?.players.map((p) => p.id) ?? [];
  return nameOf(c.find((id) => id !== store.playerId));
};

// ------------------------------------------------------------------ Story-Karten

export function pickStory(d: DateRunState, canAdvance: boolean): Screen {
  const card = d.card;
  if (!card) return ['story-wait', message('Gleich geht’s weiter ...')];
  return [`story-${d.chapter}-${card.title}-${canAdvance}`, () => {
    const root = el(`
      <div class="center">
        <p class="pink">${escapeHtml(card.kicker)}</p>
        <h1>${escapeHtml(card.title)}</h1>
        <p class="story">${escapeHtml(card.text).replace(/\n/g, '<br/>')}</p>
        ${d.chapter >= 0 && d.chapter < d.chapters.length ? `<p class="pink">♥ ${d.totalHearts} / ${d.maxHearts}</p>` : ''}
      </div>
    `);
    if (canAdvance) {
      const b = el(`<button>${card.final ? 'Zurück zur Lobby' : d.card && d.chapter >= 0 ? 'Los geht’s!' : 'Weiter'}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('story:next'));
      root.append(b);
    }
    app.append(root);
    return null;
  }];
}

// ------------------------------------------------------------------ Abstieg

export function pickDescent(d: DescentState): Screen {
  const r = d.runners[store.playerId!];
  if (!r) return ['spectate', message('Du schaust zu')];
  if (d.sub === 'countdown') return ['de-count', message('Gleich geht’s los!', 'Tippe SPRINGEN, um über Steine, Flaschen und Tauben zu hüpfen.')];
  if (d.sub === 'over') return ['de-over', message(r.finished ? 'Unten angekommen!' : 'Zeit ist um!', `${r.hits}x gestolpert`)];
  if (r.finished) return ['de-done', message('Du bist unten!', `Warte auf ${other()} ... feuer an!`)];
  return ['de-run', buildJump];
}

function buildJump() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="hits"></span></div>
    <div class="meter"><div></div></div>
    <button class="big-btn jump">SPRINGEN!</button>
    <p class="hint">Steine rollen von hinten heran – schau auf den Fernseher!</p>
  `);
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  tapButton(btn, () => {
    send('jump');
    navigator.vibrate?.(15);
  });
  app.append(root);
  return () => {
    const d = store.state?.mini?.kind === 'descent' ? store.state.mini.state : null;
    const r = d?.runners[store.playerId!];
    if (!d || !r) return;
    q(root, '.timer').textContent = `${Math.ceil(d.endsIn / 1000)}s`;
    q(root, '.hits').textContent = `${r.hits}x gestolpert`;
    q(root, '.meter > div').style.width = `${(r.s / d.length) * 100}%`;
    btn.classList.toggle('fail', r.stunned);
    btn.textContent = r.stunned ? 'AUTSCH!' : r.jumpLeft > 0 ? 'HUI!' : 'SPRINGEN!';
  };
}

// ------------------------------------------------------------------ Gespräch (Rhythmus)

export function pickRhythm(s: RhythmState): Screen {
  const id = store.playerId!;
  if (!s.charts[id]) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'ready') {
    return s.ready.includes(id) ? ['rh-wait', message('Bereit!', `Warte auf ${other()} ...`)] : ['rh-ready', buildReady];
  }
  if (s.sub === 'play') return [`rh-play-${s.playSeq}`, () => buildRhythm(s)];
  return ['rh-over', message('Gespräch vorbei', 'Schau auf den Fernseher!')];
}

function buildReady() {
  const root = el(`
    <div class="center">
      <h2>Das erste Gespräch</h2>
      <p>Die Musik kommt vom Laptop/Fernseher – dreht auf! Tippe im Takt auf LINKS und RECHTS, wenn die Noten unten ankommen.</p>
      <p>Wer gerade redet, hat mehr zu tun – wer zuhört, nickt nur ab und zu.</p>
    </div>
    <button>Bereit!</button>
  `);
  root.querySelector('button')!.addEventListener('click', () => {
    unlockAudio();
    send('ready');
  });
  app.append(root);
  return null;
}

function buildRhythm(s: RhythmState) {
  const id = store.playerId!;
  const notes = s.charts[id];
  const judged = new Array(notes.length).fill(false);
  const beatMs = 60000 / s.bpm;
  // Die Musik kommt vom TV/Laptop; Start per synchronisierter Serverzeit
  const t0 = toLocalPerf(s.startAt);

  const root = el(`
    <p class="talk"></p>
    <canvas class="lanes"></canvas>
    <div class="lane-btns"><button class="lane l0">LINKS</button><button class="lane l1">RECHTS</button></div>
    <p class="fb">&nbsp;</p>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const fb = q(root, '.fb');
  app.append(root);
  const W = (canvas.width = 240);
  const H = (canvas.height = 300);
  const g = canvas.getContext('2d')!;
  const hitY = H - 30;
  let combo = 0;

  const judge = (lane: 0 | 1) => {
    const now = performance.now() - t0;
    let best = -1;
    let bestD = Infinity;
    notes.forEach((n, i) => {
      if (judged[i] || n.lane !== lane) return;
      const dd = Math.abs(n.t - now);
      if (dd < bestD) (bestD = dd), (best = i);
    });
    if (best < 0 || bestD > RHYTHM.GOOD_MS) {
      fb.textContent = '...';
      return;
    }
    judged[best] = true;
    const qv = bestD <= RHYTHM.PERFECT_MS ? 2 : 1;
    combo++;
    fb.textContent = qv === 2 ? `Perfekt! x${combo}` : `Gut x${combo}`;
    pluck(PENTA[(best + lane * 2) % PENTA.length]);
    send('hit', { i: best, q: qv });
  };
  root.querySelectorAll<HTMLButtonElement>('.lane').forEach((b, lane) =>
    tapButton(b, () => {
      judge(lane as 0 | 1);
      navigator.vibrate?.(6);
    }),
  );

  const frame = () => {
    if (!canvas.isConnected) return;
    const now = performance.now() - t0;
    g.fillStyle = '#26304f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#2e3a62';
    g.fillRect(W / 2, 0, W / 2, H);
    // Taktlinien
    for (let b = Math.floor((now - s.leadIn) / beatMs); b < Math.floor((now - s.leadIn) / beatMs) + 4; b++) {
      const bt = s.leadIn + b * beatMs;
      const y = hitY - ((bt - now) / RHYTHM.FALL_MS) * hitY;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, y, W, 1);
    }
    g.fillStyle = '#f7e4b5';
    g.fillRect(0, hitY - 2, W, 4);
    notes.forEach((n, i) => {
      if (judged[i]) return;
      if (now - n.t > RHYTHM.GOOD_MS + 40) {
        judged[i] = true;
        combo = 0;
        fb.textContent = 'verpasst';
        send('hit', { i, q: 0 });
        return;
      }
      const y = hitY - ((n.t - now) / RHYTHM.FALL_MS) * hitY;
      if (y < -20) return;
      const x = n.lane === 0 ? W / 4 : (3 * W) / 4;
      g.fillStyle = '#2d1b12';
      g.fillRect(x - 22, y - 9, 44, 18);
      g.fillStyle = n.lane === 0 ? '#f07aa8' : '#f0b13a';
      g.fillRect(x - 20, y - 7, 40, 14);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(x - 20, y - 7, 40, 3);
    });
    const phrase = s.phrases.find((p) => now >= p.from && now < p.to);
    const talk = q(root, '.talk');
    if (now < s.leadIn) talk.textContent = `Gleich geht’s los ... ${Math.ceil((s.leadIn - now) / 1000)}`;
    else if (phrase) talk.textContent = phrase.speaker === id ? `Du redest: „${phrase.topic}“` : `${nameOf(phrase.speaker)} redet – nick mit!`;
    else talk.textContent = '';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return null;
}

// ------------------------------------------------------------------ Wrap

const iconCache = new Map<string, HTMLCanvasElement>();
function icon(id: string) {
  let c = iconCache.get(id);
  if (!c) {
    c = ingredient(id).canvas;
    iconCache.set(id, c);
  }
  return c;
}

export function pickWrap(w: WrapState): Screen {
  const p = w.players[store.playerId!];
  if (!p) return ['spectate', message('Du schaust zu')];
  if (w.sub === 'over') return ['wr-over', message('Guten Appetit!', 'Schau auf den Fernseher!')];
  if (p.done) return ['wr-done', message('Wrap ist fertig!', `${other()} wird begeistert sein.`)];
  return ['wr-build', buildWheel];
}

function buildWheel() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="who"></span></div>
    <h2 class="next"></h2>
    <div class="recipe"></div>
    <canvas class="wheel"></canvas>
    <button class="big-btn grab">GREIFEN!</button>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  const S = (canvas.width = canvas.height = 220);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  app.append(root);
  let angle = 0;
  let last = performance.now();
  let flash: { ok: boolean; until: number } | null = null;
  let lastSeq = 0;

  const wrap = () => (store.state?.mini?.kind === 'wrap' ? store.state.mini.state : null);
  const itemAtPointer = () => {
    const pl = wrap()?.players[store.playerId!];
    if (!pl) return null;
    const n = pl.wheel.length;
    const seg = (Math.PI * 2) / n;
    const local = (((-angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return pl.wheel[Math.floor(local / seg) % n];
  };
  tapButton(btn, () => {
    const item = itemAtPointer();
    if (item) send('grab', { item });
    navigator.vibrate?.(12);
  });

  const frame = () => {
    if (!canvas.isConnected) return;
    const now = performance.now();
    const pl = wrap()?.players[store.playerId!];
    if (pl) angle += ((now - last) / 1000) * pl.speed * Math.PI * 2 * 0.35;
    last = now;
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2 + 6, R = 96;
    if (pl) {
      const n = pl.wheel.length;
      const seg = (Math.PI * 2) / n;
      pl.wheel.forEach((item, i) => {
        const a0 = angle + i * seg - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, R, a0, a0 + seg);
        g.closePath();
        g.fillStyle = i % 2 ? '#f7e4b5' : '#e6c88a';
        g.fill();
        g.strokeStyle = '#8d5629';
        g.lineWidth = 2;
        g.stroke();
        const am = a0 + seg / 2;
        g.drawImage(icon(item), Math.round(cx + Math.cos(am) * R * 0.68 - 16), Math.round(cy + Math.sin(am) * R * 0.68 - 16), 32, 32);
      });
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.lineWidth = 5;
      g.strokeStyle = flash && now < flash.until ? (flash.ok ? '#46b04a' : '#d8473c') : '#5e3518';
      g.stroke();
      g.fillStyle = '#5e3518';
      g.beginPath();
      g.arc(cx, cy, 10, 0, Math.PI * 2);
      g.fill();
    }
    // Zeiger oben
    g.fillStyle = '#d8473c';
    g.beginPath();
    g.moveTo(cx - 10, 0);
    g.lineTo(cx + 10, 0);
    g.lineTo(cx, 20);
    g.closePath();
    g.fill();
    g.strokeStyle = '#2d1b12';
    g.lineWidth = 2;
    g.stroke();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return () => {
    const w = wrap();
    const pl = w?.players[store.playerId!];
    if (!w || !pl) return;
    q(root, '.timer').textContent = `${Math.ceil(w.endsIn / 1000)}s`;
    q(root, '.who').textContent = `für ${nameOf(w.forWhom[store.playerId!])}`;
    const next = WRAP_RECIPE[pl.step];
    q(root, '.next').textContent = next ? `Nächste Zutat: ${INGREDIENT_NAMES[next]}` : 'Fertig!';
    const rec = q(root, '.recipe');
    if (rec.dataset.step !== String(pl.step)) {
      rec.dataset.step = String(pl.step);
      rec.innerHTML = '';
      WRAP_RECIPE.forEach((it, i) => {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        c.getContext('2d')!.drawImage(icon(it), 0, 0);
        c.className = `rec ${i < pl.step ? 'got' : i === pl.step ? 'cur' : ''}`;
        rec.append(c);
      });
    }
    if (pl.lastGrab && pl.lastGrab.seq !== lastSeq) {
      lastSeq = pl.lastGrab.seq;
      flash = { ok: pl.lastGrab.ok, until: performance.now() + 400 };
      if (!pl.lastGrab.ok) navigator.vibrate?.(120);
    }
  };
}

// ------------------------------------------------------------------ Sternbilder

export function pickStars(s: StarsState): Screen {
  if (s.sub === 'over') return ['st-over', message('Was für eine Nacht.', 'Schau auf den Fernseher!')];
  return [`st-${s.round}`, buildSky];
}

function buildSky() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="prog"></span></div>
    <h2 class="name"></h2>
    <p class="hint"></p>
    <canvas class="sky"></canvas>
    <p>Wische von Stern zu Stern, um eine Linie zu ziehen.</p>
  `);
  const canvas = q<HTMLCanvasElement>(root, 'canvas');
  app.append(root);
  const W = (canvas.width = 360);
  const H = (canvas.height = 240);
  const g = canvas.getContext('2d')!;
  const bg = new Pix(W, H);
  for (let y = 0; y < H; y++) bg.hline(0, y, W, y < H * 0.5 ? '#141a3a' : '#1b2350');
  for (let i = 0; i < 120; i++) bg.px((i * 97) % W, (i * 61) % H, 'rgba(255,255,255,0.35)');

  const sky = () => (store.state?.mini?.kind === 'stars' ? store.state.mini.state : null);
  const toPx = (st: { x: number; y: number }) => ({ x: st.x * W, y: st.y * H });
  const scale = () => canvas.getBoundingClientRect().width / W;
  const pick = (e: PointerEvent, radius = 26) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale();
    const y = (e.clientY - rect.top) / scale();
    let best: number | null = null;
    let bd = radius;
    for (const st of sky()?.stars ?? []) {
      const p = toPx(st);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) (bd = d), (best = st.id);
    }
    return { id: best, x, y };
  };
  let from: number | null = null;
  let finger: { x: number; y: number } | null = null;
  let wrongFlash = 0;
  let lastWrong = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pick(e);
    from = p.id;
    finger = { x: p.x, y: p.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (from === null) return;
    const p = pick(e, 13);
    finger = { x: p.x, y: p.y };
    // Beim Überfahren eines anderen Sterns direkt verbinden (zügiges Zeichnen)
    if (p.id !== null && p.id !== from) {
      send('link', { a: from, b: p.id });
      navigator.vibrate?.(10);
      from = p.id;
    }
  });
  const up = (e: PointerEvent) => {
    if (from !== null) {
      const p = pick(e);
      if (p.id !== null && p.id !== from) send('link', { a: from, b: p.id });
    }
    from = null;
    finger = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const frame = () => {
    if (!canvas.isConnected) return;
    const s = sky();
    g.drawImage(bg.canvas, 0, 0);
    if (s) {
      const pos = new Map(s.stars.map((st) => [st.id, toPx(st)]));
      g.lineWidth = 3;
      g.strokeStyle = s.sub === 'done' ? '#ffd25e' : '#f7e4b5';
      for (const [a, b] of s.found) {
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        g.beginPath();
        g.moveTo(pa.x, pa.y);
        g.lineTo(pb.x, pb.y);
        g.stroke();
      }
      if (s.lastWrong && performance.now() < wrongFlash) {
        const pa = pos.get(s.lastWrong.a);
        const pb = pos.get(s.lastWrong.b);
        if (pa && pb) {
          g.strokeStyle = '#d8473c';
          g.beginPath();
          g.moveTo(pa.x, pa.y);
          g.lineTo(pb.x, pb.y);
          g.stroke();
        }
      }
      if (from !== null && finger) {
        const pa = pos.get(from);
        if (pa) {
          g.strokeStyle = 'rgba(255,255,255,0.5)';
          g.beginPath();
          g.moveTo(pa.x, pa.y);
          g.lineTo(finger.x, finger.y);
          g.stroke();
        }
      }
      const tw = performance.now() / 300;
      for (const st of s.stars) {
        const p = toPx(st);
        const r = (st.big ? 4 : 2.6) + Math.sin(tw + st.id) * 0.6;
        g.fillStyle = 'rgba(255,240,180,0.25)';
        g.beginPath();
        g.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = st.id === from ? '#ffd25e' : '#fff7dc';
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return () => {
    const s = sky();
    if (!s) return;
    q(root, '.timer').textContent = `${Math.ceil(s.endsIn / 1000)}s`;
    q(root, '.prog').textContent = `${s.found.length}/${s.edgeTotal} Linien`;
    q(root, '.name').textContent = s.sub === 'done' ? `Geschafft: ${s.name}!` : `${s.name} (${s.round}/${s.rounds})`;
    q(root, '.hint').textContent = s.hint;
    if (s.lastWrong && s.lastWrong.seq !== lastWrong) {
      lastWrong = s.lastWrong.seq;
      wrongFlash = performance.now() + 500;
      navigator.vibrate?.(80);
    }
  };
}
