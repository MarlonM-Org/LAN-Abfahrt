import type { BouleState } from '../../../shared/types';
import { BOULE, bouleAim, boulePowerFor } from '../../../shared/boule';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store } from '../core';
import type { BowlThrow } from '../bowlingThrow';
import { mountThrowInput } from '../throwInput';

const boule = () => (store.state?.mini?.kind === 'boule' ? store.state.mini.state : null);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const pts = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

export function pickBoule(s: BouleState): Screen {
  const id = store.playerId!;
  if (!(id in s.ballsPer)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'intro') {
    const mine = mySide(s);
    const team = s.teams && mine ? `Du spielst für ${mine.name}. ` : '';
    return [
      'bo-intro',
      message(
        'Boule am Strand!',
        `${team}${s.ballsPer[id]} ${s.ballsPer[id] === 1 ? 'Kugel' : 'Kugeln'} pro Aufnahme. Wer nicht am nächsten am Schweinchen liegt, wirft. Bis ${s.target} Punkte oder ${s.maxEnds} Aufnahmen.`,
      ),
    ];
  }
  if (s.sub === 'aim' && s.turn === id) return [`bo-aim-${s.aimSeq}`, () => buildAim(s)];
  return ['bo-watch', () => buildWatch()];
}

const mySide = (s: BouleState) => s.sides.find((x) => x.members.includes(store.playerId!));

// ------------------------------------------------------------------ Mini-Karte (hochkant: Kreis unten, nach oben werfen)

