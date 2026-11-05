import type { MaexPrivate, MaexState } from '../../../shared/types';
import { MAEX, MAEXCHEN, MAEX_ORDER, isPasch, maexBeats, maexLabel } from '../../../shared/maexchen';
import { type Screen, app, el, escapeHtml, nameOf, q, send, store, timerText } from '../core';
import { enableMotion, motionSupport, onMotion, swingAcc } from '../motion';
import { haptic } from '../haptic';
import { unlockAudio } from '../audio';

/**
 * Mäxchen am Pool am Handy (hochkant): schütteln (oder Becher antippen) = glauben & würfeln,
 * AUFDECKEN!, unter dem Becher heimlich die Würfel ansehen (gedrückt halten) und einen Wert ansagen.
 */

const myPriv = (s: MaexState): MaexPrivate | null =>
  store.priv?.kind === 'maexchen' && store.priv.state.phaseNo === s.phaseNo ? store.priv.state : null;

const cur = () => (store.state?.mini?.kind === 'maexchen' ? store.state.mini.state : null);

export function pickMaexchen(s: MaexState): Screen {
  ensureStyle();
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['spectate', () => buildInfo('Du schaust zu', 'Mäxchen läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['mx-over', () => buildInfo('Spiel vorbei!', 'Schau auf den Fernseher.')];
  if (!s.drink && (s.lives[id] ?? 0) <= 0 && s.sub !== 'lift' && s.sub !== 'reveal') return ['mx-out', () => buildInfo('Du bist raus!', 'Keine Leben mehr – tipp unten, wer am Ende übrig bleibt.')];
  if (s.sub === 'lift' || s.sub === 'reveal') return [`mx-rev-${s.phaseNo}`, () => buildReveal(s)];
  if (s.turn === id && s.sub === 'roll') return [`mx-roll-${s.phaseNo}`, () => buildRoll(s)];
  if (s.turn === id && s.sub === 'announce') return [`mx-ann-${s.phaseNo}`, () => buildAnnounce(s)];
  return [`mx-watch-${s.phaseNo}`, () => buildWatch(s)];
}

// ---------------------------------------------------------------- Bausteine

function livesHtml(s: MaexState, id = store.playerId!) {
  if (s.drink) {
    const n = s.sips[id] ?? 0;
    return `🍺 ${n === 1 ? '1 Schluck' : `${n} Schlücke`}`;
  }
  const n = s.lives[id] ?? 0;
  return Array.from({ length: MAEX.LIVES }, (_, i) => `<span class="mx-heart${i < n ? '' : ' off'}">♥</span>`).join('');
}

function headHtml(s: MaexState) {
  return `<div class="mx-top"><span>Runde ${s.round}/${s.rounds}</span><span class="mx-lives">${livesHtml(s)}</span><span class="mx-timer"></span></div>`;
}

const PIP_CELLS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function setDie(d: HTMLElement, n: number) {
  d.classList.toggle('one', n === 1);
  d.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${PIP_CELLS[n]?.includes(i) ? 'p' : ''}"></i>`).join('');
}

function updateTimer(root: HTMLElement) {
  const t = root.querySelector<HTMLElement>('.mx-timer');
  if (t) t.textContent = timerText((sec) => `⏱${sec}`);
}

function claimHtml(s: MaexState) {
  if (!s.claim) return '';
  const hot = s.claim.value === MAEXCHEN;
  return `<p>${escapeHtml(nameOf(s.claim.by))} sagt:</p><div class="mx-big${hot ? ' hot' : ''}">${maexLabel(s.claim.value)}</div>`;
}

function buildInfo(title: string, sub: string) {
  const s = cur();
  const root = el(`<div class="mx">${s ? headHtml(s) : ''}<div class="center"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div></div>`);
  app.append(root);
  return null;
}

// ---------------------------------------------------------------- Schütteln: glauben & würfeln

/** Sensor-Erlaubnis gilt bis zum Neuladen; einmal pro Sitzung (iPhone) aus einem Tap heraus anfragen */
let motionTried = false;

function buildRoll(s: MaexState) {
  const maex = s.claim?.value === MAEXCHEN;
  const lose = s.drink ? '1 Schluck' : '−1 Leben';
  const shakeOk = motionSupport() === 'ok';
  const root = el(`
    <div class="mx">
      ${headHtml(s)}
      ${s.claim ? claimHtml(s) : '<h2>Du beginnst!</h2><p>Jeder Wert ist erlaubt.</p>'}
      ${maex
        ? `<p>Glaubst du das Mäxchen, verlierst du ${lose} – ohne aufzudecken. Deckst du auf und es stimmt: doppelt!</p>
           <button class="mx-accept">GLAUBEN (${lose})</button>`
        : `<div class="mx-cupwrap mx-tap"><div class="mx-cup"></div></div>
           <p class="mx-hint">${shakeOk ? 'Handy schütteln' : 'Becher antippen'}${s.claim ? ' = glauben &amp; würfeln' : ' = würfeln'}</p>`}
      ${s.claim ? '<button class="big-btn mx-doubt">AUFDECKEN!</button>' : ''}
    </div>
  `);
  app.append(root);
  let sent = false;
  let unsub: (() => void) | null = null;
  const stop = () => {
    unsub?.();
    unsub = null;
  };
  const cupEl = root.querySelector<HTMLElement>('.mx-cup');
  const wiggle = () => {
    if (!cupEl) return;
    cupEl.classList.remove('shake');
    void cupEl.offsetWidth;
    cupEl.classList.add('shake');
  };
  const go = (action: 'roll' | 'doubt') => {
    if (sent) return;
    sent = true;
    stop();
    haptic(action === 'doubt' ? 'hit' : 'win');
    if (action === 'roll') wiggle();
    send(action);
  };
  const tap = root.querySelector<HTMLElement>('.mx-tap');
  tap?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    // iPhone: Erlaubnis für den Sensor beim ersten Tippen holen – ab dem nächsten Zug klappt Schütteln
    if (!motionTried && motionSupport() === 'needs-permission') {
      motionTried = true;
      void enableMotion();
    }
    go('roll');
  });
  root.querySelector('.mx-accept')?.addEventListener('click', () => go('roll'));
  root.querySelector('.mx-doubt')?.addEventListener('click', () => go('doubt'));
  // Schütteln: drei kräftige Ausschläge innerhalb von 0,9 s
  if (!maex && shakeOk) {
    let hits: number[] = [];
    unsub = onMotion((m) => {
      if (!root.isConnected) return stop();
      if (sent || swingAcc(m) < 9) return;
      if (hits.length && m.t - hits[hits.length - 1] < 70) return;
      hits = [...hits.filter((h) => m.t - h < 900), m.t];
      wiggle();
      haptic('tick');
      if (hits.length >= 3) go('roll');
    });
  }
  haptic('tap');
  return () => {
    if (!root.isConnected) return stop();
    updateTimer(root);
  };
}

