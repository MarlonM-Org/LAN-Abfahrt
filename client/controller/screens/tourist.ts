import type { TourPrivate, TourState } from '../../../shared/types';
import { TOUR_LOCATIONS, tourOutcomeText } from '../../../shared/tourist';
import { type Screen, app, el, escapeHtml, message, nameOf, q, secondsLeft, send, store } from '../core';

const tour = () => (store.state?.mini?.kind === 'tourist' ? store.state.mini.state : null);
const priv = (): TourPrivate | null => (store.priv?.kind === 'tourist' ? store.priv.state : null);

/** Abgehakte Orte – nur lokal auf dem Handy, pro Runde (überlebt Screen-Wechsel wie die Abstimmung) */
const tourTicks = { round: -1, set: new Set<number>() };
function tourTickSet(round: number) {
  if (tourTicks.round !== round) {
    tourTicks.round = round;
    tourTicks.set = new Set();
  }
  return tourTicks.set;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function pickTourist(t: TourState): Screen {
  const id = store.playerId!;
  if (!(id in t.points)) return ['tour-spectate', message('Du schaust zu', 'Hört gut zu – wer ist der Tourist?')];
  const p = priv();
  if (t.sub === 'over') return ['tour-over', message('Spiel vorbei!', 'Gleich gibt’s die Punkte ...')];
  if (!p || p.round !== t.round) return ['tour-wait', message('Moment ...')];
  switch (t.sub) {
    case 'intro':
    case 'play':
      return [`tour-play-${t.round}`, buildPlay];
    case 'vote': {
      const v = t.vote!;
      const role = id === v.accused ? 'accused' : id === v.accuser ? 'accuser' : 'voter';
      return [`tour-vote-${t.phaseNo}-${role}-${p.myVote !== null}-${v.passed !== null}`, () => buildVote(role)];
    }
    case 'reveal':
      return [`tour-reveal-${t.round}`, buildReveal];
  }
}

// ---------------------------------------------------------------- Fragerunde

function buildPlay() {
  const root = el(`
    <div class="top-row"><span class="tour-round"></span><span class="timer"></span></div>
    <div class="tour-turn panel"></div>
    <div class="tour-card" role="button">
      <div class="tour-card-back"><b>DEINE KARTE</b><small>Antippen zum Aufdecken – niemand darf mitlesen!</small></div>
      <div class="tour-card-front hidden"></div>
    </div>
    <div class="tour-head"><span class="tour-head-text"></span><button class="secondary small tour-cancel hidden">Abbrechen</button></div>
    <div class="tour-list"></div>
    <div class="tour-pick hidden"></div>
    <button class="danger tour-accuse">ANKLAGEN</button>
  `);
  const me = store.playerId!;
  let mode: 'tick' | 'guess' | 'accuse' = 'tick';
  let turnKey = '';

  // --- Karte (aufdecken / verdecken)
  const card = q(root, '.tour-card');
  const back = q(root, '.tour-card-back');
  const front = q(root, '.tour-card-front');
  let open = false;
  const setOpen = (o: boolean) => {
    open = o;
    back.classList.toggle('hidden', open);
    front.classList.toggle('hidden', !open);
    card.classList.toggle('open', open);
    if (open) renderFront();
  };
  const renderFront = () => {
    const p = priv();
    if (!p) return;
    front.innerHTML = p.tourist
      ? `<b class="tour-big pink">DU BIST DER TOURIST!</b>
         <span>Finde heraus, wo ihr seid – und lass dir nichts anmerken.</span>
         <button class="danger tour-know">ICH WEISS ES!</button>
         <small>Antippen zum Verdecken</small>`
      : `<span>Ihr seid hier:</span>
         <b class="tour-big">${escapeHtml(p.location ?? '?')}</b>
         <span>Deine Rolle: <b class="pink">${escapeHtml(p.role ?? '?')}</b></span>
         <small>Antippen zum Verdecken</small>`;
    front.querySelector('.tour-know')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('guess');
      setOpen(false);
      navigator.vibrate?.(30);
    });
  };
  card.addEventListener('click', () => setOpen(!open));

  // --- Ortsliste (für alle gleich, damit man den Touristen nicht am Bildschirm erkennt)
  const ticks = tourTickSet(tour()?.round ?? 0);
  const list = q(root, '.tour-list');
  const locBtns = TOUR_LOCATIONS.map((loc, i) => {
    const b = document.createElement('button');
    b.className = 'secondary tour-loc';
    b.textContent = loc.name;
    b.classList.toggle('off', ticks.has(i));
    b.addEventListener('click', () => {
      if (mode === 'guess') {
        if (!confirm(`Seid ihr hier: ${loc.name}?\nFalsch geraten = die Einheimischen gewinnen!`)) return;
        send('guess', { loc: i });
        setMode('tick');
        return;
      }
      if (ticks.has(i)) ticks.delete(i);
      else ticks.add(i);
      b.classList.toggle('off', ticks.has(i));
    });
    list.append(b);
    return b;
  });

  // --- Anklagen
  const pick = q(root, '.tour-pick');
  const accuseBtn = q<HTMLButtonElement>(root, '.tour-accuse');
  accuseBtn.addEventListener('click', () => setMode(mode === 'accuse' ? 'tick' : 'accuse'));
  q(root, '.tour-cancel').addEventListener('click', () => setMode('tick'));

  const setMode = (m: typeof mode) => {
    mode = m;
    const t = tour();
    list.classList.toggle('hidden', m === 'accuse');
    list.classList.toggle('guessing', m === 'guess');
    pick.classList.toggle('hidden', m !== 'accuse');
    q(root, '.tour-cancel').classList.toggle('hidden', m === 'tick');
    q(root, '.tour-head-text').textContent =
      m === 'guess' ? 'Wo seid ihr? Tippe den Ort!' : m === 'accuse' ? 'Wen klagst du an?' : 'Mögliche Orte – antippen zum Abhaken';
    pick.innerHTML = '';
    if (m === 'accuse' && t) {
      const grid = el(`<div class="btn-grid"></div>`);
      for (const p of store.state?.players ?? []) {
        if (!(p.id in t.points) || p.id === me) continue;
        const b = document.createElement('button');
        b.className = 'danger small';
        b.textContent = p.name;
        b.addEventListener('click', () => {
          if (!confirm(`${p.name} anklagen?\nDas geht nur einmal pro Runde.`)) return;
          send('accuse', { target: p.id });
          setMode('tick');
        });
        q(grid, '.btn-grid').append(b);
      }
      pick.append(grid);
    }
  };
  setMode('tick');

  // --- Wer fragt wen?
  const turn = q(root, '.tour-turn');
  const renderTurn = (t: TourState) => {
    turn.innerHTML = '';
    const asker = t.asker;
    const last = t.lastAsk;
    if (t.sub === 'intro') {
      turn.append(el(`<h2>Runde ${t.round} beginnt!</h2><p>Deck heimlich deine Karte auf. ${escapeHtml(nameOf(asker))} stellt die erste Frage.</p>`));
      return;
    }
    if (asker === me) {
      const intro = last ? `<h2 class="pink">${escapeHtml(nameOf(last.from))} fragt dich!</h2><p>Antworte laut – dann bist du dran:</p>` : `<h2 class="pink">Du stellst die erste Frage!</h2>`;
      turn.append(el(`${intro}<p class="label-left">Wen fragst du?</p>`));
      const grid = el(`<div class="btn-grid"></div>`);
      const back = last?.to === me ? last.from : null;
      for (const p of store.state?.players ?? []) {
        if (!(p.id in t.points) || p.id === me) continue;
        const b = document.createElement('button');
        b.className = 'small';
        b.textContent = p.name;
        // Zurückfragen gilt nicht
        if (p.id === back) {
          b.disabled = true;
          b.title = 'Hat dich gerade gefragt';
        }
        b.addEventListener('click', () => {
          send('ask', { target: p.id });
          navigator.vibrate?.(15);
        });
        q(grid, '.btn-grid').append(b);
      }
      turn.append(grid);
    } else if (last) {
      turn.append(el(`<h2>${escapeHtml(nameOf(last.from))} fragt ${escapeHtml(nameOf(last.to))}</h2><p>Hör gut zu ...</p>`));
    } else {
      turn.append(el(`<h2>${escapeHtml(nameOf(asker))} stellt die erste Frage</h2><p>Hör gut zu ...</p>`));
    }
  };

  app.append(root);

  return () => {
    const t = tour();
    const p = priv();
    if (!t || !p) return;
    const sec = secondsLeft();
    q(root, '.tour-round').textContent = `Runde ${t.round}/${t.rounds}`;
    q(root, '.timer').textContent = t.sub === 'intro' ? `Start in ${sec}s` : clock(sec);
    const key = `${t.sub}-${t.asker}-${t.askSeq}`;
    if (key !== turnKey) {
      turnKey = key;
      renderTurn(t);
    }
    const used = t.accusers.includes(me);
    accuseBtn.disabled = used || t.sub !== 'play';
    accuseBtn.textContent = used ? 'Anklage verbraucht' : mode === 'accuse' ? 'Doch nicht' : 'ANKLAGEN';
    if (used && mode === 'accuse') setMode('tick');
    if (!p.tourist && mode === 'guess') setMode('tick');
    locBtns.forEach((b, i) => b.classList.toggle('off', ticks.has(i)));
  };
}

