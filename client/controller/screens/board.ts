import type { BoardState } from '../../../shared/types';
import { FINALE_COCKTAILS, FINALE_KINDS, MINI_INFO, ORIENT_TEXT, miniInspired } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, nameOf, q, socket, store, tapButton } from '../core';
import { haptic } from '../haptic';

function stats(b: BoardState) {
  const id = store.playerId!;
  return `<div class="stats"><span>$ ${b.coins[id] ?? 0}</span><span class="pink">Cocktails ${b.cocktails[id] ?? 0}</span></div>`;
}

export function pickBoard(b: BoardState): Screen {
  const id = store.playerId ?? '';
  // Bonus-Cocktails sehen alle (auch wer gerade erst dazugekommen ist)
  if (b.sub === 'bonus') return ['board-bonus', buildBonus];
  // Nachzügler: steht noch nicht auf dem Brett → steigt zur nächsten Runde ein
  if (!b.order.includes(id)) return ['board-late', buildLate];
  if (b.sub === 'roll') return [`board-roll-${b.round}`, () => buildRoll(b)];
  if (b.sub === 'intro' && b.nextMini) {
    const info = MINI_INFO[b.nextMini];
    return [`board-intro-${b.round}`, () => {
      const insp = miniInspired(b.nextMini!);
      const finale = b.round === b.maxRounds && FINALE_KINDS.includes(b.nextMini!);
      app.append(el(`<div class="center"><p>${finale ? `FINALE – die Sieger bekommen ${FINALE_COCKTAILS} Cocktails!` : "Gleich geht's los:"}</p><div class="intro-icon">${info.icon}</div><h1>${escapeHtml(info.title)}</h1>${insp ? `<p class="insp">${escapeHtml(insp)}</p>` : ''}<p>${escapeHtml(info.tagline)}</p><p class="orient-line orient-${info.orientation}">${ORIENT_TEXT[info.orientation]}</p></div>`));
      return null;
    }];
  }
  return ['board-watch', buildWatch];
}

/** Würfelfenster: alle gleichzeitig – nach dem Wurf Augenzahl + wer noch fehlt */
function buildRoll(b: BoardState) {
  const root = el(`
    <div class="stat-slot"></div>
    <h2 class="roll-title">Alle würfeln!</h2>
    <p class="roll-sub"></p>
    <button class="big-btn roll">WÜRFELN!</button>
    <p class="roll-wait center"></p>
  `);
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  let rolled = false;
  let shown = false;
  tapButton(btn, () => {
    if (rolled) return;
    rolled = true;
    btn.textContent = '...';
    haptic('tap');
    socket.emit('board:roll');
  });
  app.append(root);
  // Restzeit: Server schickt rollMs ~1×/s, dazwischen zählt das Handy selbst
  let ms = b.rollMs;
  let at = performance.now();
  const sub = q(root, '.roll-sub');
  const paint = () => {
    const s = store.state?.board;
    if (!s || s.sub !== 'roll') return;
    const left = Math.max(0, Math.ceil((ms - (performance.now() - at)) / 1000));
    const end = s.double ? ' · Endspurt: doppelte Münzen!' : '';
    sub.textContent = `Runde ${s.round}/${s.maxRounds} · noch ${left} s${end}`;
  };
  const timer = setInterval(() => (root.isConnected ? paint() : clearInterval(timer)), 250);
  paint();
  return () => {
    const s = store.state?.board;
    if (!s) return;
    if (s.rollMs !== ms) {
      ms = s.rollMs;
      at = performance.now();
    }
    q(root, '.stat-slot').innerHTML = stats(s);
    const mine = s.rolls[store.playerId ?? ''];
    if (mine && !shown) {
      shown = true;
      rolled = true;
      btn.textContent = `${mine}!`;
      haptic(mine >= 5 ? 'win' : 'hit');
    }
    const missing = s.order.filter((id) => !(id in s.rolls) && store.state?.players.find((p) => p.id === id && p.connected && !p.removed));
    q(root, '.roll-wait').textContent = mine
      ? missing.length
        ? `Warte auf ${missing.length > 3 ? `${missing.length} Spieler` : missing.map((id) => nameOf(id)).join(', ')} ...`
        : 'Alle haben gewürfelt – gleich geht es los!'
      : 'Nicht gewürfelt? Am Ende würfelt der Server für dich.';
    paint();
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
    const roll = b.lastRoll;
    q(root, '.who').textContent =
      b.sub === 'moving' && roll && roll.playerId === cur ? (cur === store.playerId ? `Du läufst ${roll.value}!` : `${nameOf(cur)} läuft ${roll.value} ...`) : `Runde ${Math.min(b.round, b.maxRounds)}/${b.maxRounds}`;
    q(root, '.msg').textContent = b.message;
  };
}

function buildLate() {
  const root = el(`
    <div class="center">
      <h2>Gleich bist du dabei!</h2>
      <p>Du steigst zur nächsten Brett-Runde ein – mit so vielen Münzen wie der Durchschnitt.</p>
      <p class="msg"></p>
    </div>
  `);
  app.append(root);
  return () => {
    q(root, '.msg').textContent = store.state?.board?.message ?? '';
  };
}

/** Bonus-Cocktails am Ende: aufgedeckte Karten, die eigene Auszeichnung hervorgehoben */
function buildBonus() {
  const root = el(`
    <div class="stat-slot"></div>
    <div class="center">
      <h2>Bonus-Cocktails!</h2>
      <div class="bonus-list"></div>
      <h2 class="bonus-me pink"></h2>
    </div>
  `);
  app.append(root);
  let lastKey = '';
  return () => {
    const b = store.state?.board;
    const bonus = b?.bonus;
    if (!b || !bonus) return;
    q(root, '.stat-slot').innerHTML = stats(b);
    const key = `${bonus.shown}-${bonus.revealed}`;
    if (key === lastKey) return;
    lastKey = key;
    const me = store.playerId ?? '';
    const lines = bonus.awards.slice(0, bonus.shown).map((a, i) => {
      const open = i < bonus.shown - 1 || bonus.revealed;
      const mine = open && a.winners.includes(me);
      const who = open ? a.winners.map((id) => escapeHtml(nameOf(id))).join(', ') : '???';
      return `<p style="margin:6px 0${mine ? ';color:var(--pink)' : ''}"><b>${escapeHtml(a.title)}</b><br>${escapeHtml(a.desc)}<br>${who}${open ? ` · ${a.value} ${escapeHtml(a.unit)}` : ''}</p>`;
    });
    q(root, '.bonus-list').innerHTML = lines.join('') || '<p>Trommelwirbel ...</p>';
    const cur = bonus.awards[bonus.shown - 1];
    const won = bonus.awards.filter((a, i) => (i < bonus.shown - 1 || bonus.revealed) && a.winners.includes(me));
    q(root, '.bonus-me').textContent = won.length ? `Du bist ${won.map((a) => a.title).join(' und ')}! +${won.length} Cocktail${won.length > 1 ? 's' : ''}` : '';
    if (bonus.revealed && cur?.winners.includes(me)) haptic('win');
  };
}
