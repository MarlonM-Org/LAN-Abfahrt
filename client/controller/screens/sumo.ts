import type { SumoState } from '../../../shared/types';
import { SUMO } from '../../../shared/sumo';
import { SHIRTS } from '../../../shared/avatar';
import { type Screen, app, avatarCanvas, el, me, message, nameOf, q, secondsLeft, send, store, tapButton } from '../core';
import { joystick } from './controller';

/** Sumo-Steg: Joystick links, REMPELN rechts */
export function pickSumo(s: SumoState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Sumo-Steg läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['su-over', message('Sumo-Steg vorbei!', 'Schau auf den Fernseher!')];
  if (!mine.alive && s.sub === 'play') return [`su-dead-${s.round}`, message('Im Wasser – zuschauen', 'PLATSCH! Du dümpelst im Schwimmring und schaust zu, bis die Runde vorbei ist.')];
  return ['su-ctl', () => {
    const look = me()?.look;
    const color = look ? SHIRTS[look.shirt] : '#f2c33a';
    const root = el(`
      <div class="arena-head" style="border-color:${color}">
        <span class="arena-av"></span>
        <div><div class="arena-round su-round"></div><div class="arena-stats su-stats"></div></div>
      </div>
      <p class="hint arena-hint su-hint"></p>
      <div class="arena-controls">
        <div class="stick-area"></div>
        <button class="big-btn su-dash">REMPELN<span class="su-cd"></span></button>
      </div>
    `);
    if (look) q(root, '.arena-av').append(avatarCanvas(3, look));
    joystick(q(root, '.stick-area'), (x, y) => send('stick', { x, y }));
    const dash = q<HTMLButtonElement>(root, '.su-dash');
    const cd = q(root, '.su-cd');
    tapButton(dash, () => {
      if (dash.disabled) return;
      send('dash');
      navigator.vibrate?.(30);
    });
    let hits = mine.hits;
    app.append(root);
    return () => {
      const st = store.state?.mini?.kind === 'sumo' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      q(root, '.su-round').textContent = `Runde ${st.round} · Siege ${p.wins}/${st.winRounds}`;
      q(root, '.su-stats').textContent = `${p.pushes}× ins Wasser geschubst`;
      let hint = '';
      if (st.sub === 'countdown') hint = `Gleich geht’s los … ${secondsLeft()}`;
      else if (st.sub === 'roundOver') hint = st.roundWinner === id ? 'Rundensieg! Du bist trocken geblieben!' : st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle im Wasser – Unentschieden!';
      else if (st.sudden) hint = 'Der Steg bricht! Halt dich fest!';
      else if (p.stun) hint = 'Uff! Getroffen …';
      else hint = 'Schubs sie vom Steg!';
      q(root, '.su-hint').textContent = hint;
      if (p.hits > hits) {
        hits = p.hits;
        navigator.vibrate?.([40, 30, 60]);
      }
      const ready = st.sub === 'play' && p.alive && p.cd <= 0;
      dash.disabled = !ready;
      // Abklingzeit als Füllstand
      const frac = st.sub === 'play' && p.cd > 0 ? p.cd / SUMO.DASH_COOLDOWN_MS : 0;
      cd.style.transform = `scaleY(${frac})`;
    };
  }];
}