// ---------------------------------------------------------------- Ansagen

function buildAnnounce(s: MaexState) {
  const claim = s.claim?.value ?? null;
  const values = MAEX_ORDER.filter((v) => maexBeats(v, claim));
  const root = el(`
    <div class="mx">
      ${headHtml(s)}
      <div class="mx-cupwrap mx-peek-area">
        <div class="mx-dice"><div class="mx-die"></div><div class="mx-die"></div></div>
        <div class="mx-cup"></div>
      </div>
      <p class="mx-hint">Becher gedrückt halten = heimlich drunter schauen</p>
      <p>${claim == null ? 'Sag einen Wert an:' : `Muss <b>${maexLabel(claim)}</b> schlagen:`}</p>
      <div class="mx-grid">${values.map((v) => `<button class="secondary mx-v${isPasch(v) ? ' pasch' : ''}${v === MAEXCHEN ? ' max' : ''}" data-v="${v}">${maexLabel(v)}</button>`).join('')}</div>
      <button class="mx-send" disabled>Wert wählen …</button>
    </div>
  `);
  app.append(root);
  const box = q(root, '.mx');
  const area = q(root, '.mx-peek-area');
  const sendBtn = q<HTMLButtonElement>(root, '.mx-send');
  let pick: number | null = null;
  let sent = false;
  const peek = (on: boolean) => {
    box.classList.toggle('peek', on);
    if (on) haptic('tick');
  };
  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      area.setPointerCapture(e.pointerId);
    } catch {
      /* synthetische Events ohne echten Zeiger */
    }
    peek(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(ev, () => peek(false));
  area.addEventListener('contextmenu', (e) => e.preventDefault());
  root.querySelectorAll<HTMLButtonElement>('.mx-v').forEach((b) =>
    b.addEventListener('click', () => {
      if (sent) return;
      pick = Number(b.dataset.v);
      root.querySelectorAll('.mx-v.sel').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      sendBtn.disabled = false;
      sendBtn.textContent = `ANSAGEN: ${maexLabel(pick)}`;
      haptic('tick');
    }),
  );
  sendBtn.addEventListener('click', () => {
    if (sent || pick === null) return;
    sent = true;
    haptic('hit');
    send('announce', { value: pick });
    sendBtn.disabled = true;
    sendBtn.textContent = 'Angesagt!';
  });
  let shown = 0;
  return () => {
    updateTimer(root);
    const st = cur();
    const p = st ? myPriv(st) : null;
    if (!p || shown === p.value) return;
    shown = p.value;
    root.querySelectorAll<HTMLElement>('.mx-die').forEach((d, i) => setDie(d, p.dice[i]));
    root.querySelectorAll<HTMLElement>('.mx-v').forEach((b) => b.classList.toggle('mine', Number(b.dataset.v) === p.value));
  };
}

