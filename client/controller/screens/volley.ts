import type { VolleyState } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { VOLLEY } from '../../../shared/volley';
import { haptic } from '../haptic';
import { slideButtons } from '../slide';
import { type Screen, app, avatarCanvas, el, me, message, nameOf, q, secondsLeft, send, store } from '../core';

/** Strand-Volleyball: ◀ ▶ links, SPRUNG + SCHMETTERN rechts */
export function pickVolley(s: VolleyState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Strand-Volleyball läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const won = s.winner === mine.team;
    return [`vb-over-${won}`, message(won ? 'Gewonnen!' : 'Spiel vorbei!', `${TEAM_INFO[mine.team].name}: ${s.score[mine.team]} Punkte – schau auf den Fernseher!`)];
  }
  // Ein Screen fürs ganze Spiel, damit gehaltene Finger beim Phasen-/Bankwechsel erhalten bleiben
  return ['vb-play', () => {
    const team = TEAM_INFO[mine.team];
    const other = TEAM_INFO[mine.team === 'A' ? 'B' : 'A'];
    const look = me()?.look;
    // Quer wie am Gamepad: links ◀ ▶, rechts SCHMETTERN über SPRUNG
    const root = el(`
      <div class="lx vb vb-lx">
        <div class="lx-head"><span class="vb-av"></span><span class="lx-tag team-${mine.team}">${team.name}</span><span class="vb-score grow"></span></div>
        <div class="lx-left vb-move">
          <button class="big-btn vb-btn vb-left">◀</button>
          <button class="big-btn vb-btn vb-right">▶</button>
        </div>
        <div class="lx-mid"><p class="vb-status"></p></div>
        <div class="lx-right vb-act">
          <button class="big-btn vb-btn vb-spike">SCHMETTERN<i class="vb-cd"></i></button>
          <button class="big-btn vb-btn vb-jump">SPRUNG</button>
        </div>
      </div>
    `);
    if (look) q(root, '.vb-av').append(avatarCanvas(1, look));
    // ◀ ▶ zum Rüberrutschen: die Richtung folgt dem Daumen, nicht dem Knopf, auf dem er aufgesetzt hat.
    // Ganze linke Zone, jeder Punkt zählt zum näheren Knopf; bei zwei Fingern gewinnt der jüngste.
    // Loslassen (auch input-reset, Blur, App im Hintergrund) = stehen bleiben.
    let lastDir = 0;
    const emit = (force = false) => {
      const k = dirs.held()[0];
      const dir = k === 'right' ? 1 : k === 'left' ? -1 : 0;
      if (!force && dir === lastDir) return;
      if (dir !== lastDir && dir !== 0) haptic('tick');
      lastDir = dir;
      send('move', { dir });
    };
    const dirs = slideButtons(q(root, '.vb-move'), { left: q(root, '.vb-left'), right: q(root, '.vb-right') }, () => emit(), { slack: Infinity, exclusive: true });
    // SPRUNG / SCHMETTERN lösen beim Aufsetzen aus – und beim Draufrutschen (SPRUNG drücken, Daumen hoch = schmettern)
    const spikeBtn = q<HTMLButtonElement>(root, '.vb-spike');
    slideButtons(
      q(root, '.vb-act'),
      { spike: spikeBtn, jump: q(root, '.vb-jump') },
      () => undefined,
      {
        slack: 10,
        onEnter: (k) => {
          send(k);
          haptic(k === 'spike' ? 20 : 10);
        },
      },
    );
    // Falls ein Paket verloren geht: Richtung regelmäßig wiederholen
    const keepAlive = setInterval(() => {
      if (!root.isConnected) return clearInterval(keepAlive);
      emit(true);
    }, 500);
    app.append(root);

    let touches = mine.touches;
    let points = s.score.A + s.score.B;
    return () => {
      const st = store.state?.mini?.kind === 'volley' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      const ours = st.score[p.team];
      const theirs = st.score[p.team === 'A' ? 'B' : 'A'];
      q(root, '.vb-score').textContent = `${ours} : ${theirs} gegen ${other.name}`;
      let status: string;
      if (st.sub === 'intro') status = `Gleich geht’s los … ${secondsLeft()}  Du spielst ${p.team === 'A' ? 'links' : 'rechts'}.`;
      else if (!p.court) status = 'Du sitzt auf der Bank – nach dem nächsten Punkt wechselt jemand aus.';
      else if (st.sub === 'serve') status = st.server === id ? 'Dein Aufschlag! Stell dich unter den Ball und spring rein.' : `Aufschlag: ${nameOf(st.server)}`;
      else if (st.sub === 'point') status = st.lastPoint?.team === p.team ? 'Punkt für euch!' : 'Punkt für die anderen …';
      else status = p.air ? 'In der Luft: SCHMETTERN!' : 'Unter den Ball laufen und springen!';
      if (st.golden && st.sub !== 'intro') status = `GOLDEN POINT! ${status}`;
      q(root, '.vb-status').textContent = status;
      root.querySelector('.vb-lx')!.classList.toggle('bench', !p.court);
      const frac = p.cd > 0 ? p.cd / VOLLEY.SPIKE_CD_MS : 0;
      (q(root, '.vb-cd') as HTMLElement).style.transform = `scaleY(${frac})`;
      spikeBtn.classList.toggle('ready', p.court && p.air && p.cd <= 0);
      if (p.touches > touches) {
        touches = p.touches;
        haptic(p.spikes ? 25 : 15);
      }
      const total = st.score.A + st.score.B;
      if (total > points) {
        points = total;
        if (st.lastPoint?.team === p.team) haptic([30, 40, 30]);
      }
    };
  }];
}
