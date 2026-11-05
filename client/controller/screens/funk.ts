import type { FunkPrivate, FunkSide, FunkState, Team } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { FUNK, FUNK_SIDE_TEXT, FUNK_ZONES, funkClamp, funkOther } from '../../../shared/funk';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton, teamBadge, timerText } from '../core';
import { haptic } from '../haptic';

/**
 * Funkfrequenz am Handy (hochkant):
 *   Funker  – verdeckte Karte (gedrückt halten = Ziel sehen), optional Hinweis tippen, „FUNKSPRUCH LOS!“
 *   Team    – Frequenz-Schieber (Ziehen + ◀ ▶ fein), Kapitän macht den Tipp fest
 *   Gegner  – zuhören, dann „weiter links“ / „weiter rechts“ wetten
 */

const funk = () => (store.state?.mini?.kind === 'funk' ? store.state.mini.state : null);
const priv = (): FunkPrivate | null => (store.priv?.kind === 'funk' ? store.priv.state : null);

/** Eigener Reglerwert – überlebt Screen-Wechsel innerhalb der Runde */
const myDial = { round: -1, v: 50, touched: false };

export function pickFunk(st: FunkState): Screen {
  injectCss();
  const id = store.playerId!;
  const inGame = st.teams.A.includes(id) || st.teams.B.includes(id);
  if (!inGame) return ['funk-spectate', message('Du hörst mit', 'Wo liegt die geheime Frequenz?')];
  if (st.sub === 'over') return ['funk-over', message('Funkstille!', 'Gleich gibt’s das Ergebnis ...')];
  const p = priv();
  if (!p || p.round !== st.round) return ['funk-wait', message('Moment ...')];
  if (st.sub === 'reveal') return [`funk-reveal-${st.round}`, buildReveal];
  if (p.role === 'funker') return [`funk-f-${st.round}-${st.funker}`, buildFunker];
  if (p.role === 'team') {
    if (st.sub === 'intro' || st.sub === 'clue') return [`funk-t-wait-${st.round}`, buildTeamWait];
    return [`funk-t-dial-${st.round}`, buildDial];
  }
  if (st.sub === 'bet') return [`funk-g-bet-${st.round}`, buildBet];
  return [`funk-g-wait-${st.round}`, buildListen];
}

// ---------------------------------------------------------------- Bausteine

const myTeam = (st: FunkState): Team => (st.teams.A.includes(store.playerId!) ? 'A' : 'B');

/** Kopfzeile: Runde, Punkte beider Teams, Timer */
function head(): { root: HTMLElement; update: (st: FunkState) => void } {
  const root = el(`
    <div class="fk-head">
      <span class="fk-sc fk-A"></span>
      <span class="fk-round"></span>
      <span class="fk-sc fk-B"></span>
    </div>
    <div class="fk-sub"><span class="fk-what"></span><span class="timer"></span></div>
  `);
  const box = root as HTMLElement;
  return {
    root: box,
    update: (st) => {
      q(box, '.fk-A').textContent = `☀ ${st.score.A}`;
      q(box, '.fk-B').textContent = `🌊 ${st.score.B}`;
      q(box, '.fk-round').textContent = `Runde ${st.round}/${st.rounds}`;
      q(box, '.timer').textContent = timerText();
    },
  };
}

