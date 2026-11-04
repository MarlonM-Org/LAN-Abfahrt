import { GRILL_INGS, GRILL_RECIPES, type GrillItem, type GrillState, grillHint, itemLabel, newBase } from '../../../shared/grill';
import { TEAM_INFO } from '../../../shared/flunky';
import { grillItemKey, grillItemPix } from '../../art/grill';
import { type Screen, app, el, message, q, send, store, tapButton } from '../core';
import { joystick } from './controller';

/** Gegenstand groß und pixelig auf ein Canvas malen */
function paintItem(cv: HTMLCanvasElement, item: GrillItem | null, scale: number) {
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  if (!item) return;
  const src = grillItemPix(item).canvas;
  g.drawImage(src, 0, 0, src.width * scale, src.height * scale);
}

export function pickGrill(s: GrillState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') {
    const k = s.kitchens[me.k];
    const sub = s.teams
      ? s.winner === k.team
        ? 'Euer Team hat gewonnen! Schau auf den Fernseher.'
        : s.winner
          ? 'Knapp verloren – schau auf den Fernseher!'
          : 'Unentschieden – schau auf den Fernseher!'
      : `${s.stars} von 3 Sternen – schau auf den Fernseher!`;
    return ['gr-over', message('Feierabend!', `${me.sv}× serviert · ${me.ch}× geschnippelt\n${sub}`)];
  }
  return [
    `gr-${s.sub}`,
    () => {
      const kit = s.kitchens[me.k];
      const badge = kit.team
        ? `<div class="team-badge team-${kit.team}">${TEAM_INFO[kit.team].name} – Küche ${kit.team === 'A' ? 'links' : 'rechts'}</div>`
        : `<div class="team-badge gr-coop">Gemeinsam kochen!</div>`;
      const root = el(`
        <div class="gr">
          ${badge}
          <div class="top-row"><span class="timer"></span><span class="score"></span></div>
          <div class="gr-carry">
            <canvas class="gr-held" width="88" height="80"></canvas>
            <div class="gr-carry-txt"><small>DU TRÄGST</small><b class="gr-what"></b></div>
          </div>
          <p class="gr-hint"></p>
          <div class="gr-orders"></div>
          <div class="gr-controls">
            <div class="stick-area"></div>
            <div class="gr-btns">
              <button class="big-btn gr-grab"><span class="gr-grab-l">NEHMEN</span><small class="gr-grab-s">aufheben</small></button>
              <button class="big-btn gr-act">AKTION<small>halten: schneiden/löschen</small></button>
            </div>
          </div>
        </div>
      `);
      joystick(q(root, '.stick-area'), (x, y) => send('stick', { x, y }));
      tapButton(q(root, '.gr-grab'), () => {
        send('grab');
        navigator.vibrate?.(12);
      });
      // AKTION: gedrückt halten (regelmäßig wiederholen, falls ein Paket verloren geht)
      const act = q<HTMLButtonElement>(root, '.gr-act');
      let actPointer: number | null = null;
      let actTimer: number | undefined;
      const release = (e?: PointerEvent) => {
        if (e && e.pointerId !== actPointer) return;
        actPointer = null;
        act.classList.remove('held');
        clearInterval(actTimer);
        send('act', { down: false });
      };
      act.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        act.setPointerCapture(e.pointerId);
        actPointer = e.pointerId;
        act.classList.add('held');
        send('act', { down: true });
        navigator.vibrate?.(8);
        clearInterval(actTimer);
        actTimer = window.setInterval(() => {
          if (!act.isConnected) return clearInterval(actTimer);
          send('act', { down: true });
        }, 300);
      });
      act.addEventListener('pointerup', release);
      act.addEventListener('pointercancel', release);
      act.addEventListener('contextmenu', (e) => e.preventDefault());
      app.append(root);

      const cv = q<HTMLCanvasElement>(root, '.gr-held');
      const orders = q(root, '.gr-orders');
      let heldKey = '?';
      let orderKey = '?';
      let prevNo = me.no;
      let prevSv = me.sv;
      let orderBars: { el: HTMLElement; id: number }[] = [];
      return () => {
        const st = store.state?.mini?.kind === 'grill' ? store.state.mini.state : null;
        const p = st?.players[id];
        if (!st || !p) return;
        const k = st.kitchens[p.k];
        q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
        q(root, '.score').textContent = st.teams ? `Sonne ${st.kitchens[0].score} : ${st.kitchens[1].score} Meer` : `${k.score} Punkte`;
        const hk = p.h ? grillItemKey(p.h) : '';
        if (hk !== heldKey) {
          heldKey = hk;
          paintItem(cv, p.h, 4);
          q(root, '.gr-what').textContent = itemLabel(p.h);
          q(root, '.gr-grab-l').textContent = p.h ? 'ABLEGEN' : 'NEHMEN';
          q(root, '.gr-grab-s').textContent = p.h ? 'ablegen · kombinieren · servieren' : 'aufheben';
        }
        let hint = grillHint(p.h);
        if (st.sub === 'countdown') hint = 'Gleich geht’s los! Schau auf die Bestellzettel am Fernseher.';
        else if (p.w) hint = p.h?.x ? 'Löschen ...' : 'Schnippel, schnippel ...';
        else if (k.slots.some((sl) => sl.f) && !p.h) hint = 'FEUER! Feuerlöscher holen und AKTION halten!';
        q(root, '.gr-hint').textContent = hint;
        root.querySelector('.gr')?.classList.toggle('fire', k.slots.some((sl) => sl.f));

        // Bestellungen klein
        const ok = k.orders.map((o) => o.id).join(',');
        if (ok !== orderKey) {
          orderKey = ok;
          orders.innerHTML = '';
          orderBars = k.orders.map((o) => {
            const R = GRILL_RECIPES[o.r];
            const box = el(`<div class="gr-order"><canvas width="44" height="40"></canvas><span>${R.name}</span><i><b></b></i></div>`).firstElementChild as HTMLElement;
            const dish: GrillItem = { ...newBase(R.base), p: R.parts.map((t) => ({ t, s: GRILL_INGS[t].path[GRILL_INGS[t].path.length - 1] })) };
            paintItem(box.querySelector('canvas')!, dish, 2);
            orders.append(box);
            return { el: box.querySelector('b') as HTMLElement, id: o.id };
          });
        }
        for (const b of orderBars) {
          const o = k.orders.find((x) => x.id === b.id);
          if (!o) continue;
          const f = o.left / o.dur;
          b.el.style.width = `${Math.round(f * 100)}%`;
          b.el.className = f < 0.25 ? 'low' : f < 0.5 ? 'mid' : '';
        }
        if (p.no > prevNo) navigator.vibrate?.([30, 40, 30]);
        if (p.sv > prevSv) navigator.vibrate?.(60);
        prevNo = p.no;
        prevSv = p.sv;
      };
    },
  ];
}
