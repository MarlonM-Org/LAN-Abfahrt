import type { Socket } from 'socket.io-client';
import { isMusicMenuOpen } from './musicMenu';
import type { GameState } from '../../shared/types';
import { bus, getState } from './store';
import { installArcadePicker } from './arcadePicker';
import { hdFactor, setHdFactor } from './hd';

/**
 * Steuerung direkt am Laptop (Maus + Tastatur), falls kein Handy-VIP mehr da ist.
 * Unauffälliges Overlay: erscheint bei Mausbewegung oder Tastendruck, verschwindet nach ein paar Sekunden.
 * Der Server nimmt die Befehle nur von Verbindungen an, die vom Laptop selbst (localhost) kommen.
 *
 *   Esc (2×)        Spiel abbrechen → Lobby
 *   Enter / Leertaste  Weiter (wie „Weiter“ des VIP) – im Ergebnis eines Einzelspiels: Nochmal
 *   A               Arcade-Auswahl: beliebiges Spiel per Maus/Tastatur starten (im Ergebnis: anderes Spiel)
 *   L               Lobby: Leaderboard des Abends groß ein-/ausblenden
 *   S               Zug/Phase überspringen (wie das VIP-Menü am Handy) – nur in Zug-/Warte-Phasen
 *   Auflösung ×1/×2  Render-Auflösung der TV-Seite (hd.ts) – lädt die Seite neu
 */
const HIDE_MS = 3500;
const ARM_MS = 3000;

type Cmd = 'abort' | 'continue' | 'removeBots' | 'pick' | 'again' | 'menu' | 'board' | 'resetSession' | 'skip';

/** Eigenes Stylesheet, damit tv.html unangetastet bleibt */
const CSS = `
body.hc-idle { cursor: none; }
#host-ctl { position: fixed; right: 2vh; bottom: 2vh; z-index: 10; padding: 1.2vh 1.4vh; font: 1.2vh 'Press Start 2P', monospace; color: #fff4d6; background: rgba(45, 27, 18, 0.72); border: 0.3vh solid rgba(247, 228, 181, 0.5); opacity: 0; pointer-events: none; transition: opacity 0.3s; }
#host-ctl.show { opacity: 1; pointer-events: auto; }
#host-ctl .hc-title { color: #f7c948; margin-bottom: 1vh; }
#host-ctl .hc-row { display: flex; gap: 0.8vh; flex-wrap: wrap; max-width: 62vh; }
#host-ctl .hc-row + .hc-row { margin-top: 0.8vh; }
#host-ctl button.hc-again:not(:disabled) { background: #f0973a; color: #fff4d6; }
#host-ctl button[hidden] { display: none; }
#host-ctl button { font: inherit; color: #3d2414; background: #f7e4b5; border: 0.3vh solid #8d5629; padding: 0.8vh 1vh; cursor: pointer; }
#host-ctl button:hover:not(:disabled) { background: #fff4d6; }
#host-ctl button:disabled { opacity: 0.35; cursor: default; }
#host-ctl button.armed, #host-ctl button.armed:hover { background: #e2574c; color: #fff4d6; }
#host-ctl .hc-keys { margin-top: 1vh; opacity: 0.75; font-size: 1.1vh; }
#host-ctl .hc-msg { margin-top: 0.8vh; min-height: 1.4vh; color: #f7c948; }
`;

