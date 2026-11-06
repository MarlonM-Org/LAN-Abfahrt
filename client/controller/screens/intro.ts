import type { IntroState, MiniKind, MiniTeams, Team } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT, miniInspired, teamHandicapText } from '../../../shared/games';
import { type Screen, app, colorOfId, el, escapeHtml, me, message, nameOf, q, socket, store } from '../core';
import { haptic } from '../haptic';

/**
 * Regelkarte vor einem Minispiel ohne Aufwärmrunde (Raum-Phase `intro`; Spiele aus `WARMUP_KINDS` zeigen statt der
 * Karte den echten Controller, siehe `../warmup.ts`): Titel, „à la …“, ein Satz Ziel, die Steuer-Zeilen aus
 * `MINI_HOWTO` als gut lesbare Liste, ggf. Teams vom Brett, Haltung – dazu der große **BEREIT!**-Knopf (`intro:ready`).
 * Kein Countdown: Oben „x/y ✓“, unten auf wen noch gewartet wird; der VIP hat „▶ JETZT STARTEN“ (`vip:continue`).
 * Der Screen hat die Haltung des Spiels (drittes Tupel-Element), damit Ansage-Karte und Overlay schon hier greifen.
 */
export function pickIntro(it: IntroState, vip: boolean): Screen {
  const orient = MINI_INFO[it.kind]?.orientation ?? 'any';
  if (!store.playerId || !it.ids.includes(store.playerId)) {
    return ['intro-watch', message('Gleich geht’s los', 'Diese Runde schaust du zu – beim nächsten Spiel bist du dabei!')];
  }
  return [`intro-${it.kind}${it.teams ? `-${it.teams.label}` : ''}`, () => buildIntro(it.kind, vip, it.teams ?? null), orient];
}

/** Team-Spiel vom Brett: „2 gegen 2 · Du: Team Meer mit Ben – gegen Anna, Clara“ (Namen in Spielerfarbe) */
function teamsHtml(teams: MiniTeams, kind: MiniKind): string {
  const id = store.playerId;
  const mine: Team | null = id && teams.A.includes(id) ? 'A' : id && teams.B.includes(id) ? 'B' : null;
  const name = (pid: string) => `<b style="color:${colorOfId(pid).hex}">${escapeHtml(nameOf(pid))}</b>`;
  const list = (ids: string[]) => (ids.length ? ids.map(name).join(', ') : '–');
  const tag = (t: Team) => `<span class="it-team team-${t}">${escapeHtml(TEAM_INFO[t].name)}</span>`;
  const hc = teamHandicapText(teams, kind);
  const body = mine
    ? `Du: ${tag(mine)}${teams[mine].filter((p) => p !== id).length ? ` mit ${list(teams[mine].filter((p) => p !== id))}` : ' (allein!)'} – gegen ${list(teams[mine === 'A' ? 'B' : 'A'])}`
    : `${tag('A')} ${list(teams.A)} – gegen ${tag('B')} ${list(teams.B)}`;
  return `<p class="it-teams">⚔️ <b>${escapeHtml(teams.label)}</b> nach Feldfarbe · ${body}${hc ? `<br>Handicap: ${escapeHtml(hc)}` : ''}</p>`;
}

