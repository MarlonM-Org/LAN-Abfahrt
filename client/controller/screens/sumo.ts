import type { SumoState } from '../../../shared/types';
import { SUMO } from '../../../shared/sumo';
import { SHIRTS } from '../../../shared/avatar';
import { type Screen, app, avatarCanvas, el, me, message, nameOf, q, secondsLeft, send, store, tapButton } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';
import { spectatorBar } from '../spectator';
import { SPECTATOR } from '../../../shared/spectator';

/** Sumo-Steg (quer): schwebender Stick links, REMPELN rechts */
export function pickSumo(s: SumoState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Sumo-Steg läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['su-over', message('Sumo-Steg vorbei!', 'Schau auf den Fernseher!')];
  // Raus: als Geist alle 5 s eine Welle über den Steg schicken + auf den Rundensieger tippen
  if (!mine.alive && (s.sub === 'play' || s.sub === 'roundOver')) return [`su-dead-${s.round}`, buildSumoGhost, 'any'];
  return ['su-ctl', () => {
    const look = me()?.look;
    const color = look ? SHIRTS[look.shirt] : '#f2c33a';
    const root = el(`
      <div class="lx ar-lx su-lx" style="--ar-color:${color}">
        <div class="lx-head"><span class="arena-av"></span><span class="arena-round su-round"></span><span class="arena-stats su-stats grow"></span></div>
        <div class="lx-left ar-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
        <div class="lx-mid"><p class="hint arena-hint su-hint"></p></div>
        <div class="lx-right"><button class="big-btn su-dash">REMPELN<span class="su-cd"></span></button></div>
      </div>
    `);
    if (look) q(root, '.arena-av').append(avatarCanvas(1, look));
    stickZone(q(root, '.ar-stick'), (x, y) => send('stick', { x, y }));
    const dash = q<HTMLButtonElement>(root, '.su-dash');
    const cd = q(root, '.su-cd');
    tapButton(dash, () => {
      if (dash.disabled) return;
      send('dash');
      haptic(30);
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
        haptic([40, 30, 60]);
      }
      const ready = st.sub === 'play' && p.alive && p.cd <= 0;
      dash.disabled = !ready;
      // Abklingzeit als Füllstand
      const frac = st.sub === 'play' && p.cd > 0 ? p.cd / SUMO.DASH_COOLDOWN_MS : 0;
      cd.style.transform = `scaleY(${frac})`;
    };
  }];
}

/** Quer: links Hinweis + Zuschauer-Leiste, rechts der WELLE-Knopf */
function buildSumoGhost() {
  const id = store.playerId!;
  const root = el(`
    <div class="lx su-ghost">
      <div class="lx-head"><b>🌊 Im Wasser</b><span class="arena-round su-round"></span><span class="arena-stats grow su-ghint"></span></div>
      <div class="lx-left su-ghost-info"></div>
      <div class="lx-mid"><p class="su-gtext">PLATSCH! Schick eine Welle vom Rand über den Steg – sie schubst alle, die sie erwischt.</p></div>
      <div class="lx-right"><button class="big-btn ghost-wave">🌊<br/>WELLE<small>alle 5 s</small><i class="cd"></i></button></div>
    </div>
  `);
  const wave = q<HTMLButtonElement>(root, '.ghost-wave');
  const cd = q(root, '.ghost-wave .cd');
  tapButton(wave, () => {
    if (wave.disabled) return;
    send('wave');
    haptic([20, 30, 40]);
  });
  const bar = spectatorBar(q(root, '.su-ghost-info'));
  app.append(root);
  haptic([60, 40, 120]);
  return () => {
    bar();
    const st = store.state?.mini?.kind === 'sumo' ? store.state.mini.state : null;
    if (!st) return;
    const g = st.ghosts?.[id];
    const p = st.players[id];
    q(root, '.su-round').textContent = `Runde ${st.round}`;
    q(root, '.su-ghint').textContent = p ? `${p.pushes}× ins Wasser geschubst` : '';
    q(root, '.su-gtext').textContent =
      st.sub === 'roundOver'
        ? st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle im Wasser – Unentschieden!'
        : g && g.cd > 0 ? `Die nächste Welle baut sich auf … ${Math.ceil(g.cd / 1000)}s` : 'PLATSCH! Schick eine Welle vom Rand über den Steg – sie schubst alle, die sie erwischt.';
    wave.disabled = !(st.sub === 'play' && g && g.cd <= 0);
    cd.style.transform = `scaleY(${g && st.sub === 'play' ? Math.min(1, g.cd / SPECTATOR.SUMO_WAVE_MS) : 1})`;
  };
}
