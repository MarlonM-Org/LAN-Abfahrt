import type { BoardAsk, BoardDuel, BoardState, DuelPick } from '../../../shared/types';
import { DUEL_PENALTY, FINALE_COCKTAILS, FINALE_KINDS, ITEM_INFO, MINI_INFO, ORIENT_TEXT, miniInspired } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, nameOf, q, socket, store, tapButton } from '../core';
import { haptic } from '../haptic';

function stats(b: BoardState) {
  const id = store.playerId!;
  const item = b.items?.[id];
  const slot = item ? `<span title="${escapeHtml(ITEM_INFO[item].title)}">${ITEM_INFO[item].icon}</span>` : '';
  return `<div class="stats"><span>$ ${b.coins[id] ?? 0}</span>${slot}<span class="pink">Cocktails ${b.cocktails[id] ?? 0}</span></div>`;
}

/** Lokaler Countdown aus einem Server-Wert (ms, ~1×/s aktualisiert) */
function countdown() {
  let ms = 0;
  let at = performance.now();
  return {
    set(v: number) {
      if (v !== ms) {
        ms = v;
        at = performance.now();
      }
    },
    left: () => Math.max(0, Math.ceil((ms - (performance.now() - at)) / 1000)),
  };
}

export function pickBoard(b: BoardState): Screen {
  const id = store.playerId ?? '';
  // Bonus-Cocktails sehen alle (auch wer gerade erst dazugekommen ist)
  if (b.sub === 'bonus') return ['board-bonus', buildBonus];
  // Nachzügler: steht noch nicht auf dem Brett → steigt zur nächsten Runde ein
  if (!b.order.includes(id)) return ['board-late', buildLate];
  if (b.sub === 'roll') return [`board-roll-${b.round}`, () => buildRoll(b)];
  if (b.sub === 'moving') {
    const ask = b.ask;
    if (ask && ask.playerId === id) return [`board-ask-${ask.seq}`, () => buildAsk(ask)];
    const d = b.duel;
    if (d && (d.a === id || d.b === id)) return [`board-duel-${d.seq}-${d.sub === 'choose' ? 'choose' : 'reveal'}`, () => (d.sub === 'choose' ? buildDuelChoose(d) : buildDuelReveal(d))];
  }
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

/** Würfelfenster: alle gleichzeitig – vorher ggf. das Item einsetzen, nach dem Wurf Augenzahl + wer noch fehlt */
function buildRoll(b: BoardState) {
  const root = el(`
    <div class="stat-slot"></div>
    <h2 class="roll-title">Alle würfeln!</h2>
    <p class="roll-sub"></p>
    <div class="item-slot"></div>
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
  const cd = countdown();
  cd.set(b.rollMs);
  const sub = q(root, '.roll-sub');
  const paint = () => {
    const s = store.state?.board;
    if (!s || s.sub !== 'roll') return;
    const end = s.double ? ' · Endspurt: doppelte Münzen!' : '';
    sub.textContent = `Runde ${s.round}/${s.maxRounds} · noch ${cd.left()} s${end}`;
  };
  const timer = setInterval(() => (root.isConnected ? paint() : clearInterval(timer)), 250);
  paint();
  const me = store.playerId ?? '';
  let itemKey = '';
  return () => {
    const s = store.state?.board;
    if (!s) return;
    cd.set(s.rollMs);
    q(root, '.stat-slot').innerHTML = stats(s);
    const mine = s.rolls[me];
    const using = s.using?.[me];
    const item = s.items?.[me];
    // Item-Karte: Einsetzen vor dem Würfeln (Doppelwürfel, Klau, Taxi), das Schild wirkt von allein
    const key = `${item ?? ''}|${using ?? ''}|${mine ?? ''}`;
    if (key !== itemKey) {
      itemKey = key;
      const slot = q(root, '.item-slot');
      if (using) {
        const info = ITEM_INFO[using];
        slot.innerHTML = `<div class="item-card used"><b>${info.icon} ${escapeHtml(info.title)}</b><small>${using === 'taxi' ? 'Taxi gerufen – du fährst direkt zur Bar!' : 'Eingesetzt für diesen Zug'}</small></div>`;
      } else if (item) {
        const info = ITEM_INFO[item];
        const can = info.active && mine === undefined;
        slot.innerHTML = `<div class="item-card"><b>${info.icon} ${escapeHtml(info.title)}</b><small>${escapeHtml(info.desc)}</small>${can ? `<button class="small use-item">${item === 'taxi' ? 'Taxi rufen (statt würfeln)' : 'Jetzt einsetzen'}</button>` : `<small class="muted">${info.active ? 'Nächste Runde einsetzbar' : 'Wirkt von allein'}</small>`}</div>`;
        const use = slot.querySelector<HTMLButtonElement>('.use-item');
        if (use) tapButton(use, () => {
          use.disabled = true;
          haptic('tap');
          socket.emit('board:item');
        });
      } else slot.innerHTML = '';
    }
    if (using === 'taxi') {
      rolled = true;
      btn.textContent = '🚕';
      btn.disabled = true;
    } else if (using === 'dice2' && !mine) btn.textContent = '2× WÜRFELN!';
    if (mine && !shown) {
      shown = true;
      rolled = true;
      btn.textContent = `${mine}!`;
      haptic(mine >= 5 ? 'win' : 'hit');
    }
    const missing = s.order.filter((id) => !(id in s.rolls) && store.state?.players.find((p) => p.id === id && p.connected && !p.removed));
    q(root, '.roll-wait').textContent = mine !== undefined
      ? missing.length
        ? `Warte auf ${missing.length > 3 ? `${missing.length} Spieler` : missing.map((id) => nameOf(id)).join(', ')} ...`
        : 'Alle haben gewürfelt – gleich geht es los!'
      : 'Nicht gewürfelt? Am Ende würfelt der Server für dich.';
    paint();
  };
}

/** Entscheidung am Handy: Cocktail kaufen, Laden, Abzweigung – mit Countdown, danach entscheidet der Server */
function buildAsk(ask: BoardAsk) {
  const b = store.state!.board!;
  const me = store.playerId ?? '';
  const coins = b.coins[me] ?? 0;
  let html = '';
  if (ask.kind === 'bar') {
    html = `
      <h2 class="ask-title">🍹 Cocktail für ${ask.price} Münzen?</h2>
      <p>Du hast ${coins} Münzen. Cocktails entscheiden am Ende – und jeder weitere kostet mehr.</p>
      <button class="big-btn roll" data-choice="yes">JA, HER DAMIT!</button>
      <button class="secondary" data-choice="no">Nein, sparen</button>
      <p class="ask-wait center"></p>`;
  } else if (ask.kind === 'shop') {
    const offer = ask.offer ?? [];
    html = `
      <h2 class="ask-title">🛒 Strandladen</h2>
      <p>Du hast ${coins} Münzen – höchstens ein Item im Rucksack.</p>
      <div class="shop-list">${offer.map((k) => `<button class="shop-item" data-choice="${k}"><b>${ITEM_INFO[k].icon} ${escapeHtml(ITEM_INFO[k].title)}</b><small>${escapeHtml(ITEM_INFO[k].desc)}</small><span>$ ${ITEM_INFO[k].price}</span></button>`).join('')}</div>
      <button class="secondary" data-choice="none">Nichts kaufen</button>
      <p class="ask-wait center"></p>`;
  } else {
    html = `
      <h2 class="ask-title">⇄ Gabelung!</h2>
      <p>Welchen Weg nimmst du?</p>
      <button class="fork-btn" data-choice="short"><b>🏃 Abkürzung</b><small>3 Felder kürzer · ein rotes Feld · keine Bar</small></button>
      <button class="fork-btn long" data-choice="long"><b>🍹 Langer Weg</b><small>${ask.barOnLong ? 'Die Bar steht hier!' : 'Bar (wenn sie dort steht)'} · Ereignis · Duell · zwei rote Felder</small></button>
      <p class="ask-wait center"></p>`;
  }
  const root = el(`<div class="stat-slot"></div><div class="ask">${html}</div>`);
  app.append(root);
  let answered = false;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-choice]')];
  for (const btn of buttons) {
    tapButton(btn, () => {
      if (answered) return;
      answered = true;
      const c = btn.dataset.choice!;
      const choice = ask.kind === 'bar' ? c === 'yes' : ask.kind === 'shop' ? (c === 'none' ? null : c) : c;
      socket.emit('board:answer', { seq: ask.seq, choice });
      haptic('tap');
      for (const o of buttons) o.disabled = o !== btn;
      q(root, '.ask-wait').textContent = 'Gewählt!';
    });
  }
  const cd = countdown();
  cd.set(ask.ms);
  const fallback = ask.kind === 'bar' ? 'Ja' : ask.kind === 'shop' ? 'nichts kaufen' : 'der Server wählt';
  const paint = () => {
    if (answered) return;
    q(root, '.ask-wait').textContent = `Noch ${cd.left()} s – ohne Antwort: ${fallback}`;
  };
  const timer = setInterval(() => (root.isConnected ? paint() : clearInterval(timer)), 250);
  paint();
  return () => {
    const s = store.state?.board;
    if (!s) return;
    q(root, '.stat-slot').innerHTML = stats(s);
    if (s.ask?.seq === ask.seq) cd.set(s.ask.ms);
    paint();
  };
}

function buildWatch() {
  const root = el(`
    <div class="stat-slot"></div>
    <div class="center">
      <h2 class="who"></h2>
      <p class="msg"></p>
      <p class="duel-line pink"></p>
    </div>
  `);
  app.append(root);
  return () => {
    const b = store.state?.board;
    if (!b) return;
    q(root, '.stat-slot').innerHTML = stats(b);
    const cur = b.order[b.turnIdx];
    const roll = b.lastRoll;
    const d = b.duel;
    q(root, '.who').textContent = d
      ? `Duell: ${nameOf(d.a)} gegen ${nameOf(d.b)}`
      : b.ask
        ? `${nameOf(b.ask.playerId)} überlegt ...`
        : b.sub === 'moving' && roll && roll.playerId === cur
          ? cur === store.playerId
            ? roll.kind === 'taxi' ? 'Dein Taxi fährt zur Bar!' : `Du läufst ${roll.value}!`
            : roll.kind === 'taxi' ? `${nameOf(cur)} nimmt das Taxi zur Bar ...` : `${nameOf(cur)} läuft ${roll.value} ...`
          : `Runde ${Math.min(b.round, b.maxRounds)}/${b.maxRounds}`;
    q(root, '.msg').textContent = b.message;
    q(root, '.duel-line').textContent = d ? (d.sub === 'choose' ? `Beide wählen geheim – Pott: ${d.pot} Münzen` : d.sub === 'reveal' ? 'Schaut auf den TV!' : (d.result ?? '')) : '';
  };
}

/** Duell „Teilen oder Klauen“: geheime Wahl (die eigene Wahl kommt über `private` zurück) */
function buildDuelChoose(d: BoardDuel) {
  const me = store.playerId ?? '';
  const opp = d.a === me ? d.b : d.a;
  const root = el(`
    <div class="stat-slot"></div>
    <div class="duel">
      <h2>⚔️ Duell um ${d.pot} Münzen</h2>
      <p>Gegen <b>${escapeHtml(nameOf(opp))}</b>. Beide teilen: je ${d.pot / 2}. Einer klaut: er bekommt alle ${d.pot}. Beide klauen: nichts – und je −${DUEL_PENALTY}.</p>
      <button class="big-btn half duel-share" data-pick="share">🤝 TEILEN</button>
      <button class="big-btn half duel-steal" data-pick="steal">😈 KLAUEN</button>
      <p class="duel-wait center"></p>
    </div>
  `);
  app.append(root);
  let picked: DuelPick | null = null;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-pick]')];
  const show = (p: DuelPick) => {
    picked = p;
    for (const o of buttons) o.disabled = o.dataset.pick !== p;
  };
  for (const btn of buttons) {
    tapButton(btn, () => {
      if (picked) return;
      show(btn.dataset.pick as DuelPick);
      haptic('tap');
      socket.emit('board:duel', { seq: d.seq, pick: picked });
    });
  }
  const cd = countdown();
  cd.set(d.ms);
  const paint = () => {
    const s = store.state?.board?.duel;
    const other = s?.chosen.includes(opp);
    q(root, '.duel-wait').textContent = picked
      ? `Du hast ${picked === 'share' ? 'TEILEN' : 'KLAUEN'} gewählt. ${other ? 'Beide haben gewählt – schaut auf den TV!' : `Warte auf ${nameOf(opp)} ...`}`
      : `Noch ${cd.left()} s – ohne Wahl: Teilen${other ? ` · ${nameOf(opp)} hat schon gewählt` : ''}`;
  };
  const timer = setInterval(() => (root.isConnected ? paint() : clearInterval(timer)), 250);
  paint();
  return () => {
    const s = store.state?.board;
    if (!s) return;
    q(root, '.stat-slot').innerHTML = stats(s);
    if (s.duel?.seq === d.seq) cd.set(s.duel.ms);
    // Nach einem Reconnect: die eigene Wahl kommt über das private Event zurück
    const priv = store.priv;
    if (!picked && priv?.kind === 'board' && priv.state.duelPick) show(priv.state.duelPick);
    paint();
  };
}

/** Aufdecken läuft am TV – das Handy verrät nichts, bis die Münzen verteilt sind */
function buildDuelReveal(d: BoardDuel) {
  const me = store.playerId ?? '';
  const opp = d.a === me ? d.b : d.a;
  const root = el(`
    <div class="stat-slot"></div>
    <div class="center">
      <h2 class="duel-title">Die Karten werden aufgedeckt ...</h2>
      <p class="duel-sub">Schau auf den TV!</p>
      <p class="duel-res pink"></p>
    </div>
  `);
  app.append(root);
  let done = false;
  return () => {
    const s = store.state?.board;
    if (!s) return;
    q(root, '.stat-slot').innerHTML = stats(s);
    const cur = s.duel;
    if (!cur || cur.seq !== d.seq || cur.sub !== 'done' || done) return;
    done = true;
    const mine = cur.picks?.[me], theirs = cur.picks?.[opp];
    const lab = (p?: DuelPick) => (p === 'steal' ? 'KLAUEN' : 'TEILEN');
    q(root, '.duel-title').textContent = `Du: ${lab(mine)} · ${nameOf(opp)}: ${lab(theirs)}`;
    q(root, '.duel-sub').textContent = '';
    q(root, '.duel-res').textContent = cur.result ?? '';
    const won = (mine === 'share' && theirs === 'share') || (mine === 'steal' && theirs === 'share');
    haptic(won ? 'win' : 'hit');
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
      const tie = open && a.tied ? `<br><small>Gleichstand mit ${a.tied.filter((id) => !a.winners.includes(id)).map((id) => escapeHtml(nameOf(id))).join(', ')} – der Rückstand bekommt ihn</small>` : '';
      return `<p style="margin:6px 0${mine ? ';color:var(--pink)' : ''}"><b>${escapeHtml(a.title)}</b><br>${escapeHtml(a.desc)}<br>${who}${open ? ` · ${a.value} ${escapeHtml(a.unit)}` : ''}${tie}</p>`;
    });
    q(root, '.bonus-list').innerHTML = lines.join('') || '<p>Trommelwirbel ...</p>';
    const cur = bonus.awards[bonus.shown - 1];
    const won = bonus.awards.filter((a, i) => (i < bonus.shown - 1 || bonus.revealed) && a.winners.includes(me));
    q(root, '.bonus-me').textContent = won.length ? `Du bist ${won.map((a) => a.title).join(' und ')}! +${won.length} Cocktail${won.length > 1 ? 's' : ''}` : '';
    if (bonus.revealed && cur?.winners.includes(me)) haptic('win');
  };
}

