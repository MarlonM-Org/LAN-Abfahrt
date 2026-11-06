import type { LiederPrivate, LiederState } from '../../../shared/types';
import { LIEDER_COLORS } from '../../../shared/lieder';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, socket, store, timerText } from '../core';
import { haptic } from '../haptic';

/** Lokale Genre-Auswahl – überlebt einen Neuaufbau des Screens (kurzer WLAN-Aussetzer) */
const local = { picks: [] as string[] };

const st = () => (store.state?.mini?.kind === 'lieder' ? store.state.mini.state : null);
/** Privater Zustand – nur, wenn er zur aktuellen Runde passt */
const priv = (): LiederPrivate | null => {
  const p = store.priv?.kind === 'lieder' ? store.priv.state : null;
  const s = st();
  return p && s && p.round === s.round ? p : null;
};

const short = (name: string) => name.replace(/^Bot\s+/, '');
const genreOf = (s: LiederState, id: string | null) => s.genres.find((g) => g.id === id);
const genreLabel = (s: LiederState, id: string | null) => {
  const g = genreOf(s, id);
  return g ? `${g.icon} ${g.name}` : '?';
};
const ownerText = (s: LiederState) => (s.owner === store.playerId ? 'dein Genre' : `Genre von ${short(nameOf(s.owner))}`);

export function pickLieder(s: LiederState, vip: boolean): Screen {
  injectCss();
  const id = store.playerId!;
  const r = s.round;
  if (!s.players.includes(id)) return ['ls-spectate', message('Du hörst zu', 'Schau auf den Fernseher!')];
  switch (s.sub) {
    case 'pick':
      return s.picked.includes(id) ? ['ls-picked', buildPicked] : [`ls-pick-${s.perPlayer}`, buildPick];
    case 'genres':
      return ['ls-genres', buildPlan];
    case 'prep':
      return [`ls-prep-${r}`, buildPrep];
    case 'play':
      return [`ls-play-${r}`, buildPlay];
    case 'reveal':
      return [`ls-rev-${r}-${vip}`, () => buildReveal(vip)];
    default:
      return ['ls-over', message('Das war Guess the Song!', s.note ?? 'Gleich gibt’s die Auswertung ...')];
  }
}

const tickTimer = (root: ParentNode) => {
  const t = root.querySelector('.timer');
  if (t) t.textContent = timerText((sec) => `${sec}s`);
};

// ------------------------------------------------------------------ Genres wählen

function buildPick() {
  const s = st()!;
  const n = s.perPlayer;
  local.picks = local.picks.filter((g) => s.genres.some((x) => x.id === g)).slice(0, n);
  const root = el(`
    <div class="top-row"><span>Guess the Song</span><span class="timer"></span></div>
    <h2 class="ls-h">Wähle ${n === 1 ? 'dein Genre' : `${n} Genres`}</h2>
    <p class="ls-hint">Reihum kommt je ein Lied aus deinen Genres dran – raten müssen aber alle!</p>
    <div class="ls-genres">
      ${s.genres.map((g) => `<button class="secondary ls-g" data-g="${escapeHtml(g.id)}"><span class="ls-gi">${g.icon}</span><span class="ls-gn">${escapeHtml(g.name)}</span><span class="ls-gc">${g.n} Lieder</span></button>`).join('')}
    </div>
    <button class="ls-ok" disabled></button>
  `);
  const ok = q<HTMLButtonElement>(root, '.ls-ok');
  const show = () => {
    root.querySelectorAll<HTMLButtonElement>('.ls-g').forEach((b) => b.classList.toggle('on', local.picks.includes(b.dataset.g!)));
    ok.disabled = local.picks.length !== n;
    ok.textContent = local.picks.length === n ? 'Fertig!' : `${local.picks.length}/${n} gewählt`;
  };
  root.querySelectorAll<HTMLButtonElement>('.ls-g').forEach((b) =>
    b.addEventListener('click', () => {
      const g = b.dataset.g!;
      haptic('tick');
      if (local.picks.includes(g)) local.picks = local.picks.filter((x) => x !== g);
      else if (n === 1) local.picks = [g];
      else if (local.picks.length < n) local.picks = [...local.picks, g];
      else return haptic('bad');
      show();
    }),
  );
  ok.addEventListener('click', () => {
    if (local.picks.length !== n) return;
    haptic('hit');
    send('genres', { genres: local.picks });
    ok.disabled = true;
    ok.textContent = 'Gesendet!';
  });
  show();
  app.append(root);
  return () => tickTimer(root);
}

