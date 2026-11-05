import type { FlunkyState, Team } from '../../../shared/types';
import { RUN_TAPS, TEAM_INFO, missHint, otherTeam } from '../../../shared/flunky';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton, teamBadge } from '../core';
import type { BowlThrow } from '../bowlingThrow';
import { mountThrowInput } from '../throwInput';
import { motionSupport, onMotion, swingAcc } from '../motion';

export function pickFlunky(f: FlunkyState): Screen {
  const id = store.playerId!;
  const team: Team | null = f.teams.A.includes(id) ? 'A' : f.teams.B.includes(id) ? 'B' : null;
  if (!team) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  switch (f.sub) {
    case 'aim':
      return f.throwerId === id ? [`fl-aim-${f.lastThrow?.seq ?? 0}`, () => buildAim(team)] : ['fl-watch', () => buildWatch(team)];
    case 'flight':
      return ['fl-flight', message('Der Ball fliegt ...', 'Schau auf den Fernseher!')];
    case 'chug':
      if (team === f.turnTeam) {
        return (f.beer[id] ?? 0) > 0 ? ['fl-drink', () => buildDrink(team)] : ['fl-drunk', message('Ausgetrunken!', 'Feuer dein Team an!')];
      }
      if (f.runnerId === id) return ['fl-run', () => buildRun(team)];
      return ['fl-watch', () => buildWatch(team)];
    case 'reset':
      return ['fl-reset', message('Flasche steht wieder!', 'Wechsel ...')];
    case 'over': {
      const won = f.winner === team;
      return ['fl-over', message(won ? 'GEWONNEN!' : 'VERLOREN!', won ? 'Ihr habt am schnellsten ausgetrunken.' : 'Revanche?')];
    }
  }
}

const flunky = () => (store.state?.mini?.kind === 'flunky' ? store.state.mini.state : null);

function windText(w: number) {
  const n = Math.round(Math.abs(w) * 3);
  if (n === 0) return 'Windstill';
  return `Wind ${(w < 0 ? '<' : '>').repeat(n)} – zieht nach ${w < 0 ? 'links' : 'rechts'}`;
}

/** Seitliche Streuung: Wurfrichtung −1 … 1 → Flunky-Winkel (Server klemmt auf ±0,8) */
const ANGLE_K = 0.7;

/**
 * Werfen: wie beim Bowling/Boule wahlweise mit dem Bewegungssensor (Knopf halten, Arm schwingen, loslassen –
 * Schwung = Weite, Drehen = Richtung) oder per Wischen. Die Wahl gilt für alle Wurfspiele.
 */
function buildAim(team: Team) {
  const f0 = flunky();
  const mine = f0?.lastThrow && f0.lastThrow.throwerId === store.playerId && !f0.lastThrow.hit ? f0.lastThrow : null;
  const root = el(`
    ${teamBadge(team)}
    <h2>Du wirfst!</h2>
    <p class="wind"></p>
    ${mine ? `<p class="fl-last">Letzter Wurf: ${missHint(mine.team, mine.to)}</p>` : ''}
    <div class="fl-area"></div>
  `);
  app.append(root);
  const area = q(root, '.fl-area');
  const input = mountThrowInput(
    area,
    root,
    {
      ask: 'Wirf wie beim echten Flunkyball: Knopf halten, Arm nach vorn schwingen, loslassen. Mittlerer Schwung trifft die Flasche – der Wind lenkt ab.',
      motionHint: 'Halten, Arm schwingen, loslassen. Schwung = Weite (mittel trifft!), Drehen = Richtung.',
      padText: 'Ball nach oben wischen!<br/>Länge = Kraft · schräg = Richtung',
      // Wischen wie bisher: Länge = Kraft, Richtung = Ziel
      swipe: (pts, padH) => {
        const a = pts[0];
        const b = pts[pts.length - 1];
        const up = a.y - b.y;
        if (up < 40) return { ok: false, reason: 'Nach OBEN wischen!' };
        const angle = Math.max(-1, Math.min(1, Math.atan2(b.x - a.x, up) / ANGLE_K));
        return { ok: true, t: { speed: Math.min(1, up / (padH * 0.9)), angle, spin: 0 } };
      },
      button: 'HALTEN &amp;<br/>WERFEN',
    },
    (t: BowlThrow) => {
      navigator.vibrate?.(30);
      send('throw', { angle: t.angle * ANGLE_K, power: t.speed });
      area.innerHTML = '';
      area.append(el(`<div class="center"><h2>Wurf!</h2><p>Kraft ${Math.round(t.speed * 100)} % – schau auf den Fernseher!</p></div>`));
    },
  );

  return () => {
    const f = flunky();
    if (f) q(root, '.wind').textContent = windText(f.wind);
    if (!f || f.sub !== 'aim') input.stop();
  };
}

