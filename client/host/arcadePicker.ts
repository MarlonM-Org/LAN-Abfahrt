/**
 * Laptop: Arcade-Auswahl (Taste A oder Knopf in der Laptop-Steuerung).
 * Alle Spiele als Kacheln mit Icon – Maus oder Pfeiltasten + Enter startet, Esc schließt.
 * Spiele, die nicht zur Spielerzahl passen, sind ausgegraut. Der Server nimmt 'host:start'
 * nur von Loopback-Verbindungen an (wie die übrige Laptop-Steuerung).
 */
import type { Socket } from 'socket.io-client';
import type { GameState, MiniKind } from '../../shared/types';
import { ARCADE_GROUPS, MINI_INFO, TURNIER_PLAYLISTS, fitsPlayers, miniInspired } from '../../shared/games';
import { bus, getState } from './store';
import { isMusicMenuOpen } from './musicMenu';

const CSS = `
#ap-panel { position: fixed; inset: 4vh 4vw; z-index: 30; overflow: auto; padding: 2vh 2.4vh; font: 1.3vh 'Press Start 2P', monospace; line-height: 1.5; color: #3d2414; background: #f7e4b5; border: 0.5vh solid #8d5629; box-shadow: 0 0 0 0.3vh #2d1b12, 0 1vh 0 rgba(0,0,0,0.3); }
#ap-panel[hidden] { display: none; }
#ap-panel .ap-head { display: flex; align-items: center; gap: 1.4vh; margin-bottom: 1.2vh; flex-wrap: wrap; }
#ap-panel h3 { margin: 0; font-size: 1.9vh; color: #a8342a; flex: 1; }
#ap-panel h4 { margin: 1.6vh 0 0.8vh; font-size: 1.3vh; color: #7a5a3a; }
#ap-panel .hint { font-size: 1vh; color: #7a5a3a; }
#ap-panel .msg { min-height: 1.4vh; color: #a8342a; font-size: 1.1vh; }
#ap-panel .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(17vh, 1fr)); gap: 1vh; }
#ap-panel button { font: inherit; color: #3d2414; background: #fff6dc; border: 0.3vh solid #8d5629; cursor: pointer; }
#ap-panel .act { padding: 1vh 1.4vh; font-size: 1.1vh; background: #f0973a; color: #fff4d6; text-shadow: 0.15vh 0.15vh 0 #5e3518; }
#ap-panel .tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.5vh; padding: 1vh 0.6vh; font-size: 1.05vh; min-height: 11vh; }
#ap-panel .tile .ic { font-size: 3.4vh; line-height: 1.15; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
#ap-panel .tile .insp { font-size: 0.85vh; color: #7a5a3a; }
#ap-panel .tile .pl { font-size: 0.85vh; color: #7a5a3a; }
#ap-panel .tile .or { position: absolute; top: 0.4vh; left: 0.5vh; padding: 0.15vh 0.4vh; font-size: 1.1vh; color: #2f7d32; background: #d9f2c8; border: 0.2vh solid #2f7d32; }
#ap-panel .tile .vt { position: absolute; top: 0.4vh; right: 0.4vh; padding: 0.2vh 0.5vh; font-size: 1vh; color: #fff4d6; background: #a8342a; }
#ap-panel .tile:hover:not(:disabled), #ap-panel .tile:focus { background: #f7c948; outline: 0.3vh solid #a8342a; outline-offset: -0.3vh; }
#ap-panel button:disabled { opacity: 0.35; cursor: default; filter: grayscale(0.7); }
#ap-panel .tour { display: flex; flex-wrap: wrap; gap: 1vh; }
#ap-panel .tour button { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4vh; padding: 1vh 1.2vh; font-size: 1.05vh; text-align: left; }
#ap-panel .tour .tn { color: #a8342a; }
#ap-panel .tour .tg { font-size: 0.9vh; color: #7a5a3a; }
#ap-panel .tour button:hover:not(:disabled), #ap-panel .tour button:focus { background: #f7c948; outline: 0.3vh solid #a8342a; outline-offset: -0.3vh; }
`;