function buildIntro(kind: MiniKind, vipAtBuild: boolean, teams: MiniTeams | null) {
  injectCss();
  const info = MINI_INFO[kind];
  const how = MINI_HOWTO[kind];
  const insp = miniInspired(kind);
  const root = el(`
    <div class="it">
      <div class="it-head">
        <span class="it-icon">${info.icon}</span>
        <div class="it-title"><b>${escapeHtml(info.title)}</b>${insp ? `<small>${escapeHtml(insp)}</small>` : ''}</div>
        <span class="it-count"></span>
      </div>
      <div class="it-info">
        <p class="it-goal">${escapeHtml(how.goal)}</p>
        ${teams ? teamsHtml(teams, kind) : ''}
        <ul class="it-ctrls">${how.controls.slice(0, 3).map((c) => `<li><span>${c.icon}</span><p>${escapeHtml(c.text)}</p></li>`).join('')}</ul>
        <p class="it-orient${info.orientation === 'landscape' ? ' land' : ''}">${ORIENT_TEXT[info.orientation]}</p>
      </div>
      <div class="it-foot">
        <button class="big-btn it-ready">BEREIT!</button>
        <p class="it-status"></p>
        <div class="it-vip${vipAtBuild ? '' : ' hidden'}">
          <button class="it-go">▶ JETZT STARTEN</button>
          <small>Du bist VIP: startet sofort, ohne auf alle zu warten</small>
        </div>
      </div>
    </div>
  `);

  const ready = q<HTMLButtonElement>(root, '.it-ready');
  ready.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (ready.disabled) return;
    socket.emit('intro:ready');
    haptic('win');
    ready.disabled = true;
    ready.textContent = '✓ BEREIT';
  });
  const vipBox = q(root, '.it-vip');
  const go = q<HTMLButtonElement>(root, '.it-go');
  go.addEventListener('click', () => {
    haptic('tap');
    socket.emit('vip:continue');
  });
  const count = q(root, '.it-count');
  const status = q(root, '.it-status');

  app.append(root);
  return () => {
    const s = store.state;
    const st = s?.phase === 'intro' ? s.intro : null;
    if (!st) return;
    const id = store.playerId!;
    // Kein Timer: Los geht’s erst, wenn alle (verbundenen) bereit sind – oder der VIP startet
    const n = st.ids.length;
    const nReady = st.ready.length;
    const mine = st.ready.includes(id);
    const others = st.ids.filter((pid) => pid !== id && !st.ready.includes(pid));
    count.textContent = `${nReady}/${n} ✓`;
    count.classList.toggle('all', n > 0 && nReady >= n);
    if (mine && !ready.disabled) {
      ready.disabled = true;
      ready.textContent = '✓ BEREIT';
    }
    status.textContent = !mine
      ? `${nReady}/${n} bereit · Drück BEREIT, wenn du so weit bist`
      : others.length
        ? `Du bist bereit ✓ Warte auf ${waitingNames(others)} …`
        : 'Alle bereit – los geht’s!';
    const vip = !!me()?.isVip;
    vipBox.classList.toggle('hidden', !vip);
    // VIP ist bereit, andere fehlen noch → Start-Knopf pulsiert
    go.classList.toggle('hot', vip && mine && others.length > 0);
  };
}