// ---------------------------------------------------------------- Anklage

function buildVote(role: 'accused' | 'accuser' | 'voter') {
  const t = tour()!;
  const v = t.vote!;
  const p = priv();
  const accuser = escapeHtml(nameOf(v.accuser));
  const accused = escapeHtml(nameOf(v.accused));
  const root = el(`<div class="center tour-vote"></div>`);
  const box = q(root, '.tour-vote');

  if (v.passed !== null) {
    box.append(
      el(
        v.passed
          ? `<h1>EINSTIMMIG!</h1><h2>${accused} wird überprüft ...</h2>`
          : `<h1>NICHT EINSTIMMIG</h1><h2>${v.yes} ja · ${v.no} nein</h2><p>Die Runde geht weiter!</p>`,
      ),
    );
    app.append(root);
    return null;
  }

  box.append(el(`<h1>ANKLAGE!</h1><p class="timer"></p>`));
  if (role === 'accused') {
    box.append(el(`<h2 class="pink">${accuser} hält dich für den Touristen!</h2><p>Verteidige dich – laut!</p>`));
  } else if (role === 'accuser') {
    box.append(el(`<h2>Du klagst ${accused} an.</h2><p>Überzeug die anderen!</p>`));
  } else if (p?.myVote !== null && p?.myVote !== undefined) {
    box.append(el(`<h2>${accuser} klagt ${accused} an.</h2><h2 class="pink">Deine Stimme: ${p.myVote ? 'JA' : 'NEIN'}</h2>`));
  } else {
    box.append(el(`<h2>${accuser} klagt ${accused} an.</h2><p>Ist ${accused} der Tourist? Nur einstimmig fliegt der Verdacht auf!</p>`));
    const row = el(`<div class="tour-yesno"><button class="danger tour-yes">JA</button><button class="tour-no">NEIN</button></div>`);
    let sent = false;
    const vote = (yes: boolean) => {
      if (sent) return;
      sent = true;
      navigator.vibrate?.(20);
      send('vote', { yes });
    };
    q(row, '.tour-yes').addEventListener('click', () => vote(true));
    q(row, '.tour-no').addEventListener('click', () => vote(false));
    box.append(row);
  }
  box.append(el(`<p class="tour-count"></p>`));
  app.append(root);
  return () => {
    const s = tour();
    if (!s?.vote) return;
    q(root, '.timer').textContent = `${secondsLeft()}s`;
    const need = Object.keys(s.points).length - 2;
    q(root, '.tour-count').textContent = `${s.vote.voted.length}/${need} haben abgestimmt`;
  };
}

