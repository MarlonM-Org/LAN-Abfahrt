import type { TttPrivate, TttShopItem, TttState } from '../../../shared/types';
import { ROOMS, TTT, TTT_ROLES, TTT_SHOP } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, message, nameOf, q, secondsLeft, send, store, tapButton } from '../core';
import { joystick } from './controller';

const ttt = () => (store.state?.mini?.kind === 'ttt' ? store.state.mini.state : null);
const priv = (): TttPrivate | null => (store.priv?.kind === 'ttt' ? store.priv.state : null);

export function pickTtt(s: TttState): Screen {
  const p = priv();
  if (!p) return ['ttt-wait', message('Moment ...')];
  switch (s.sub) {
    case 'roles':
      return [`ttt-roles-${s.round}`, () => buildRoles(s)];
    case 'play':
      return p.alive
        ? [`ttt-play-${s.round}-${p.role}`, buildPlay]
        : [`ttt-dead-${s.round}`, message('Ausgeknockt – zuschauen', 'Psst! Nichts verraten. Schau auf den Fernseher, wer gewinnt.')];
    case 'roundEnd':
      return [`ttt-end-${s.round}`, () => buildRoundEnd(s, p)];
    case 'over':
      return ['ttt-over', message('Alle Runden gespielt!', `Du hast ${s.scores[store.playerId!] ?? 0} Punkte. Schau auf den Fernseher!`)];
  }
}

function roleText(p: TttPrivate) {
  if (p.role === 'traitor') {
    return p.partners.length ? `VERRÄTER – mit ${p.partners.map(nameOf).join(', ')}` : 'VERRÄTER';
  }
  return p.role === 'detective' ? 'DETEKTIV (alle wissen es)' : 'UNSCHULDIG';
}

/** Rolle nur sichtbar, solange man den Knopf gedrückt hält – damit niemand mitliest. */
function roleHold(container: HTMLElement, label = 'Rolle ansehen (gedrückt halten)', cls = '') {
  const btn = el(`<button class="secondary role-btn ${cls}">${label}</button>`).firstElementChild as HTMLButtonElement;
  const show = () => {
    const p = priv();
    if (!p) return;
    btn.textContent = roleText(p);
    btn.classList.toggle('danger', p.role === 'traitor');
    btn.classList.toggle('detective', p.role === 'detective');
  };
  const hide = () => {
    btn.textContent = label;
    btn.classList.remove('danger', 'detective');
  };
  btn.addEventListener('pointerdown', (e) => (e.preventDefault(), show()));
  btn.addEventListener('pointerup', hide);
  btn.addEventListener('pointerleave', hide);
  btn.addEventListener('pointercancel', hide);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  container.append(btn);
}

function buildRoles(s: TttState) {
  const det = s.detective ? `<p class="label-left">Detektiv (mit Hut): <b>${escapeHtml(nameOf(s.detective))}</b> – kann an Ausgeknockten Spuren finden.</p>` : '';
  const root = el(`
    <h1>VERRÄTER IM<br/>FERIENHAUS</h1>
    <h2>Runde ${s.round} von ${s.rounds}</h2>
    <p>Halte den Knopf gedrückt, damit niemand mitliest.</p>
    <div class="slot"></div>
    <div class="panel">
      <p class="label-left">Unschuldige: Überlebt, findet die Verräter und knockt sie aus!</p>
      <p class="label-left">Verräter (${s.traitorCount}): Knockt alle anderen aus. Im Geheimfach gibt’s Tricks.</p>
      ${det}
      <p class="label-left">ANGRIFF = Poolnudel (oder Wasserpistole/Kokosnuss). BENUTZEN = aufheben/untersuchen.</p>
    </div>
  `);
  roleHold(q(root, '.slot'));
  app.append(root);
  return null;
}