/** „Anna, Ben und Clara“ bzw. „Anna, Ben, Clara +2“ */
export function waitingNames(ids: string[]): string {
  const names = ids.map((pid) => nameOf(pid));
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0] ?? '';
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
.it { display: flex; flex-direction: column; gap: 12px; user-select: none; -webkit-user-select: none; }
.it-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.it-icon { font-size: 32px; line-height: 1; flex: none; }
.it-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.it-title b { font-weight: normal; font-size: 12px; line-height: 1.4; color: var(--red); }
.it-title small { font-size: 7px; line-height: 1.4; color: var(--ink-soft); }
.it-count { flex: none; font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.it-count.all { color: #2f7d32; }
.it-info { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.it-goal { font-size: 10px; line-height: 1.7; color: var(--ink); text-align: left; }
.it-teams { font-size: 8px; line-height: 1.7; color: var(--ink); text-align: left; }
.it-team { padding: 1px 4px; border: 2px solid var(--wood-darker); color: var(--ink); white-space: nowrap; }
.it-ctrls { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.it-ctrls li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 7px 8px; background: var(--paper-light); border: 2px solid var(--paper-dark); }
.it-ctrls li span { font-size: 18px; line-height: 1; flex: none; width: 24px; text-align: center; }
.it-ctrls li p { flex: 1; min-width: 0; margin: 0; font-size: 8px; line-height: 1.6; color: var(--ink); text-align: left; overflow-wrap: anywhere; }
.it-orient { font-size: 8px; line-height: 1.5; color: var(--ink-soft); text-align: left; }
.it-orient.land { color: #2f7d32; }
.it-foot { display: flex; flex-direction: column; gap: 8px; }
.big-btn.it-ready { min-height: 64px; flex: none; font-size: 18px; background: var(--green); box-shadow: inset 0 4px 0 #7fd47f, inset 0 -6px 0 #2f7d32, 0 3px 0 var(--outline); }
.big-btn.it-ready:disabled { opacity: 1; filter: none; background: #2f7d32; color: #d8f5d0; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.3); transform: translateY(2px); }
.it-status { font-size: 7px; line-height: 1.6; color: var(--ink-soft); text-align: center; }
.it-vip { display: flex; flex-direction: column; gap: 4px; }
.it-vip.hidden { display: none; }
.it-vip small { font-size: 6px; line-height: 1.5; color: var(--ink-soft); text-align: center; }
.it-go { font-size: 12px; padding: 12px; background: #f0973a; box-shadow: inset 0 4px 0 #ffb867, inset 0 -6px 0 #c06a1f, 0 3px 0 var(--outline); }
.it-go.hot { animation: it-pulse 1.1s ease-in-out infinite; }
@keyframes it-pulse { 50% { filter: brightness(1.15); transform: scale(1.03); } }

/* Handy quer (Quer-Spiele zeigen die Karte schon quer): links Regeln (scrollt bei Bedarf), rechts BEREIT – ohne Scrollen */
/* Klasse von orientation.ts (gilt auch bei Pseudo-Quer) */
:where(html.land-short) #app:has(.it) { padding: 0; border: 0; box-shadow: none; min-height: 0; background: none; }
:where(html.land-short) .it { position: fixed; inset: 0; z-index: 1; overflow: hidden; display: grid; gap: 6px 16px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 34%); grid-template-rows: auto minmax(0, 1fr); grid-template-areas: "head foot" "info foot";
  padding: max(6px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
  background: var(--paper); background-image: radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.35) 0 1px, transparent 2px); background-size: 9px 9px;
  border: 3px solid var(--wood-dark); box-shadow: inset 0 0 0 2px var(--wood); }
:where(html.land-short) .it-head { grid-area: head; }
:where(html.land-short) #app:has(> .abort) .it-head { padding-right: 0; }
:where(html.land-short) .it-icon { font-size: 22px; }
:where(html.land-short) .it-title { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
:where(html.land-short) .it-title b { font-size: 10px; }
:where(html.land-short) .it-info { grid-area: info; overflow-y: auto; gap: 6px; padding-right: 4px; }
:where(html.land-short) .it-goal { font-size: 9px; line-height: 1.6; }
:where(html.land-short) .it-ctrls { gap: 4px; }
:where(html.land-short) .it-ctrls li { padding: 4px 6px; }
:where(html.land-short) .it-ctrls li span { font-size: 15px; }
:where(html.land-short) .it-ctrls li p { font-size: 7px; line-height: 1.5; }
:where(html.land-short) .it-orient { font-size: 7px; }
:where(html.land-short) .it-foot { grid-area: foot; justify-content: center; gap: 6px; min-height: 0; }
:where(html.land-short) #app:has(> .abort) .it-foot { padding-top: 26px; }
:where(html.land-short) .big-btn.it-ready { min-height: 0; flex: 1; max-height: 140px; font-size: 15px; }
:where(html.land-short) .it-status { font-size: 6px; line-height: 1.5; }
:where(html.land-short) .it-go { padding: 8px 6px; font-size: 9px; }
:where(html.land-short) .it-vip small { display: none; }
:where(html.land-short) .it-count { font-size: 9px; }
`;