/** Skala mit Polen, optionalen Zonen ums Ziel und Zeiger */
function scale(st: FunkState, opts: { needle?: boolean; big?: boolean } = {}) {
  const [l, r] = st.pair;
  const root = el(`
    <div class="fk-scale ${opts.big ? 'big' : ''}">
      <div class="fk-poles"><span>◀ ${escapeHtml(l)}</span><span>${escapeHtml(r)} ▶</span></div>
      <div class="fk-band">
        <div class="fk-zones hidden"></div>
        <div class="fk-needle ${opts.needle === false ? 'hidden' : ''}"></div>
      </div>
    </div>
  `);
  const zones = q(root, '.fk-zones');
  // Von außen nach innen, damit die 4er-Zone oben liegt
  for (const z of [...FUNK_ZONES].reverse()) {
    const d = document.createElement('div');
    d.className = `fk-zone z${z.points}`;
    d.dataset.r = String(z.r);
    d.textContent = String(z.points);
    zones.append(d);
  }
  const needle = q(root, '.fk-needle');
  return {
    root,
    band: q(root, '.fk-band'),
    setNeedle(v: number) {
      needle.style.left = `${funkClamp(v)}%`;
    },
    setTarget(t: number | null) {
      zones.classList.toggle('hidden', t === null);
      if (t === null) return;
      for (const d of zones.querySelectorAll<HTMLElement>('.fk-zone')) {
        const rr = Number(d.dataset.r);
        const a = funkClamp(t - rr);
        const b = funkClamp(t + rr);
        d.style.left = `${a}%`;
        d.style.width = `${b - a}%`;
      }
    },
  };
}

// ---------------------------------------------------------------- Funker

function buildFunker() {
  const st = funk()!;
  const h = head();
  const sc = scale(st, { needle: false, big: true });
  const root = el(`
    <div class="fk">
      ${teamBadge(st.active)}
      <h2 class="pink">Du bist der FUNKER!</h2>
      <div class="fk-card" role="button">
        <div class="fk-card-back"><b>📻 GEHEIMES ZIEL</b><small>Gedrückt halten zum Ansehen – niemand darf mitgucken!</small></div>
        <div class="fk-card-front hidden"></div>
      </div>
      <p class="fk-tip"></p>
      <input type="text" class="fk-clue" maxlength="${FUNK.MAX_CLUE}" placeholder="Hinweis tippen (optional)" autocomplete="off" enterkeyhint="send" />
      <button class="fk-go">FUNKSPRUCH LOS!</button>
    </div>
  `);
  const box = q(root, '.fk');
  box.prepend(h.root);
  const card = q(box, '.fk-card');
  const back = q(box, '.fk-card-back');
  const front = q(box, '.fk-card-front');
  front.append(sc.root);
  front.append(el(`<small>Loslassen zum Verdecken</small>`));
  const show = (on: boolean) => {
    back.classList.toggle('hidden', on);
    front.classList.toggle('hidden', !on);
    card.classList.toggle('open', on);
    if (on) {
      sc.setTarget(priv()?.target ?? null);
      haptic('tick');
    }
  };
  card.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    show(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) card.addEventListener(ev, () => show(false));
  card.addEventListener('contextmenu', (e) => e.preventDefault());

  const input = q<HTMLInputElement>(box, '.fk-clue');
  input.value = st.clue ?? '';
  let tmr: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = window.setTimeout(() => send('clue', { text: input.value }), 350);
  });
  const go = q<HTMLButtonElement>(box, '.fk-go');
  const fire = () => {
    clearTimeout(tmr);
    send('clue', { text: input.value, go: true });
    haptic('tap');
    input.blur();
  };
  go.addEventListener('click', fire);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const s = funk();
    if (s?.sub === 'clue' || s?.sub === 'intro') fire();
    else (clearTimeout(tmr), send('clue', { text: input.value }), input.blur());
  });

  app.append(root);
  return () => {
    const s = funk();
    if (!s) return;
    h.update(s);
    const what = q(h.root, '.fk-what');
    const tip = q(box, '.fk-tip');
    const before = s.sub === 'intro' || s.sub === 'clue';
    go.classList.toggle('hidden', !before);
    input.disabled = s.sub === 'bet';
    if (before) {
      what.textContent = 'Überleg dir einen Hinweis';
      tip.textContent = 'Halte die Karte, merk dir das Ziel – dann sag laut einen Begriff, der genau dort auf der Skala liegt!';
    } else if (s.sub === 'tune') {
      what.textContent = 'Dein Team dreht';
      tip.textContent = 'Sag deinen Hinweis LAUT! Mehr verraten ist verboten – kein Zeigen, keine Zahlen.';
    } else {
      what.textContent = 'Gegner wetten';
      tip.textContent = `Tipp steht! ${TEAM_INFO[funkOther(s.active)].name} wettet: weiter links oder rechts?`;
    }
  };
}

