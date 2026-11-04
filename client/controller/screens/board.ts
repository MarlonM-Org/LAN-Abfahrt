import type { BoardState } from '../../../shared/types';
import { MINI_INFO } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, nameOf, q, socket, store, tapButton } from '../core';

function stats(b: BoardState) {
  const id = store.playerId!;
  return `<div class="stats"><span>$ ${b.coins[id] ?? 0}</span><span class="pink">Cocktails ${b.cocktails[id] ?? 0}</span></div>`;
}

export function pickBoard(b: BoardState): Screen {
  const myTurn = b.sub === 'roll' && b.order[b.turnIdx] === store.playerId;
  if (myTurn) return [`board-roll-${b.round}`, () => buildRoll(b)];
  if (b.sub === 'intro' && b.nextMini) {
    const info = MINI_INFO[b.nextMini];
    return [`board-intro-${b.round}`, () => {
      app.append(el(`<div class="center"><p>Gleich geht's los:</p><h1>${escapeHtml(info.title)}</h1><p>${escapeHtml(info.tagline)}</p></div>`));
      return null;
    }];
  }
  return ['board-watch', buildWatch];
}

function buildRoll(b: BoardState) {
  const root = el(`
    <div class="stat-slot"></div>
    <h2>Du bist dran!</h2>
    <p>Runde ${b.round}/${b.maxRounds}</p>
    <button class="big-btn roll">WÜRFELN!</button>
  `);
  q(root, '.stat-slot').innerHTML = stats(b);
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  let rolled = false;
  tapButton(btn, () => {
    if (rolled) return;
    rolled = true;
    btn.textContent = '...';
    navigator.vibrate?.(30);
    socket.emit('board:roll');
  });
  app.append(root);
  return () => {
    const s = store.state?.board;
    if (s?.lastRoll && s.lastRoll.playerId === store.playerId && s.sub !== 'roll') btn.textContent = `${s.lastRoll.value}!`;
  };
}

function buildWatch() {
  const root = el(`
    <div class="stat-slot"></div>
    <div class="center">
      <h2 class="who"></h2>
      <p class="msg"></p>
    </div>
  `);
  app.append(root);
  return () => {
    const b = store.state?.board;
    if (!b) return;
    q(root, '.stat-slot').innerHTML = stats(b);
    const cur = b.order[b.turnIdx];
    q(root, '.who').textContent = b.sub === 'roll' ? `${nameOf(cur)} würfelt ...` : `Runde ${b.round}/${b.maxRounds}`;
    q(root, '.msg').textContent = b.message;
  };
}
