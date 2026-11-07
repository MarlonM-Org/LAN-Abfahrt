import type { WrPrivate, WrRole, WrState } from '../../../shared/wolfrunde';
import { WR_MIN_CARDS, WR_ORDER, WR_ROLES, WR_SPECIALS, WR_WINNER, wrDeckSize, wrFits, wrSummary, wrWakeOrder } from '../../../shared/wolfrunde';
import { type Screen, app, avatarCanvas, el, escapeHtml, message, nameOf, q, send, socket, store } from '../core';

/**
 * Werwolf mit Erzähler (Handy).
 * - setup: VIP wählt den Erzähler per Dropdown, der Erzähler stellt den Stapel zusammen und teilt aus
 * - play: Spieler sehen nur ihre verdeckte Karte (antippen = kurz aufdecken), der Erzähler eine Übersicht aller
 *   Karten mit 💀-Knopf pro Spieler (nochmal tippen = wiederbeleben) und Nacht/Tag-Umschalter
 * Screen-Keys bewusst ohne „over“/„dead“ & Co. – sonst hängt main.ts die Zuschauer-Leiste (Emotes, Wetten) an.
 */

const wrState = () => (store.state?.mini?.kind === 'wolfrunde' ? store.state.mini.state : null);
const priv = (): WrPrivate | null => (store.priv?.kind === 'wolfrunde' ? store.priv.state : null);
const roleLabel = (r: WrRole) => `${WR_ROLES[r].icon} ${WR_ROLES[r].name}`;

export function pickWolfrunde(w: WrState, vip: boolean): Screen {
  const id = store.playerId!;
  if (w.sub === 'setup') {
    if (w.narrator === id) return [`wr-setup-erz-${vip}`, () => buildNarratorSetup(vip)];
    return [`wr-setup-${vip}`, () => buildSetupWait(vip)];
  }
  if (w.sub === 'over') return [`wr-ende-${w.deal}`, buildEnd];
  if (w.narrator === id) return [`wr-buch-${w.deal}`, buildBook];
  if (!w.players.includes(id)) return ['wr-zuschauer', message('Du schaust zu', 'Diese Runde leitet der Erzähler – beim nächsten Spiel bist du dabei.')];
  const p = priv();
  if (!p?.card || p.deal !== w.deal) return ['wr-mischen', message('Karten werden gemischt ...')];
  return [`wr-karte-${w.deal}-${p.card}-${!!p.steal}`, buildCard];
}

// ---------------------------------------------------------------- Erzähler wählen (VIP)

