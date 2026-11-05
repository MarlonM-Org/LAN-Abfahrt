import type { VerstPrivate, VerstState } from '../../../shared/types';
import { PROPS, ZONES } from '../../../shared/verstecken';
import { hideProp } from '../../art/hideprops';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton, toast } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';

const vs = () => (store.state?.mini?.kind === 'verstecken' ? store.state.mini.state : null);
const priv = (): VerstPrivate | null => (store.priv?.kind === 'verstecken' ? store.priv.state : null);

let lastNote = 0;
function showNotes() {
  const n = priv()?.note;
  if (n && n.seq > lastNote) {
    lastNote = n.seq;
    toast(n.text);
  }
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function pickVerstecken(s: VerstState): Screen {
  const p = priv();
  if (!p) return ['vs-wait', message('Moment ...')];
  const r = s.round;
  switch (s.sub) {
    case 'intro':
      return p.role === 'seeker'
        ? [`vs-intro-${r}-s`, message('Du bist SUCHER!', 'Gleich heißt es: Augen zu und nicht auf den Fernseher schauen! Danach findest du die Möbel, die keine sind.')]
        : [`vs-intro-${r}-h`, message('Du versteckst dich!', 'Lauf zu einem Möbelstück, drück VERWANDELN und dann EINRASTEN. Am besten dort, wo so ein Ding auch hingehört.')];
    case 'hide':
      if (p.role === 'seeker') return [`vs-blind-${r}`, buildBlind];
      return [`vs-hider-${r}`, buildHider];
    case 'seek':
      if (p.role === 'seeker') return [`vs-seeker-${r}`, buildSeeker];
      if (p.found) return [`vs-found-${r}`, message('Gefunden – zuschauen', p.foundBy ? `${nameOf(p.foundBy)} hat dich entdeckt. Schau auf den Fernseher!` : 'Schau auf den Fernseher!')];
      return [`vs-hider-${r}`, buildHider];
    case 'reveal': {
      if (p.role === 'seeker') return [`vs-reveal-${r}`, message(s.winner === 'seekers' ? 'Alle gefunden!' : 'Zeit um!', `Du hast insgesamt ${p.finds} gefunden · ${p.score} Punkte`)];
      return [`vs-reveal-${r}`, message(p.found ? 'Erwischt!' : 'Unentdeckt!', `${p.score} Punkte bisher`)];
    }
    case 'over':
      return ['vs-over', message('Spiel vorbei!', 'Schau auf den Fernseher!')];
  }
}

function buildBlind() {
  const root = el(`
    <div class="vs-blind">
      <h1>AUGEN ZU!</h1>
      <p>Nicht auf den Fernseher schauen –<br/>die anderen verstecken sich.</p>
      <div class="vs-count"></div>
      <p>Handy vibriert, wenn’s losgeht.</p>
    </div>
  `);
  app.append(root);
  return () => {
    const m = vs();
    if (!m) return;
    q(root, '.vs-count').textContent = String(Math.ceil(m.endsIn / 1000));
    if (m.endsIn < 400) haptic(200);
  };
}

function propCanvas() {
  const c = document.createElement('canvas');
  c.className = 'vs-prop';
  c.width = 40;
  c.height = 44;
  return c;
}

function drawProp(c: HTMLCanvasElement, d: VerstPrivate['disguise']) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  if (!d) {
    g.fillStyle = '#7a5a3a';
    g.font = '16px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.fillText('?', c.width / 2, c.height / 2 + 8);
    return;
  }
  const pix = hideProp(d.t, d.v);
  const k = Math.max(1, Math.floor(Math.min(c.width / pix.w, c.height / pix.h)));
  g.imageSmoothingEnabled = false;
  g.drawImage(pix.canvas, (c.width - pix.w * k) / 2, c.height - pix.h * k, pix.w * k, pix.h * k);
}

