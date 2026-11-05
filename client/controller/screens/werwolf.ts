import type { WolfPrivate, WolfState } from '../../../shared/werwolf';
import { WOLF_CAUSE_TEXT, WOLF_ROLES, type WolfRole } from '../../../shared/werwolf';
import { type Screen, app, avatarCanvas, el, escapeHtml, me, message, nameOf, q, secondsLeft, send, socket, store, toast } from '../core';

const wolfState = () => (store.state?.mini?.kind === 'werwolf' ? store.state.mini.state : null);
const priv = (): WolfPrivate | null => (store.priv?.kind === 'werwolf' ? store.priv.state : null);

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Schäfchen pro Nacht – nur lokal, damit alle Handys gleich beschäftigt aussehen */
const sheep = { night: -1, n: 0 };

export function pickWerwolf(w: WolfState): Screen {
  const id = store.playerId!;
  if (!(id in w.alive)) return ['ww-spectate', message('Du schaust zu', 'Pssst – die Werwölfe sind unterwegs ...')];
  const p = priv();
  if (!p) return ['ww-wait', message('Moment ...')];
  if (w.sub === 'over') return [`ww-over`, buildOver];
  // Der Jäger schießt nach seinem Tod noch einmal
  if (w.sub === 'hunter' && w.hunter === id && !w.shotDone) return [`ww-hunt-${w.phaseNo}`, buildHunter];
  if (!p.alive) return ['ww-dead', buildDead];
  switch (w.sub) {
    case 'roles':
      return ['ww-roles', buildRoles];
    case 'night':
    case 'witch':
      return [`ww-night-${w.phaseNo}`, buildNight];
    case 'dawn':
      return [`ww-dawn-${w.phaseNo}`, () => buildNews('Der Morgen graut ...')];
    case 'day':
      return [`ww-day-${w.phaseNo}-${!!me()?.isVip}`, buildDay];
    case 'vote':
      return [`ww-vote-${w.phaseNo}-${!!p.myVote}`, buildVote];
    case 'verdict':
      return [`ww-verdict-${w.phaseNo}`, buildVerdict];
    case 'hunter':
      return [`ww-hunter-${w.phaseNo}-${w.shotDone}`, () => buildNews('Der Jäger!')];
  }
  return ['ww-wait', message('Moment ...')];
}

// ---------------------------------------------------------------- Rollenkarte

function roleName(r: WolfRole) {
  return WOLF_ROLES[r].name.toUpperCase();
}

/** Verdeckte Rollenkarte – sieht für alle gleich aus, bis man sie antippt */
function roleCard(big = false) {
  const root = el(`
    <div class="ww-card${big ? ' big' : ''}" role="button">
      <div class="ww-card-back"><b>DEINE ROLLE</b><small>Antippen zum Aufdecken – niemand darf mitlesen!</small></div>
      <div class="ww-card-front hidden"></div>
    </div>`);
  const card = q(root, '.ww-card');
  const back = q(root, '.ww-card-back');
  const front = q(root, '.ww-card-front');
  let open = false;
  let closeTimer: number | undefined;
  const render = () => {
    const p = priv();
    if (!p) return;
    const info = WOLF_ROLES[p.role];
    let extra = '';
    if (p.role === 'wolf') {
      extra = p.partners.length ? `<span>Dein Rudel: <b class="ww-red">${p.partners.map((id) => escapeHtml(nameOf(id))).join(', ')}</b></span>` : '<span>Du bist der einzige Werwolf.</span>';
    } else if (p.role === 'seherin' && p.seen.length) {
      extra = `<span>Gesehen: ${p.seen.map((s) => `${escapeHtml(nameOf(s.id))} <b class="${s.wolf ? 'ww-red' : 'ww-green'}">${s.wolf ? 'WOLF' : 'ok'}</b>`).join(' · ')}</span>`;
    } else if (p.role === 'hexe') {
      extra = `<span>Heiltrank: <b>${p.heal ? 'da' : 'weg'}</b> · Gifttrank: <b>${p.poison ? 'da' : 'weg'}</b></span>`;
    }
    front.innerHTML = `<b class="ww-role" style="color:${info.color}">${roleName(p.role)}</b><span>${escapeHtml(info.text)}</span>${extra}<small>Antippen zum Verdecken</small>`;
  };
  const setOpen = (o: boolean) => {
    open = o;
    back.classList.toggle('hidden', open);
    front.classList.toggle('hidden', !open);
    card.classList.toggle('open', open);
    clearTimeout(closeTimer);
    if (open) {
      render();
      closeTimer = window.setTimeout(() => setOpen(false), 8000);
    }
  };
  card.addEventListener('click', () => setOpen(!open));
  return { root, update: () => open && render() };
}

