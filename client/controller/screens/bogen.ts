import type { BogenState } from '../../../shared/types';
import { BOGEN, BOGEN_COLORS, BOGEN_POWERS, bogenSnap } from '../../../shared/bogen';
import { haptic } from '../haptic';
import { type Screen, app, avatarCanvas, el, me, message, nameOf, q, send, store } from '../core';
import { floatingStick, holdButton } from './smash';

/** Pfeile als kleine Symbole (Wasserbomben-Pfeile blau) */
function quiverHtml(arrows: number, bombs: number) {
  if (!arrows) return '<span class="bg-empty">leer!</span>';
  let s = `<b class="bg-count">${arrows}×</b>`;
  for (let i = 0; i < arrows; i++) s += `<i class="bg-arrow${i < bombs ? ' bomb' : ''}"></i>`;
  return s;
}

/** Pfeile nach Ziel-Richtung (0 = rechts, im Uhrzeigersinn) */
const AIM_GLYPH = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

/** Bogen-Arena am Handy: Joystick (laufen + zielen), SPRUNG, SCHUSS, DASH */
export function pickBogen(s: BogenState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu', 'Bogen-Arena läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const best = Math.max(...Object.values(s.players).map((p) => p.wins));
    const won = mine.wins === best && Object.values(s.players).filter((p) => p.wins === best).length === 1;
    return [`bg-over-${won}`, message(won ? 'Meisterschütze!' : 'Bogen-Arena vorbei!', won ? 'Du hast die Bogen-Arena gewonnen!' : 'Schau auf den Fernseher!')];
  }
  if (!mine.alive && s.sub === 'play') {
    const msg = message('Getroffen!', 'Puff – du bist für diese Runde raus. Feuer die anderen an!');
    return [`bg-dead-${s.round}`, () => {
      haptic([60, 40, 120]);
      return msg();
    }];
  }

  return ['bg-play', () => {
    const idx = Object.keys(s.players).indexOf(id);
    const color = BOGEN_COLORS[Math.max(0, idx) % BOGEN_COLORS.length];
    const root = el(`
      <div class="smash bogen" style="--bg-color:${color}">
        <div class="sm-top bg-top">
          <span class="sm-av"></span>
          <span class="bg-quiver"></span>
          <span class="bg-wins"></span>
        </div>
        <div class="sm-info"><b class="bg-title"></b><span class="sm-hint bg-hint"></span></div>
        <div class="sm-pad">
          <div class="sm-zone">
            <div class="sm-ring"><div class="sm-knob"></div></div>
            <span class="bg-aim"></span>
            <span class="sm-zone-label">Laufen + Zielen (8 Richtungen) · ▼ = durch Planken fallen</span>
          </div>
          <div class="bg-btns">
            <button class="sm-btn bg-dash">DASH<i class="cd"></i></button>
            <button class="sm-btn bg-shoot">SCHUSS</button>
            <button class="sm-btn jump bg-jump">SPRUNG</button>
          </div>
        </div>
      </div>
    `);
    const pl = me();
    if (pl) q(root, '.sm-av').append(avatarCanvas(2, pl.look));
    const aimEl = q(root, '.bg-aim');
    const showAim = (x: number, y: number) => {
      const d = bogenSnap(x, y);
      aimEl.textContent = d >= 0 ? AIM_GLYPH[d] : '';
    };
    const stick = floatingStick(q(root, '.sm-zone'), (x, y) => {
      send('stick', { x, y });
      showAim(x, y);
    });
    const press = (b: string) => () => {
      const d = stick();
      send('btn', { b, down: true, x: d.x, y: d.y });
    };
    holdButton(q(root, '.bg-shoot'), press('shoot'));
    holdButton(q(root, '.bg-dash'), press('dash'));
    holdButton(q(root, '.bg-jump'), press('jump'), () => send('btn', { b: 'jump', down: false }));
    app.append(root);

    let lastArrows = -1;
    let lastKey = '';
    return () => {
      const st = store.state?.mini?.kind === 'bogen' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      const qKey = `${p.arrows}-${p.bombs}`;
      if (qKey !== lastKey) {
        lastKey = qKey;
        q(root, '.bg-quiver').innerHTML = quiverHtml(p.arrows, p.bombs);
      }
      q(root, '.bg-wins').innerHTML = `R${st.round} ${Array.from({ length: st.winRounds }, (_, i) => `<i class="bg-pip${i < p.wins ? ' on' : ''}"></i>`).join('')}`;
      let title = 'Bogen-Arena';
      if (p.bombs > 0) title = `${BOGEN_POWERS.bombe.name} ×${p.bombs}`;
      else if (p.double > 0) title = `${BOGEN_POWERS.doppel.name} ×${p.double}`;
      else if (p.shield) title = BOGEN_POWERS.schild.name;
      q(root, '.bg-title').textContent = title;
      let hint = '';
      if (st.sub === 'countdown') hint = `Runde ${st.round} startet gleich … Ein Treffer und du bist raus – auch ein Sprung auf den Kopf!`;
      else if (st.sub === 'roundOver') hint = st.roundWinner === id ? 'Rundensieg! Du hast als Letzte(r) überlebt!' : st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Unentschieden!';
      else if (p.arrows === 0) hint = 'Köcher leer! Lauf über steckende Pfeile, um sie aufzusammeln.';
      else if (p.dash) hint = 'Ausweichen! Pfeile, die dich jetzt treffen, fängst du.';
      else hint = 'Joystick-Richtung = Schussrichtung. DASH im richtigen Moment fängt Pfeile!';
      q(root, '.bg-hint').textContent = hint;
      const dash = q(root, '.bg-dash');
      (q(root, '.bg-dash .cd') as HTMLElement).style.height = `${Math.min(1, p.cd / BOGEN.DASH_CD_MS) * 100}%`;
      dash.classList.toggle('cooling', p.cd > 0);
      q(root, '.bg-shoot').classList.toggle('empty', p.arrows === 0);
      if (lastArrows >= 0 && p.arrows > lastArrows) haptic(15);
      lastArrows = p.arrows;
    };
  }];
}

