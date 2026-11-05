import type { SchaetzPrivate, SchaetzState } from '../../../shared/types';
import { SCHAETZ, fmtNum } from '../../../shared/schaetz';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, socket, store, timerText } from '../core';
import { haptic } from '../haptic';

/** Lokale Eingabe – überlebt einen Neuaufbau des Screens (kurzer WLAN-Aussetzer) */
const local = { key: '', digits: '' };

const st = () => (store.state?.mini?.kind === 'schaetz' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Runde passt */
const priv = (): SchaetzPrivate | null => {
  const p = store.priv?.kind === 'schaetz' ? store.priv.state : null;
  const s = st();
  return p && s && p.round === s.round ? p : null;
};

const short = (name: string) => name.replace(/^Bot\s+/, '');
const withUnit = (n: number, unit: string) => `${fmtNum(n)}${unit ? ` ${unit}` : ''}`;

export function pickSchaetz(s: SchaetzState, vip: boolean): Screen {
  injectCss();
  const id = store.playerId!;
  const r = s.round;
  if (s.sub === 'truth' && vip) return [`sz-truth-${r}`, () => buildPad(s, 'truth')];
  if (!s.players.includes(id)) return ['sz-spectate', message('Du schaust zu', 'Schau auf den Fernseher!')];
  switch (s.sub) {
    case 'guess': {
      const p = priv();
      if (!p) return ['sz-wait', message('Moment ...')];
      return p.guess === null ? [`sz-guess-${r}`, () => buildPad(s, 'guess')] : [`sz-guessed-${r}`, buildGuessed];
    }
    case 'line':
      return [`sz-line-${r}`, () => buildInfo(s, 'Die Karten werden sortiert ...', 'Gleich setzt du deine Chips.')];
    case 'bet':
      return [`sz-bet-${r}`, () => buildBet(s)];
    case 'truth': {
      const subj = s.subject === id;
      return [`sz-truth-${r}-${subj}`, () => buildInfo(s, subj ? 'Jetzt du: Sag dem VIP die Wahrheit!' : 'Der VIP tippt die richtige Zahl ein ...', subj ? 'Wie viel ist es wirklich?' : `Frag ${short(nameOf(s.subject))}!`)];
    }
    case 'drum':
      return [`sz-drum-${r}`, () => buildInfo(s, 'Trommelwirbel ...', 'Schau auf den Fernseher!')];
    case 'reveal':
      return [`sz-rev-${r}-${vip}`, () => buildReveal(s, vip)];
    case 'scores':
      return [`sz-scores-${r}-${vip}`, () => buildScores(s, vip)];
    default:
      return ['sz-over', message('Das war Schätzkönig!', 'Gleich gibt’s die Auswertung ...')];
  }
}

function head(s: SchaetzState) {
  return `
    <div class="top-row"><span>${s.rounds > 1 ? `Frage ${s.round}/${s.rounds}` : 'Schätzkönig'}</span><span class="timer"></span></div>
    <h2 class="sz-q">${escapeHtml(s.question)}</h2>`;
}

const tickTimer = (root: ParentNode) => {
  const t = root.querySelector('.timer');
  if (t) t.textContent = timerText((sec) => `${sec}s`);
};

// ------------------------------------------------------------------ Zahlenfeld (Schätzen + VIP-Auflösung)

function buildPad(s: SchaetzState, mode: 'guess' | 'truth') {
  const key = `${mode}-${s.round}`;
  if (local.key !== key) {
    local.key = key;
    local.digits = '';
  }
  const truth = mode === 'truth';
  const root = el(`
    ${head(s)}
    ${truth ? `<p class="sz-hint">${s.subject === store.playerId ? 'Es geht um dich: Tipp ehrlich die <b>echte</b> Zahl ein.' : `VIP: Frag ${escapeHtml(short(nameOf(s.subject)))} und tipp die <b>richtige</b> Zahl ein.`}</p>` : ''}
    <div class="sz-display"><span class="sz-num"></span><small>${escapeHtml(s.unit || 'Jahr')}</small></div>
    <div class="sz-pad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '000'].map((k) => `<button class="secondary" data-k="${k}">${k}</button>`).join('')}
    </div>
    <button class="sz-ok" disabled>${truth ? 'Auflösen!' : 'Schätzung abgeben'}</button>
  `);
  const num = q(root, '.sz-num');
  const ok = q<HTMLButtonElement>(root, '.sz-ok');
  const show = () => {
    num.textContent = local.digits ? fmtNum(Number(local.digits)) : '?';
    num.classList.toggle('empty', !local.digits);
    ok.disabled = !local.digits;
  };
  let sent = false;
  root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => {
    const k = b.dataset.k!;
    let holdTimer: number | undefined;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (sent) return;
      haptic('tick');
      if (k === '⌫') {
        local.digits = local.digits.slice(0, -1);
        // Gedrückt halten = alles löschen
        holdTimer = window.setTimeout(() => {
          local.digits = '';
          haptic('tap');
          show();
        }, 550);
      } else {
        const next = (local.digits === '0' ? '' : local.digits) + k;
        const clean = next.replace(/^0+(?=\d)/, '');
        if (clean.length <= SCHAETZ.MAX_DIGITS) local.digits = clean;
      }
      show();
    });
    const stop = () => clearTimeout(holdTimer);
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  ok.addEventListener('click', () => {
    if (sent || !local.digits) return;
    sent = true;
    haptic('hit');
    const value = Number(local.digits);
    if (truth) socket.emit('vip:mini', `truth:${value}`);
    else send('guess', { round: s.round, value });
    ok.disabled = true;
    ok.textContent = 'Gesendet!';
  });
  show();
  app.append(root);
  return () => tickTimer(root);
}