// ---------------------------------------------------------------- Spielerauswahl

/** Raster mit Spielern (Avatar + Name + optional Markierungen) */
function grid(ids: string[]) {
  const root = el(`<div class="player-grid ww-grid"></div>`);
  const inner = q(root, '.ww-grid');
  const many = ids.length > 8;
  if (many) inner.classList.add('many');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const id of ids) {
    const p = store.state?.players.find((x) => x.id === id);
    const b = document.createElement('button');
    b.className = 'player-btn';
    if (p) b.append(avatarCanvas(many ? 2 : 3, p.look));
    const span = document.createElement('span');
    span.textContent = p?.name ?? '?';
    b.append(span);
    const mark = document.createElement('i');
    mark.className = 'ww-mark';
    b.append(mark);
    inner.append(b);
    buttons.set(id, b);
  }
  return { root, buttons };
}

const othersAlive = (w: WolfState) => Object.keys(w.alive).filter((id) => w.alive[id] && id !== store.playerId);

// ---------------------------------------------------------------- Rollen

function buildRoles() {
  const card = roleCard(true);
  app.append(
    el(`<div class="top-row"><span>Werwölfe im Ferienhaus</span><span class="timer"></span></div>`),
    el(`<h1>Deine geheime Rolle</h1>`),
    card.root,
    el(`<p>Merk sie dir gut. Die Karte kannst du jederzeit wieder aufdecken – aber nur heimlich!</p>`),
  );
  return () => {
    q(app, '.timer').textContent = `${secondsLeft()}s`;
    card.update();
  };
}

// ---------------------------------------------------------------- Nacht (für alle gleich aufgebaut)