// ---------------------------------------------------------------- Auflösung

function buildReveal() {
  const t = tour()!;
  const r = t.reveal!;
  const p = priv();
  const me = store.playerId!;
  const gain = r.gains[me] ?? 0;
  const wasTourist = r.touristen.includes(me);
  app.append(
    el(`
      <div class="center">
        <h1>${escapeHtml(tourOutcomeText(r, nameOf))}</h1>
        <div class="panel tour-reveal">
          <p>Ihr wart hier:</p>
          <h2>${escapeHtml(r.location)}</h2>
          <p>${r.touristen.length > 1 ? 'Touristen' : 'Tourist'}:</p>
          <h2 class="pink">${escapeHtml(r.touristen.map(nameOf).join(' & '))}</h2>
          ${wasTourist ? '<p>Du warst der Tourist!</p>' : p?.role ? `<p>Deine Rolle: ${escapeHtml(p.role)}</p>` : ''}
        </div>
        <h2 class="${gain ? 'yellow' : ''}">${gain ? `+${gain} ${gain === 1 ? 'Punkt' : 'Punkte'}!` : 'Keine Punkte diesmal'}</h2>
        <p>Deine Punkte: ${t.points[me] ?? 0}${t.round < t.rounds ? ' · gleich kommt die nächste Runde' : ''}</p>
      </div>
    `),
  );
  return null;
}