export function installHostControls(socket: Socket) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement('div');
  root.id = 'host-ctl';
  root.innerHTML = `
    <div class="hc-title">Laptop-Steuerung</div>
    <div class="hc-row">
      <button data-cmd="abort" tabindex="-1">Spiel abbrechen</button>
      <button data-cmd="continue" tabindex="-1">Weiter</button>
      <button data-cmd="skip" tabindex="-1">Zug überspringen (S)</button>
      <button data-cmd="removeBots" tabindex="-1">Bots entfernen</button>
      <button data-cmd="pick" tabindex="-1">Spiel wählen (A)</button>
    </div>
    <div class="hc-row">
      <button data-cmd="again" class="hc-again" tabindex="-1" hidden>Nochmal (Enter)</button>
      <button data-cmd="menu" tabindex="-1" hidden>Anderes Spiel (A)</button>
      <button data-cmd="board" tabindex="-1">Leaderboard (L)</button>
      <button data-cmd="resetSession" tabindex="-1">Leaderboard zurücksetzen</button>
      <button data-local="hd" tabindex="-1" title="Render-Auflösung: ×2 = 960 × 540 (glattere Bewegung, Welt bleibt 480 × 270) – lädt die TV-Seite neu">Auflösung ×${hdFactor()}</button>
    </div>
    <div class="hc-keys">Esc 2× = abbrechen · Enter = weiter / jetzt starten / nochmal · S = überspringen · A = Spiel wählen · L = Leaderboard</div>
    <div class="hc-msg"></div>
  `;
  document.body.append(root);
  const btn = (c: Cmd) => root.querySelector<HTMLButtonElement>(`button[data-cmd="${c}"]`)!;
  const msgEl = root.querySelector<HTMLDivElement>('.hc-msg')!;

  let hideTimer: number | undefined;
  let hovered = false;
  const show = () => {
    root.classList.add('show');
    document.body.classList.remove('hc-idle');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (hovered || armedUntil > Date.now()) return show();
      root.classList.remove('show');
      document.body.classList.add('hc-idle');
    }, HIDE_MS);
  };
  root.addEventListener('pointerenter', () => (hovered = true));
  root.addEventListener('pointerleave', () => (hovered = false));
  window.addEventListener('mousemove', show);

  let msgTimer: number | undefined;
  const say = (text: string) => {
    msgEl.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msgEl.textContent = ''), 3000);
    show();
  };

  const send = (cmd: Cmd) =>
    socket.timeout(3000).emit('host:cmd', cmd, (err: unknown, r?: { ok: boolean; msg?: string }) => {
      if (err) return say('Server antwortet nicht.');
      if (r?.msg) say(r.msg);
    });

  // Abbrechen braucht eine Bestätigung (zweimal klicken bzw. zweimal Esc)
  let armedUntil = 0;
  let armTimer: number | undefined;
  const abort = () => {
    if (btn('abort').disabled) return say('Es läuft gerade kein Spiel.');
    if (armedUntil > Date.now()) {
      armedUntil = 0;
      clearTimeout(armTimer);
      update();
      return send('abort');
    }
    armedUntil = Date.now() + ARM_MS;
    update();
    say('Nochmal klicken bzw. Esc zum Abbrechen');
    clearTimeout(armTimer);
    armTimer = window.setTimeout(() => {
      armedUntil = 0;
      update();
    }, ARM_MS);
  };
  const cont = () => {
    const st = getState();
    // Ergebnis eines Einzelspiels: Enter = Nochmal (gleiches Spiel, gleiche Leute)
    if (st?.phase === 'results' && st.nochmal) return again();
    if (btn('continue').disabled) return say('Gerade gibt es nichts zum Weiterschalten.');
    send('continue');
  };
  const again = () => {
    const n = getState()?.nochmal;
    if (!n) return say('Nochmal gibt es nur im Ergebnis eines Einzelspiels.');
    if (n.disabled) return say(`Nochmal geht nicht: ${n.disabled}`);
    send('again');
  };

  // Leaderboard des Abends zurücksetzen: zweimal klicken
  let resetArmedUntil = 0;
  const resetSession = () => {
    if (resetArmedUntil > Date.now()) {
      resetArmedUntil = 0;
      update();
      return send('resetSession');
    }
    resetArmedUntil = Date.now() + ARM_MS;
    update();
    say('Nochmal klicken: Punkte des Abends löschen');
    window.setTimeout(() => update(), ARM_MS + 50);
  };

  const skip = () => {
    if (btn('skip').disabled) return say('Gerade gibt es nichts zum Überspringen.');
    send('skip');
  };

  btn('abort').addEventListener('click', abort);
  btn('skip').addEventListener('click', skip);
  btn('continue').addEventListener('click', cont);
  btn('removeBots').addEventListener('click', () => send('removeBots'));
  const picker = installArcadePicker(socket, say);
  btn('pick').addEventListener('click', () => picker.toggle());
  btn('again').addEventListener('click', again);
  btn('menu').addEventListener('click', () => picker.toggle(true));
  btn('board').addEventListener('click', () => send('board'));
  btn('resetSession').addEventListener('click', resetSession);
  // Render-Auflösung umschalten (lädt die Seite neu; ein laufendes Spiel läuft am Server weiter)
  root.querySelector<HTMLButtonElement>('button[data-local="hd"]')!.addEventListener('click', () => setHdFactor(hdFactor() === 2 ? 1 : 2));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // Offenes Musik-Menü (oder Eingabefeld darin) hat Vorrang: Esc schließt nur das Menü
    if (document.querySelector('#musik-menu-root .open, #musik-menu-root [data-open="1"]') || isMusicMenuOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      abort();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show();
      cont();
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Nicht, während ein Eingabefeld (z. B. Arcade-Suche) den Fokus hat
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      show();
      skip();
    } else if (e.key === 'l' || e.key === 'L') {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      send('board');
    }
  });

  function update(s: GameState | null = getState()) {
    const phase = s?.phase ?? 'lobby';
    const sp = s?.mini?.kind === 'stillepost' ? s.mini.state : null;
    const waits =
      (phase === 'results' && !!s?.results) ||
      (phase === 'story' && !!s?.date?.card) ||
      (phase === 'intro' && !!s?.intro) ||
      (s?.mini?.kind === 'murder' && s.mini.state.sub === 'meeting') ||
      (!!sp && (sp.sub === 'reveal' || sp.sub === 'vote' || sp.sub === 'tally'));
    btn('abort').disabled = phase === 'lobby';
    btn('abort').textContent = armedUntil > Date.now() ? 'Wirklich abbrechen?' : 'Spiel abbrechen';
    btn('abort').classList.toggle('armed', armedUntil > Date.now());
    btn('continue').disabled = !waits;
    // Regelkarte: Enter startet das Spiel sofort, ohne auf die übrigen „Bereit“ zu warten
    btn('continue').textContent = phase === 'intro' ? 'Jetzt starten (Enter)' : 'Weiter';
    const skippable = (phase === 'mini' || phase === 'board') && s?.skippable ? s.skippable : null;
    btn('skip').disabled = !skippable;
    btn('skip').textContent = skippable ? `${skippable.label} (S)` : 'Zug überspringen (S)';
    btn('removeBots').disabled = phase !== 'lobby' || !s?.botCount;
    const single = phase === 'results' && !!s?.nochmal;
    btn('pick').disabled = phase !== 'lobby';
    btn('pick').hidden = single;
    btn('again').hidden = !single;
    btn('menu').hidden = !single;
    btn('again').disabled = !!s?.nochmal?.disabled;
    btn('again').title = s?.nochmal?.disabled ?? '';
    btn('again').textContent = s?.nochmal ? `Nochmal: ${s.nochmal.next} (Enter)` : 'Nochmal (Enter)';
    btn('continue').hidden = single;
    btn('board').disabled = phase !== 'lobby';
    btn('board').textContent = s?.showBoard ? 'Lobby zeigen (L)' : 'Leaderboard (L)';
    btn('resetSession').disabled = (phase !== 'lobby' && phase !== 'results') || !s?.session.games;
    btn('resetSession').textContent = resetArmedUntil > Date.now() ? 'Wirklich zurücksetzen?' : 'Leaderboard zurücksetzen';
    btn('resetSession').classList.toggle('armed', resetArmedUntil > Date.now());
  }
  bus.on('state', (s: GameState) => update(s));
  update();
  show();
}