function buildNight() {
  const w0 = wolfState()!;
  if (sheep.night !== w0.day) {
    sheep.night = w0.day;
    sheep.n = 0;
  }
  const card = roleCard();
  const box = el(`
    <div class="ww-night">
      <div class="top-row"><span>NACHT ${w0.day}</span><span class="timer"></span></div>
      <div class="ww-card-slot"></div>
      <div class="panel ww-prompt"><h2 class="ww-q"></h2><p class="ww-sub"></p></div>
      <div class="ww-grid-slot"></div>
      <div class="ww-actions"><button class="ww-a"></button><button class="ww-b"></button></div>
    </div>`);
  q(box, '.ww-card-slot').append(card.root);
  const ids = othersAlive(w0);
  const g = grid(ids);
  q(box, '.ww-grid-slot').append(g.root);
  const btnA = q<HTMLButtonElement>(box, '.ww-a');
  const btnB = q<HTMLButtonElement>(box, '.ww-b');
  app.append(box);

  const isHexeTurn = () => wolfState()?.sub === 'witch' && priv()?.role === 'hexe';

  for (const [id, b] of g.buttons) {
    b.addEventListener('click', () => {
      const w = wolfState();
      const p = priv();
      if (!w || !p) return;
      navigator.vibrate?.(15);
      if (w.sub === 'night') {
        if (p.role === 'wolf' && p.partners.includes(id)) return toast('Gehört zu deinem Rudel!');
        if (p.role === 'seherin' && p.nightPick) return toast('Nur ein Blick pro Nacht.');
        send('night', { target: id });
      } else if (isHexeTurn()) {
        if (!p.poison) return toast('Dein Gifttrank ist schon weg.');
        if (p.witchDone) return;
        send('poison', { target: p.witchPoison === id ? 'none' : id });
      } else {
        toast('Psst – die Hexe ist dran. Zähl Schäfchen!');
      }
    });
  }

  // Knopf A: Schäfchen zählen bzw. (Hexe) Heiltrank; Knopf B: gähnen bzw. (Hexe) fertig
  btnA.addEventListener('click', () => {
    const p = priv();
    if (isHexeTurn() && p) {
      if (p.witchDone) return;
      if (!p.heal) return toast('Dein Heiltrank ist schon weg.');
      if (!p.victim) return toast('Heute Nacht wurde niemand gebissen.');
      send('heal', { on: !p.witchHealed });
    } else {
      sheep.n += 1;
    }
    navigator.vibrate?.(10);
  });
  btnB.addEventListener('click', () => {
    const p = priv();
    if (isHexeTurn() && p && !p.witchDone) {
      send('witchDone');
    } else {
      toast(['Uaaah ...', 'Gääähn!', 'Noch fünf Minuten ...', 'Zzz ...'][Math.floor(Math.random() * 4)]);
    }
    navigator.vibrate?.(10);
  });

  return () => {
    const w = wolfState();
    const p = priv();
    if (!w || !p) return;
    card.update();
    q(box, '.timer').textContent = clock(secondsLeft());
    const qEl = q(box, '.ww-q');
    const sub = q(box, '.ww-sub');
    const hexe = isHexeTurn();
    // Auswahl und Markierungen
    for (const [id, b] of g.buttons) {
      const dead = !w.alive[id];
      b.disabled = dead;
      let picked = false;
      let mark = '';
      if (w.sub === 'night' || !hexe) picked = p.nightPick === id;
      if (hexe) picked = p.witchPoison === id;
      if (p.role === 'wolf') {
        const n = Object.values(p.pack).filter((t) => t === id).length;
        if (n) mark = String(n);
        if (p.partners.includes(id)) mark = 'RUDEL';
      }
      b.classList.toggle('picked', picked);
      b.querySelector('.ww-mark')!.textContent = mark;
    }
    const pickName = p.nightPick ? escapeHtml(nameOf(p.nightPick)) : '';
    if (w.sub === 'night') {
      if (p.role === 'wolf') {
        qEl.textContent = 'Wen holt ihr euch?';
        const picks = Object.entries(p.pack);
        const agree = picks.length === p.partners.length + 1 && new Set(picks.map(([, t]) => t)).size === 1;
        sub.innerHTML = picks.length
          ? `${picks.map(([wid, t]) => `${wid === store.playerId ? 'Du' : escapeHtml(nameOf(wid))} → ${escapeHtml(nameOf(t))}`).join(' · ')}${p.partners.length ? (agree ? ' · <b class="ww-green">Einig!</b>' : ' · Einigt euch!') : ''}`
          : 'Tippe dein Opfer an.';
      } else if (p.role === 'seherin') {
        qEl.textContent = 'Wen durchschaust du?';
        const last = p.seen[p.seen.length - 1];
        sub.innerHTML =
          p.nightPick && last?.id === p.nightPick
            ? `${pickName} ist <b class="${last.wolf ? 'ww-red' : 'ww-green'}">${last.wolf ? 'EIN WERWOLF!' : 'KEIN Werwolf.'}</b>`
            : 'Tippe jemanden an.';
      } else {
        qEl.textContent = 'Wen verdächtigst du?';
        sub.innerHTML = p.nightPick ? `Dein Verdacht: ${pickName}. Zähl Schäfchen!` : 'Tippe jemanden an.';
      }
      btnA.textContent = `SCHÄFCHEN: ${sheep.n}`;
      btnB.textContent = 'GÄHNEN';
      btnA.disabled = false;
      btnB.disabled = false;
    } else if (hexe) {
      qEl.textContent = p.victim ? `${nameOf(p.victim)} wurde gebissen!` : 'Niemand wurde gebissen.';
      sub.innerHTML = p.witchDone
        ? 'Erledigt. Schlaf gut!'
        : `${p.heal ? (p.witchHealed ? '<b class="ww-green">Wird geheilt.</b> ' : 'Heilen? ') : 'Heiltrank weg. '}${p.poison ? (p.witchPoison ? `Gift für <b class="ww-red">${escapeHtml(nameOf(p.witchPoison))}</b>.` : 'Gift: Namen antippen.') : 'Gifttrank weg.'}`;
      btnA.textContent = p.witchHealed ? 'NICHT HEILEN' : 'HEILEN';
      btnB.textContent = 'FERTIG';
      btnA.disabled = p.witchDone || !p.heal || !p.victim;
      btnB.disabled = p.witchDone;
    } else {
      qEl.textContent = 'Die Hexe ist wach ...';
      sub.innerHTML = 'Augen zu und weiter Schäfchen zählen!';
      btnA.textContent = `SCHÄFCHEN: ${sheep.n}`;
      btnB.textContent = 'GÄHNEN';
      btnA.disabled = false;
      btnB.disabled = false;
    }
  };
}

// ---------------------------------------------------------------- Morgen / Jäger (Nachrichten)

function deathsHtml(w: WolfState) {
  if (!w.deaths.length) return '<h2 class="ww-green">Niemand ist gestorben!</h2>';
  return w.deaths
    .map((d) => {
      const r = w.revealed[d.id] ?? 'dorf';
      const you = d.id === store.playerId;
      return `<div class="panel ww-death"><h2>${you ? 'DU' : escapeHtml(nameOf(d.id))}</h2><b style="color:${WOLF_ROLES[r].color}">${roleName(r)}</b><p>${WOLF_CAUSE_TEXT[d.cause]}</p></div>`;
    })
    .join('');
}

