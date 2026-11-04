import type { MurderPrivate, MurderState } from '../../../shared/types';
import { MURDER, ROOMS } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, message, nameOf, playerButtons, q, secondsLeft, send, socket, store, tapButton } from '../core';

const murder = () => (store.state?.mini?.kind === 'murder' ? store.state.mini.state : null);
const priv = (): MurderPrivate | null => (store.priv?.kind === 'murder' ? store.priv.state : null);

export function pickMurder(m: MurderState, vip: boolean): Screen {
  const p = priv();
  if (!p) return ['m-wait', message('Moment ...')];
  switch (m.sub) {
    case 'roles':
      return ['m-roles', buildRoles];
    case 'tasks':
      return [`m-tasks-${m.phaseNo}`, buildTasks];
    case 'meeting':
      return [`m-meeting-${m.phaseNo}-${vip}`, () => buildMeeting(vip)];
    case 'vote':
      if (!p.alive) return [`m-vote-dead-${m.phaseNo}`, message('Abstimmung läuft', 'Tote stimmen nicht ab. Psst!')];
      return p.myVote ? [`m-voted-${m.phaseNo}`, message('Abgestimmt!', 'Warte auf die anderen ...')] : [`m-vote-${m.phaseNo}`, buildVote];
    case 'ejected':
      return [`m-ejected-${m.phaseNo}`, () => buildEjected(m)];
    case 'over': {
      const won = (m.winner === 'murderer') === (p.role === 'murderer');
      return ['m-over', message(won ? 'GEWONNEN!' : 'VERLOREN!', m.winReason ?? '')];
    }
  }
}

/** Rolle nur sichtbar, solange man den Button gedrückt hält – damit niemand mitliest. */
function roleHold(container: HTMLElement) {
  const btn = el(`<button class="secondary role-btn">Rolle ansehen (gedrückt halten)</button>`).firstElementChild as HTMLButtonElement;
  const show = () => {
    const p = priv();
    if (!p) return;
    const partners = p.partners.length ? ` – Komplize: ${p.partners.map(nameOf).join(', ')}` : '';
    btn.textContent = p.role === 'murderer' ? `MÖRDER${partners}` : 'Urlauber';
    btn.classList.toggle('danger', p.role === 'murderer');
  };
  const hide = () => {
    btn.textContent = 'Rolle ansehen (gedrückt halten)';
    btn.classList.remove('danger');
  };
  btn.addEventListener('pointerdown', (e) => (e.preventDefault(), show()));
  btn.addEventListener('pointerup', hide);
  btn.addEventListener('pointerleave', hide);
  btn.addEventListener('pointercancel', hide);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  container.append(btn);
}

function buildRoles() {
  const root = el(`
    <h1>MORD IM<br/>FERIENHAUS</h1>
    <p>Halte den Knopf gedrückt, damit niemand mitliest.</p>
    <div class="slot center"></div>
    <div class="panel">
      <p class="label-left">Urlauber: Erledigt Aufgaben in den Räumen. Findet ihr eine Leiche, meldet sie!</p>
      <p class="label-left">Mörder: Bist du mit genau einer Person allein im Raum, kannst du zuschlagen.</p>
      <p class="label-left">Tote reden nicht!</p>
    </div>
  `);
  roleHold(q(root, '.slot'));
  app.append(root);
  return null;
}