// ---------------------------------------------------------------- Zuschauen (wer gerade nicht dran ist)

function nextAfter(s: MaexState, id: string): string | null {
  const o = s.order;
  const i = o.indexOf(id);
  for (let k = 1; k < o.length; k++) {
    const c = o[(i + k) % o.length];
    if (s.drink || (s.lives[c] ?? 0) > 0) return c;
  }
  return null;
}

function buildWatch(s: MaexState) {
  const me = store.playerId!;
  const who = escapeHtml(nameOf(s.turn));
  const status = s.sub === 'announce' ? 'schaut unter den Becher …' : s.claim ? (s.claim.value === MAEXCHEN ? 'muss das Mäxchen glauben – oder aufdecken!' : 'glaubt – oder deckt auf?') : 'beginnt und würfelt …';
  const next = s.sub === 'announce' && nextAfter(s, s.turn) === me;
  const root = el(`
    <div class="mx">
      ${headHtml(s)}
      <h2>${who} ${status}</h2>
      ${s.claim ? claimHtml(s) : ''}
      ${s.chain.length > 1 ? `<p class="mx-hint">Bisher: ${s.chain.map((c) => maexLabel(c.value)).join(' › ')}</p>` : ''}
      ${next ? '<p class="mx-next">Du bist als Nächstes dran – schau ihm gut ins Gesicht!</p>' : ''}
    </div>
  `);
  app.append(root);
  return () => updateTimer(root);
}

// ---------------------------------------------------------------- Auflösung

function buildReveal(s: MaexState) {
  const me = store.playerId!;
  const r = s.reveal;
  if (!r) return buildInfo('Moment …', '');
  const cost = s.drink ? (r.cost === 1 ? '1 Schluck' : `${r.cost} Schlücke`) : r.cost === 1 ? '1 Leben' : `${r.cost} Leben`;
  const loserTxt = (id: string | null) => (id === me ? (s.drink ? `Du trinkst ${cost}!` : `Du verlierst ${cost}!`) : `${escapeHtml(nameOf(id))} ${s.drink ? `trinkt ${cost}` : `verliert ${cost}`}.`);
  let title: string;
  let sub: string;
  if (s.sub === 'lift') {
    title = `${escapeHtml(nameOf(r.doubter))} deckt auf!`;
    sub = `${escapeHtml(nameOf(r.by))} sagte <b>${maexLabel(r.claimed)}</b> … Trommelwirbel!`;
  } else if (r.accepted) {
    title = r.loser === me ? 'Mäxchen geglaubt' : `${escapeHtml(nameOf(r.doubter))} glaubt das Mäxchen`;
    sub = loserTxt(r.loser);
  } else {
    title = r.lied ? (r.by === me ? 'Erwischt!' : 'Gelogen!') : r.doubter === me ? 'Falsch gezweifelt!' : 'Stimmt!';
    sub = `Wurf <b>${maexLabel(r.actual ?? 0)}</b> · Ansage <b>${maexLabel(r.claimed)}</b><br>${loserTxt(r.loser)}${r.out && r.loser === me ? '<br>Du bist raus.' : r.out ? ' Raus!' : ''}`;
  }
  const root = el(`
    <div class="mx">
      ${headHtml(s)}
      <h1>${title}</h1>
      ${s.sub === 'reveal' && r.dice ? '<div class="mx-dice open"><div class="mx-die"></div><div class="mx-die"></div></div>' : ''}
      <p>${sub}</p>
    </div>
  `);
  app.append(root);
  if (r.dice) root.querySelectorAll<HTMLElement>('.mx-die').forEach((d, i) => setDie(d, r.dice![i]));
  if (s.sub === 'reveal' && (r.by === me || r.doubter === me)) haptic(r.loser === me ? 'bad' : 'win');
  return null;
}