function buildPlay() {
  const p0 = priv()!;
  const root = el(`
    <div class="top-row ttt-top"><span class="timer"></span><span class="hearts"></span><span class="weapon"></span></div>
    <p class="ttt-info"></p>
    <div class="stick-area"></div>
    <div class="ttt-btns">
      <button class="big-btn ttt-attack">ANGRIFF</button>
      <button class="big-btn ttt-use">BENUTZEN</button>
    </div>
    <div class="ttt-row"><div class="slot"></div><button class="secondary stash-btn">Geheimfach</button></div>
    <div class="panel ttt-stash hidden"></div>
  `);
  joystick(q(root, '.stick-area'), (x, y) => send('stick', { x, y }));
  const attack = q<HTMLButtonElement>(root, '.ttt-attack');
  const use = q<HTMLButtonElement>(root, '.ttt-use');
  tapButton(attack, () => {
    send('attack');
    navigator.vibrate?.(15);
  });
  tapButton(use, () => {
    send('use');
    navigator.vibrate?.(8);
  });
  roleHold(q(root, '.slot'), 'Rolle (halten)', 'small');

  // Geheimfach: sieht für alle gleich aus, nur der Inhalt hängt von der Rolle ab
  const stash = q(root, '.ttt-stash');
  const stashBtn = q<HTMLButtonElement>(root, '.stash-btn');
  stashBtn.addEventListener('click', () => stash.classList.toggle('hidden'));
  const shopBtns: { btn: HTMLButtonElement; item: TttShopItem }[] = [];
  if (p0.role === 'traitor') {
    stash.append(el(`<h2>Verräter-Shop</h2><p class="credits"></p>`));
    for (const item of Object.keys(TTT_SHOP) as TttShopItem[]) {
      const def = TTT_SHOP[item];
      const b = el(`<button class="small shop-btn">${def.title} (${def.cost})<br/><small>${def.text}</small></button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (item === 'radio') {
          q(stash, '.radio-rooms').classList.toggle('hidden');
          return;
        }
        send('buy', { item });
        stash.classList.add('hidden');
      });
      stash.append(b);
      shopBtns.push({ btn: b, item });
    }
    const rooms = el(`<div class="rooms radio-rooms hidden"></div>`);
    ROOMS.forEach((r, i) => {
      const b = el(`<button class="room-btn">${r.name}</button>`).firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => {
        send('buy', { item: 'radio', room: i });
        stash.classList.add('hidden');
        q(stash, '.radio-rooms').classList.add('hidden');
      });
      q(rooms, '.rooms').append(b);
    });
    stash.append(rooms);
  } else if (p0.role === 'detective') {
    stash.append(el(`<h2>Spurensucher</h2><p>Untersuche Ausgeknockte mit BENUTZEN. Nach ${TTT.TRACKER_MS / 1000} s zeigt der Fernseher die Shirt-Farbe des Täters.</p>`));
  } else {
    stash.append(el(`<h2>Leer.</h2><p>Du bist unschuldig – trau niemandem! Bleib in Gruppen und untersuche Ausgeknockte.</p>`));
  }
  const close = el(`<button class="secondary small">Zu</button>`).firstElementChild as HTMLButtonElement;
  close.addEventListener('click', () => stash.classList.add('hidden'));
  stash.append(close);
  app.append(root);

  let lastInfo = p0.info?.seq ?? 0;
  let infoUntil = 0;
  return () => {
    const p = priv();
    if (!p) return;
    q(root, '.timer').textContent = `${Math.floor(secondsLeft() / 60)}:${String(secondsLeft() % 60).padStart(2, '0')}`;
    q(root, '.hearts').textContent = '♥'.repeat(p.hp) + '♡'.repeat(Math.max(0, TTT.HP - p.hp));
    q(root, '.weapon').textContent = p.weapon === 'pistol' ? `Pistole ${p.ammo}` : p.weapon === 'coconut' ? 'Kokosnuss' : 'Poolnudel';
    if (p.info && p.info.seq !== lastInfo) {
      lastInfo = p.info.seq;
      infoUntil = performance.now() + 3500;
      navigator.vibrate?.(30);
    }
    const info = q(root, '.ttt-info');
    if (p.cloakLeft > 0) info.textContent = `Unsichtbar: noch ${Math.ceil(p.cloakLeft / 1000)} s`;
    else if (p.info && performance.now() < infoUntil) info.textContent = p.info.text;
    else info.textContent = p.near ?? 'Lauf durchs Haus ...';
    attack.classList.toggle('cooldown', !p.attackReady);
    attack.textContent = p.weapon === 'pistol' ? 'SPRITZEN' : p.weapon === 'coconut' ? 'WERFEN' : 'ANGRIFF';
    use.disabled = !p.near;
    if (p.role === 'traitor') {
      q(stash, '.credits').textContent = `${p.credits} Credit${p.credits === 1 ? '' : 's'} – +1 pro Ausgeknocktem`;
      for (const { btn, item } of shopBtns) btn.disabled = p.credits < TTT_SHOP[item].cost || (item === 'trap' && !p.inDoor) || (item === 'cloak' && p.cloakLeft > 0);
    }
  };
}

function buildRoundEnd(s: TttState, p: TttPrivate) {
  const last = s.last;
  if (!last) return message('Runde vorbei!')();
  const myTeam = p.role === 'traitor' ? 'traitor' : 'innocent';
  const won = last.winner === myTeam;
  const pts = last.points[store.playerId!] ?? 0;
  const traitors = last.traitors.map(nameOf).join(', ');
  app.append(
    el(`
      <div class="center">
        <h1>${won ? 'GEWONNEN!' : 'VERLOREN!'}</h1>
        <h2>${escapeHtml(last.reason)}</h2>
        <p>Du warst: <b style="color:${TTT_ROLES[p.role].color}">${TTT_ROLES[p.role].name}</b></p>
        <p>Verräter: ${escapeHtml(traitors)}</p>
        <h2>${pts >= 0 ? '+' : ''}${pts} Punkte (gesamt ${s.scores[store.playerId!] ?? 0})</h2>
        <p>${s.round < s.rounds ? 'Gleich geht’s weiter – mit neuen Rollen!' : 'Das war die letzte Runde!'}</p>
      </div>
    `),
  );
  return null;
}
