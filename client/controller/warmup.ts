import type { IntroState, MiniKind } from '../../shared/types';
import { MINI_HOWTO, MINI_INFO } from '../../shared/games';
import { type Screen, el, escapeHtml, me, q, socket, store } from './core';
import { haptic } from './haptic';
import { waitingNames } from './screens/intro';

/**
 * Aufwärmrunde am Handy (Raum-Phase `intro` mit `intro.warm`, Spiele aus `WARMUP_KINDS`): Der echte Controller
 * des Spiels (sein Screen-Modul aus `screens/`) läuft unverändert mit dem Snapshot des Übungsspiels – darüber liegt
 * nur eine schmale Leiste: AUFWÄRMEN, Titel + Ziel (bzw. auf wen gewartet wird), „x/y ✓“, BEREIT (`intro:ready`),
 * der VIP hat zusätzlich „▶ JETZT STARTEN“ (`vip:continue`). Bereit-/Start-Logik wie auf der Regelkarte.
 *
 * Damit die Leiste keinen Spielknopf verdeckt, rutscht `#app` darunter (`html.wu`): `#app` wird `position: fixed`
 * ab der Leistenhöhe und bekommt ein `transform` – dadurch richten sich auch die festen Quer-Layouts der Spiele
 * (`.lx`, `.k3` …, eigentlich `position: fixed; inset: 0`) nach #app statt nach dem ganzen Bildschirm.
 * Wetten/Emotes der Zuschauer-Leiste sind in der Aufwärmrunde ausgeblendet (nichts zählt).
 */

/** Screen-Keys der Aufwärmrunde beginnen damit (main.ts erkennt so den Wechsel ins echte Spiel) */
export const WARM_PREFIX = 'warm';

/**
 * Hüllt den Screen des Spiels ein: eigener Key je Übungsinstanz (`seq` = `GameLive.miniSeq`, eine frische
 * Übungsrunde baut den Controller neu), Haltung bleibt die des Spiels.
 */
export function pickWarmup(it: IntroState, inner: Screen, seq: number): Screen {
  const [key, build, orient] = inner;
  return [
    `${WARM_PREFIX}${seq}-${key}`,
    () => {
      mountBar(it.kind, it.seq);
      const up = build();
      return () => {
        up?.();
        updateBar();
      };
    },
    orient,
  ];
}

/** Bei jedem Render (main.ts): Leiste weg, sobald kein Aufwärm-Screen mehr steht */
export function syncWarmup(key: string) {
  if (key.startsWith(WARM_PREFIX)) return updateBar();
  if (!bar) return;
  bar.remove();
  bar = null;
  barFor = '';
  document.documentElement.classList.remove('wu');
}

// ------------------------------------------------------------------ Leiste

let bar: HTMLElement | null = null;
/** Für welche Karte (Spiel + Nummer) die Leiste gebaut ist */
let barFor = '';
let readyBtn: HTMLButtonElement | null = null;

function mountBar(kind: MiniKind, seq: number) {
  injectCss();
  const id = `${kind}-${seq}`;
  if (bar && barFor === id) return;
  bar?.remove();
  barFor = id;
  const info = MINI_INFO[kind];
  const goal = MINI_HOWTO[kind]?.goal ?? info.tagline;
  bar = el(`
    <div class="wu-bar">
      <span class="wu-tag">AUFWÄRMEN</span>
      <p class="wu-text"><b>${info.icon} ${escapeHtml(info.title)}</b> <i class="wu-goal">${escapeHtml(goal)}</i></p>
      <span class="wu-count"></span>
      <button class="wu-ready">BEREIT!</button>
      <button class="wu-go hidden">▶ JETZT STARTEN</button>
    </div>
  `).firstElementChild as HTMLElement;
  document.body.append(bar);
  document.documentElement.classList.add('wu');
  const ready = q<HTMLButtonElement>(bar, '.wu-ready');
  readyBtn = ready;
  ready.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (ready.disabled) return;
    socket.emit('intro:ready');
    haptic('win');
    ready.disabled = true;
    ready.textContent = '✓ BEREIT';
  });
  ready.addEventListener('contextmenu', (e) => e.preventDefault());
  q(bar, '.wu-go').addEventListener('click', () => {
    haptic('tap');
    socket.emit('vip:continue');
  });
  updateBar();
}

