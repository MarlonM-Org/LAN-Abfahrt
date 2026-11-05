import { UMZUG_KINDS, type UmzugState, umzugGoals, umzugName } from '../../../shared/umzug';
import { TEAM_INFO } from '../../../shared/flunky';
import { umzugItemPix } from '../../art/umzug';
import { type Screen, app, el, message, q, send, store, tapButton } from '../core';
import { onInputReset, stickZone } from '../stick';
import { haptic } from '../haptic';

/** Möbelstück groß und pixelig auf ein Canvas malen */
function paintItem(cv: HTMLCanvasElement, k: number | null) {
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  if (k === null) return;
  const src = umzugItemPix(k).canvas;
  const scale = Math.max(2, Math.min(5, Math.floor(Math.min(cv.width / src.width, cv.height / src.height))));
  g.drawImage(src, Math.round((cv.width - src.width * scale) / 2), Math.round((cv.height - src.height * scale) / 2), src.width * scale, src.height * scale);
}

/**
 * Umzugschaos am Handy (quer wie am Gamepad): links Stick, Mitte „Du trägst“ + Hinweis + Sterne,
 * rechts GREIFEN (gedrückt halten = tragen bzw. ein Ende eines schweren Teils festhalten, loslassen =
 * absetzen) über WERFEN (ohne Teil in der Hand: SPRINT).
 */
