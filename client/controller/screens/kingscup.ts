import type { KingsState } from '../../../shared/kingscup';
import { KINGS, KINGS_CATEGORIES, KINGS_PRESET_RULES, KINGS_RACE, KINGS_RHYMES, KINGS_RULES, SUIT_CHARS } from '../../../shared/kingscup';
import { cardLabel } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, message, nameOf, playerButtons, q, send, socket, store, tapButton, toast } from '../core';

const kc = () => (store.state?.mini?.kind === 'kingscup' ? store.state.mini.state : null);

const cardHtml = (s: KingsState) => {
  if (!s.card) return '';
  const red = s.card.suit < 2;
  return `<div class="kc-card ${red ? 'red' : ''}"><span>${cardLabel(s.card.rank)}</span><small>${SUIT_CHARS[s.card.suit]}</small></div>`;
};

const ruleHtml = (s: KingsState) => {
  if (!s.card) return '';
  const r = KINGS_RULES[s.card.rank];
  return `${cardHtml(s)}<h1>${escapeHtml(r.title)}</h1><p>${escapeHtml(r.text)}</p>`;
};

/** Kumpel des Spielers (in beide Richtungen) */
function matesOf(s: KingsState, id: string) {
  return Object.entries(s.mates)
    .filter(([a, b]) => a === id || b === id)
    .map(([a, b]) => (a === id ? b : a));
}