/** Dropdown mit allen möglichen Erzählern – nur für den VIP */
function narratorSelect() {
  const root = el(`<label class="wr-pick"><span>Wer erzählt?</span><select class="wr-select"></select></label>`);
  const select = q<HTMLSelectElement>(root, 'select');
  let listKey = '';
  select.addEventListener('change', () => socket.emit('vip:mini', `narrator:${select.value}`));
  const update = () => {
    const w = wrState();
    if (!w) return;
    const ids = [...(w.narrator ? [w.narrator] : []), ...w.players];
    const players = store.state?.players ?? [];
    const list = ids
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p && (p.connected || p.id === w.narrator))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const key = JSON.stringify([w.narrator, list.map((p) => [p.id, p.name])]);
    if (key === listKey || document.activeElement === select) return;
    listKey = key;
    select.innerHTML = `<option value="">– bitte wählen –</option>${list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.id === store.playerId ? ' (du)' : ''}</option>`).join('')}`;
    select.value = w.narrator ?? '';
  };
  return { root, update };
}

function buildSetupWait(vip: boolean) {
  const pick = vip ? narratorSelect() : null;
  app.append(el(`<div class="top-row"><span>🌕 Werwolf</span><span>${vip ? 'VIP' : ''}</span></div>`), el(`<h1>Werwolf</h1>`));
  if (pick) app.append(el(`<div class="panel wr-panel"></div>`));
  if (pick) q(app, '.wr-panel').append(pick.root);
  const info = el(`<div class="center"><h2 class="wr-who"></h2><p class="wr-sub"></p></div>`);
  app.append(info);
  return () => {
    const w = wrState();
    if (!w) return;
    pick?.update();
    q(app, '.wr-who').textContent = w.narrator ? `🎙️ ${nameOf(w.narrator)} erzählt` : vip ? 'Wähle oben den Erzähler.' : 'Der VIP wählt den Erzähler ...';
    q(app, '.wr-sub').textContent = w.narrator ? 'Gleich gibt’s Karten.' : '';
  };
}

// ---------------------------------------------------------------- Stapel zusammenstellen (Erzähler)

function buildNarratorSetup(vip: boolean) {
  const pick = vip ? narratorSelect() : null;
  app.append(el(`<div class="top-row"><span>🌕 Werwolf</span><span>🎙️ Erzähler</span></div>`), el(`<h1>Du erzählst</h1>`));
  if (pick) {
    app.append(el(`<div class="panel wr-panel wr-vip"></div>`));
    q(app, '.wr-vip').append(pick.root);
  }
  const deck = el(`
    <div class="panel wr-panel wr-deck">
      <div class="wr-count"><span>🐺 Werwölfe</span><button class="secondary small wr-minus">–</button><b class="wr-wolves">1</b><button class="secondary small wr-plus">+</button></div>
      <div class="wr-chips"></div>
      <p class="wr-sum"></p>
    </div>`);
  app.append(deck);
  const chips = new Map<WrRole, HTMLButtonElement>();
  for (const r of WR_SPECIALS) {
    const b = el(`<button class="secondary wr-chip">${roleLabel(r)}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => send('config', { toggle: r }));
    q(app, '.wr-chips').append(b);
    chips.set(r, b);
  }
  const minus = q<HTMLButtonElement>(app, '.wr-minus');
  const plus = q<HTMLButtonElement>(app, '.wr-plus');
  minus.addEventListener('click', () => send('config', { wolves: (wrState()?.config.wolves ?? 1) - 1 }));
  plus.addEventListener('click', () => send('config', { wolves: (wrState()?.config.wolves ?? 1) + 1 }));
  const go = el(`<button class="drink-btn wr-deal">🃏 Karten verteilen</button>`).firstElementChild as HTMLButtonElement;
  go.addEventListener('click', () => send('deal'));
  app.append(go);
  return () => {
    const w = wrState();
    if (!w) return;
    pick?.update();
    const n = w.players.length;
    const c = w.config;
    q(app, '.wr-wolves').textContent = String(c.wolves);
    minus.disabled = c.wolves <= 1;
    plus.disabled = !wrFits(c, n, { wolf: true });
    for (const [r, b] of chips) {
      const on = c.specials.includes(r);
      b.classList.toggle('on', on);
      b.classList.toggle('secondary', !on);
      b.disabled = !on && !wrFits(c, n, { role: r });
    }
    const extra = wrDeckSize(c, n) - n;
    q(app, '.wr-sum').textContent = `${n} Spieler: ${wrSummary(c, n)}${extra ? ` (${extra} bleiben für den Dieb übrig)` : ''}`;
    go.disabled = n < WR_MIN_CARDS;
    go.textContent = n < WR_MIN_CARDS ? `Mindestens ${WR_MIN_CARDS} Spieler` : '🃏 Karten verteilen';
  };
}

// ---------------------------------------------------------------- Übersicht (Erzähler)

const sortRows = (ids: string[], cards: Record<string, WrRole>) =>
  [...ids].sort((a, b) => WR_ORDER.indexOf(cards[a]) - WR_ORDER.indexOf(cards[b]) || nameOf(a).localeCompare(nameOf(b), 'de'));

