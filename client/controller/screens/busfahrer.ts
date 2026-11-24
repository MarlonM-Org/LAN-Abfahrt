import type { BusCard, BusState, BusTipp } from '../../../shared/busfahrer';
import { BUS_SUIT_CHARS, BUS_TIPP_TEXT, busFrageText, busRed, busSchluecke, busTippHint, sipText } from '../../../shared/busfahrer';
import { cardLabel } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, nameOf, q, send, store, tapButton } from '../core';
import { haptic } from '../haptic';

/**
 * Busfahrer (MiniKind `hilo`) am Handy: Kartenreihe oben, die Frage, große Tipp-Knöpfe.
 * Ein Tipp gilt sofort (kein Ändern), dann „Warte auf die anderen“. Auflösung groß: „Trink 2!“ bzw. „Sicher!“.
 */

const ARROWS: Partial<Record<BusTipp, string>> = { hoeher: '▲', tiefer: '▼', gleich: '=' };

/** Eigene Tipps (nur zur Anzeige im Warte-/Auflösungs-Screen) – pro Spielinstanz und Karte */
const mine = new Map<string, BusTipp>();
const tipKey = (s: BusState) => `${store.state?.miniSeq ?? 0}-${s.round}`;

function cardHtml(c: BusCard | null, cls = '') {
  if (!c) return `<div class="bf-card back ${cls}"><span>?</span></div>`;
  return `<div class="bf-card ${busRed(c) ? 'red' : ''} ${cls}"><span>${cardLabel(c.rank)}</span><small>${BUS_SUIT_CHARS[c.suit]}</small></div>`;
}

/** Kartenreihe: aufgedeckte Karten, die aktuelle (verdeckt mit „?“ bzw. frisch umgedreht), Rest verdeckt */
function rowHtml(s: BusState) {
  const n = s.fragen.length;
  const cells: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = s.cards[i] ?? null;
    const cur = i === s.step && s.sub !== 'over';
    cells.push(`<div class="bf-cell">${cardHtml(c, `${cur ? 'cur' : ''} ${cur && c ? 'flip' : ''}`)}<b>${busSchluecke(i)}🍺</b></div>`);
  }
  return `<div class="bf-row">${cells.join('')}</div>`;
}

const ACE_NOTE = '<p class="bf-note">Ass ist hoch: 2 … 10 · B 11 · D 12 · K 13 · A 14</p>';

export function pickBusfahrer(s: BusState): Screen {
  const id = store.playerId!;
  if (!(id in s.sips)) return ['spectate', () => {
    app.append(el(`<div class="center"><h2>Du schaust zu</h2><p>Der Bus ist schon voll – beim nächsten Spiel fährst du mit.</p></div>`));
    return null;
  }];
  const frage = s.fragen[s.step];
  const sips = busSchluecke(s.step);
  const head = `<p class="bf-head">Karte ${s.step + 1}/${s.fragen.length}${s.passes > 1 ? ` · Durchgang ${s.pass}/${s.passes}` : ''}</p>`;

  if (s.sub === 'guess' && !s.chosen.includes(id)) {
    return [`bf-g-${s.round}`, () => {
      const btns = s.options
        .map((t) => `<button class="big-btn bf-opt t-${t}" data-t="${t}">${BUS_TIPP_TEXT[t]}${ARROWS[t] ? ` ${ARROWS[t]}` : ''}<small>${escapeHtml(busTippHint(frage, t, s.cards))}</small></button>`)
        .join('');
      const root = el(`
        ${head}
        ${rowHtml(s)}
        <h2>${escapeHtml(busFrageText(frage, s.cards))}</h2>
        <p class="bf-stake">Falsch = <b>${sipText(sips)}</b></p>
        <div class="bf-opts n${s.options.length}">${btns}</div>
        ${frage === 'hoehe' || frage === 'zwischen' ? ACE_NOTE : ''}
      `);
      let sent = false;
      root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) =>
        tapButton(b, () => {
          if (sent) return;
          sent = true;
          const tipp = b.dataset.t as BusTipp;
          mine.set(tipKey(s), tipp);
          b.classList.add('picked');
          haptic('tap');
          send('guess', { round: s.round, tipp });
        }),
      );
      app.append(root);
      return null;
    }];
  }

  if (s.sub === 'guess') {
    return [`bf-w-${s.round}`, () => {
      const t = mine.get(tipKey(s));
      const root = el(`
        ${head}
        ${rowHtml(s)}
        <div class="center">
          <h2>${t ? `Dein Tipp: ${BUS_TIPP_TEXT[t]}` : 'Getippt!'}</h2>
          <p class="bf-wait"></p>
        </div>
      `);
      app.append(root);
      const wait = q(root, '.bf-wait');
      return () => {
        const cur = store.state?.mini?.kind === 'hilo' ? store.state.mini.state : s;
        const total = Object.keys(cur.sips).length;
        wait.textContent = `Warte auf die anderen … (${cur.chosen.length}/${total})`;
      };
    }];
  }

  if (s.sub === 'reveal') {
    return [`bf-r-${s.round}`, () => {
      const n = s.roundSips?.[id] ?? 0;
      const out = s.out.includes(id);
      const g = s.guesses?.[id];
      const card = s.cards[s.step];
      const title = out ? 'Ausgesetzt' : n ? `Trink ${n}!` : 'Sicher!';
      const mineLine = out ? 'Dein Handy war weg – diese Karte zählt nicht.' : g ? `Dein Tipp: ${BUS_TIPP_TEXT[g]}` : 'Kein Tipp abgegeben';
      const root = el(`
        ${head}
        <div class="center bf-result ${out ? 'out' : n ? 'drink' : 'safe'}">
          ${cardHtml(card ?? null, 'big flip')}
          <h1>${title}</h1>
          <p>${escapeHtml(s.answerText)} → <b>${s.answer ? BUS_TIPP_TEXT[s.answer] : ''}</b></p>
          <p>${escapeHtml(mineLine)}</p>
          <p class="bf-total">Bisher: ${sipText(s.sips[id] ?? 0)}</p>
        </div>
      `);
      app.append(root);
      if (!out) haptic(n ? 'bad' : 'win');
      return null;
    }];
  }

  return ['bf-over', () => {
    const total = s.sips[id] ?? 0;
    const most = Math.max(0, ...Object.values(s.sips));
    const drivers = Object.keys(s.sips).filter((p) => most > 0 && s.sips[p] === most);
    const driverLine = !most ? 'Keiner musste trinken!' : drivers.includes(id) ? 'Du fährst den Bus! 🚌' : `Busfahrer: ${drivers.map(nameOf).join(', ')}`;
    app.append(el(`
      ${rowHtml(s)}
      <div class="center">
        <h1>Endstation!</h1>
        <h2>Du: ${sipText(total)}</h2>
        <p>${escapeHtml(driverLine)}</p>
      </div>
    `));
    return null;
  }];
}
