import type { ZauberState } from '../../../shared/types';
import { ZAUBER } from '../../../shared/zauber';
import { haptic } from '../haptic';
import { type Screen, app, avatarCanvas, el, me, message, myColor, nameOf, q, secondsLeft, send, store } from '../core';
import { floatingStick, holdButton } from './smash';

/**
 * Zauber-Arena am Handy (am besten quer): links schwebender Joystick zum Laufen, rechts
 * zwei große Knöpfe – ANGRIFF (Zielsuch-Feuerball) und EILE (Sprint), jeweils mit Abklingzeit.
 * Gezielt wird mit der Laufrichtung: der Feuerball fliegt grob dorthin, wohin man zuletzt
 * gelaufen ist (oder wohin der Stick beim Drücken zeigt) und sucht sich dann selbst sein Ziel –
 * deshalb reicht ein Stick, ein zweiter Ziel-Stick wäre unnötig fummelig.
 */
export function pickZauber(s: ZauberState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Zauber-Arena läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const best = Math.max(...Object.values(s.players).map((p) => p.wins));
    const won = mine.wins === best && Object.values(s.players).filter((p) => p.wins === best).length === 1;
    return [`zb-over-${won}`, message(won ? 'Erzmagier!' : 'Zauber-Arena vorbei!', won ? 'Du hast die Zauber-Arena gewonnen!' : 'Schau auf den Fernseher!')];
  }
  if (!mine.alive && s.sub === 'play') {
    const msg = message('Verpufft!', 'Puff – du bist für diese Runde raus. Feuer die anderen an!');
    return [`zb-dead-${s.round}`, () => {
      haptic([60, 40, 140]);
      return msg();
    }];
  }

  return ['zb-play', () => {
    const look = me()?.look;
    const color = myColor()?.hex ?? '#9b5fc0';
    const root = el(`
      <div class="smash zauber" style="--zb-color:${color}">
        <div class="sm-top zb-top">
          <span class="sm-av"></span>
          <span class="zb-hp"><i></i><b></b></span>
          <span class="zb-wins"></span>
        </div>
        <div class="sm-info"><b class="zb-title">Zauber-Arena</b><span class="sm-hint zb-hint"></span></div>
        <div class="sm-pad">
          <div class="sm-zone">
            <div class="sm-ring"><div class="sm-knob"></div></div>
            <span class="zb-aim">➤</span>
            <span class="sm-zone-label">Laufen · Laufrichtung = Zielrichtung</span>
          </div>
          <div class="zb-btns">
            <button class="sm-btn zb-sprint">EILE<i class="cd"></i></button>
            <button class="sm-btn zb-cast">ANGRIFF<i class="cd"></i></button>
          </div>
        </div>
      </div>
    `);
    if (look) q(root, '.sm-av').append(avatarCanvas(2, look));
    const aimEl = q(root, '.zb-aim');
    let aimDeg = mine.a;
    const showAim = () => (aimEl.style.transform = `translate(-50%, -50%) rotate(${aimDeg}deg)`);
    showAim();
    const stick = floatingStick(q(root, '.sm-zone'), (x, y) => {
      send('stick', { x, y });
      if (Math.hypot(x, y) > 0.2) {
        aimDeg = Math.round((Math.atan2(y, x) * 180) / Math.PI);
        showAim();
      }
    });
    const press = (action: string) => () => {
      const d = stick();
      // Stick gerade gedrückt → genau diese Richtung, sonst die letzte Laufrichtung (Server)
      send(action, Math.hypot(d.x, d.y) > 0.2 ? { x: d.x, y: d.y } : {});
    };
    holdButton(q(root, '.zb-cast'), press('cast'));
    holdButton(q(root, '.zb-sprint'), press('sprint'));
    app.append(root);

    let hits = mine.hits;
    let lastHud = '';
    return () => {
      const st = store.state?.mini?.kind === 'zauber' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      // Server-Zielrichtung übernehmen, wenn der Stick ruht (z. B. nach dem Wurf)
      const d = stick();
      if (Math.hypot(d.x, d.y) <= 0.2 && p.a !== aimDeg) {
        aimDeg = p.a;
        showAim();
      }
      const hud = `${p.hp}-${p.lava}-${p.wins}-${st.round}`;
      if (hud !== lastHud) {
        lastHud = hud;
        const hpEl = q(root, '.zb-hp');
        (q(hpEl, 'i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, (p.hp / ZAUBER.HP) * 100))}%`;
        hpEl.classList.toggle('low', p.hp <= 35);
        hpEl.classList.toggle('lava', p.lava);
        q(hpEl, 'b').textContent = `${p.hp}`;
        q(root, '.zb-wins').innerHTML = `R${st.round} ${Array.from({ length: st.winRounds }, (_, i) => `<i class="bg-pip${i < p.wins ? ' on' : ''}"></i>`).join('')}`;
      }
      let title = 'Zauber-Arena';
      let hint = '';
      if (st.sub === 'countdown') {
        title = `Runde ${st.round}`;
        hint = `Gleich geht’s los … ${secondsLeft()} · Feuerbälle schleudern weg – ab in die Lava mit ihnen!`;
      } else if (st.sub === 'roundOver') {
        title = 'Runde vorbei';
        hint = st.roundWinner === id ? 'Rundensieg! Du hast als Letzte(r) durchgehalten!' : st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle verpufft – Unentschieden!';
      } else if (p.lava) {
        title = 'LAVA! Raus da!';
        hint = 'Lava frisst deine Lebenspunkte – zurück auf den Stein, EILE hilft!';
      } else if (st.sudden) {
        title = 'EINSTURZ!';
        hint = 'Die letzte Insel zerfällt – halte durch!';
      } else if (p.stun) hint = 'Getroffen! Du fliegst …';
      else if (p.sprint) hint = 'Eilzauber! Schnell weg – oder ran an den Gegner.';
      else hint = 'ANGRIFF wirft einen Feuerball, der Gegner verfolgt. EILE = kurz rennen und ausweichen.';
      q(root, '.zb-title').textContent = title;
      q(root, '.zb-hint').textContent = hint;
      const cast = q(root, '.zb-cast');
      const sprint = q(root, '.zb-sprint');
      (q(cast, '.cd') as HTMLElement).style.height = `${Math.min(1, p.cdA / ZAUBER.BOLT_CD_MS) * 100}%`;
      (q(sprint, '.cd') as HTMLElement).style.height = `${Math.min(1, p.cdB / ZAUBER.SPRINT_CD_MS) * 100}%`;
      cast.classList.toggle('cooling', p.cdA > 0);
      sprint.classList.toggle('cooling', p.cdB > 0);
      sprint.classList.toggle('active', p.sprint);
      q(root, '.zauber').classList.toggle('in-lava', p.lava);
      if (p.hits > hits) {
        hits = p.hits;
        haptic([40, 30, 70]);
      }
    };
  }];
}