function buildHider() {
  // Quer: Stick links, rechts ein Daumenbogen – EINRASTEN groß (Hauptaktion), VERWANDELN oben, PFEIFEN innen
  const root = el(`
    <div class="lx vs-lx vs-hide">
      <div class="lx-head"><span class="lx-tag vs-role hider">VERSTECKER</span><span class="vs-timer"></span><span class="vs-foot grow"></span></div>
      <div class="lx-left vs-stick"><span class="st-label">LAUFEN</span></div>
      <div class="lx-mid vs-status">
        <div class="vs-propbox"></div>
        <div class="vs-name"></div><div class="vs-hint"></div>
      </div>
      <div class="lx-right vs-btns">
        <button class="big-btn vs-morph">VERWANDELN</button>
        <button class="big-btn vs-whistle">PFEIFEN</button>
        <button class="big-btn vs-lock">EINRASTEN</button>
      </div>
    </div>
  `);
  const canvas = propCanvas();
  q(root, '.vs-propbox').append(canvas);
  stickZone(q(root, '.vs-stick'), (x, y) => send('stick', { x, y }));
  const morph = q<HTMLButtonElement>(root, '.vs-morph');
  const lock = q<HTMLButtonElement>(root, '.vs-lock');
  const whistle = q<HTMLButtonElement>(root, '.vs-whistle');
  tapButton(morph, () => (send('morph'), haptic(15)));
  tapButton(lock, () => (send('lock'), haptic(25)));
  tapButton(whistle, () => (send('whistle'), haptic([30, 40, 30])));
  app.append(root);
  let drawn = '';
  return () => {
    showNotes();
    const m = vs();
    const p = priv();
    if (!m || !p) return;
    q(root, '.vs-timer').textContent = `${m.sub === 'hide' ? 'Verstecken' : 'Suche'} ${clock(m.endsIn)}`;
    const key = p.disguise ? `${p.disguise.t}-${p.disguise.v}` : '-';
    if (key !== drawn) {
      drawn = key;
      drawProp(canvas, p.disguise);
    }
    q(root, '.vs-name').textContent = p.disguise ? `Du bist: ${PROPS[p.disguise.t].name}${p.locked ? ' (eingerastet)' : ''}` : 'Noch kein Möbel';
    const hint = q(root, '.vs-hint');
    hint.textContent = p.hint;
    hint.className = `vs-hint ${p.hintLevel}`;
    morph.disabled = !p.canMorph;
    lock.disabled = !p.disguise;
    lock.textContent = p.locked ? 'LÖSEN' : 'EINRASTEN';
    lock.classList.toggle('on', p.locked);
    const ready = m.sub === 'seek' && !!p.disguise && p.whistleIn <= 0;
    whistle.disabled = !ready;
    whistle.textContent = m.sub !== 'seek' ? 'PFEIFEN' : p.whistleIn > 0 ? `PFEIFEN ${Math.ceil(p.whistleIn / 1000)}s` : 'PFEIFEN +2';
    const left = m.hiders.length - m.found.length;
    q(root, '.vs-foot').textContent = `${ZONES[p.zone]?.name ?? ''} · ${p.score} Pkt · noch ${left} versteckt`;
  };
}

function buildSeeker() {
  const root = el(`
    <div class="lx vs-lx vs-seek">
      <div class="lx-head"><span class="lx-tag vs-role seeker">SUCHER</span><span class="vs-timer"></span><span class="vs-name grow"></span></div>
      <div class="lx-left vs-stick"><span class="st-label">LAUFEN</span></div>
      <div class="lx-mid vs-status seeker">
        <div class="vs-hint"></div>
        <p class="vs-foot">Falsch geprüft = kurz schwindelig. Achte auf Pfiffe und wackelnde Möbel!</p>
      </div>
      <div class="lx-right vs-btns"><button class="big-btn vs-check">PRÜFEN</button></div>
    </div>
  `);
  stickZone(q(root, '.vs-stick'), (x, y) => send('stick', { x, y }));
  const check = q<HTMLButtonElement>(root, '.vs-check');
  tapButton(check, () => (send('check'), haptic(20)));
  app.append(root);
  let lastFinds = priv()?.finds ?? 0;
  return () => {
    showNotes();
    const m = vs();
    const p = priv();
    if (!m || !p) return;
    q(root, '.vs-timer').textContent = clock(m.endsIn);
    const left = m.hiders.length - m.found.length;
    q(root, '.vs-name').innerHTML = `Noch <b>${left}</b> versteckt · ${escapeHtml(String(p.score))} Pkt`;
    const hint = q(root, '.vs-hint');
    hint.textContent = p.hint;
    hint.className = `vs-hint ${p.hintLevel}`;
    const stunned = p.stunIn > 0;
    check.disabled = stunned;
    check.textContent = stunned ? 'SCHWINDELIG' : 'PRÜFEN';
    if (p.finds > lastFinds) {
      lastFinds = p.finds;
      haptic([60, 40, 120]);
    }
  };
}