// ---------------------------------------------------------------- Team

function buildTeamWait() {
  const st = funk()!;
  const h = head();
  const sc = scale(st, { needle: false });
  const root = el(`
    <div class="fk">
      ${teamBadge(st.active)}
      <h2>Euer Team funkt!</h2>
      <p class="fk-big"><b class="pink">${escapeHtml(nameOf(st.funker))}</b> ist Funker und denkt sich einen Hinweis aus.</p>
      <p>Hör gut zu – gleich dreht ihr gemeinsam an der Frequenz.</p>
    </div>
  `);
  const box = q(root, '.fk');
  box.prepend(h.root);
  box.append(sc.root);
  app.append(root);
  return () => {
    const s = funk();
    if (!s) return;
    h.update(s);
    q(h.root, '.fk-what').textContent = s.sub === 'intro' ? 'Gleich geht’s los' : 'Funker überlegt';
  };
}

function buildDial() {
  const st = funk()!;
  if (myDial.round !== st.round) {
    myDial.round = st.round;
    myDial.v = 50;
    myDial.touched = false;
  }
  const me = store.playerId!;
  if (me in st.dials) {
    myDial.v = st.dials[me];
    myDial.touched = true;
  }
  const h = head();
  const sc = scale(st, { big: true });
  const root = el(`
    <div class="fk">
      ${teamBadge(st.active)}
      <p class="fk-clue-line"></p>
      <div class="fk-dialwrap"></div>
      <div class="fk-fine">
        <button class="secondary fk-minus">◀ 1</button>
        <span class="fk-val"></span>
        <button class="secondary fk-plus">1 ▶</button>
      </div>
      <p class="fk-mean"></p>
      <button class="fk-lock hidden">TIPP FESTMACHEN!</button>
      <p class="fk-note"></p>
    </div>
  `);
  const box = q(root, '.fk');
  box.prepend(h.root);
  q(box, '.fk-dialwrap').append(sc.root);
  const band = sc.band;
  const mine = document.createElement('div');
  mine.className = 'fk-knob';
  band.append(mine);
  // Die Nadel zeigt den Team-Mittelwert, der Knopf den eigenen Regler
  sc.setNeedle(st.dial);

  let lastSent = 0;
  let sendTimer: number | undefined;
  let lastBuzz = Math.round(myDial.v / 5);
  const locked = () => !!funk()?.locked || funk()?.sub !== 'tune';
  const push = () => {
    const now = performance.now();
    clearTimeout(sendTimer);
    if (now - lastSent >= 70) {
      lastSent = now;
      send('dial', { v: myDial.v });
    } else sendTimer = window.setTimeout(push, 70 - (now - lastSent));
  };
  const set = (v: number) => {
    if (locked()) return;
    myDial.v = Math.round(funkClamp(v) * 10) / 10;
    myDial.touched = true;
    paint();
    const b = Math.round(myDial.v / 5);
    if (b !== lastBuzz) {
      lastBuzz = b;
      haptic('tick');
    }
    push();
  };
  const paint = () => {
    mine.style.left = `${myDial.v}%`;
    mine.classList.toggle('untouched', !myDial.touched);
    q(box, '.fk-val').textContent = myDial.touched ? `${Math.round(myDial.v)}` : '–';
  };
  const fromX = (x: number) => {
    const r = band.getBoundingClientRect();
    return ((x - r.left) / Math.max(1, r.width)) * 100;
  };
  band.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      band.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    set(fromX(e.clientX));
  });
  band.addEventListener('pointermove', (e) => {
    if (!band.hasPointerCapture?.(e.pointerId) && e.buttons === 0) return;
    set(fromX(e.clientX));
  });
  band.addEventListener('contextmenu', (e) => e.preventDefault());
  tapButton(q(box, '.fk-minus'), () => set(Math.round(myDial.v) - 1));
  tapButton(q(box, '.fk-plus'), () => set(Math.round(myDial.v) + 1));
  const lockBtn = q<HTMLButtonElement>(box, '.fk-lock');
  lockBtn.addEventListener('click', () => {
    if (!confirm('Tipp festmachen? Danach wettet das andere Team.')) return;
    send('lock');
    haptic('hit');
  });
  paint();

  app.append(root);
  return () => {
    const s = funk();
    if (!s) return;
    h.update(s);
    sc.setNeedle(s.dial);
    const n = Object.keys(s.dials).length;
    q(h.root, '.fk-what').textContent = s.sub === 'bet' ? 'Gegner wetten' : 'Dreht die Frequenz!';
    q(box, '.fk-clue-line').innerHTML = s.clue
      ? `${escapeHtml(nameOf(s.funker))}: <b class="pink">„${escapeHtml(s.clue)}“</b>`
      : `Hör auf ${escapeHtml(nameOf(s.funker))}s Hinweis!`;
    q(box, '.fk-mean').textContent = `Team-Zeiger: ${Math.round(s.dial)}${n ? ` (aus ${n} ${n === 1 ? 'Regler' : 'Reglern'})` : ''}`;
    const cap = s.captain === me;
    lockBtn.classList.toggle('hidden', !cap || s.sub !== 'tune');
    band.classList.toggle('off', s.sub !== 'tune');
    for (const b of box.querySelectorAll<HTMLButtonElement>('.fk-fine button')) b.disabled = s.sub !== 'tune';
    q(box, '.fk-note').textContent =
      s.sub === 'bet'
        ? `Tipp steht! ${TEAM_INFO[funkOther(s.active)].name} wettet jetzt.`
        : cap
          ? 'Du bist Kapitän: Seid ihr euch einig? Dann mach den Tipp fest.'
          : `Diskutiert! ${escapeHtml(nameOf(s.captain))} ist Kapitän und macht den Tipp fest.`;
  };
}

