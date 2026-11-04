import type { KurveState } from '../../../shared/types';
import { KURVE, KURVE_POWER_INFO } from '../../../shared/games';
import { type Screen, app, el, message, nameOf, q, send, store } from '../core';

/**
 * Halte-Knopf, der mehrere Finger verträgt: gedrückt, solange mindestens ein Pointer drauf ist.
 * (Kein click – der käme erst beim Loslassen.)
 */
function holdButton(btn: HTMLElement, onChange: () => void) {
  const pointers = new Set<number>();
  const update = () => {
    btn.classList.toggle('held', pointers.size > 0);
    onChange();
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    pointers.add(e.pointerId);
    update();
  });
  const up = (e: PointerEvent) => {
    if (pointers.delete(e.pointerId)) update();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return {
    get held() {
      return pointers.size > 0;
    },
    reset() {
      pointers.clear();
      btn.classList.remove('held');
    },
  };
}

export function pickKurve(s: KurveState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['kv-over', message('Endstand!', 'Schau auf den Fernseher!')];
  // Ein einziger Screen für alle Runden – so bleiben gehaltene Finger beim Phasenwechsel erhalten
  return ['kv-play', () => {
    const color = KURVE.COLORS[me.color] ?? '#fff';
    const root = el(`
      <div class="kv-color" style="background:${color}">Du bist <b>${KURVE.COLOR_NAMES[me.color] ?? '?'}</b></div>
      <div class="top-row"><span class="round"></span><span class="score"></span></div>
      <p class="kv-status"></p>
      <div class="kv-btns">
        <button class="big-btn kv-btn kv-left">◀<br/>LINKS</button>
        <button class="big-btn kv-btn kv-right">RECHTS<br/>▶</button>
      </div>
    `);
    let lastDir = 0;
    const emit = (force = false) => {
      const dir = (right.held ? 1 : 0) - (left.held ? 1 : 0);
      if (!force && dir === lastDir) return;
      if (dir !== lastDir && dir !== 0) navigator.vibrate?.(8);
      lastDir = dir;
      send('turn', { dir });
    };
    const left = holdButton(q(root, '.kv-left'), () => emit());
    const right = holdButton(q(root, '.kv-right'), () => emit());
    // Falls ein Paket verloren geht: Richtung regelmäßig wiederholen
    const keepAlive = setInterval(() => {
      if (!root.isConnected) return clearInterval(keepAlive);
      emit(true);
    }, 400);
    const release = () => {
      if (!root.isConnected) {
        window.removeEventListener('blur', release);
        document.removeEventListener('visibilitychange', release);
        return;
      }
      left.reset();
      right.reset();
      emit();
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    app.append(root);

    let deadRound = 0;
    return () => {
      const st = store.state?.mini?.kind === 'kurve' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      q(root, '.round').textContent = `Runde ${st.round}/${st.rounds}`;
      q(root, '.score').textContent = `${p.score} Punkte`;
      const alive = Object.values(st.players).filter((h) => h.alive).length;
      let status: string;
      if (st.sub === 'countdown') status = `Gleich geht’s los! Dein Kopf blinkt ${KURVE.COLOR_NAMES[p.color]} auf dem TV.`;
      else if (st.sub === 'roundEnd') status = st.roundWinner ? (st.roundWinner === id ? 'Du gewinnst die Runde!' : `${nameOf(st.roundWinner)} gewinnt die Runde.`) : 'Runde vorbei!';
      else if (!p.alive) status = 'Crash! Du bist raus – warte auf die nächste Runde.';
      else if (p.fx.length) status = p.fx.map((f) => (f === 'slow' ? 'Du wirst ausgebremst!' : KURVE_POWER_INFO[f].label)).join(' ');
      else status = st.storm ? 'Sturm! Alle werden schneller ...' : `Noch ${alive} im Rennen – +1 für jeden Crash der anderen`;
      q(root, '.kv-status').textContent = status;
      root.querySelector('.kv-btns')!.classList.toggle('out', !p.alive && st.sub === 'play');
      if (!p.alive && st.sub === 'play' && deadRound !== st.round) {
        deadRound = st.round;
        navigator.vibrate?.([60, 40, 120]);
      }
    };
  }];
}
