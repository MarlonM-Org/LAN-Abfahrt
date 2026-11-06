import { WASSER, type WasserState } from '../../../shared/wasser';
import { TEAM_INFO } from '../../../shared/flunky';
import { type Screen, app, el, message, q, send, store } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function pickWasser(s: WasserState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['ws-over', message(s.endReason === 'away' ? 'Spielende!' : 'Zeit um!', `${me.h} Treffer · ${me.n}× nass – schau auf den Fernseher!`)];
  return [
    `ws-${s.sub}`,
    () => {
      const team = me.t ? TEAM_INFO[me.t] : null;
      const side = me.t === 'A' ? 'links' : 'rechts';
      const badge = team
        ? `<span class="lx-tag team-${me.t}">${team.name} · Lager ${side}</span>`
        : `<span class="lx-tag" style="background:${hex(me.c)};color:#fff4d6">Jeder gegen jeden</span>`;
      // Quer wie ein Twin-Stick-Gamepad: linke Hälfte laufen, rechte Hälfte zielen (Loslassen = Wurf)
      const root = el(`
        <div class="lx ws ws-lx">
          <div class="lx-head">
            ${badge}<span class="timer"></span>
            <span class="ws-wet">NÄSSE <span class="ws-meter"><div></div></span></span>
            <span class="ws-ammo"><i></i><i></i><i></i></span>
            <span class="score grow"></span>
          </div>
          <div class="lx-left ws-move"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
          <div class="lx-mid"><p class="ws-hint"></p></div>
          <div class="lx-right ws-aim"><span class="st-label ws-aim-label">ZIELEN · LOSLASSEN = WURF</span></div>
        </div>
      `);
      stickZone(q(root, '.ws-move'), (x, y) => send('stick', { x, y }));
      // Ziel-Stick: Ziehen = Richtung + Weite (Vorschau auf dem TV), Loslassen = werfen, nur antippen bricht ab.
      // Weite wächst quadratisch (shared/wasser.ts throwDist): ein kleines Stück ziehen = Wurf direkt neben einen selbst.
      stickZone(q(root, '.ws-aim'), (x, y) => send('aim', { x, y }), {
        radius: 64,
        trailing: false,
        step: 0.03,
        onRelease: (x, y, ok) => {
          if (ok && Math.hypot(x, y) >= WASSER.AIM_MIN) {
            send('throw', { x, y });
            haptic(15);
          } else send('aim', { x: 0, y: 0 });
        },
      });
      app.append(root);
      const wrap = q(root, '.ws');
      const fill = q(root, '.ws-meter > div');
      const dots = [...root.querySelectorAll<HTMLElement>('.ws-ammo i')];
      let prevWet = me.w;
      let prevSoaked = me.n;
      return () => {
        const st = store.state?.mini?.kind === 'wasser' ? store.state.mini.state : null;
        const p = st?.players[id];
        if (!st || !p) return;
        q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
        q(root, '.score').textContent = st.ffa ? `${p.k}× nass gemacht` : `Sonne ${st.score.A} : ${st.score.B} Meer`;
        fill.style.width = `${p.s === 'drying' ? Math.round((1 - p.dp) * 100) : p.w}%`;
        fill.className = p.w > 70 || p.s !== 'ok' ? 'danger' : '';
        dots.forEach((d, i) => {
          d.className = i < p.a ? 'full' : '';
          d.style.background = i < p.a ? hex(p.c) : '';
        });
        const towel = p.t ? `eurem Handtuch (${p.t === 'A' ? 'links' : 'rechts'})` : 'einem Handtuch';
        const bucket = p.t ? `Eimer (${p.t === 'A' ? 'links' : 'rechts'})` : 'Eimer';
        let hint = 'Rechts ziehen = zielen (wenig = nah), loslassen = werfen. Hinter Hecken bist du sicher!';
        if (st.sub === 'countdown') hint = 'Gleich geht’s los! Links laufen, rechts zielen + loslassen.';
        else if (p.s === 'soaked') hint = `KLATSCHNASS! Lauf zu ${towel}${p.sk > 0 ? ` – sonst wirst du in ${Math.ceil(p.sk / 1000)} s hingetragen` : ''}.`;
        else if (p.s === 'drying') hint = 'Abtrocknen ... gleich geht’s weiter!';
        else if (p.pi > 0) hint = `WASSERPISTOLE! Rechts zielen = spritzen (${Math.ceil(p.pi / 1000)}s)`;
        else if (p.a === 0) hint = `Leer! Nachfüllen am ${bucket} oder am Schlauch (Mitte, schneller).`;
        else if (p.w > 70) hint = 'Fast klatschnass – ab in Deckung!';
        q(root, '.ws-hint').textContent = hint;
        q(root, '.ws-aim-label').textContent = p.pi > 0 ? 'SPRITZEN! Ziehen = Richtung' : 'ZIELEN · LOSLASSEN = WURF';
        wrap.classList.toggle('soaked', p.s !== 'ok');
        wrap.classList.toggle('pistol', p.pi > 0);
        if (p.n > prevSoaked) haptic([80, 60, 160]);
        else if (p.w > prevWet + 5) haptic(40);
        prevWet = p.w;
        prevSoaked = p.n;
      };
    },
  ];
}