function buildPicked() {
  const s = st()!;
  const mine = store.priv?.kind === 'lieder' ? store.priv.state.picks : local.picks;
  const root = el(`
    <div class="top-row"><span>Guess the Song</span><span class="timer"></span></div>
    <div class="center">
      <p>Deine Genres</p>
      <div class="ls-mine">${mine.map((g) => `<span>${escapeHtml(genreLabel(s, g))}</span>`).join('')}</div>
      <p class="wait"></p>
      <button class="secondary small ls-undo">Ändern</button>
    </div>
  `);
  q(root, '.ls-undo').addEventListener('click', () => {
    haptic('tick');
    send('unpick');
  });
  app.append(root);
  return () => {
    const cur = st();
    if (!cur) return;
    tickTimer(root);
    const missing = cur.players.length - cur.picked.length;
    q(root, '.wait').textContent = missing > 0 ? `Warte noch auf ${missing} ...` : 'Alle sind bereit!';
  };
}

/** Übersicht: wann kommen meine Genres dran? */
function buildPlan() {
  const s = st()!;
  const id = store.playerId!;
  const mine = (s.plan ?? []).map((p, i) => ({ ...p, round: i + 1 })).filter((p) => p.owner === id);
  const root = el(`
    <div class="center">
      <h2>${s.rounds} Songs</h2>
      <p>Deine Genres kommen in</p>
      <div class="ls-mine">${mine.map((p) => `<span>Runde ${p.round}: ${escapeHtml(genreLabel(s, p.genre))}</span>`).join('') || '<span>–</span>'}</div>
      <p>Erst 4 Antworten, später 6, am Ende 8. Schnell sein lohnt sich!</p>
    </div>
  `);
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Runde

function head(s: LiederState) {
  return `<div class="top-row"><span>Song ${s.round}/${s.rounds}</span><span class="timer"></span></div>`;
}

function buildPrep() {
  const s = st()!;
  const root = el(`
    ${head(s)}
    <div class="center">
      <h1 class="ls-big">${escapeHtml(genreLabel(s, s.genre))}</h1>
      <p>${escapeHtml(ownerText(s))}</p>
      <h2 class="ls-ear">🎧 Ohren auf ...</h2>
      ${s.note ? `<p class="ls-note">${escapeHtml(s.note)}</p>` : ''}
    </div>
  `);
  app.append(root);
  return null;
}

function buildPlay() {
  const s = st()!;
  const n = s.options.length;
  const root = el(`
    ${head(s)}
    <p class="ls-sub">${escapeHtml(genreLabel(s, s.genre))} · ${escapeHtml(ownerText(s))}</p>
    <div class="ls-opts n${n}">
      ${s.options.map((t, i) => `<button class="ls-o" data-i="${i}" style="--c:${LIEDER_COLORS[i % LIEDER_COLORS.length]}">${escapeHtml(t)}</button>`).join('')}
    </div>
    <p class="ls-status">Welcher Song läuft?</p>
  `);
  let sent: number | null = priv()?.choice ?? null;
  root.querySelectorAll<HTMLButtonElement>('.ls-o').forEach((b) =>
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const cur = st();
      if (sent !== null || !cur || cur.sub !== 'play') return;
      sent = Number(b.dataset.i);
      haptic('hit');
      send('answer', { round: cur.round, index: sent });
      show();
    }),
  );
  const show = () => {
    const choice = priv()?.choice ?? sent;
    root.querySelectorAll<HTMLButtonElement>('.ls-o').forEach((b) => {
      const i = Number(b.dataset.i);
      b.classList.toggle('picked', choice === i);
      b.classList.toggle('dim', choice !== null && choice !== i);
    });
    const cur = st();
    const missing = cur ? cur.players.length - cur.answered.length : 0;
    q(root, '.ls-status').textContent = choice === null ? 'Welcher Song läuft?' : missing > 0 ? `Eingeloggt! Warte noch auf ${missing} ...` : 'Alle haben getippt!';
  };
  show();
  app.append(root);
  return () => {
    tickTimer(root);
    show();
  };
}