/** VIP (nicht selbst dran): kein Zeitlimit beim Ziehen/Wählen/Tippen – stattdessen „Überspringen“ */
export function pickKingsCup(s: KingsState, vip: boolean): Screen {
  const screen = pickInner(s, vip);
  const id = store.playerId!;
  const waiting = s.sub === 'draw' || s.sub === 'pick' || s.sub === 'word' || s.sub === 'rule' || s.sub === 'chain';
  if (!vip || !waiting || (id === s.drawer && s.sub !== 'chain') || !s.order.includes(id)) return screen;
  const [key, build] = screen;
  return [
    `${key}-vipskip`,
    () => {
      const upd = build();
      const label = s.sub === 'draw' ? `${nameOf(s.drawer).slice(0, 12)} überspringen` : s.sub === 'chain' ? 'Runde beenden (keiner trinkt)' : 'Überspringen';
      const b = el(`<button class="secondary small kc-skip">⏭ ${escapeHtml(label)}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => {
        b.disabled = true;
        socket.emit('vip:mini', 'skip');
      });
      app.append(b);
      return upd;
    },
  ];
}

function pickInner(s: KingsState, vip: boolean): Screen {
  const id = store.playerId!;
  if (!s.order.includes(id)) return ['kc-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  const me = id === s.drawer;
  const seq = s.drawSeq;
  switch (s.sub) {
    case 'draw':
      return me ? [`kc-draw-${seq}`, () => buildDraw(s)] : [`kc-wait-${seq}-${s.drawer}-${s.qm === id}-${!!s.qm}-${vip}`, () => buildWait(s, vip)];
    case 'reveal':
      return [`kc-rev-${seq}`, () => (app.append(el(`<div class="center kc-rule">${me ? '<p>Deine Karte:</p>' : `<p>${escapeHtml(nameOf(s.drawer))} zieht:</p>`}${ruleHtml(s)}</div>`)), null)];
    case 'pick':
      if (me) return [`kc-pick-${seq}`, () => buildPick(s)];
      return [`kc-pw-${seq}`, message(s.pickFor === 'mate' ? `${nameOf(s.drawer)} sucht einen Kumpel ...` : `${nameOf(s.drawer)} sucht aus, wer trinkt ...`, 'Bitte nicht ich, bitte nicht ich ...')];
    case 'race': {
      const r = s.race!;
      if (!r.players.includes(id)) {
        return [`kc-rk-${seq}`, message(r.kind === 'rudern' ? 'Du bist der Wikingerkönig!' : 'Du schaust zu', r.kind === 'rudern' ? 'Mach ein Geweih mit den Händen – und schau, wer zuletzt rudert!' : '')];
      }
      return [`kc-race-${seq}`, () => buildRace(s)];
    }
    case 'word':
      if (me) return [`kc-word-${seq}`, () => buildText(s, 'word')];
      return [`kc-ww-${seq}`, message(`${nameOf(s.drawer)} überlegt ...`, s.card?.rank === 9 ? 'Gleich kommt ein Reimwort – überleg schon mal!' : 'Gleich kommt eine Kategorie – überleg schon mal!')];
    case 'chain': {
      const judge = me || !store.state?.players.find((p) => p.id === s.drawer)?.connected;
      return [`kc-chain-${seq}-${judge}`, () => buildChain(judge)];
    }
    case 'rule':
      if (me) return [`kc-rule-${seq}`, () => buildText(s, 'rule')];
      return [`kc-rw-${seq}`, message(`${nameOf(s.drawer)} denkt sich eine Regel aus ...`, 'Das kann nichts Gutes bedeuten.')];
    case 'waterfall':
      return [`kc-wf-${seq}`, () => buildWaterfall(s)];
    case 'result':
      return [`kc-res-${seq}`, () => buildResult(s)];
    default:
      return ['kc-over', message('Der Becher ist leer!', 'Gleich gibt’s die Auswertung ...')];
  }
}

// ------------------------------------------------------------------ Ziehen

function buildDraw(s: KingsState) {
  const root = el(`
    <h1>Du bist dran!</h1>
    <p>Karte ${s.drawn + 1} von ${s.total} – tippen oder nach oben wischen</p>
    <div class="kc-deck" role="button" aria-label="Karte ziehen"><div class="kc-back"></div><b>KARTE ZIEHEN</b></div>
  `);
  const deck = q(root, '.kc-deck');
  let sent = false;
  let startY = 0;
  const go = () => {
    if (sent) return;
    sent = true;
    deck.classList.add('drawn');
    navigator.vibrate?.(30);
    send('draw');
  };
  deck.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startY = e.clientY;
  });
  // Antippen oder Wischen – beides zieht (Wischen fühlt sich mehr nach Karte an)
  deck.addEventListener('pointerup', (e) => {
    if (startY - e.clientY > 30 || Math.abs(startY - e.clientY) < 20) go();
  });
  deck.addEventListener('contextmenu', (e) => e.preventDefault());
  app.append(root);
  navigator.vibrate?.([50, 40, 50]);
  return null;
}

function buildWait(s: KingsState, vip: boolean) {
  const id = store.playerId!;
  const mates = matesOf(s, id);
  const root = el(`
    <div class="center">
      <h2>${escapeHtml(nameOf(s.drawer))} zieht ...</h2>
      <p>Karte ${s.drawn + 1} von ${s.total}</p>
      ${s.qm === id ? '<h2 class="yellow">Du bist der Fragenmeister!</h2><p>Stell Fragen – wer antwortet, trinkt.</p>' : ''}
      ${mates.length ? `<p>Dein Kumpel: <b>${mates.map((m) => escapeHtml(nameOf(m))).join(', ')}</b></p>` : ''}
    </div>
  `);
  if (s.qm && s.qm !== id) {
    const b = el(`<button class="drink-btn">Bin auf den Fragenmeister reingefallen</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => {
      b.disabled = true;
      send('fooled');
      toast('Prost! Strichliste ist aktualisiert.');
    });
    root.append(b);
  }
  if (vip) {
    const end = el(`<button class="secondary small">Kings Cup beenden</button>`).firstElementChild as HTMLButtonElement;
    end.addEventListener('click', () => confirm('Kings Cup jetzt beenden und Strichliste zeigen?') && socket.emit('vip:mini', 'end'));
    root.append(end);
  }
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Spieler wählen (2 / 8)

function buildPick(s: KingsState) {
  const players = (store.state?.players ?? []).filter((p) => s.order.includes(p.id) && p.id !== s.drawer);
  const root = el(`
    <h1>${escapeHtml(KINGS_RULES[s.card!.rank].title)}</h1>
    <p>${s.pickFor === 'mate' ? 'Wer wird dein Trink-Kumpel?' : 'Wer muss trinken?'}</p>
  `);
  let sent = false;
  root.append(
    playerButtons(players, (target) => {
      if (sent) return;
      sent = true;
      navigator.vibrate?.(20);
      send('pick', { target });
    }),
  );
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Knopf-Rennen (4 / 7 / König)

function buildRace(s: KingsState) {
  const r = s.race!;
  const label = KINGS_RACE[s.card!.rank].button;
  const root = el(`
    <p class="kc-race-hint">${r.kind === 'boden' ? 'Hand auf den Boden – und tippen!' : r.kind === 'himmel' ? 'Hände hoch – und tippen!' : 'Rudern – und tippen!'}</p>
    <button class="big-btn kc-race wait">Gleich ...</button>
  `);
  const btn = q<HTMLButtonElement>(root, '.kc-race');
  let tapped = false;
  tapButton(btn, () => {
    const st = kc();
    if (tapped || st?.race?.phase !== 'go') return;
    tapped = true;
    navigator.vibrate?.(40);
    send('tap');
  });
  app.append(root);
  let wasGo = false;
  return () => {
    const st = kc()?.race;
    if (!st) return;
    const mine = st.times[store.playerId!];
    if (st.phase === 'ready') {
      btn.className = 'big-btn kc-race wait';
      btn.textContent = 'Gleich ...';
    } else if (st.phase === 'go' && !tapped && mine === undefined) {
      btn.className = 'big-btn kc-race go';
      btn.textContent = label;
      if (!wasGo) navigator.vibrate?.(80);
      wasGo = true;
    } else {
      btn.className = 'big-btn kc-race done';
      btn.textContent = mine !== undefined ? `${(mine / 1000).toFixed(2).replace('.', ',')} s` : tapped ? 'Gedrückt!' : 'Zu spät!';
    }
  };
}

// ------------------------------------------------------------------ Reimwort / Kategorie / Regel eintippen

function buildText(s: KingsState, kind: 'word' | 'rule') {
  const rank = s.card!.rank;
  const ideas = kind === 'rule' ? KINGS_PRESET_RULES : rank === 9 ? KINGS_RHYMES : KINGS_CATEGORIES;
  const max = kind === 'rule' ? KINGS.RULE_LEN : KINGS.WORD_LEN;
  const root = el(`
    <h1>${escapeHtml(KINGS_RULES[rank].title)}</h1>
    <p>${kind === 'rule' ? 'Deine neue Regel (gilt bis zum Ende):' : rank === 9 ? 'Dein Wort – alle müssen darauf reimen:' : 'Deine Kategorie – alle nennen reihum etwas:'}</p>
    <input type="text" class="kc-input" maxlength="${max}" placeholder="${kind === 'rule' ? 'z. B. Nur mit links trinken' : rank === 9 ? 'z. B. Haus' : 'z. B. Tiere'}" />
    <button class="drink-btn kc-ok">Los geht’s!</button>
    <p>Oder nimm einen Vorschlag:</p>
    <div class="kc-ideas"></div>
  `);
  const input = q<HTMLInputElement>(root, '.kc-input');
  const ideasEl = q(root, '.kc-ideas');
  let sent = false;
  const submit = (text: string) => {
    if (sent) return;
    if (!text.trim()) return toast('Schreib etwas – oder tipp einen Vorschlag an.');
    sent = true;
    input.blur();
    send(kind, { text: text.trim() });
  };
  for (const idea of [...ideas].sort(() => Math.random() - 0.5).slice(0, 4)) {
    const b = el(`<button class="secondary small">${escapeHtml(idea)}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => submit(idea));
    ideasEl.append(b);
  }
  q(root, '.kc-ok').addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit(input.value));
  app.append(root);
  input.focus({ preventScroll: true });
  return null;
}

// ------------------------------------------------------------------ Reim-/Kategorie-Runde

function buildChain(judge: boolean) {
  const s0 = kc()!;
  const c0 = s0.chain!;
  const root = el(`
    <p>${c0.mode === 'reim' ? 'Reimt auf' : 'Kategorie'}</p>
    <h1>${escapeHtml(c0.word)}</h1>
    <div class="kc-turn"><p>Dran:</p><h2 class="kc-who"></h2></div>
    ${
      judge
        ? `<p>Du bist Schiri: Hat die Person etwas Passendes gesagt?</p>
           <button class="big-btn half kc-next">WEITER ✓</button>
           <button class="big-btn half fail kc-fail">VERLOREN ✗</button>`
        : '<p class="kc-me"></p>'
    }
  `);
  const who = q(root, '.kc-who');
  let lastSent = -1;
  if (judge) {
    const act = (action: 'next' | 'fail') => {
      const c = kc()?.chain;
      if (!c || lastSent === c.step) return;
      lastSent = c.step;
      navigator.vibrate?.(20);
      send(action, { step: c.step });
    };
    tapButton(q(root, '.kc-next'), () => act('next'));
    tapButton(q(root, '.kc-fail'), () => act('fail'));
  }
  app.append(root);
  return () => {
    const c = kc()?.chain;
    if (!c) return;
    const name = nameOf(c.turn);
    who.textContent = c.turn === store.playerId ? 'DU!' : name;
    root.querySelector('.kc-turn')?.classList.toggle('mine', c.turn === store.playerId);
    if (judge) q(root, '.kc-fail').textContent = `${name.slice(0, 12)} HAT VERLOREN ✗`;
    else q(root, '.kc-me').textContent = c.turn === store.playerId ? (c.mode === 'reim' ? 'Sag laut ein Reimwort!' : 'Sag laut etwas Passendes!') : 'Hör gut zu ...';
  };
}

// ------------------------------------------------------------------ Wasserfall

function buildWaterfall(s: KingsState) {
  const id = store.playerId!;
  const order = s.waterfall ?? [];
  const i = order.indexOf(id);
  const before = i > 0 ? order[i - 1] : null;
  app.append(
    el(`
      <div class="center kc-rule">
        ${cardHtml(s)}
        <h1>WASSERFALL!</h1>
        <h2>Alle trinken – jetzt!</h2>
        <p>${i === 0 ? 'Du fängst an und darfst aufhören, wann du willst.' : before ? `Du darfst erst aufhören, wenn <b>${escapeHtml(nameOf(before))}</b> aufgehört hat.` : 'Trink mit!'}</p>
      </div>
    `),
  );
  navigator.vibrate?.([100, 50, 100]);
  return null;
}

// ------------------------------------------------------------------ Ansage

function buildResult(s: KingsState) {
  const id = store.playerId!;
  const a = s.announce;
  const mainHit = !!a?.drink && a.main.includes(id);
  const extra = a?.drink ? a.extra.find((e) => e.id === id) : undefined;
  const title = mainHit ? 'Trink!' : extra ? 'Trink mit!' : a?.title ?? '';
  const sub = mainHit ? (a?.title ?? '') : extra ? `Dein Kumpel ${nameOf(extra.via)} trinkt – du auch.` : a?.drink ? 'Glück gehabt!' : '';
  app.append(
    el(`
      <div class="center kc-rule">
        <h1 class="${mainHit || extra ? '' : 'kc-calm'}">${escapeHtml(title)}</h1>
        <h2>${escapeHtml(sub)}</h2>
        <p>${escapeHtml(a?.note ?? '')}</p>
        <p class="kc-count">Du: ${s.drinks[id] ?? 0}× getrunken</p>
      </div>
    `),
  );
  if (mainHit || extra) navigator.vibrate?.([80, 60, 80]);
  return null;
}