/**
 * Schütteln zählt wie Tippen (Trinken/Laufen), sobald der Bewegungssensor freigegeben ist
 * (meldet sich selbst ab, wenn der Screen weg ist). Liefert den Hinweistext (leer ohne Sensor).
 */
function shakeToTap(root: HTMLElement, onShake: () => void): string {
  if (motionSupport() !== 'ok') return '';
  let last = 0;
  let armed = true;
  const off = onMotion((m) => {
    if (!root.isConnected) return off();
    const a = swingAcc(m);
    // Spitze über 7 m/s² zählt, danach erst wieder nach Beruhigung (< 3) – ein Schüttler = ein Schluck
    if (armed && a > 7 && m.t - last > 110) {
      armed = false;
      last = m.t;
      onShake();
    } else if (a < 3) armed = true;
  });
  return '<p class="fl-shake">…oder Handy schütteln!</p>';
}

function buildDrink(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>TREFFER! Trinken!</h2>
    <p>So schnell tippen wie du kannst!</p>
    <button class="big-btn drink">TRINKEN!</button>
    <p>Dein Bier</p>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  const tap = () => {
    send('tap');
    navigator.vibrate?.(8);
  };
  tapButton(q(root, '.big-btn'), tap);
  q(root, '.big-btn').insertAdjacentHTML('afterend', shakeToTap(root, tap));
  const fill = q(root, '.meter > div');
  return () => {
    fill.style.width = `${flunky()?.beer[store.playerId!] ?? 0}%`;
  };
}

function buildRun(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>LAUF! Stell die Flasche auf!</h2>
    <p>Tippen = Laufen. Schnell, bevor die anderen austrinken!</p>
    <button class="big-btn run">LAUFEN!</button>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  const tap = () => {
    send('tap');
    navigator.vibrate?.(8);
  };
  tapButton(q(root, '.big-btn'), tap);
  q(root, '.big-btn').insertAdjacentHTML('afterend', shakeToTap(root, tap));
  const fill = q(root, '.meter > div');
  fill.style.background = 'var(--sea)';
  return () => {
    fill.style.width = `${((flunky()?.runProgress ?? 0) / RUN_TAPS) * 100}%`;
  };
}

function buildWatch(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <div class="center">
      <h2 class="headline"></h2>
      <p class="sub"></p>
    </div>
    <p>Dein Bier</p>
    <div class="meter"><div></div></div>
  `);
  app.append(root);
  const fill = q(root, '.meter > div');
  return () => {
    const f = flunky();
    if (!f) return;
    if (f.sub === 'aim') {
      q(root, '.headline').textContent = `${nameOf(f.throwerId)} wirft ...`;
      q(root, '.sub').textContent = f.turnTeam === team ? 'Dein Team ist dran – Daumen drücken!' : 'Hoffentlich daneben!';
    } else {
      q(root, '.headline').textContent = `${TEAM_INFO[f.turnTeam].name} trinkt!`;
      q(root, '.sub').textContent = `${nameOf(f.runnerId)} läuft für ${TEAM_INFO[otherTeam(f.turnTeam)].name} – anfeuern!`;
    }
    fill.style.width = `${f.beer[store.playerId!] ?? 0}%`;
  };
}