// ---------------------------------------------------------------- Gegner

function buildListen() {
  const st = funk()!;
  const h = head();
  const sc = scale(st);
  const root = el(`
    <div class="fk">
      ${teamBadge(myTeam(st))}
      <h2>${escapeHtml(TEAM_INFO[st.active].name)} funkt</h2>
      <p class="fk-big">Hört mit! Gleich wettet ihr, ob das Ziel <b>weiter links</b> oder <b>weiter rechts</b> liegt.</p>
      <p class="fk-clue-line"></p>
    </div>
  `);
  const box = q(root, '.fk');
  box.prepend(h.root);
  box.append(sc.root);
  app.append(root);
  return () => {
    const s = funk();
    if (!s) return;
    h.update(s);
    sc.setNeedle(s.dial);
    q(h.root, '.fk-what').textContent = s.sub === 'tune' ? 'Gegner drehen' : 'Funker überlegt';
    q(box, '.fk-clue-line').innerHTML = s.clue ? `Hinweis: <b class="pink">„${escapeHtml(s.clue)}“</b>` : `Funker: ${escapeHtml(nameOf(s.funker))}`;
  };
}

function buildBet() {
  const st = funk()!;
  const h = head();
  const sc = scale(st, { big: true });
  sc.setNeedle(st.dial);
  const [l, r] = st.pair;
  const root = el(`
    <div class="fk">
      ${teamBadge(myTeam(st))}
      <h2 class="pink">EURE WETTE!</h2>
      <p class="fk-clue-line"></p>
      <p>Liegt das Ziel links oder rechts vom Zeiger? Die Mehrheit zählt – richtig = 1 Punkt für euch.</p>
      <div class="fk-bets">
        <button class="fk-bet" data-side="left">◀ WEITER<br/>LINKS<small>${escapeHtml(l)}</small></button>
        <button class="fk-bet" data-side="right">WEITER ▶<br/>RECHTS<small>${escapeHtml(r)}</small></button>
      </div>
      <p class="fk-count"></p>
    </div>
  `);
  const box = q(root, '.fk');
  box.prepend(h.root);
  box.insertBefore(sc.root, q(box, '.fk-bets'));
  let sent: FunkSide | null = null;
  for (const b of box.querySelectorAll<HTMLButtonElement>('.fk-bet')) {
    b.addEventListener('click', () => {
      if (sent) return;
      sent = b.dataset.side as FunkSide;
      send('bet', { side: sent });
      haptic('tap');
    });
  }
  app.append(root);
  return () => {
    const s = funk();
    if (!s) return;
    h.update(s);
    sc.setNeedle(s.dial);
    const mine = s.bets[store.playerId!] ?? sent;
    q(h.root, '.fk-what').textContent = 'Wetten!';
    q(box, '.fk-clue-line').innerHTML = s.clue ? `Hinweis: <b class="pink">„${escapeHtml(s.clue)}“</b>` : '';
    for (const b of box.querySelectorAll<HTMLButtonElement>('.fk-bet')) {
      b.disabled = !!mine && b.dataset.side !== mine;
      b.classList.toggle('picked', b.dataset.side === mine);
    }
    const team = s.teams[funkOther(s.active)];
    const left = team.filter((id) => s.bets[id] === 'left').length;
    const right = team.filter((id) => s.bets[id] === 'right').length;
    q(box, '.fk-count').textContent = mine
      ? `Deine Wette: ${FUNK_SIDE_TEXT[mine]} · ${left}× links, ${right}× rechts (${left + right}/${team.length})`
      : `${left + right}/${team.length} haben gewettet`;
  };
}