function drawMap(c: HTMLCanvasElement, s: BouleState) {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  // Weltausschnitt: Weite (x) 0 … 450 nach oben, seitlich (y) Y0 … Y1 nach rechts
  const lat0 = BOULE.Y0;
  const lat1 = BOULE.Y1;
  const sc = Math.min(W / (lat1 - lat0), H / (BOULE.X1 - BOULE.X0));
  const ox = (W - (lat1 - lat0) * sc) / 2;
  const P = (x: number, y: number) => ({ u: ox + (y - lat0) * sc, v: H - (x - BOULE.X0) * sc });
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f1d49a';
  g.fillRect(ox, 0, (lat1 - lat0) * sc, H);
  g.strokeStyle = '#8d5629';
  g.lineWidth = 3;
  g.strokeRect(ox + 1.5, 1.5, (lat1 - lat0) * sc - 3, H - 3);
  const ci = P(BOULE.CIRCLE.x, BOULE.CIRCLE.y);
  g.strokeStyle = '#3d2414';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(ci.u, ci.v, BOULE.CIRCLE_R * sc, 0, Math.PI * 2);
  g.stroke();
  for (const b of s.balls) {
    const p = P(b.x, b.y);
    const side = s.sides.find((x) => x.id === b.side);
    g.fillStyle = hex(side?.color ?? 0x888888);
    g.beginPath();
    g.arc(p.u, p.v, Math.max(3, BOULE.BALL_R * sc), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2d1b12';
    g.lineWidth = 1;
    g.stroke();
  }
  if (s.jack) {
    const p = P(s.jack.x, s.jack.y);
    g.fillStyle = '#7a4a26';
    g.beginPath();
    g.arc(p.u, p.v, 3.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff4d6';
    g.lineWidth = 2;
    g.stroke();
  }
}

// ------------------------------------------------------------------ Werfen

function buildAim(s: BouleState) {
  const seq = s.aimSeq;
  const id = store.playerId!;
  const jackPow = s.jack ? Math.round(boulePowerFor(bouleAim(s.jack).dist) * 100) : 50;
  const jackAng = s.jack ? bouleAim(s.jack).angle / BOULE.ANGLE_MAX : 0;
  const dirTxt = Math.abs(jackAng) < 0.15 ? 'gerade' : jackAng > 0 ? 'etwas rechts' : 'etwas links';
  const lead = s.leader ? s.sides.find((x) => x.id === s.leader) : null;
  const root = el(`
    <h2>Du bist dran!</h2>
    <div class="top-row"><span>Aufnahme ${s.end}/${s.maxEnds}</span><span class="bo-left">noch ${s.left[id]} ${s.left[id] === 1 ? 'Kugel' : 'Kugeln'}</span></div>
    <div class="bo-head">
      <canvas class="bo-map" width="96" height="150"></canvas>
      <div class="bo-info">
        <p class="bo-lead">${lead ? `${escapeHtml(lead.name)} liegt vorn` : 'Noch keine Kugel im Spiel'}</p>
        <p>Schweinchen: <b>${jackPow} %</b> Kraft, ${dirTxt}</p>
        <div class="bo-style">
          <button class="small bo-legen on">Legen</button>
          <button class="small bo-schiessen">Schießen</button>
        </div>
        <p class="bo-style-hint">Hoher Bogen, rollt aus</p>
      </div>
    </div>
    <div class="bw-area bo-area"></div>
  `);
  app.append(root);
  drawMap(q<HTMLCanvasElement>(root, '.bo-map'), s);
  const area = q(root, '.bw-area');

  let shoot = false;
  const legen = q(root, '.bo-legen');
  const schiessen = q(root, '.bo-schiessen');
  const hint = q(root, '.bo-style-hint');
  const setStyle = (v: boolean) => {
    shoot = v;
    legen.classList.toggle('on', !v);
    schiessen.classList.toggle('on', v);
    hint.textContent = v ? 'Flach & hart – Kugeln wegschießen!' : 'Hoher Bogen, rollt aus';
    send('style', { shoot: v });
  };
  legen.addEventListener('click', () => setStyle(false));
  schiessen.addEventListener('click', () => setStyle(true));

  const input = mountThrowInput(
    area,
    root,
    {
      ask: 'Wirf wie beim echten Boule: Handy in die Hand, Knopf halten, Arm von unten nach vorn schwingen, loslassen. Schwung = Weite.',
      motionHint: 'Halten, Arm schwingen, loslassen. Schwung = Weite, Drehen = Richtung, Handgelenk = Effet.',
      padText: 'Kugel nach oben wischen!<br/>Schnell = weit · schräg = Richtung · im Bogen = Effet',
      padClass: 'bo-pad',
    },
    (t: BowlThrow) => {
      navigator.vibrate?.(40);
      send('throw', { seq, ...t, shoot });
      q(root, '.bo-head').classList.add('hidden');
      area.innerHTML = '';
      const dir = Math.abs(t.angle) < 0.05 ? 'gerade' : t.angle > 0 ? 'rechts' : 'links';
      area.append(
        el(`<div class="center"><h2>${shoot ? 'Schuss!' : 'Wurf!'}</h2><p>Kraft ${Math.round(t.speed * 100)} % · ${dir}${t.spin ? ` · Effet ${t.spin > 0 ? 'rechts' : 'links'}` : ''}</p><p>(Schweinchen: ${jackPow} %)</p><p>Schau auf den Fernseher!</p></div>`),
      );
    },
  );

  return () => {
    const st = boule();
    if (!st || st.sub !== 'aim' || st.aimSeq !== seq) input.stop();
  };
}

// ------------------------------------------------------------------ Zuschauen

function buildWatch() {
  const root = el(`
    <div class="center bw-watch">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <div class="panel bo-board"></div>
  `);
  app.append(root);
  const board = q(root, '.bo-board');
  let boardKey = '';
  return () => {
    const s = boule();
    if (!s) return;
    const id = store.playerId!;
    const mine = mySide(s);
    let head = '';
    let sub = '';
    if (s.sub === 'over') {
      const best = Math.max(...s.sides.map((x) => x.score));
      head = mine && mine.score === best ? (s.teams ? 'Dein Team gewinnt!' : 'Du hast gewonnen!') : 'Spiel vorbei!';
      sub = mine ? `${s.teams ? 'Dein Team hat' : 'Du hast'} ${pts(mine.score)}.` : '';
    } else if (s.sub === 'place') {
      head = `Aufnahme ${s.end}`;
      sub = 'Das Schweinchen fliegt …';
    } else if (s.sub === 'roll' && s.last) {
      head = s.last.playerId === id ? 'Deine Kugel rollt …' : `${nameOf(s.last.playerId)} ${s.last.shoot ? 'schießt' : 'legt'} …`;
      sub = 'Schau auf den Fernseher!';
    } else if (s.sub === 'measure' && s.endResult) {
      const r = s.endResult;
      const side = s.sides.find((x) => x.id === r.side);
      head = side ? `${side.id === mine?.id ? (s.teams ? 'Dein Team' : 'Du') : side.name}: +${pts(r.points)}` : 'Keiner punktet';
      sub = 'Es wird gemessen …';
    } else {
      head = s.turn ? `${nameOf(s.turn)} ist dran` : '';
      const lead = s.sides.find((x) => x.id === s.leader);
      sub = lead ? `${lead.id === mine?.id ? (s.teams ? 'Dein Team liegt' : 'Du liegst') : `${lead.name} liegt`} am Schweinchen.` : '';
      if (s.turn && mine?.members.includes(s.turn) && s.turn !== id) sub += '\nDein Team ist dran – gebt Tipps!';
    }
    q(root, '.headline').textContent = head;
    q(root, '.sub').textContent = sub;

    const key = JSON.stringify([s.sides.map((x) => x.score), s.left, s.turn, s.sub === 'over']);
    if (key === boardKey) return;
    boardKey = key;
    const rows = [...s.sides].sort((a, b) => b.score - a.score);
    board.innerHTML = rows
      .map((side) => {
        const left = side.members.reduce((a, m) => a + (s.left[m] ?? 0), 0);
        const dots = '●'.repeat(left);
        const label = s.teams ? side.name : side.name.replace(/^Bot\s+/, '');
        return `<div class="bo-row ${side.id === mine?.id ? 'me' : ''} ${s.turn && side.members.includes(s.turn) ? 'turn' : ''}"><i class="bo-sw" style="background:${hex(side.color)}"></i><span class="bw-name">${escapeHtml(label)}</span><span class="bo-dots" style="color:${hex(side.color)}">${dots}</span><b>${side.score}</b></div>`;
      })
      .join('');
  };
}