function buildNews(title: string) {
  const w = wolfState()!;
  const card = roleCard();
  let body = deathsHtml(w);
  if (w.sub === 'hunter') {
    body = !w.shotDone
      ? `<h2>${escapeHtml(nameOf(w.hunter))} war der Jäger und legt ein letztes Mal an ...</h2>`
      : w.shot
        ? `<h2>PENG! ${escapeHtml(nameOf(w.hunter))} nimmt ${escapeHtml(nameOf(w.shot))} mit.</h2>${deathsHtml(w)}`
        : `<h2>${escapeHtml(nameOf(w.hunter))} hat danebengeschossen!</h2>`;
  }
  if (w.sub === 'dawn' && w.suspect) body += `<p>Nachts am meisten verdächtigt: <b>${escapeHtml(nameOf(w.suspect))}</b></p>`;
  app.append(el(`<div class="center"><h1>${escapeHtml(title)}</h1>${body}<p>Schaut auf den Fernseher!</p></div>`), card.root);
  return () => card.update();
}

// ---------------------------------------------------------------- Tag

function aliveDeadHtml(w: WolfState) {
  const ids = Object.keys(w.alive);
  const alive = ids.filter((id) => w.alive[id]);
  const dead = ids.filter((id) => !w.alive[id]);
  return `
    <div class="panel ww-list">
      <p class="label-left">Noch im Haus (${alive.length}):</p>
      <p class="ww-names">${alive.map((id) => escapeHtml(nameOf(id))).join(', ')}</p>
      ${dead.length ? `<p class="label-left">Tot:</p><p class="ww-names">${dead.map((id) => `${escapeHtml(nameOf(id))} <b style="color:${WOLF_ROLES[w.revealed[id] ?? 'dorf'].color}">(${WOLF_ROLES[w.revealed[id] ?? 'dorf'].name})</b>`).join(', ')}</p>` : ''}
    </div>`;
}

function buildDay() {
  const w = wolfState()!;
  const card = roleCard();
  const vip = !!me()?.isVip;
  app.append(
    el(`<div class="top-row"><span>TAG ${w.day}</span><span class="timer"></span></div>`),
    el(`<h1>Diskutiert!</h1>`),
    el(`<p>Wer von euch ist ein Werwolf? Gleich wird abgestimmt.</p>`),
    card.root,
    el(aliveDeadHtml(w)),
  );
  if (vip) {
    const b = el(`<button class="danger">Jetzt abstimmen</button>`);
    b.firstElementChild!.addEventListener('click', () => socket.emit('vip:mini', 'skip'));
    app.append(b);
  }
  return () => {
    q(app, '.timer').textContent = clock(secondsLeft());
    card.update();
  };
}

function buildVote() {
  const w = wolfState()!;
  const p = priv()!;
  app.append(el(`<div class="top-row"><span>ABSTIMMUNG</span><span class="timer"></span></div>`));
  if (p.myVote) {
    app.append(
      el(`<div class="center"><h1>Abgestimmt!</h1><h2>Deine Stimme: <span class="pink">${p.myVote === 'none' ? 'Niemand' : escapeHtml(nameOf(p.myVote))}</span></h2><p class="ww-count"></p></div>`),
    );
  } else {
    app.append(el(`<h2>Wer muss das Ferienhaus verlassen?</h2>`));
    const g = grid(othersAlive(w));
    let sent = false;
    for (const [id, b] of g.buttons) {
      b.addEventListener('click', () => {
        if (sent || !confirm(`${nameOf(id)} rauswählen?`)) return;
        sent = true;
        navigator.vibrate?.(20);
        send('vote', { target: id });
      });
    }
    const none = el(`<button class="secondary">Niemand</button>`);
    none.firstElementChild!.addEventListener('click', () => {
      if (sent) return;
      sent = true;
      send('vote', { target: 'none' });
    });
    app.append(g.root, none, el(`<p class="ww-count"></p>`));
  }
  return () => {
    const s = wolfState();
    if (!s) return;
    q(app, '.timer').textContent = `${secondsLeft()}s`;
    const voters = Object.keys(s.alive).filter((id) => s.alive[id]).length;
    q(app, '.ww-count').textContent = `${s.voted.length}/${voters} haben abgestimmt`;
  };
}