function buildGuessed() {
  const s = st()!;
  const root = el(`
    ${head(s)}
    <div class="center">
      <p>Deine Schätzung</p>
      <h1 class="sz-mine"></h1>
      <p class="wait"></p>
    </div>
  `);
  app.append(root);
  return () => {
    const cur = st();
    if (!cur) return;
    tickTimer(root);
    const g = priv()?.guess;
    q(root, '.sz-mine').textContent = g === null || g === undefined ? '?' : withUnit(g, cur.unit);
    const missing = cur.players.length - cur.guessed.length;
    q(root, '.wait').textContent = missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle haben geschätzt!';
  };
}

function buildInfo(s: SchaetzState, title: string, sub: string) {
  const g = priv()?.guess;
  const root = el(`
    ${head(s)}
    <div class="center">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(sub)}</p>
      ${g !== null && g !== undefined ? `<p>Deine Schätzung: <b>${escapeHtml(withUnit(g, s.unit))}</b></p>` : ''}
    </div>
  `);
  app.append(root);
  return () => tickTimer(root);
}

// ------------------------------------------------------------------ Chips setzen

function buildBet(s: SchaetzState) {
  const id = store.playerId!;
  const cards = s.cards ?? [];
  const mineGuess = priv()?.guess;
  const rows = [
    `<button class="sz-card low" data-card="-1"><span class="sz-odds o5">×${s.lowOdds}</span><span class="sz-val">Alle zu hoch</span><span class="sz-by">kleiner als jede Karte</span><span class="sz-chips"></span></button>`,
    ...cards.map((c, i) => {
      const own = c.by.includes(id);
      const by = c.by.map((x) => short(nameOf(x))).join(', ');
      return `<button class="sz-card${own ? ' own' : ''}" data-card="${i}"><span class="sz-odds o${c.odds}">×${c.odds}</span><span class="sz-val">${escapeHtml(withUnit(c.value, s.unit))}</span><span class="sz-by">${escapeHtml(own ? `du${c.by.length > 1 ? ` + ${c.by.length - 1}` : ''}` : by)}</span><span class="sz-chips"></span></button>`;
    }),
  ];
  const root = el(`
    <div class="top-row"><span class="sz-left"></span><span class="timer"></span></div>
    <p class="sz-hint">Tipp auf die Karte, die am nächsten dran ist – <b>ohne drüber</b>. Eigene Karte geht auch!</p>
    <div class="sz-list">${rows.join('')}</div>
    <button class="secondary small sz-undo">Chips zurücknehmen</button>
    ${mineGuess !== null && mineGuess !== undefined ? `<p>Deine Schätzung: ${escapeHtml(withUnit(mineGuess, s.unit))}</p>` : ''}
  `);
  let lastTap = 0;
  root.querySelectorAll<HTMLButtonElement>('.sz-card').forEach((b) => {
    b.addEventListener('click', () => {
      const cur = st();
      if (!cur || cur.sub !== 'bet' || (cur.chips[id]?.length ?? 0) >= SCHAETZ.CHIPS) return;
      if (performance.now() - lastTap < 180) return;
      lastTap = performance.now();
      haptic('tap');
      send('chip', { round: cur.round, card: Number(b.dataset.card) });
    });
  });
  q(root, '.sz-undo').addEventListener('click', () => {
    haptic('tick');
    send('unchip', { round: s.round });
  });
  app.append(root);
  return () => {
    const cur = st();
    if (!cur) return;
    tickTimer(root);
    const mine = cur.chips[id] ?? [];
    const left = SCHAETZ.CHIPS - mine.length;
    q(root, '.sz-left').textContent = left > 0 ? `Chips übrig: ${'● '.repeat(left).trim()}` : 'Fertig! Warte auf die anderen ...';
    const total = new Map<number, number>();
    for (const picks of Object.values(cur.chips)) for (const k of picks) total.set(k, (total.get(k) ?? 0) + 1);
    root.querySelectorAll<HTMLButtonElement>('.sz-card').forEach((b) => {
      const k = Number(b.dataset.card);
      const my = mine.filter((x) => x === k).length;
      const all = total.get(k) ?? 0;
      b.classList.toggle('picked', my > 0);
      q(b, '.sz-chips').textContent = `${'🪙'.repeat(my)}${all - my > 0 ? ` +${all - my}` : ''}`;
    });
    q<HTMLButtonElement>(root, '.sz-undo').disabled = !mine.length;
  };
}