export interface ArcadePicker {
  toggle(open?: boolean): void;
  isOpen(): boolean;
}

export function installArcadePicker(socket: Socket, say: (text: string) => void): ArcadePicker {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement('div');
  panel.id = 'ap-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ap-head">
      <h3>Arcade – Spiel wählen</h3>
      <button class="act" data-act="random">Zufall</button>
      <button class="act" data-act="top">Meiste Stimmen</button>
      <span class="hint">Pfeile + Enter = starten · A/Esc = schließen</span>
    </div>
    <div class="info hint"></div>
    <div class="msg"></div>
    <div class="groups"></div>`;
  document.body.append(panel);
  const groups = panel.querySelector('.groups') as HTMLElement;
  const info = panel.querySelector('.info') as HTMLElement;
  const msg = panel.querySelector('.msg') as HTMLElement;
  const rndBtn = panel.querySelector('[data-act=random]') as HTMLButtonElement;
  const topBtn = panel.querySelector('[data-act=top]') as HTMLButtonElement;

  // Turnier: Playlists laufen nacheinander mit Gesamtwertung (Siegerehrung am Ende)
  const tourHead = document.createElement('h4');
  tourHead.textContent = 'Turnier (Playlist, Gesamtwertung, Siegerehrung)';
  const tour = document.createElement('div');
  tour.className = 'tour';
  const tourBtns: { btn: HTMLButtonElement; kinds: MiniKind[] }[] = [];
  for (const pl of TURNIER_PLAYLISTS) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="tn"></span><span class="tg"></span>`;
    (b.querySelector('.tn') as HTMLElement).textContent = `${pl.icon} ${pl.name}`;
    (b.querySelector('.tg') as HTMLElement).textContent = pl.kinds.map((k) => `${MINI_INFO[k].icon} ${MINI_INFO[k].title}`).join(' → ');
    b.addEventListener('click', () => start(`turnier:${pl.id}`));
    tour.append(b);
    tourBtns.push({ btn: b, kinds: pl.kinds });
  }
  groups.append(tourHead, tour);

  const tiles = new Map<MiniKind, { btn: HTMLButtonElement; vt: HTMLElement }>();
  for (const g of ARCADE_GROUPS) {
    const h = document.createElement('h4');
    h.textContent = g.title;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const kind of g.kinds) {
      const mi = MINI_INFO[kind];
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.kind = kind;
      const range = mi.maxPlayers ? `${mi.minPlayers}–${mi.maxPlayers} Spieler` : `ab ${mi.minPlayers} Spieler`;
      b.innerHTML = `<span class="ic"></span><span class="t"></span><span class="insp"></span><span class="pl">${range}</span><span class="vt" hidden></span>${mi.orientation === 'landscape' ? '<span class="or" title="Handy quer halten">↔</span>' : ''}`;
      (b.querySelector('.ic') as HTMLElement).textContent = mi.icon;
      (b.querySelector('.t') as HTMLElement).textContent = mi.title;
      (b.querySelector('.insp') as HTMLElement).textContent = miniInspired(kind);
      b.addEventListener('click', () => start(kind));
      grid.append(b);
      tiles.set(kind, { btn: b, vt: b.querySelector('.vt') as HTMLElement });
    }
    groups.append(h, grid);
  }

  const start = (what: string) =>
    socket.timeout(3000).emit('host:start', what, (err: unknown, r?: { ok: boolean; msg?: string }) => {
      if (err) return (msg.textContent = 'Server antwortet nicht.');
      if (r?.ok) {
        toggle(false);
        say(r.msg ?? 'Los geht’s!');
      } else msg.textContent = r?.msg ?? 'Hat nicht geklappt.';
    });
  rndBtn.addEventListener('click', () => start('random'));
  topBtn.addEventListener('click', () => start('top'));

  function render(s: GameState | null = getState()) {
    if (panel.hidden) return;
    const n = s?.players.filter((p) => p.connected && !p.removed).length ?? 0;
    const lobby = (s?.phase ?? 'lobby') === 'lobby';
    const counts = new Map<MiniKind, number>();
    for (const k of Object.values(s?.arcadeVote?.votes ?? {})) counts.set(k, (counts.get(k) ?? 0) + 1);
    const modeName = s?.mode === 'arcade' ? 'Arcade (Punkte zählen fürs Leaderboard)' : 'Einzelspiel';
    info.textContent = lobby
      ? `${n} Spieler online · ${modeName}${s?.arcadeVote ? ' · Abstimmung läuft' : ''}`
      : 'Gerade läuft ein Spiel – erst abbrechen (Esc 2× bzw. „Spiel abbrechen“).';
    rndBtn.disabled = !lobby || n < 1;
    topBtn.disabled = !lobby || ![...counts.keys()].some((k) => fitsPlayers(k, n));
    for (const t of tourBtns) t.btn.disabled = !lobby || !t.kinds.every((k) => fitsPlayers(k, n));
    for (const [kind, t] of tiles) {
      t.btn.disabled = !lobby || !fitsPlayers(kind, n);
      const c = counts.get(kind) ?? 0;
      t.vt.hidden = !c;
      t.vt.textContent = `${c} ♥`;
    }
  }

  function isOpen() {
    return !panel.hidden;
  }

  function toggle(open = panel.hidden) {
    // Ergebnis eines Einzelspiels: „Anderes Spiel“ → erst zurück in die Lobby, dann Auswahl öffnen
    const st = getState();
    if (open && st?.phase === 'results' && st.nochmal) {
      socket.timeout(3000).emit('host:cmd', 'menu', (err: unknown, r?: { ok: boolean; msg?: string }) => {
        if (err || !r?.ok) say(r?.msg ?? 'Server antwortet nicht.');
      });
    }
    panel.hidden = !open;
    msg.textContent = '';
    if (open) {
      render();
      const first = [...tiles.values()].find((t) => !t.btn.disabled)?.btn;
      (first ?? rndBtn).focus();
    } else {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  /** Pfeiltasten: nächstgelegene Kachel in der Richtung fokussieren */
  function moveFocus(dx: number, dy: number) {
    const all = [...tiles.values()].map((t) => t.btn).filter((b) => !b.disabled);
    const cur = document.activeElement instanceof HTMLButtonElement && all.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) return all[0]?.focus();
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    let best: HTMLButtonElement | null = null;
    let bestD = Infinity;
    for (const b of all) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2 - cx;
      const y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy;
      if (along <= 4) continue;
      const across = Math.abs(x * dy - y * dx);
      const d = along + across * 3;
      if (d < bestD) ((bestD = d), (best = b));
    }
    best?.focus();
    best?.scrollIntoView({ block: 'nearest' });
  }

  // Capture-Phase: läuft vor der Laptop-Steuerung (Esc = abbrechen, Enter = weiter), solange die Auswahl offen ist
  window.addEventListener(
    'keydown',
    (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isMusicMenuOpen()) return;
      if (e.key === 'a' || e.key === 'A') {
        if (e.repeat) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        return toggle();
      }
      // Im Ergebnis eines Einzelspiels: Enter startet bei geschlossener Auswahl „Nochmal“ (hostControls)
      if (panel.hidden) return;
      const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (e.key === 'Escape') toggle(false);
      else if (dirs[e.key]) moveFocus(...dirs[e.key]);
      else if (e.key === 'Enter' || e.key === ' ') {
        const k = (document.activeElement as HTMLElement | null)?.dataset?.kind;
        if (k) start(k);
        else if (document.activeElement instanceof HTMLButtonElement && panel.contains(document.activeElement)) document.activeElement.click();
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  let lastPhase = getState()?.phase ?? 'lobby';
  bus.on('state', (s: GameState) => {
    // Spiel gestartet (z. B. vom VIP-Handy) → Auswahl schließen
    if (lastPhase === 'lobby' && s.phase !== 'lobby' && !panel.hidden) toggle(false);
    lastPhase = s.phase;
    render(s);
  });

  return { toggle, isOpen };
}