export function pickUmzug(s: UmzugState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu', 'Umzugschaos läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') {
    const h = s.houses[me.k];
    const sub = s.teams
      ? s.winner === h.team
        ? 'Euer Team war schneller! Schau auf den Fernseher.'
        : s.winner
          ? 'Das andere Team war schneller – schau auf den Fernseher!'
          : 'Unentschieden – schau auf den Fernseher!'
      : `${s.stars} von 3 Sternen – schau auf den Fernseher!`;
    return ['um-over', message('Der Vermieter ist da!', `${me.st[0]}× getragen · ${me.st[1]}× Schweres geschleppt${me.st[3] ? ` · ${me.st[3]}× zerbrochen` : ''}\n${sub}`)];
  }
  return [
    `um-${s.sub}`,
    () => {
      const h = s.houses[me.k];
      const badge = h.team
        ? `<span class="lx-tag team-${h.team}">${TEAM_INFO[h.team].name} · Haus ${h.team === 'A' ? 'links' : 'rechts'}</span>`
        : `<span class="lx-tag gr-coop">Gemeinsam ausräumen!</span>`;
      const root = el(`
        <div class="lx gr um-lx">
          <div class="lx-head">${badge}<span class="timer"></span><span class="score grow"></span></div>
          <div class="lx-left um-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
          <div class="lx-mid">
            <div class="gr-carry">
              <canvas class="gr-held" width="88" height="80"></canvas>
              <div class="gr-carry-txt"><small class="um-carry-l">DU TRÄGST</small><b class="gr-what"></b></div>
            </div>
            <p class="gr-hint"></p>
            <div class="um-stars"></div>
          </div>
          <div class="lx-right gr-btns">
            <button class="big-btn gr-grab um-grab"><span class="gr-grab-l">GREIFEN</span><small class="gr-grab-s">halten = tragen</small></button>
            <button class="big-btn gr-act um-throw"><span class="um-throw-l">SPRINT</span><small class="um-throw-s">kurzer Spurt</small></button>
          </div>
        </div>
      `);
      stickZone(q(root, '.um-stick'), (x, y) => send('stick', { x, y }));
      // GREIFEN: gedrückt halten (regelmäßig wiederholen, falls ein Paket verloren geht)
      const grab = q<HTMLButtonElement>(root, '.um-grab');
      let grabPointer: number | null = null;
      let grabTimer: number | undefined;
      const release = (e?: PointerEvent) => {
        if (e && e.pointerId !== grabPointer) return;
        if (grabPointer === null) return;
        grabPointer = null;
        grab.classList.remove('held');
        clearInterval(grabTimer);
        send('grab', { down: false });
      };
      grab.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (grabPointer !== null) return;
        grab.setPointerCapture(e.pointerId);
        grabPointer = e.pointerId;
        grab.classList.add('held');
        send('grab', { down: true });
        haptic(10);
        clearInterval(grabTimer);
        grabTimer = window.setInterval(() => {
          if (!grab.isConnected) return clearInterval(grabTimer);
          send('grab', { down: true, again: true });
        }, 300);
      });
      grab.addEventListener('pointerup', release);
      grab.addEventListener('pointercancel', release);
      grab.addEventListener('lostpointercapture', release);
      onInputReset(grab, () => grabPointer !== null && release());
      grab.addEventListener('contextmenu', (e) => e.preventDefault());
      const thr = q<HTMLButtonElement>(root, '.um-throw');
      tapButton(thr, () => {
        send('throw');
        haptic(14);
      });
      app.append(root);

      const cv = q<HTMLCanvasElement>(root, '.gr-held');
      const stars = q(root, '.um-stars');
      let heldKey = -2;
      let prevNo = me.no;
      let prevPts = me.pts;
      let prevBroke = me.st[3];
      let starKey = '';
      return () => {
        const st = store.state?.mini?.kind === 'umzug' ? store.state.mini.state : null;
        const p = st?.players[id];
        if (!st || !p) return;
        const hs = st.houses[p.k];
        q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
        q(root, '.score').textContent = st.teams ? `Sonne ${st.houses[0].score} : ${st.houses[1].score} Meer` : `${hs.score} Pkt · noch ${hs.left}`;
        const item = p.g !== null ? st.items.find((i) => i.id === p.g) : undefined;
        const k = item ? item.k : -1;
        if (k !== heldKey) {
          heldKey = k;
          paintItem(cv, item ? item.k : null);
          const kind = item ? UMZUG_KINDS[item.k] : null;
          q(root, '.um-carry-l').textContent = kind?.heavy ? 'DU HÄLTST' : 'DU TRÄGST';
          q(root, '.gr-what').textContent = item ? umzugName(item.k) + (kind?.fragile ? ' (zerbrechlich!)' : kind?.heavy ? ' (zu zweit!)' : '') : 'nichts – schnapp dir was!';
          q(root, '.gr-grab-l').textContent = item ? 'HALTEN' : 'GREIFEN';
          q(root, '.gr-grab-s').textContent = item ? 'loslassen = absetzen' : 'halten = tragen';
          q(root, '.um-throw-l').textContent = item && !kind?.heavy ? 'WERFEN' : 'SPRINT';
          q(root, '.um-throw-s').textContent = item && !kind?.heavy ? (kind?.fragile ? 'lieber nicht …' : 'auch durchs Fenster') : item ? 'nicht mit Schwerem' : 'kurzer Spurt';
          thr.classList.toggle('um-fragile', !!kind?.fragile);
        }
        thr.disabled = (!!item && !!UMZUG_KINDS[item.k].heavy) || (!item && p.cd > 0);
        let hint: string;
        if (st.sub === 'countdown') hint = 'Gleich geht’s los! Alles muss in den Laster rechts am Haus.';
        else if (item && UMZUG_KINDS[item.k].heavy) {
          const partner = item.by.some((b) => b && b !== id);
          hint = partner ? 'Zieht beide in dieselbe Richtung – längs durch die Tür!' : 'Jemand muss das andere Ende anpacken!';
        } else if (item) hint = UMZUG_KINDS[item.k].fragile ? 'Vorsichtig zum Laster tragen – nicht werfen!' : 'Zum Laster tragen oder in Richtung Laster werfen.';
        else if (hs.left === 0) hint = 'Alles draußen! Geschafft!';
        else hint = 'Leichtes allein tragen, Schweres zu zweit an den Enden anpacken.';
        q(root, '.gr-hint').textContent = hint;
        if (!st.teams) {
          const goals = umzugGoals(hs.max);
          const sk = goals.map((g) => (hs.score >= g ? '1' : '0')).join('');
          if (sk !== starKey) {
            starKey = sk;
            stars.innerHTML = goals.map((g) => `<span class="${hs.score >= g ? 'on' : ''}">★<small>${g}</small></span>`).join('');
          }
        }
        if (p.no > prevNo) haptic([30, 40, 30]);
        if (p.pts > prevPts) haptic(60);
        if (p.st[3] > prevBroke) haptic([80, 40, 80, 40, 80]);
        prevNo = p.no;
        prevPts = p.pts;
        prevBroke = p.st[3];
      };
    },
  ];
}