// ---------------------------------------------------------------- Auflösung

function buildReveal() {
  const st = funk()!;
  const r = st.reveal!;
  const me = store.playerId!;
  const team = myTeam(st);
  const other = funkOther(st.active);
  const sc = scale(st, { big: true });
  sc.setNeedle(r.dial);
  sc.setTarget(r.target);
  const hit = r.points > 0;
  const mineGain = r.gains[team];
  const betLine =
    r.bet === null
      ? `${TEAM_INFO[other].name}: keine Mehrheit bei der Wette.`
      : `${TEAM_INFO[other].name} wettete ${FUNK_SIDE_TEXT[r.bet]} – ${r.betRight ? 'richtig, +1!' : 'daneben.'}`;
  app.append(
    el(`
      <div class="fk center">
        <h1>${hit ? (r.points === 4 ? 'VOLLTREFFER!' : `${r.points} PUNKTE!`) : 'RAUSCHEN ...'}</h1>
        <h2>${escapeHtml(TEAM_INFO[st.active].name)}: ${hit ? `+${r.points}` : 'leider 0'}</h2>
        <div class="fk-revealscale"></div>
        <p>Ziel ${Math.round(r.target)} · Zeiger ${Math.round(r.dial)}</p>
        <p>${escapeHtml(betLine)}</p>
        <h2 class="${mineGain ? 'yellow' : ''}">${mineGain ? `Euer Team: +${mineGain}` : 'Euer Team: diesmal nichts'}</h2>
        <p>Stand: ☀ ${st.score.A} – ${st.score.B} 🌊${st.funker === me ? ' · Danke, Funker!' : ''}</p>
      </div>
    `),
  );
  q(app, '.fk-revealscale').append(sc.root);
  haptic(mineGain ? 'win' : 'tap');
  return null;
}