function updateBar() {
  const b = bar;
  const st = store.state?.phase === 'intro' ? store.state.intro : null;
  if (!b || !st) return;
  const id = store.playerId ?? '';
  const n = st.ids.length;
  const nReady = st.ready.length;
  const mine = st.ready.includes(id);
  const others = st.ids.filter((pid) => pid !== id && !st.ready.includes(pid));
  const count = q(b, '.wu-count');
  count.textContent = `${nReady}/${n} ✓`;
  count.classList.toggle('all', n > 0 && nReady >= n);
  if (mine && readyBtn && !readyBtn.disabled) {
    readyBtn.disabled = true;
    readyBtn.textContent = '✓ BEREIT';
  }
  // Ziel-Satz, bis man selbst bereit ist – danach, auf wen noch gewartet wird
  const goal = q(b, '.wu-goal');
  const info = MINI_INFO[st.kind];
  const text = !mine ? `· ${MINI_HOWTO[st.kind]?.goal ?? info.tagline}` : others.length ? `· Warte auf ${waitingNames(others)} …` : '· Alle bereit – los geht’s!';
  if (goal.textContent !== text) goal.textContent = text;
  const vip = !!me()?.isVip;
  const go = q(b, '.wu-go');
  go.classList.toggle('hidden', !vip);
  go.classList.toggle('hot', vip && mine && others.length > 0);
  // Höhe der Leiste → #app rutscht genau darunter (hochkant bricht die Leiste um)
  const h = `${Math.ceil(b.getBoundingClientRect().height)}px`;
  if (document.documentElement.style.getPropertyValue('--wu-h') !== h) document.documentElement.style.setProperty('--wu-h', h);
}

// ------------------------------------------------------------------ Stil

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.append(css);
}

const CSS = `
html.wu #app { position: fixed; top: var(--wu-h, 34px); left: 0; right: 0; bottom: 0; transform: translateZ(0); overflow-y: auto; min-height: 0; margin: 0; }
html.wu .spec-bar { display: none; }
html.wu .pl-fab { top: calc(var(--wu-h, 34px) + 6px); }
.wu-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 20; display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap;
  padding: max(4px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) 4px max(14px, env(safe-area-inset-left, 0px));
  background: #2d1b12; color: #fff4d6; border-bottom: 3px solid var(--gold); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
  user-select: none; -webkit-user-select: none; touch-action: manipulation;
}
.wu-tag { flex: none; padding: 3px 5px 2px; font-size: 7px; color: #2d1b12; background: var(--gold); animation: wu-glow 1.6s ease-in-out infinite; }
.wu-text { flex: 1; min-width: 0; margin: 0; font-size: 8px; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.wu-text b { font-weight: normal; color: var(--gold); }
.wu-text i { font-style: normal; color: #e9dcc0; }
.wu-count { flex: none; font-size: 9px; color: #e9dcc0; white-space: nowrap; }
.wu-count.all { color: #9be37b; }
.wu-bar button { margin: 0; flex: none; min-height: 0; padding: 6px 10px 5px; font-size: 9px; line-height: 1.2; }
.wu-ready { background: var(--green); box-shadow: inset 0 3px 0 #7fd47f, inset 0 -4px 0 #2f7d32, 0 2px 0 var(--outline); }
.wu-ready:disabled { opacity: 1; filter: none; background: #2f7d32; color: #d8f5d0; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.3); }
.wu-go { background: #f0973a; box-shadow: inset 0 3px 0 #ffb867, inset 0 -4px 0 #c06a1f, 0 2px 0 var(--outline); }
.wu-go.hidden { display: none; }
.wu-go.hot { animation: wu-pulse 1.1s ease-in-out infinite; }
@keyframes wu-glow { 50% { filter: brightness(1.25); } }
@keyframes wu-pulse { 50% { filter: brightness(1.15); transform: scale(1.04); } }
/* Hochkant: Titel/Ziel eine eigene Zeile, darunter Zähler + Knöpfe */
:where(html:not(.land)) .wu-text { flex-basis: 100%; order: 2; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
:where(html:not(.land)) .wu-count { order: 1; margin-left: auto; }
:where(html:not(.land)) .wu-ready { order: 3; flex: 1; padding: 9px 10px 8px; font-size: 11px; }
:where(html:not(.land)) .wu-go { order: 4; flex: 1; padding: 9px 6px 8px; }
`;
