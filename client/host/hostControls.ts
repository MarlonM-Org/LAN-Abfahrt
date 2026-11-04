import type { Socket } from 'socket.io-client';
import type { GameState } from '../../shared/types';
import { bus, getState } from './store';

/**
 * Steuerung direkt am Laptop (Maus + Tastatur), falls kein Handy-VIP mehr da ist.
 * Unauffälliges Overlay: erscheint bei Mausbewegung oder Tastendruck, verschwindet nach ein paar Sekunden.
 * Der Server nimmt die Befehle nur von Verbindungen an, die vom Laptop selbst (localhost) kommen.
 *
 *   Esc (2×)        Spiel abbrechen → Lobby
 *   Enter / Leertaste  Weiter (wie „Weiter“ des VIP)
 */
const HIDE_MS = 3500;
const ARM_MS = 3000;

type Cmd = 'abort' | 'continue' | 'removeBots';

/** Eigenes Stylesheet, damit tv.html unangetastet bleibt */
const CSS = `
body.hc-idle { cursor: none; }
#host-ctl { position: fixed; left: 2vh; bottom: 2vh; z-index: 10; padding: 1.2vh 1.4vh; font: 1.2vh 'Press Start 2P', monospace; color: #fff4d6; background: rgba(45, 27, 18, 0.72); border: 0.3vh solid rgba(247, 228, 181, 0.5); opacity: 0; pointer-events: none; transition: opacity 0.3s; }
#host-ctl.show { opacity: 1; pointer-events: auto; }
#host-ctl .hc-title { color: #f7c948; margin-bottom: 1vh; }
#host-ctl .hc-row { display: flex; gap: 0.8vh; }
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
      <button data-cmd="removeBots" tabindex="-1">Bots entfernen</button>
    </div>
    <div class="hc-keys">Esc 2× = abbrechen · Enter/Leertaste = weiter</div>
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
    if (btn('continue').disabled) return say('Gerade gibt es nichts zum Weiterschalten.');
    send('continue');
  };

  btn('abort').addEventListener('click', abort);
  btn('continue').addEventListener('click', cont);
  btn('removeBots').addEventListener('click', () => send('removeBots'));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      abort();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show();
      cont();
    }
  });

  function update(s: GameState | null = getState()) {
    const phase = s?.phase ?? 'lobby';
    const sp = s?.mini?.kind === 'stillepost' ? s.mini.state : null;
    const waits =
      (phase === 'results' && !!s?.results) ||
      (phase === 'story' && !!s?.date?.card) ||
      (s?.mini?.kind === 'murder' && s.mini.state.sub === 'meeting') ||
      (!!sp && (sp.sub === 'reveal' || sp.sub === 'vote' || sp.sub === 'tally'));
    btn('abort').disabled = phase === 'lobby';
    btn('abort').textContent = armedUntil > Date.now() ? 'Wirklich abbrechen?' : 'Spiel abbrechen';
    btn('abort').classList.toggle('armed', armedUntil > Date.now());
    btn('continue').disabled = !waits;
    btn('removeBots').disabled = phase !== 'lobby' || !s?.botCount;
  }
  bus.on('state', (s: GameState) => update(s));
  update();
  show();
}
