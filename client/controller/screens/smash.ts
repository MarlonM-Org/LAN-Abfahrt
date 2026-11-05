import type { SmashState } from '../../../shared/types';
import { SPECIALS, pctColor } from '../../../shared/smash';
import { type Screen, app, avatarCanvas, el, escapeHtml, me, message, q, send, store } from '../core';

/**
 * Schwebender Joystick: Wo der Daumen aufsetzt, ist die Mitte.
 * Schickt die Richtung gedrosselt (~20 Hz) und bei jeder deutlichen Änderung.
 */
export function floatingStick(zone: HTMLElement, onMove: (x: number, y: number) => void) {
  const ring = q(zone, '.sm-ring');
  const knob = q(zone, '.sm-knob');
  const R = 46;
  let active: number | null = null;
  let cx = 0;
  let cy = 0;
  let cur = { x: 0, y: 0 };
  let sent = { x: 0, y: 0, t: 0 };
  const emit = (force = false) => {
    const now = performance.now();
    const changed = Math.hypot(cur.x - sent.x, cur.y - sent.y);
    // große Richtungswechsel sofort, kleine höchstens alle 50 ms
    if (!force && changed < 0.08) return;
    if (!force && changed < 0.45 && now - sent.t < 50) return;
    sent = { ...cur, t: now };
    onMove(cur.x, cur.y);
  };
  const place = (x: number, y: number) => {
    const r = zone.getBoundingClientRect();
    ring.style.left = `${x - r.left}px`;
    ring.style.top = `${y - r.top}px`;
  };
  const reset = () => {
    ring.style.left = '';
    ring.style.top = '';
    knob.style.transform = '';
    ring.classList.remove('on');
  };
  const move = (e: PointerEvent) => {
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // Daumen zieht den Ring mit – so muss man nie "zurückgreifen"
      const over = d - R;
      cx += (dx / d) * over;
      cy += (dy / d) * over;
      place(cx, cy);
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.hypot(dx, dy) / R;
    const k = m < 0.18 ? 0 : 1;
    cur = { x: Math.round((dx / R) * k * 100) / 100, y: Math.round((dy / R) * k * 100) / 100 };
    emit();
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active !== null) return;
    zone.setPointerCapture(e.pointerId);
    active = e.pointerId;
    cx = e.clientX;
    cy = e.clientY;
    place(cx, cy);
    ring.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
  const up = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    cur = { x: 0, y: 0 };
    reset();
    emit(true);
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('lostpointercapture', up);
  const keepAlive = setInterval(() => {
    if (!zone.isConnected) return clearInterval(keepAlive);
    if (active !== null) emit(true);
  }, 250);
  return () => cur;
}

/** Knopf mit Drücken/Loslassen (für SCHILD halten) – reagiert sofort beim Berühren */
export function holdButton(btn: HTMLElement, onDown: () => void, onUp?: () => void) {
  let pid: number | null = null;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pid !== null) return;
    pid = e.pointerId;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('pressed');
    navigator.vibrate?.(8);
    onDown();
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    pid = null;
    btn.classList.remove('pressed');
    onUp?.();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function pickSmash(s: SmashState): Screen {
  const id = store.playerId!;
  const f = s.fighters[id];
  if (!f) return ['spectate', message('Du schaust zu', 'Smash-Arena läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const won = s.winner === id;
    return [`sm-over-${won}`, message(won ? 'Du hast gewonnen!' : 'SPIEL!', won ? 'Champion der Arena!' : 'Schau auf den Fernseher!')];
  }
  if (f.state === 'out') return ['sm-out', message('K.O. – du bist raus!', `${f.kos === 1 ? '1 K.O.' : `${f.kos} K.O.s`} verteilt. Feuer die anderen an!`)];

  return ['sm-play', () => {
    const sp = SPECIALS[f.special];
    const root = el(`
      <div class="smash">
        <div class="sm-top">
          <span class="sm-av"></span>
          <span class="sm-pct">0%</span>
          <span class="sm-stocks"></span>
          <span class="sm-timer"></span>
        </div>
        <div class="sm-info"><b>Spezial: ${escapeHtml(sp.name)}</b><span class="sm-hint"></span></div>
        <div class="sm-pad">
          <div class="sm-zone">
            <div class="sm-ring"><div class="sm-knob"></div></div>
            <span class="sm-zone-label">Bewegen · ▼ = ducken / durchfallen</span>
          </div>
          <div class="sm-btns">
            <button class="sm-btn b">SPEZIAL<i class="cd"></i></button>
            <button class="sm-btn jump">SPRUNG</button>
            <button class="sm-btn shield">SCHILD</button>
            <button class="sm-btn a">SCHLAG</button>
          </div>
        </div>
      </div>
    `);
    const pl = me();
    if (pl) q(root, '.sm-av').append(avatarCanvas(2, pl.look));
    const stick = floatingStick(q(root, '.sm-zone'), (x, y) => send('stick', { x, y }));
    const press = (b: string) => () => {
      const d = stick();
      send('btn', { b, down: true, x: d.x, y: d.y });
    };
    holdButton(q(root, '.sm-btn.a'), press('a'));
    holdButton(q(root, '.sm-btn.b'), press('b'));
    holdButton(q(root, '.sm-btn.jump'), press('jump'));
    holdButton(q(root, '.sm-btn.shield'), press('shield'), () => send('btn', { b: 'shield', down: false }));
    app.append(root);

    let lastPct = f.pct;
    let lastStocks = f.stocks;
    return () => {
      const st = store.state?.mini?.kind === 'smash' ? store.state.mini.state : null;
      const me2 = st?.fighters[id];
      if (!st || !me2) return;
      const pct = q(root, '.sm-pct');
      pct.textContent = `${me2.pct}%`;
      pct.style.color = pctColor(me2.pct);
      q(root, '.sm-stocks').textContent = '●'.repeat(me2.stocks);
      const secs = Math.ceil(st.endsIn / 1000);
      q(root, '.sm-timer').textContent = st.sub === 'countdown' ? `Start in ${secs}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const cdFrac = Math.min(1, me2.cd / sp.cooldown);
      (q(root, '.sm-btn.b .cd') as HTMLElement).style.height = `${cdFrac * 100}%`;
      q(root, '.sm-btn.b').classList.toggle('cooling', me2.cd > 0);
      const shieldBtn = q(root, '.sm-btn.shield');
      shieldBtn.style.setProperty('--shield', `${me2.shield}%`);
      let hint = sp.text;
      if (st.sub === 'countdown') hint = `${sp.text} Joystick-Richtung + SCHLAG = andere Schläge.`;
      else if (me2.state === 'respawn') hint = 'Autsch! Gleich bist du wieder da ...';
      else if (me2.hold) hint = `${me2.hold === 'kokos' ? 'Kokosnuss' : 'Wasserbombe'} in der Hand – SCHLAG zum Werfen!`;
      else if (me2.anim === 'dizzy') hint = 'Schild kaputt – du bist benommen!';
      q(root, '.sm-hint').textContent = hint;
      if (me2.pct > lastPct) navigator.vibrate?.(Math.min(60, 15 + (me2.pct - lastPct) * 3));
      if (me2.stocks < lastStocks) navigator.vibrate?.([120, 60, 120]);
      lastPct = me2.pct;
      lastStocks = me2.stocks;
    };
  }];
}