let lastNext = 0;
function nextButton(label: string) {
  const b = el(`<button class="ls-next">${label}</button>`).firstElementChild as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (performance.now() - lastNext < 500) return;
    lastNext = performance.now();
    haptic('tap');
    socket.emit('vip:mini', 'next');
  });
  return b;
}

function buildReveal(vip: boolean) {
  const s = st()!;
  const id = store.playerId!;
  const a = s.answer;
  const choice = s.choices?.[id];
  const gain = s.gain?.[id] ?? 0;
  const right = a !== null && choice === a.index;
  const ms = s.times?.[id];
  if (right) haptic('win');
  const ranked = [...s.players].sort((x, y) => (s.points[y] ?? 0) - (s.points[x] ?? 0));
  const place = ranked.findIndex((x) => (s.points[x] ?? 0) === (s.points[id] ?? 0)) + 1;
  const root = el(`
    <div class="center">
      <p>Das war</p>
      <h1 class="ls-title">${escapeHtml(a?.title ?? '?')}</h1>
      <p>${escapeHtml([a?.artist, a?.year].filter(Boolean).join(' · '))}</p>
      <h2 class="${right ? 'yellow' : ''}">${choice === undefined ? 'Nicht getippt' : right ? `Richtig! +${gain}` : 'Leider falsch'}</h2>
      <p>${right && ms !== undefined ? `${(ms / 1000).toFixed(1).replace('.', ',')} s${s.first === id ? ' – Schnellste:r! ⚡' : ''}` : choice !== undefined && choice !== null ? `Du hattest: ${escapeHtml(s.options[choice] ?? '?')}` : ''}</p>
      <p>Platz ${place} · ${s.points[id] ?? 0} Punkte</p>
    </div>
  `);
  if (vip) q(root, '.center').append(nextButton(s.round >= s.rounds ? 'Zur Auswertung' : 'Nächster Song'));
  app.append(root);
  return null;
}

// ------------------------------------------------------------------ Stil (eigenes <style>, damit style.css unberührt bleibt)

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
.ls-h { margin: 0; }
.ls-hint, .ls-sub, .ls-note { font-size: 9px; line-height: 1.6; margin: 0; }
.ls-note { color: var(--red); }
.ls-genres { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ls-g { display: grid; grid-template-columns: 26px 1fr; grid-template-areas: "i n" "i c"; align-items: center; column-gap: 6px; text-align: left; padding: 8px; min-height: 52px; }
.ls-g.on { background: #fff1b0; border-color: var(--gold); box-shadow: inset 0 -3px 0 #e8c25a, 0 3px 0 var(--wood-darker); }
.ls-gi { grid-area: i; font-size: 18px; text-align: center; }
.ls-gn { grid-area: n; font-size: 9px; line-height: 1.4; }
.ls-gc { grid-area: c; font-size: 7px; color: var(--ink-soft); }
.ls-ok { font-size: 13px; padding: 16px 8px; background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.ls-mine { display: flex; flex-direction: column; gap: 6px; }
.ls-mine span { padding: 8px; background: var(--paper-light); border: 3px solid var(--wood-dark); font-size: 10px; }
.ls-big { font-size: 15px; }
.ls-ear { animation: ls-pulse 0.9s ease-in-out infinite alternate; }
@keyframes ls-pulse { from { transform: scale(1); } to { transform: scale(1.08); } }
.ls-opts { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-content: stretch; }
.ls-opts.n4 { grid-auto-rows: minmax(96px, 1fr); }
.ls-opts.n6 { grid-auto-rows: minmax(78px, 1fr); }
.ls-opts.n8 { grid-auto-rows: minmax(62px, 1fr); }
.ls-o { background: var(--c); border-color: var(--outline); box-shadow: inset 0 3px 0 rgba(255,255,255,0.3), inset 0 -4px 0 rgba(0,0,0,0.3), 0 3px 0 var(--outline); font-size: 10px; line-height: 1.5; padding: 6px; overflow-wrap: anywhere; hyphens: auto; touch-action: manipulation; }
.ls-opts.n4 .ls-o { font-size: 11px; }
.ls-o.picked { outline: 4px solid var(--gold); outline-offset: -2px; transform: scale(1.03); }
.ls-o.dim { opacity: 0.35; filter: grayscale(0.6); }
.ls-status { text-align: center; font-size: 10px; margin: 0; }
.ls-title { font-size: 15px; overflow-wrap: anywhere; }
.ls-next { margin-top: 8px; }
`;
