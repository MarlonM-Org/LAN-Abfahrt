import type { Look, MiniKind } from '../../../shared/types';
import { HAIRS, HAIR_STYLES, SHIRTS, SKINS, randomLook } from '../../../shared/avatar';
import { MINI_INFO, PARTY_ROUND_OPTIONS } from '../../../shared/games';
import { LS, app, avatarCanvas, el, paintAvatar, q, socket, store, toast } from '../core';

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
  const root = el(`
    <h1>LAN-ABFAHRT</h1>
    <div class="row-center"></div>
    <h2 class="hello"></h2>
    <p class="count"></p>
    <div class="menu"></div>
    <div class="panel">
      <p class="label-left">Eigene „Wer würde eher ...?“-Frage</p>
      <input type="text" maxlength="120" class="q-input" placeholder="... den Flug verpassen?" />
      <button class="small" data-act="addq">Frage hinzufügen</button>
      <p class="q-count"></p>
    </div>
    <button class="secondary small" data-act="edit">Charakter ändern</button>
  `);
  q(root, '.row-center').append(avatarCanvas(6, store.look));
  const menu = q(root, '.menu');
  const gated: { btn: HTMLButtonElement; min: number }[] = [];

  if (vip) {
    menu.append(el(`<p>Du bist der VIP – du wählst, was gespielt wird.</p>`));
    menu.append(el(`<h2>Party-Modus</h2><p>Spielbrett + Minispiele, Finale: Mord im Ferienhaus</p>`));
    const roundRow = el(`<div class="btn-row"></div>`);
    for (const r of PARTY_ROUND_OPTIONS) {
      const b = el(`<button>${r} Runden</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: 'party', rounds: r }));
      q(roundRow, '.btn-row').append(b);
      gated.push({ btn: b, min: 2 });
    }
    menu.append(roundRow);
    menu.append(el(`<h2>Einzelspiel</h2>`));
    for (const kind of Object.keys(MINI_INFO) as MiniKind[]) {
      const info = MINI_INFO[kind];
      const b = el(`<button class="secondary">${info.title}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => socket.emit('vip:start', { mode: kind }));
      menu.append(b);
      gated.push({ btn: b, min: info.minPlayers });
    }
  } else {
    menu.append(el(`<div class="center"><p>Warte, bis der VIP ein Spiel startet ...</p></div>`));
  }

  const qInput = q<HTMLInputElement>(root, '.q-input');
  q(root, '[data-act=addq]').addEventListener('click', () => {
    const text = qInput.value.trim();
    if (text.length < 4) return toast('Frage ist zu kurz.');
    socket.emit('question:add', text, (r: { ok: boolean; question?: string }) => {
      if (r.ok) {
        qInput.value = '';
        toast(`Gespeichert: Wer würde eher ${r.question}`);
      } else {
        toast('Hat nicht geklappt.');
      }
    });
  });
  q(root, '[data-act=edit]').addEventListener('click', onEdit);
  app.append(root);

  return () => {
    const n = store.state?.players.filter((p) => p.connected).length ?? 0;
    q(root, '.hello').textContent = `Hi ${store.name}!`;
    q(root, '.count').textContent = `${n} Spieler in der Lobby`;
    q(root, '.q-count').textContent = `${store.state?.customQuestionCount ?? 0} eigene Fragen gespeichert`;
    for (const g of gated) g.btn.disabled = n < g.min;
  };
}