function buildTasks() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="status"></span></div>
    <div class="dead-banner hidden">Du bist tot! Psst – nicht verraten. Als Geist kannst du weiter Aufgaben machen.</div>
    <div class="rooms"></div>
    <div class="panel task-panel">
      <p class="task-text"></p>
      <button class="big-btn task">TIPPEN</button>
    </div>
    <button class="danger hidden kill-btn"></button>
    <button class="report hidden report-btn">LEICHE MELDEN!</button>
    <div class="slot"></div>
  `);
  const roomsEl = q(root, '.rooms');
  const roomBtns = ROOMS.map((r, i) => {
    const b = document.createElement('button');
    b.className = 'room-btn';
    b.textContent = r.name;
    b.addEventListener('click', () => {
      send('room', { room: i });
      navigator.vibrate?.(10);
    });
    roomsEl.append(b);
    return b;
  });
  const taskBtn = q<HTMLButtonElement>(root, '.big-btn');
  tapButton(taskBtn, () => {
    send('task');
    navigator.vibrate?.(5);
  });
  const killBtn = q<HTMLButtonElement>(root, '.kill-btn');
  killBtn.addEventListener('click', () => {
    send('kill');
    navigator.vibrate?.([100, 50, 100]);
  });
  q(root, '.report-btn').addEventListener('click', () => send('report'));
  roleHold(q(root, '.slot'));
  app.append(root);

  return () => {
    const p = priv();
    const m = murder();
    if (!p || !m) return;
    q(root, '.timer').textContent = `${secondsLeft()}s`;
    q(root, '.status').textContent = `Aufgaben ${Math.round((m.taskProgress / Math.max(1, m.taskTarget)) * 100)}%`;
    q(root, '.dead-banner').classList.toggle('hidden', p.alive);
    roomBtns.forEach((b, i) => {
      b.classList.toggle('active', p.room === i);
      b.classList.toggle('done', p.doneRooms.includes(i));
    });
    const taskText = q(root, '.task-text');
    if (p.room === null) {
      taskText.textContent = 'Wähle einen Raum!';
      taskBtn.disabled = true;
      taskBtn.textContent = '---';
    } else if (p.doneRooms.includes(p.room)) {
      taskText.textContent = `${ROOMS[p.room].name}: erledigt! Geh in einen anderen Raum.`;
      taskBtn.disabled = true;
      taskBtn.textContent = 'FERTIG';
    } else {
      taskText.textContent = `${ROOMS[p.room].name}: ${ROOMS[p.room].task}`;
      taskBtn.disabled = false;
      taskBtn.textContent = `TIPPEN ${p.taskTaps}/${MURDER.TASK_TAPS}`;
    }
    killBtn.classList.toggle('hidden', !p.killTarget);
    if (p.killTarget) killBtn.textContent = `AUSSCHALTEN: ${nameOf(p.killTarget)}`;
    q(root, '.report-btn').classList.toggle('hidden', !p.bodyHere);
  };
}

function buildMeeting(vip: boolean) {
  const m = murder()!;
  const reporter = m.reporter ? `${escapeHtml(nameOf(m.reporter))} hat eine Leiche gefunden!` : 'Die Zeit ist um!';
  const deaths = m.deaths.length ? `Tot: ${escapeHtml(m.deaths.map(nameOf).join(', '))}` : 'Niemand ist gestorben.';
  const root = el(`
    <div class="center">
      <h1>BESPRECHUNG</h1>
      <h2>${reporter}</h2>
      <p>${deaths}</p>
      <p>Diskutiert am Tisch: Wer war wo? Wer lügt?</p>
      <p class="timer"></p>
    </div>
  `);
  if (vip) {
    const b = el(`<button>Zur Abstimmung</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => socket.emit('vip:mini', 'skip'));
    root.append(b);
  }
  app.append(root);
  return () => {
    q(root, '.timer').textContent = `Abstimmung in ${secondsLeft()}s`;
  };
}

function buildVote() {
  const m = murder()!;
  const root = el(`<h2>Wen werft ihr raus?</h2><p class="timer"></p>`);
  const alive = (store.state?.players ?? []).filter((p) => m.alive[p.id] && p.id !== store.playerId);
  let sent = false;
  const vote = (target: string) => {
    if (sent) return;
    sent = true;
    send('vote', { target });
  };
  root.append(playerButtons(alive, vote));
  const skip = el(`<button class="secondary">Überspringen</button>`).firstElementChild as HTMLButtonElement;
  skip.addEventListener('click', () => vote('skip'));
  root.append(skip);
  app.append(root);
  return () => {
    q(root, '.timer').textContent = `${secondsLeft()}s`;
  };
}

function buildEjected(m: MurderState) {
  const name = m.ejected ? nameOf(m.ejected) : null;
  const isMe = m.ejected === store.playerId;
  app.append(
    el(`
      <div class="center">
        <h1>${name ? `${escapeHtml(name)} fliegt raus!` : 'Niemand fliegt raus.'}</h1>
        ${isMe ? '<h2 class="pink">Das bist du! Ab jetzt bist du ein Geist.</h2>' : ''}
        ${name ? `<h2>${m.ejectedWasMurderer ? 'Das war der Mörder!' : 'Unschuldig ...'}</h2>` : ''}
      </div>
    `),
  );
  return null;
}
