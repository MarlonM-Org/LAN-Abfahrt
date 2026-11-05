import type { WackelState } from '../../../shared/wackel';
import { haptic } from '../haptic';
import { type Screen, app, avatarCanvas, el, me, message, myColor, nameOf, q, secondsLeft, send, store } from '../core';
import { floatingStick, holdButton } from './smash';

/**
 * Wackel-Prügelei am Handy (quer halten): links schwebender Joystick zum Torkeln und Lehnen,
 * rechts drei Knöpfe – SPRINGEN, HAUEN (schlägt in Stick-Richtung) und GREIFEN (gedrückt halten:
 * die Hände kleben an Spielern, Kanten und dem Kranhaken; loslassen mit Stick-Richtung = Wurf).
 */
export function pickWackel(s: WackelState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Wackel-Prügelei läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const best = Math.max(...Object.values(s.players).map((p) => p.wins));
    const won = mine.wins === best && Object.values(s.players).filter((p) => p.wins === best).length === 1;
    return [`wk-over-${won}`, message(won ? 'Wackel-Champion!' : 'Wackel-Prügelei vorbei!', won ? 'Du bist als Einzige(r) trocken geblieben!' : 'Schau auf den Fernseher!')];
  }
  if (!mine.alive && s.sub === 'play') {
    const msg = message('PLATSCH!', 'Du dümpelst im Schwimmring – feuer die anderen an!');
    return [`wk-dead-${s.round}`, () => {
      haptic([60, 40, 140]);
      return msg();
    }];
  }

  return ['wk-play', () => {
    const look = me()?.look;
    const color = myColor()?.hex ?? '#e0503f';
    const root = el(`
      <div class="smash wackel" style="--wk-color:${color}">
        <div class="sm-top wk-top">
          <span class="sm-av"></span>
          <span class="wk-wins"></span>
          <span class="sm-timer wk-timer"></span>
        </div>
        <div class="sm-info"><b class="wk-title">Wackel-Prügelei</b><span class="sm-hint wk-hint"></span></div>
        <div class="sm-pad">
          <div class="sm-zone">
            <div class="sm-ring"><div class="sm-knob"></div></div>
            <span class="sm-zone-label">Torkeln · Richtung = Schlag / Wurf</span>
          </div>
          <div class="wk-btns">
            <button class="sm-btn wk-jump">SPRINGEN</button>
            <button class="sm-btn wk-grab">GREIFEN<small>halten</small></button>
            <button class="sm-btn wk-punch">HAUEN<i class="cd"></i></button>
          </div>
        </div>
      </div>
    `);
    if (look) q(root, '.sm-av').append(avatarCanvas(2, look));
    const stick = floatingStick(q(root, '.sm-zone'), (x, y) => send('stick', { x, y }));
    const press = (b: string, down = true) => () => {
      const d = stick();
      send('btn', { b, down, x: d.x, y: d.y });
    };
    holdButton(q(root, '.wk-jump'), press('jump'));
    holdButton(q(root, '.wk-punch'), press('punch'));
    const grabBtn = q(root, '.wk-grab');
    holdButton(grabBtn, press('grab'), press('grab', false));
    app.append(root);

    let lastHud = '';
    let lastStun = mine.stun;
    let lastHeld = mine.held;
    let lastHits = mine.hits;
    return () => {
      const st = store.state?.mini?.kind === 'wackel' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      const hud = `${p.wins}-${p.outs}-${st.round}-${st.sudden}`;
      if (hud !== lastHud) {
        lastHud = hud;
        q(root, '.wk-wins').innerHTML = `R${st.round} ${Array.from({ length: st.winRounds }, (_, i) => `<i class="bg-pip${i < p.wins ? ' on' : ''}"></i>`).join('')} <span class="wk-outs">${p.outs}× raus</span>`;
      }
      const secs = Math.ceil(st.endsIn / 1000);
      q(root, '.wk-timer').textContent = st.sub === 'countdown' ? `Start in ${Math.max(1, secondsLeft())}` : st.sudden ? `FLUT ${secs}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      (q(root, '.wk-punch .cd') as HTMLElement).style.height = `${Math.min(100, (p.cd / 520) * 100)}%`;
      q(root, '.wk-punch').classList.toggle('cooling', p.cd > 0);
      grabBtn.classList.toggle('holding', p.grab === 1);
      grabBtn.classList.toggle('hanging', p.grab === 2);
      root.querySelector('.wackel')!.classList.toggle('stunned', p.stun);
      let title = 'Wackel-Prügelei';
      let hint = '';
      if (st.sub === 'countdown') {
        title = `Runde ${st.round}`;
        hint = 'Gleich geht’s los … HAUEN betäubt, GREIFEN halten packt – an der Kante loslassen = Wurf!';
      } else if (st.sub === 'roundOver') {
        title = 'Runde vorbei';
        hint = st.roundWinner === id ? 'Rundensieg! Du bist als Letzte(r) trocken geblieben!' : st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle baden gegangen – Unentschieden!';
      } else if (p.stun) {
        title = 'Benommen!';
        hint = 'Autsch – deine Puppe sackt zusammen. Gleich stehst du wieder …';
      } else if (p.held) {
        title = 'Festgehalten!';
        hint = 'Zappeln und HAUEN – wer zuschlägt, kommt frei!';
      } else if (p.grab === 2) {
        title = 'Du hängst!';
        hint = 'SPRINGEN zieht dich hoch – GREIFEN loslassen = fallen.';
      } else if (p.grab === 1) {
        title = 'Gepackt!';
        hint = 'Zur Kante schleppen, Stick nach außen und GREIFEN loslassen = Wurf!';
      } else if (st.sudden) {
        title = 'DAS WASSER STEIGT!';
        hint = 'Hoch hinaus – wer zuletzt trocken ist, gewinnt.';
      } else hint = 'Joystick torkeln · SPRINGEN · HAUEN in Stick-Richtung · GREIFEN halten (Spieler, Kanten, Haken)';
      q(root, '.wk-title').textContent = title;
      q(root, '.wk-hint').textContent = hint;
      if (p.stun && !lastStun) haptic('hit');
      if (p.held && !lastHeld) haptic([30, 30, 30]);
      if (p.hits > lastHits) haptic('tap');
      lastStun = p.stun;
      lastHeld = p.held;
      lastHits = p.hits;
    };
  }];
}