function buildBook() {
  const w0 = wrState()!;
  const book0 = priv()?.book;
  app.append(
    el(`
    <div class="wr-book">
      <div class="wr-head"><b>🎙️ ERZÄHLER</b><span class="wr-phase"></span><button class="wr-time"></button></div>
      <p class="wr-wake"></p>
      <p class="wr-rest hidden"></p>
      <div class="wr-list"></div>
      <div class="wr-foot"><button class="secondary small wr-redeal">🔀 Neu verteilen</button><button class="small wr-end">🏁 Spiel beenden</button></div>
      <div class="panel wr-endpick hidden"><h2>Wer hat gewonnen?</h2></div>
    </div>`),
  );
  const timeBtn = q<HTMLButtonElement>(app, '.wr-time');
  timeBtn.addEventListener('click', () => send('time', { to: wrState()?.time === 'night' ? 'day' : 'night' }));

  // Feste Reihenfolge (nach Rolle, dann Name) – Tote bleiben an ihrem Platz, damit sich nichts unterm Finger verschiebt
  const rows = new Map<string, { row: HTMLElement; role: HTMLElement; btn: HTMLButtonElement }>();
  const list = q(app, '.wr-list');
  const buildRows = (cards: Record<string, WrRole>) => {
    list.innerHTML = '';
    rows.clear();
    for (const id of sortRows(w0.players, cards)) {
      const p = store.state?.players.find((x) => x.id === id);
      const row = el(`<div class="wr-row"><span class="wr-av"></span><span class="wr-who"><b></b><i class="wr-role"></i></span><button class="wr-skull" aria-label="tot / lebendig"></button></div>`).firstElementChild as HTMLElement;
      if (p) q(row, '.wr-av').append(avatarCanvas(2, p.look));
      q(row, '.wr-who b').textContent = nameOf(id);
      const btn = q<HTMLButtonElement>(row, '.wr-skull');
      btn.addEventListener('click', () => send('kill', { target: id, alive: !wrState()?.alive[id] }));
      list.append(row);
      rows.set(id, { row, role: q(row, '.wr-role'), btn });
    }
  };
  let rowsKey = '';

  // Spielende: Sieger wählen (Verliebte nur mit Amor)
  const endPick = q(app, '.wr-endpick');
  const winners = (['dorf', 'wolf', ...(w0.config.specials.includes('amor') ? ['liebe' as const] : [])] as const).map((k) => {
    const b = el(`<button class="wr-win wr-win-${k}">${WR_WINNER[k].button}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => send('end', { winner: k }));
    return b;
  });
  const back = el(`<button class="secondary small">Weiterspielen</button>`).firstElementChild as HTMLButtonElement;
  endPick.append(...winners, back);
  q(app, '.wr-end').addEventListener('click', () => endPick.classList.toggle('hidden'));
  back.addEventListener('click', () => endPick.classList.add('hidden'));
  q(app, '.wr-redeal').addEventListener('click', () => {
    if (confirm('Alle Karten einsammeln und neu verteilen?')) send('redeal');
  });

  if (book0) {
    buildRows(book0.cards);
    rowsKey = JSON.stringify(book0.cards);
  }

  return () => {
    const w = wrState();
    const book = priv()?.book;
    if (!w || !book) return;
    // Der Dieb hat getauscht → seine Rolle (und damit die Sortierung) ändert sich einmal
    const key = JSON.stringify(book.cards);
    if (key !== rowsKey) {
      rowsKey = key;
      buildRows(book.cards);
    }
    const night = w.time === 'night';
    q(app, '.wr-phase').textContent = w.time === 'dusk' ? 'Karten ansehen' : night ? `Nacht ${w.round}` : `Tag ${w.round}`;
    timeBtn.textContent = night ? '☀️ Tag' : '🌙 Nacht';
    timeBtn.classList.toggle('night', !night);
    const first = w.round === 0 || (w.round === 1 && night);
    q(app, '.wr-wake').textContent = `${first ? '1. Nacht' : 'Nachts'}: ${wrWakeOrder(w.config, first).join(' · ')}`;
    const rest = q(app, '.wr-rest');
    rest.classList.toggle('hidden', !book.dieb);
    if (book.dieb) {
      const now = book.cards[book.dieb];
      rest.textContent = !book.stolen
        ? `Für den Dieb übrig: ${book.rest.map(roleLabel).join(' · ')}`
        : now === 'dieb'
          ? `${nameOf(book.dieb)} behält den Dieb.`
          : `${nameOf(book.dieb)} hat getauscht: ${roleLabel(now)}`;
    }
    for (const [id, r] of rows) {
      const alive = !!w.alive[id];
      const card = book.cards[id];
      r.row.classList.toggle('dead', !alive);
      r.role.textContent = `${roleLabel(card)}${id === book.dieb && card !== 'dieb' ? ' (war Dieb)' : ''}`;
      r.role.style.color = alive ? WR_ROLES[card].color : '';
      r.btn.textContent = alive ? '💀' : '↺';
      r.btn.classList.toggle('revive', !alive);
    }
  };
}

// ---------------------------------------------------------------- Eigene Karte (Spieler)

/** Verdeckte Karte – sieht für alle gleich aus; antippen = 8 s aufdecken. Der Dieb tauscht auf der Vorderseite. */
function buildCard() {
  app.append(
    el(`
    <div class="ww-night wr-me">
      <div class="top-row"><span>🌕 Werwolf</span><span class="wr-phase"></span></div>
      <div class="dead-banner wr-tot hidden">💀 Du bist raus</div>
      <div class="ww-card big" role="button">
        <div class="ww-card-back"><b>DEINE KARTE</b><small>Antippen zum Aufdecken – niemand darf mitlesen!</small></div>
        <div class="ww-card-front hidden"></div>
      </div>
      <p class="wr-hint">Rolle merken – dann Handy weglegen.</p>
    </div>`),
  );
  const card = q(app, '.ww-card');
  const back = q(app, '.ww-card-back');
  const front = q(app, '.ww-card-front');
  let open = false;
  let closeTimer: number | undefined;
  const render = () => {
    const p = priv();
    if (!p?.card) return;
    const info = WR_ROLES[p.card];
    front.innerHTML = `<span class="wr-big">${info.icon}</span><b class="ww-role" style="color:${info.color}">${escapeHtml(info.name.toUpperCase())}</b><span>${escapeHtml(info.text)}</span>${p.wasDieb ? '<small>(vorher Dieb)</small>' : ''}`;
    if (p.steal) {
      // Dieb: eine der zwei übrigen Karten nehmen – liegen zwei Werwölfe da, muss er einen nehmen
      const must = p.steal.every((r) => r === 'werwolf');
      const box = el(`<div class="wr-steal"><span>Tauschen gegen:</span></div>`).firstElementChild as HTMLElement;
      p.steal.forEach((r, i) => {
        const b = el(`<button class="small">${roleLabel(r)}</button>`).firstElementChild as HTMLButtonElement;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          send('steal', { pick: i });
        });
        box.append(b);
      });
      const keep = el(`<button class="secondary small">Dieb behalten</button>`).firstElementChild as HTMLButtonElement;
      keep.disabled = must;
      keep.addEventListener('click', (e) => {
        e.stopPropagation();
        send('steal', { pick: -1 });
      });
      box.append(keep);
      front.append(box);
    }
    front.append(el(`<small>Antippen zum Verdecken</small>`));
  };
  const setOpen = (o: boolean) => {
    open = o;
    back.classList.toggle('hidden', open);
    front.classList.toggle('hidden', !open);
    card.classList.toggle('open', open);
    clearTimeout(closeTimer);
    if (open) {
      render();
      // Der Dieb braucht etwas länger zum Entscheiden
      closeTimer = window.setTimeout(() => setOpen(false), priv()?.steal ? 20000 : 8000);
    }
  };
  card.addEventListener('click', () => setOpen(!open));
  return () => {
    const w = wrState();
    if (!w) return;
    const alive = !!w.alive[store.playerId!];
    q(app, '.wr-tot').classList.toggle('hidden', alive);
    q(app, '.wr-phase').textContent = w.time === 'dusk' ? '' : w.time === 'night' ? `🌙 Nacht ${w.round}` : `☀️ Tag ${w.round}`;
  };
}

// ---------------------------------------------------------------- Ende

function buildEnd() {
  const w = wrState()!;
  const p = priv();
  const mine = p?.card ? `Du warst: ${roleLabel(p.card)}` : '';
  app.append(el(`<div class="center"><h1>${escapeHtml(w.winner ? WR_WINNER[w.winner].title : 'Spiel vorbei')}</h1><h2>${escapeHtml(mine)}</h2><p>Gleich kommt das Ergebnis.</p></div>`));
  return null;
}
