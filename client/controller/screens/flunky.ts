import type { FlunkyState, Team } from '../../../shared/types';
import { RUN_TAPS, TEAM_INFO, otherTeam } from '../../../shared/flunky';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton, teamBadge } from '../core';

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

function buildAim(team: Team) {
  const root = el(`
    ${teamBadge(team)}
    <h2>Du wirfst!</h2>
    <p class="wind"></p>
    <div class="swipe-pad">
      <div class="arrow">^</div>
      <p class="pad-text">Schnell nach oben wischen!<br/>Länge = Kraft, Richtung = Ziel</p>
    </div>
  `);
  app.append(root);
  const pad = q(root, '.swipe-pad');
  const padText = q(root, '.pad-text');
  let start: { x: number; y: number; id: number } | null = null;
  let thrown = false;

  pad.addEventListener('pointerdown', (e) => {
    if (thrown) return;
    pad.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  pad.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id || thrown) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (-dy < 40) {
      padText.textContent = 'Nach OBEN wischen!';
      return;
    }
    const angle = Math.atan2(dx, -dy);
    const power = Math.min(1, -dy / (pad.clientHeight * 0.9));
    thrown = true;
    navigator.vibrate?.(30);
    padText.textContent = `Wurf! Kraft ${Math.round(power * 100)}%`;
    send('throw', { angle, power });
  });

  return () => {
    const f = flunky();
    if (f) q(root, '.wind').textContent = windText(f.wind);
  };
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
  tapButton(q(root, '.big-btn'), () => {
    send('tap');
    navigator.vibrate?.(8);
  });
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
  tapButton(q(root, '.big-btn'), () => {
    send('tap');
    navigator.vibrate?.(8);
  });
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