// ---------------------------------------------------------------- Styles

function ensureStyle() {
  if (document.getElementById('mx-style')) return;
  const st = document.createElement('style');
  st.id = 'mx-style';
  st.textContent = `
.mx { display: flex; flex-direction: column; gap: 10px; flex: 1; user-select: none; -webkit-user-select: none; }
.mx .center { margin: auto 0; display: flex; flex-direction: column; gap: 10px; }
.mx-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 9px; color: var(--ink-soft); }
.mx-lives { font-size: 14px; color: #d8473c; letter-spacing: 2px; }
.mx-heart.off { color: #c9b28a; }
.mx-timer { min-width: 40px; text-align: right; }
.mx-big { text-align: center; font-size: 26px; color: var(--red); line-height: 1.3; }
.mx-big.hot { color: #d8473c; animation: mx-pulse 0.6s infinite alternate; }
@keyframes mx-pulse { from { transform: scale(1); } to { transform: scale(1.08); } }
.mx-hint { font-size: 9px; }
.mx-next { color: var(--red); }
.mx-cupwrap { position: relative; height: 170px; display: flex; justify-content: center; align-items: flex-end; touch-action: none; filter: drop-shadow(0 4px 0 var(--outline)); cursor: pointer; }
.mx-tap { flex: 1; min-height: 170px; align-items: center; }
.mx-cup { position: relative; z-index: 1; width: 118px; height: 112px; clip-path: polygon(20% 0, 80% 0, 100% 100%, 0 100%);
  background: linear-gradient(90deg, #a5502e 0 14%, #7a3b2e 14% 78%, #4a2018 78%), #7a3b2e;
  box-shadow: inset 0 -10px 0 #c9a24a, inset 0 8px 0 #5a2a20; transition: transform 0.16s ease-out; transform-origin: 50% 100%; }
.mx-cup::after { content: '🎲'; position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); font-size: 26px; opacity: 0.85; }
.mx-cup.shake { animation: mx-shake 0.28s ease-in-out; }
@keyframes mx-shake { 0% { transform: rotate(0); } 25% { transform: rotate(-14deg) translateY(-6px); } 75% { transform: rotate(14deg) translateY(-6px); } 100% { transform: rotate(0); } }
.mx.peek .mx-cup { transform: translate(64px, -46px) rotate(24deg); }
.mx-dice { position: absolute; bottom: 10px; display: flex; gap: 12px; z-index: 0; }
.mx-dice.open { position: static; justify-content: center; }
.mx-die { width: 48px; height: 48px; padding: 5px; background: #fbf6ea; border: 3px solid var(--outline); border-radius: 9px;
  box-shadow: inset -3px -3px 0 #d9cdb4; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); }
.mx-die i { margin: 2px; border-radius: 50%; }
.mx-die i.p { background: var(--outline); }
.mx-die.one i.p { background: #c0392b; }
.mx-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.mx-v { padding: 9px 2px; font-size: 11px; min-height: 40px; }
.mx-v.pasch { background: #f3d58a; }
.mx-v.max { background: #e8a0a0; color: var(--ink); }
.mx-v.sel { background: var(--gold); color: var(--ink); box-shadow: inset 0 0 0 3px var(--red), 0 3px 0 var(--wood-darker); }
.mx.peek .mx-v.mine { box-shadow: inset 0 0 0 3px var(--green), 0 3px 0 var(--wood-darker); }
.mx-send { min-height: 58px; font-size: 13px; background: var(--red); }
.mx-doubt { min-height: 18vh; flex: none; background: #c0392b; box-shadow: inset 0 4px 0 #e86a5c, inset 0 -6px 0 #8a2419, 0 3px 0 var(--outline); }
.mx-accept { min-height: 64px; font-size: 13px; }
`;
  document.head.append(st);
}