function buildVerdict() {
  const w = wolfState()!;
  const card = roleCard();
  let head: string;
  if (w.lynched) {
    const r = w.revealed[w.lynched] ?? 'dorf';
    const you = w.lynched === store.playerId;
    head = `<h1>${you ? 'Du musst' : `${escapeHtml(nameOf(w.lynched))} muss`} raus!</h1><h2>Rolle: <b style="color:${WOLF_ROLES[r].color}">${roleName(r)}</b></h2>`;
  } else {
    head = `<h1>${w.tie ? 'Gleichstand!' : 'Niemand muss raus.'}</h1><p>${w.tie ? 'Bei Gleichstand fliegt niemand raus.' : ''}</p>`;
  }
  app.append(el(`<div class="center">${head}<p>Gleich wird es wieder Nacht ...</p></div>`), card.root);
  return () => card.update();
}

// ---------------------------------------------------------------- Jäger

function buildHunter() {
  const w = wolfState()!;
  app.append(
    el(`<div class="top-row"><span>DER JÄGER</span><span class="timer"></span></div>`),
    el(`<h1>Letzter Schuss!</h1>`),
    el(`<p>Du bist raus – aber als Jäger nimmst du jemanden mit. Wen?</p>`),
  );
  const g = grid(othersAlive(w));
  let sent = false;
  for (const [id, b] of g.buttons) {
    b.addEventListener('click', () => {
      if (sent || !confirm(`${nameOf(id)} mitnehmen?`)) return;
      sent = true;
      navigator.vibrate?.([30, 40, 80]);
      send('shoot', { target: id });
    });
  }
  app.append(g.root);
  return () => {
    q(app, '.timer').textContent = `${secondsLeft()}s`;
  };
}

// ---------------------------------------------------------------- Tot / Ende

function allRolesHtml(roles: Record<string, WolfRole> | null) {
  if (!roles) return '';
  return Object.entries(roles)
    .map(([id, r]) => `<div class="ww-rolerow"><span>${escapeHtml(nameOf(id))}</span><b style="color:${WOLF_ROLES[r].color}">${WOLF_ROLES[r].name}</b></div>`)
    .join('');
}

function buildDead() {
  const root = el(`
    <div class="center">
      <h1>Du bist tot</h1>
      <h2>Nicht mehr mitreden 🤫</h2>
      <p class="ww-phase"></p>
      <div class="ww-card" role="button">
        <div class="ww-card-back"><b>ALLE ROLLEN</b><small>Antippen – aber nichts verraten!</small></div>
        <div class="ww-card-front hidden ww-allroles"></div>
      </div>
      <button class="danger ww-skip hidden">Jetzt abstimmen lassen</button>
    </div>`);
  // Auch ein toter VIP darf die Diskussion abkürzen
  q(root, '.ww-skip').addEventListener('click', () => socket.emit('vip:mini', 'skip'));
  const card = q(root, '.ww-card');
  let open = false;
  card.addEventListener('click', () => {
    open = !open;
    q(root, '.ww-card-back').classList.toggle('hidden', open);
    q(root, '.ww-allroles').classList.toggle('hidden', !open);
    card.classList.toggle('open', open);
  });
  app.append(root);
  return () => {
    const w = wolfState();
    const p = priv();
    if (!w) return;
    const phase: Record<string, string> = {
      night: `Nacht ${w.day} – die anderen tippen heimlich.`,
      witch: `Nacht ${w.day} – die Hexe ist dran.`,
      dawn: 'Der Morgen graut ...',
      day: `Tag ${w.day} – die anderen diskutieren.`,
      vote: 'Die anderen stimmen ab.',
      verdict: 'Auflösung der Abstimmung.',
      hunter: 'Der Jäger zielt ...',
    };
    q(root, '.ww-phase').textContent = phase[w.sub] ?? '';
    q(root, '.ww-skip').classList.toggle('hidden', !(w.sub === 'day' && me()?.isVip));
    const html = allRolesHtml(p?.allRoles ?? null);
    const box = q(root, '.ww-allroles');
    if (box.innerHTML !== html) box.innerHTML = html;
  };
}

function buildOver() {
  const w = wolfState()!;
  const p = priv();
  const mine = p ? p.role : 'dorf';
  const won = (mine === 'wolf') === (w.winner === 'wolf');
  app.append(
    el(`
      <div class="center">
        <h1>${w.winner === 'wolf' ? 'Die Werwölfe gewinnen!' : 'Die Urlauber gewinnen!'}</h1>
        <h2 class="${won ? 'ww-green' : 'ww-red'}">${won ? 'Dein Team hat gewonnen!' : 'Dein Team hat verloren.'}</h2>
        <p>Du warst: <b style="color:${WOLF_ROLES[mine].color}">${WOLF_ROLES[mine].name}</b></p>
        <div class="panel">${allRolesHtml(w.roles)}</div>
      </div>`),
  );
  return null;
}