// ---------------------------------------------------------------- Stil (eigenes <style>, style.css bleibt unberührt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.fk { display: flex; flex-direction: column; gap: 10px; user-select: none; -webkit-user-select: none; }
.fk-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 10px; }
.fk-sc { padding: 3px 6px; border: 2px solid var(--outline); color: var(--ink); }
.fk-sc.fk-A { background: var(--sun); }
.fk-sc.fk-B { background: #7fbcf0; }
.fk-round { color: var(--ink-soft); font-size: 8px; }
.fk-sub { display: flex; justify-content: space-between; font-size: 9px; color: var(--ink-soft); }
.fk-sub .timer { color: var(--red); }
.fk-big { font-size: 10px; line-height: 1.7; color: var(--ink); }
.fk-tip, .fk-note, .fk-mean, .fk-count { font-size: 8px; line-height: 1.7; }
.fk-clue-line { font-size: 10px; color: var(--ink); min-height: 1.7em; }
.fk-scale { display: flex; flex-direction: column; gap: 4px; }
.fk-poles { display: flex; justify-content: space-between; gap: 8px; font-size: 8px; line-height: 1.4; color: var(--ink); }
.fk-poles span:last-child { text-align: right; }
.fk-band { position: relative; height: 46px; border: 3px solid var(--outline); background: #f6e7b8;
  background-image: repeating-linear-gradient(90deg, rgba(61,36,20,.55) 0 1px, transparent 1px 10%), repeating-linear-gradient(90deg, rgba(61,36,20,.25) 0 1px, transparent 1px 2%);
  box-shadow: inset 0 0 0 2px #fff6dc, inset 0 -8px 0 rgba(0,0,0,.08); touch-action: none; overflow: hidden; }
.fk-scale.big .fk-band { height: 64px; }
.fk-band.off { filter: grayscale(.5); opacity: .85; }
.fk-zones { position: absolute; inset: 0; }
.fk-zone { position: absolute; top: 0; bottom: 0; display: flex; align-items: flex-end; justify-content: center; font-size: 8px; color: #fff6dc; padding-bottom: 2px; }
.fk-zone.z2, .fk-zone.z3 { justify-content: flex-start; padding-left: 3px; }
.fk-zone.z2 { background: #f0b13a; }
.fk-zone.z3 { background: #f0973a; }
.fk-zone.z4 { background: #e0503f; }
.fk-needle { position: absolute; top: -3px; bottom: -3px; width: 4px; margin-left: -2px; background: var(--red); box-shadow: 0 0 0 1px #2d1b12; transition: left .12s linear; }
.fk-knob { position: absolute; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; background: var(--wood); border: 3px solid var(--outline); box-shadow: inset 0 3px 0 var(--wood-light); pointer-events: none; }
.fk-knob.untouched { opacity: .45; }
.fk-fine { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
.fk-fine button { padding: 12px 6px; }
.fk-val { min-width: 48px; text-align: center; font-size: 16px; color: var(--red); }
.fk-card { position: relative; min-height: 150px; display: flex; align-items: stretch; justify-content: center; border: 3px solid var(--outline); background: #2d1b12; touch-action: none; -webkit-touch-callout: none; }
.fk-card-back { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 14px; color: #ffd25e; text-align: center;
  background-image: repeating-linear-gradient(45deg, #3d2414 0 6px, #2d1b12 6px 12px); }
.fk-card-back b { font-weight: normal; font-size: 12px; }
.fk-card-back small { font-size: 8px; color: #f7e4b5; line-height: 1.6; }
.fk-card-front { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--paper-light); }
.fk-card-front small { font-size: 7px; color: var(--ink-soft); text-align: center; }
.fk-card.open { border-color: var(--red); }
.fk-go { font-size: 13px; padding: 16px 10px; background: var(--red); }
.fk-lock { font-size: 12px; padding: 16px 10px; background: var(--green); }
.fk-bets { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fk-bet { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 6px; font-size: 12px; line-height: 1.4; }
.fk-bet small { font-size: 7px; opacity: .9; }
.fk-bet.picked { background: var(--red); }
.fk-revealscale { width: 100%; }
.fk .team-badge { padding: 4px; }
`;
