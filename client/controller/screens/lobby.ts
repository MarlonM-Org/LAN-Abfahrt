import type { Look, MiniKind } from '../../../shared/types';
import { BEARDS, HAIRS, HAIR_STYLES, SHIRTS, SKINS, randomLook } from '../../../shared/avatar';
import { ARCADE_GROUPS, DATE_KINDS, DRINK_KINDS, MINI_INFO, PARTY_KINDS, PARTY_ROUND_OPTIONS, fitsPlayers, miniInspired } from '../../../shared/games';
import { DATE_COMING_SOON, DATE_VERSIONS } from '../../../shared/dates';
import { LS, app, avatarCanvas, el, escapeHtml, myColor, paintAvatar, q, socket, store, toast } from '../core';
import { lobbyPlayerList } from '../players';
import { sessionPanel } from './leaderboard';

/** VIP-Schalter im Party-Modus: auch lange Minispiele (> 4 min) aufs Brett – bleibt bis zum Neuladen */
let partyLongGames = false;

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
    <div class="session-slot"></div>
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
  const plist = lobbyPlayerList();
  q(root, '.count').after(plist.root);
  const menu = q(root, '.menu');
  const gated: { btn: HTMLButtonElement; min: number; max?: number; hint?: string }[] = [];
  /** Arcade-Kacheln + Abstimmung: wird im Updater aufgefrischt */
  let arcadeUpdate: ((n: number) => void) | null = null;
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
      const b = el(`<button class="secondary small">${info.title}${info.orientation === 'landscape' ? ' <b class="or-mark">↔</b>' : ''}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: kind }));
      q(row, '.btn-grid').append(b);
      gated.push({ btn: b, min: info.minPlayers, max: info.maxPlayers, hint: info.maxPlayers ? `max. ${info.maxPlayers} Spieler` : undefined });
    }
    menu.append(row);
  };

  if (mode === 'arcade') {
    const voteOpen = !!store.state?.arcadeVote;
    if (vip) {
      menu.append(el(`<h2>Arcade</h2><p>Jedes Spiel einzeln – die Punkte landen im Leaderboard.</p>`));
      const tog = el(`<button class="vote-toggle ${voteOpen ? 'on' : 'secondary'}">Alle dürfen wählen: ${voteOpen ? 'AN' : 'AUS'}</button>`).firstElementChild as HTMLButtonElement;
      tog.addEventListener('click', () => socket.emit('vip:arcadeVote', !voteOpen));
      menu.append(tog);
      const rnd = el(`<button class="drink-btn">Zufälliges Spiel</button>`).firstElementChild as HTMLButtonElement;
      rnd.addEventListener('click', () => socket.emit('vip:start', { mode: 'random' }));
      menu.append(rnd);
      gated.push({ btn: rnd, min: 1 });
    } else if (voteOpen) {
      menu.append(el(`<h2>Arcade</h2><p>Tippe auf dein Wunschspiel – der VIP sieht alle Stimmen und startet.</p>`));
    } else {
      menu.append(el(`<div class="center"><h2>Arcade</h2><p>Warte, bis der VIP ein Spiel startet ...</p></div>`));
    }
    if (vip || voteOpen) arcadeUpdate = arcadeTiles(menu, vip, voteOpen, gated);
    menu.append(leaderboardPanel());
    if (vip) {
      const reset = el(`<button class="secondary small">Leaderboard zurücksetzen</button>`).firstElementChild as HTMLButtonElement;
      reset.textContent = 'Ewige Tabelle zurücksetzen';
      reset.addEventListener('click', () => confirm('Ewige Arcade-Tabelle (alle Abende) löschen?') && socket.emit('vip:resetLeaderboard'));
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
    // Gespeicherter Brettstand (data/party.json, z. B. nach einem Server-Neustart) → fortsetzen
    const saved = store.state?.partyResume;
    if (saved) {
      const names = saved.names.slice(0, 4).join(', ') + (saved.names.length > 4 ? ' …' : '');
      const b = el(`<button class="drink-btn">Party fortsetzen? Runde ${saved.round}/${saved.maxRounds}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: 'party', resume: true }));
      menu.append(b, el(`<p>Mit ${escapeHtml(names)}</p>`));
      gated.push({ btn: b, min: 2 });
    }
    const roundRow = el(`<div class="btn-row"></div>`);
    for (const r of PARTY_ROUND_OPTIONS) {
      const b = el(`<button>${r} Runden</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: 'party', rounds: r, longGames: partyLongGames }));
      q(roundRow, '.btn-row').append(b);
      gated.push({ btn: b, min: 2 });
    }
    menu.append(roundRow);
    const longLabel = () => `Lange Spiele (Golf, Bowling …): ${partyLongGames ? 'AN' : 'AUS'}`;
    const longTog = el(`<button class="small ${partyLongGames ? '' : 'secondary'}"></button>`).firstElementChild as HTMLButtonElement;
    longTog.textContent = longLabel();
    longTog.addEventListener('click', () => {
      partyLongGames = !partyLongGames;
      longTog.textContent = longLabel();
      longTog.classList.toggle('secondary', !partyLongGames);
    });
    menu.append(longTog);
    singles(PARTY_KINDS);
  } else {
    const label = mode === 'date' ? 'Date Night ♥' : mode === 'drink' ? 'Trinkspiel' : 'Party-Abfahrt';
    menu.append(el(`<div class="center"><h2>${label}</h2><p>Warte, bis der VIP ein Spiel startet ...</p></div>`));
  }

  // Leaderboard des Abends (alle Modi): Tabelle auf Wunsch, VIP: auf dem TV zeigen + zurücksetzen
  const ses = sessionPanel({ open: (store.state?.session.games ?? 0) > 0 });
  const slot = q(root, '.session-slot');
  slot.append(ses.root);
  let tvBtn: HTMLButtonElement | null = null;
  let resetSes: HTMLButtonElement | null = null;
  if (vip) {
    const row = el(`<div class="btn-row lb-vip"></div>`).firstElementChild as HTMLElement;
    tvBtn = el(`<button class="secondary small"></button>`).firstElementChild as HTMLButtonElement;
    tvBtn.addEventListener('click', () => socket.emit('vip:showBoard', !store.state?.showBoard));
    resetSes = el(`<button class="secondary small">Zurücksetzen</button>`).firstElementChild as HTMLButtonElement;
    resetSes.addEventListener('click', () => confirm('Leaderboard des Abends löschen? Alle Punkte von heute gehen verloren.') && socket.emit('vip:resetSession'));
    row.append(tvBtn, resetSes);
    ses.root.append(row);
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
  type QKind = 'wwe' | 'nhie' | 'post' | 'quip' | 'werwars';
  const qKinds: [QKind, string][] =
    mode === 'drink' ? [['nhie', 'Ich hab noch nie'], ['wwe', 'Wer würde eher']] : [['post', 'Stille Post'], ['quip', 'Sprüche-Duell'], ['werwars', 'Wer war’s?']];
  const qNames: Record<QKind, string> = { nhie: 'Ich hab noch nie', wwe: 'Wer würde eher', post: 'Stille Post:', quip: 'Sprüche-Duell:', werwars: 'Wer war’s?:' };
  let qKind: QKind = qKinds[0][0];
  const qInput = q<HTMLInputElement>(root, '.q-input');
  const kindTabs = q(root, '.q-kind');
  const kindBtns: HTMLButtonElement[] = [];
  if (qKinds.length === 1) kindTabs.classList.add('hidden');
  if (qKinds.length === 3) kindTabs.classList.add('three');
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
            : k === 'werwars'
              ? 'z. B. Mein erstes Haustier'
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
    const n = st?.players.filter((p) => p.connected && !p.removed).length ?? 0;
    const off = st?.players.filter((p) => !p.connected && !p.removed).length ?? 0;
    q(root, '.hello').innerHTML = `Hi ${escapeHtml(store.name)}!` + ((c) => (c ? ` Du bist <span class="me-color" style="background:${c.hex};color:${c.ink}">${c.name.toUpperCase()}</span>` : ''))(myColor());
    q(root, '.count').textContent = `${n} Spieler in der Lobby${st?.botCount ? ` (davon ${st.botCount} Bots)` : ''}${off ? ` · ${off} offline` : ''}`;
    plist.update();
    q(root, '.q-count').textContent =
      mode === 'drink'
        ? `${st?.customNhieCount ?? 0} eigene Aussagen · ${st?.customQuestionCount ?? 0} eigene Fragen`
        : `${st?.customPostCount ?? 0} eigene Startsätze · ${st?.customQuipCount ?? 0} eigene Sprüche-Fragen · ${st?.customWerwarsCount ?? 0} eigene Wer-war’s-Fragen`;
    arcadeUpdate?.(n);
    ses.update();
    if (tvBtn) tvBtn.textContent = st?.showBoard ? 'TV: Lobby zeigen' : 'Auf dem TV zeigen';
    if (resetSes) resetSes.disabled = !st?.session.games;
    for (const g of gated) {
      const tooMany = g.max !== undefined && n > g.max;
      g.btn.disabled = n < g.min || tooMany;
      // Kurzer Hinweis, warum ein Spiel ausgegraut ist (z. B. „max. 8 Spieler“)
      if (g.hint) {
        const small = g.btn.querySelector('small.max-hint');
        if (tooMany && !small) g.btn.insertAdjacentHTML('beforeend', `<small class="max-hint"><br/>${g.hint}</small>`);
        else if (!tooMany && small) small.remove();
      }
    }
  };
}

/**
 * Arcade-Übersicht als Kacheln (Icon, Titel, „à la …“, Stimmen).
 * VIP: Tippen startet das Spiel. Andere (nur bei „Alle dürfen wählen“): Tippen = Stimme (nochmal = zurückziehen).
 */
function arcadeTiles(menu: HTMLElement, vip: boolean, voteOpen: boolean, gated: { btn: HTMLButtonElement; min: number; max?: number; hint?: string }[]) {
  let top: HTMLButtonElement | null = null;
  let fav: HTMLButtonElement | null = null;
  if (vip && voteOpen) {
    const row = el(`<div class="bot-row vote-actions"><button class="small">Meiste Stimmen starten</button><button class="small secondary">Zufall aus Favoriten</button></div>`);
    [top, fav] = [...row.querySelectorAll('button')] as HTMLButtonElement[];
    top.addEventListener('click', () => socket.emit('vip:start', { mode: 'top' }));
    fav.addEventListener('click', () => socket.emit('vip:start', { mode: 'favorites' }));
    menu.append(row);
  }
  const tiles: { kind: MiniKind; btn: HTMLButtonElement; votes: HTMLElement; key: string }[] = [];
  for (const g of ARCADE_GROUPS) {
    menu.append(el(`<h2>${escapeHtml(g.title)}</h2>`));
    const grid = el(`<div class="arcade-grid"></div>`);
    for (const kind of g.kinds) {
      const info = MINI_INFO[kind];
      const insp = miniInspired(kind);
      const b = el(
        `<button class="secondary arcade-tile"><span class="ic">${info.icon}</span><span class="t">${escapeHtml(info.title)}${info.orientation === 'landscape' ? ' <b class="or-mark" title="Handy quer halten">↔</b>' : ''}</span>${insp ? `<small class="insp">${escapeHtml(insp)}</small>` : ''}<span class="votes"></span></button>`,
      ).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => (vip ? socket.emit('vip:start', { mode: kind }) : socket.emit('arcade:vote', kind)));
      q(grid, '.arcade-grid').append(b);
      gated.push({ btn: b, min: info.minPlayers, max: info.maxPlayers, hint: info.maxPlayers ? `max. ${info.maxPlayers} Spieler` : undefined });
      tiles.push({ kind, btn: b, votes: q(b, '.votes'), key: '' });
    }
    menu.append(grid);
  }

  return (n: number) => {
    const st = store.state;
    const votes = st?.arcadeVote?.votes ?? {};
    const byKind = new Map<MiniKind, string[]>();
    for (const [id, k] of Object.entries(votes)) byKind.set(k, [...(byKind.get(k) ?? []), id]);
    for (const t of tiles) {
      const ids = byKind.get(t.kind) ?? [];
      const key = ids.join(',');
      t.btn.classList.toggle('mine', !!store.playerId && votes[store.playerId] === t.kind);
      t.btn.classList.toggle('voted', ids.length > 0);
      if (key === t.key) continue;
      t.key = key;
      t.votes.innerHTML = '';
      if (!ids.length) continue;
      t.votes.append(el(`<b>${ids.length}</b>`));
      for (const id of ids.slice(0, 6)) {
        const p = st?.players.find((pl) => pl.id === id);
        if (p) t.votes.append(avatarCanvas(1, p.look));
      }
    }
    if (top && fav) {
      const fitting = [...byKind].filter(([k]) => fitsPlayers(k, n));
      const best = Math.max(0, ...fitting.map(([, ids]) => ids.length));
      const leaders = fitting.filter(([, ids]) => ids.length === best);
      top.disabled = !fitting.length;
      fav.disabled = !fitting.length;
      top.textContent = !fitting.length
        ? 'Meiste Stimmen starten'
        : leaders.length === 1
          ? `Starten: ${MINI_INFO[leaders[0][0]].icon} ${MINI_INFO[leaders[0][0]].title} (${best})`
          : `Meiste Stimmen (${leaders.length}× ${best}) – Zufall`;
    }
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
        .map(([k, g]) => `<tr><td>${MINI_INFO[k as MiniKind] ? `${MINI_INFO[k as MiniKind].icon} ${escapeHtml(MINI_INFO[k as MiniKind].title)}` : escapeHtml(k)}</td><td>${g!.points}</td><td>${g!.plays}x</td></tr>`)
        .join('')
    : '';
  return el(`
    <div class="panel">
      <p class="label-left">Ewige Tabelle (alle Abende · Punkte · Siege)</p>
      ${rows ? `<table class="lb"><tbody>${rows}</tbody></table>` : '<p>Noch keine Punkte – spielt los!</p>'}
      ${mine ? `<p class="label-left">Deine Punkte pro Spiel</p><table class="lb"><tbody>${per}</tbody></table>` : ''}
    </div>
  `);
}