// ------------------------------------------------------------------ Auflösung / Zwischenstand

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="sz-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    haptic('tap');
    socket.emit('vip:mini', 'next');
  });
  return b;
}

function buildReveal(s: SchaetzState, vip: boolean) {
  const id = store.playerId!;
  const gain = s.gain?.[id] ?? 0;
  const winCard = s.winner !== null && s.winner >= 0 ? s.cards?.[s.winner] : null;
  const author = !!winCard?.by.includes(id);
  const myChips = (s.chips[id] ?? []).filter((k) => k === s.winner).length;
  const g = priv()?.guess;
  if (gain > 0) haptic('win');
  const root = el(`
    <div class="center">
      <p>${s.answerByMedian ? 'Keine Auflösung – der Median zählt' : 'Die richtige Antwort'}</p>
      <h1>${s.answer !== null ? escapeHtml(withUnit(s.answer, s.unit)) : '?'}</h1>
      ${g !== null && g !== undefined ? `<p>Du hast ${escapeHtml(fmtNum(g))} geschätzt.</p>` : ''}
      <h2 class="${gain ? 'yellow' : ''}">${gain ? `+${gain} Punkte!` : 'Diesmal keine Punkte'}</h2>
      <p>${[author ? `Deine Karte gewinnt (+${SCHAETZ.AUTHOR_BONUS})` : '', myChips ? `${myChips} Chip${myChips > 1 ? 's' : ''} richtig gesetzt` : ''].filter(Boolean).join(' · ')}</p>
      <p>Deine Punkte: ${s.points[id] ?? 0}</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(s.round >= s.rounds ? 'Zur Auswertung' : 'Weiter'));
  app.append(root);
  return null;
}

function buildScores(s: SchaetzState, vip: boolean) {
  const id = store.playerId!;
  const ranked = [...s.players].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const root = el(`
    <div class="center">
      <p>Zwischenstand nach Frage ${s.round}/${s.rounds}</p>
      <h1>Platz ${place}</h1>
      <h2>${s.points[id] ?? 0} Punkte</h2>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton('Nächste Frage'));
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Stil (eigenes <style>, damit style.css unberührt bleibt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.sz-q { font-size: 12px; line-height: 1.6; }
.sz-hint { font-size: 9px; line-height: 1.6; }
.sz-hint b { color: var(--red); font-weight: normal; }
.sz-display { display: flex; align-items: baseline; justify-content: center; gap: 8px; padding: 12px 8px; background: var(--paper-light); border: 3px solid var(--wood-dark); box-shadow: inset 0 2px 0 var(--paper-dark); min-height: 58px; }
.sz-num { font-size: 22px; color: var(--red); overflow-wrap: anywhere; text-align: center; }
.sz-num.empty { color: #c9ab78; }
.sz-display small { font-size: 9px; color: var(--ink-soft); }
.sz-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sz-pad button { font-size: 18px; padding: 14px 0; touch-action: none; }
.sz-pad button[data-k='000'] { font-size: 13px; }
.sz-ok { font-size: 13px; padding: 16px 8px; background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.sz-list { display: flex; flex-direction: column; gap: 6px; }
.sz-card { display: grid; grid-template-columns: 34px 1fr auto; grid-template-areas: "odds val chips" "odds by chips"; align-items: center; column-gap: 8px; text-align: left; padding: 8px 10px; background: var(--paper-light); color: var(--ink); text-shadow: none; border-color: var(--wood-dark); box-shadow: inset 0 -3px 0 var(--paper-dark), 0 3px 0 var(--wood-darker); }
.sz-card.low { background: #3b2a22; color: #ffb3a8; }
.sz-card.low .sz-by { color: #d8b9a0; }
.sz-card.own { border-style: dashed; }
.sz-card.picked { background: #fff1b0; border-color: var(--gold); box-shadow: inset 0 -3px 0 #e8c25a, 0 3px 0 var(--wood-darker); }
.sz-card.low.picked { background: #5a3a2c; }
.sz-odds { grid-area: odds; text-align: center; padding: 4px 0; color: #fff4d6; border: 2px solid var(--outline); background: #2f7d32; }
.sz-odds.o3 { background: #d99a2b; }
.sz-odds.o4, .sz-odds.o5 { background: var(--red); }
.sz-val { grid-area: val; font-size: 11px; overflow-wrap: anywhere; }
.sz-by { grid-area: by; font-size: 8px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sz-chips { grid-area: chips; font-size: 11px; white-space: nowrap; }
.sz-next { margin-top: 8px; }
`;
