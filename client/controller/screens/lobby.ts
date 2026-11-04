import type { Look, MiniKind } from '../../../shared/types';
import { BEARDS, HAIRS, HAIR_STYLES, SHIRTS, SKINS, randomLook } from '../../../shared/avatar';
import { ARCADE_GROUPS, DATE_KINDS, DRINK_KINDS, MINI_INFO, PARTY_KINDS, PARTY_ROUND_OPTIONS } from '../../../shared/games';
import { DATE_COMING_SOON, DATE_VERSIONS } from '../../../shared/dates';
import { LS, app, avatarCanvas, el, escapeHtml, paintAvatar, q, socket, store, toast } from '../core';

/** Avatar-Editor. `onDone` tritt dem Spiel bei bzw. aktualisiert den Charakter. */
export function buildEdit(onDone: () => void) {
  const preview = avatarCanvas(8);
  const root = el(`
    <h1>LAN-ABFAHRT</h1>
    <div class="panel"></div>
    <label>Dein Name</label>
    <input type="text" maxlength="12" placeholder="z. B. Marlon" />
    <div class="pickers"></div>
    <button class="secondary small" data-act="random">Zufall</button>
    <button data-act="go">Los geht's!</button>
  `);
  q(root, '.panel').append(preview);
  const input = q<HTMLInputElement>(root, 'input');
  input.value = store.name;

  const pickers = q(root, '.pickers');
  const fields: { key: keyof Look; label: string; n: number; text: (i: number) => string }[] = [
    { key: 'skin', label: 'Haut', n: SKINS.length, text: (i) => `${i + 1}/${SKINS.length}` },
    { key: 'hairStyle', label: 'Frisur', n: HAIR_STYLES.length, text: (i) => HAIR_STYLES[i] },
    { key: 'hair', label: 'Haare', n: HAIRS.length, text: (i) => `${i + 1}/${HAIRS.length}` },
    { key: 'beard', label: 'Bart', n: BEARDS.length, text: (i) => BEARDS[i] },
    { key: 'shirt', label: 'Shirt', n: SHIRTS.length, text: (i) => `${i + 1}/${SHIRTS.length}` },
  ];
  const valueEls: HTMLElement[] = [];
  for (const f of fields) {
    const row = el(
      `<div class="picker"><span>${f.label}</span><button class="small">&lt;</button><span class="value"></span><button class="small">&gt;</button></div>`,
    ).firstElementChild as HTMLElement;
    const [prev, next] = row.querySelectorAll('button');
    const step = (d: number) => {
      store.look = { ...store.look, [f.key]: (store.look[f.key] + d + f.n) % f.n };
      update();
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    valueEls.push(q(row, '.value'));
    pickers.append(row);
  }
  q(root, '[data-act=random]').addEventListener('click', () => {
    store.look = randomLook();
    update();
  });
  q(root, '[data-act=go]').addEventListener('click', () => {
    const n = input.value.trim().slice(0, 12);
    if (!n) return toast('Bitte gib einen Namen ein.');
    store.name = n;
    localStorage.setItem(LS.name, n);
    localStorage.setItem(LS.look, JSON.stringify(store.look));
    store.editing = false;
    onDone();
  });
  app.append(root);

  const update = () => {
    paintAvatar(preview, store.look);
    fields.forEach((f, i) => (valueEls[i].textContent = f.text(store.look[f.key])));
  };
  update();
  return null;
}

export function buildLobby(vip: boolean, onEdit: () => void) {
  const mode = store.state?.mode ?? 'party';
  const root = el(`
    <h1>LAN-ABFAHRT</h1>
    <div class="row-center"></div>
    <h2 class="hello"></h2>
    <p class="count"></p>
    <div class="menu"></div>
    <div class="panel q-panel">
      <p class="label-left">${mode === 'drink' ? 'Eigene Frage / Aussage' : 'Eigener Startsatz / Spruch'}</p>
      <div class="mode-tabs q-kind"></div>
      <input type="text" maxlength="120" class="q-input" />
      <button class="small" data-act="addq">Hinzufügen</button>
      <p class="q-count"></p>
    </div>
    <div class="bot-row"></div>
    <button class="secondary small" data-act="edit">Charakter ändern</button>
  `);
  q(root, '.row-center').append(avatarCanvas(6, store.look));
  const menu = q(root, '.menu');
  const gated: { btn: HTMLButtonElement; min: number; max?: number }[] = [];
  if (mode === 'date') q(root, '.q-panel').classList.add('hidden');

  if (vip) {
    menu.append(el(`<p>Du bist der VIP – du wählst, was gespielt wird.</p>`));
    const tabs = el(`<div class="mode-tabs four"></div>`);
    for (const [m, label] of [['party', 'Party'], ['arcade', 'Arcade'], ['drink', 'Trinken'], ['date', 'Date ♥']] as const) {
      const b = el(`<button class="mode-tab ${m === mode ? 'active' : 'secondary'}">${label}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:mode', m));
      q(tabs, '.mode-tabs').append(b);
    }
    menu.append(tabs);
  }

  const singles = (kinds: MiniKind[], title = 'Einzelspiel') => {
    menu.append(el(`<h2>${title}</h2>`));
    const row = el(`<div class="btn-grid"></div>`);
    for (const kind of kinds) {
      const info = MINI_INFO[kind];
      const b = el(`<button class="secondary small">${info.title}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: kind }));
      q(row, '.btn-grid').append(b);
      gated.push({ btn: b, min: info.minPlayers });
    }
    menu.append(row);
  };

  if (mode === 'arcade') {
    if (vip) {
      menu.append(el(`<h2>Arcade</h2><p>Jedes Spiel einzeln – die Punkte landen im Leaderboard.</p>`));
      const rnd = el(`<button class="drink-btn">Zufälliges Spiel</button>`).firstElementChild as HTMLButtonElement;
      rnd.addEventListener('click', () => socket.emit('vip:start', { mode: 'random' }));
      menu.append(rnd);
      gated.push({ btn: rnd, min: 1 });
      for (const g of ARCADE_GROUPS) singles(g.kinds, g.title);
    }
    menu.append(leaderboardPanel());
    if (vip) {
      const reset = el(`<button class="secondary small">Leaderboard zurücksetzen</button>`).firstElementChild as HTMLButtonElement;
      reset.addEventListener('click', () => confirm('Alle Arcade-Punkte löschen?') && socket.emit('vip:resetLeaderboard'));
      menu.append(reset);
    }
  } else if (vip && mode === 'date') {
    menu.append(el(`<h2>Date Night</h2><p>Für genau 2 Spieler – ihr spielt zusammen und sammelt Herzen.</p>`));
    for (const v of DATE_VERSIONS) {
      const b = el(`<button class="date-btn">${v.title}<br/><small>${v.subtitle}</small></button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: 'date', version: v.id }));
      menu.append(b);
      gated.push({ btn: b, min: 2, max: 2 });
    }
    for (const t of DATE_COMING_SOON) menu.append(el(`<button class="secondary" disabled>${t} – kommt bald</button>`));
    singles(DATE_KINDS, 'Einzelnes Kapitel');
  } else if (vip && mode === 'drink') {
    menu.append(el(`<h2>Trinkspiel</h2><p>Partyklassiker reihum: Wer würde eher, Ich hab noch nie, Höher oder Tiefer, Tick-Tack-Bumm. Wasser zählt auch!</p>`));
    const b = el(`<button class="drink-btn">Los geht’s!</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => socket.emit('vip:start', { mode: 'drink' }));
    menu.append(b);
    gated.push({ btn: b, min: 2 });
    singles(DRINK_KINDS);
  } else if (vip) {
    menu.append(el(`<h2>Party-Modus</h2><p>Spielbrett + Minispiele, Finale: Mord oder Verräter im Ferienhaus</p>`));
    const roundRow = el(`<div class="btn-row"></div>`);
    for (const r of PARTY_ROUND_OPTIONS) {
      const b = el(`<button>${r} Runden</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: 'party', rounds: r }));
      q(roundRow, '.btn-row').append(b);
      gated.push({ btn: b, min: 2 });
    }
    menu.append(roundRow);
    singles(PARTY_KINDS);
  } else {
    const label = mode === 'date' ? 'Date Night ♥' : mode === 'drink' ? 'Trinkspiel' : 'Party-Abfahrt';
    menu.append(el(`<div class="center"><h2>${label}</h2><p>Warte, bis der VIP ein Spiel startet ...</p></div>`));
  }

  // Bots zum Testen
  if (vip) {
    const row = q(root, '.bot-row');
    const add = el(`<button class="secondary small">+ Bot</button>`).firstElementChild as HTMLButtonElement;
    add.addEventListener('click', () => socket.emit('vip:addBot'));
    const rm = el(`<button class="secondary small">Bots entfernen</button>`).firstElementChild as HTMLButtonElement;
    rm.addEventListener('click', () => socket.emit('vip:removeBots'));
    row.append(add, rm);
  }

  // Eigene Fragen (Wer würde eher / Ich hab noch nie) bzw. Startsätze für Stille Post / Fragen fürs Sprüche-Duell
  type QKind = 'wwe' | 'nhie' | 'post' | 'quip';
  const qKinds: [QKind, string][] =
    mode === 'drink' ? [['nhie', 'Ich hab noch nie'], ['wwe', 'Wer würde eher']] : [['post', 'Stille Post'], ['quip', 'Sprüche-Duell']];
  const qNames: Record<QKind, string> = { nhie: 'Ich hab noch nie', wwe: 'Wer würde eher', post: 'Stille Post:', quip: 'Sprüche-Duell:' };
  let qKind: QKind = qKinds[0][0];
  const qInput = q<HTMLInputElement>(root, '.q-input');
  const kindTabs = q(root, '.q-kind');
  const kindBtns: HTMLButtonElement[] = [];
  if (qKinds.length === 1) kindTabs.classList.add('hidden');
  const setKind = (k: QKind) => {
    qKind = k;
    kindBtns.forEach((b) => b.classList.toggle('active', b.dataset.k === k));
    kindBtns.forEach((b) => b.classList.toggle('secondary', b.dataset.k !== k));
    qInput.placeholder =
      k === 'wwe'
        ? 'Wer würde eher ... den Flug verpassen?'
        : k === 'post'
          ? 'z. B. Ein Hai beim Kindergeburtstag'
          : k === 'quip'
            ? 'z. B. Das beste Mitbringsel: ___'
            : 'Ich hab noch nie ... im Zelt geschlafen.';
  };
  for (const [k, label] of qKinds) {
    const b = el(`<button class="mode-tab small" data-k="${k}">${label}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => setKind(k));
    kindBtns.push(b);
    kindTabs.append(b);
  }
  setKind(qKind);
  q(root, '[data-act=addq]').addEventListener('click', () => {
    const text = qInput.value.trim();
    if (text.length < 4) return toast('Zu kurz.');
    socket.emit(
      'question:add',
      text,
      (r: { ok: boolean; question?: string }) => {
        if (r.ok) {
          qInput.value = '';
          toast(`Gespeichert: ${qNames[qKind]} ${r.question}`);
        } else {
          toast('Hat nicht geklappt.');
        }
      },
      qKind,
    );
  });
  q(root, '[data-act=edit]').addEventListener('click', onEdit);
  app.append(root);

  return () => {
    const st = store.state;
    const n = st?.players.filter((p) => p.connected).length ?? 0;
    q(root, '.hello').textContent = `Hi ${store.name}!`;
    q(root, '.count').textContent = `${n} Spieler in der Lobby${st?.botCount ? ` (davon ${st.botCount} Bots)` : ''}`;
    q(root, '.q-count').textContent =
      mode === 'drink'
        ? `${st?.customNhieCount ?? 0} eigene Aussagen · ${st?.customQuestionCount ?? 0} eigene Fragen`
        : `${st?.customPostCount ?? 0} eigene Startsätze · ${st?.customQuipCount ?? 0} eigene Sprüche-Fragen`;
    for (const g of gated) g.btn.disabled = n < g.min || (g.max !== undefined && n > g.max);
  };
}

/** Leaderboard + eigene Punkte pro Spiel */
function leaderboardPanel() {
  const list = store.state?.leaderboard ?? [];
  const mine = list.find((e) => e.name === store.name);
  const rows = list
    .slice(0, 10)
    .map((e, i) => `<tr class="${e.name === store.name ? 'me' : ''}"><td>${i + 1}.</td><td>${escapeHtml(e.name)}</td><td>${e.points}</td><td>${e.wins}</td></tr>`)
    .join('');
  const per = mine
    ? Object.entries(mine.perGame)
        .sort((a, b) => (b[1]?.points ?? 0) - (a[1]?.points ?? 0))
        .map(([k, g]) => `<tr><td>${escapeHtml(MINI_INFO[k as MiniKind]?.title ?? k)}</td><td>${g!.points}</td><td>${g!.plays}x</td></tr>`)
        .join('')
    : '';
  return el(`
    <div class="panel">
      <p class="label-left">Leaderboard (Punkte · Siege)</p>
      ${rows ? `<table class="lb"><tbody>${rows}</tbody></table>` : '<p>Noch keine Punkte – spielt los!</p>'}
      ${mine ? `<p class="label-left">Deine Punkte pro Spiel</p><table class="lb"><tbody>${per}</tbody></table>` : ''}
    </div>
  `);
}
