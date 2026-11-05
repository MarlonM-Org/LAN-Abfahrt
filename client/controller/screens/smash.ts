import type { SmashState } from '../../../shared/types';
import { SPECIALS, pctColor } from '../../../shared/smash';
import { type Screen, app, avatarCanvas, el, escapeHtml, me, message, q, send, store } from '../core';
import { onInputReset, stickZone } from '../stick';
import { haptic } from '../haptic';

/**
 * Schwebender Joystick für Smash/Bogen/Zauber – jetzt der gemeinsame aus stick.ts
 * (Deadzone, mitziehender Ring, input-reset). Der alte Ring im Markup wird ersetzt.
 */
export function floatingStick(zone: HTMLElement, onMove: (x: number, y: number) => void) {
  zone.querySelector('.sm-ring')?.remove();
  return stickZone(zone, onMove);
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
    haptic(8);
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
  // Handy gedreht / Ausrichtungs-Overlay: losgelassen
  onInputReset(btn, () => {
    if (pid === null) return;
    pid = null;
    btn.classList.remove('pressed');
    onUp?.();
  });
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
      if (me2.pct > lastPct) haptic(Math.min(60, 15 + (me2.pct - lastPct) * 3));
      if (me2.stocks < lastStocks) haptic([120, 60, 120]);
      lastPct = me2.pct;
      lastStocks = me2.stocks;
    };
  }];
}
