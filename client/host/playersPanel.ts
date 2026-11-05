/**
 * TV/Laptop: Panel „Spieler“ (Knopf oben links oder Taste P).
 * Zeigt alle Spieler mit Online/Offline-Status und erlaubt, einzelne oder alle zu entfernen.
 * Eigenständiges DOM (über dem Phaser-Canvas) – der Server nimmt die Befehle nur von
 * Loopback-Verbindungen an (TV-Ansicht direkt am Laptop über http://localhost:…/tv.html).
 */
import type { Socket } from 'socket.io-client';
import type { GameState, KickResponse, PlayerPublic } from '../../shared/types';
import { offlineLabel } from '../../shared/players';
import { bus, getState, metaReceivedAt } from './store';
import { isMusicMenuOpen } from './musicMenu';

const CSS = `
#pl-toggle { position: fixed; left: 2vh; top: 2vh; z-index: 20; padding: 0.8vh 1.2vh; font: 1.2vh 'Press Start 2P', monospace; color: #3d2414; background: #f7e4b5; border: 0.4vh solid #8d5629; box-shadow: 0 0 0 0.25vh #2d1b12; cursor: pointer; opacity: 0.35; }
#pl-toggle:hover, #pl-toggle.warn { opacity: 1; }
#pl-toggle.warn { color: #a8342a; }
#pl-panel { position: fixed; left: 2vh; top: 7vh; z-index: 21; width: min(62vh, 90vw); max-height: 86vh; overflow: auto; padding: 2vh; font: 1.4vh 'Press Start 2P', monospace; line-height: 1.6; color: #3d2414; background: #f7e4b5; border: 0.5vh solid #8d5629; box-shadow: 0 0 0 0.3vh #2d1b12, 0 1vh 0 rgba(0,0,0,0.3); }
#pl-panel[hidden] { display: none; }
#pl-panel h3 { margin: 0 0 1.4vh; font-size: 1.8vh; color: #a8342a; display: flex; justify-content: space-between; align-items: center; }
#pl-panel .row { display: flex; align-items: center; gap: 1.2vh; padding: 0.8vh 1vh; margin-bottom: 0.8vh; background: #fff6dc; border: 0.3vh solid #e6c88a; }
#pl-panel .row.off { opacity: 0.6; }
#pl-panel .dot { width: 1.2vh; height: 1.2vh; flex: none; background: #46b04a; box-shadow: 0 0 0 0.2vh #2d1b12; }
#pl-panel .row.off .dot { background: #a8342a; }
#pl-panel .who { flex: 1; min-width: 0; }
#pl-panel .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#pl-panel .tag { font-size: 1vh; color: #a8342a; }
#pl-panel .st { font-size: 1.1vh; color: #7a5a3a; }
#pl-panel .row.off .st { color: #a8342a; }
#pl-panel button { font: 1.1vh 'Press Start 2P', monospace; padding: 0.9vh 1.1vh; color: #fff4d6; text-shadow: 0.15vh 0.15vh 0 #5e3518; background: #b8783f; border: 0.3vh solid #5e3518; cursor: pointer; white-space: nowrap; }
#pl-panel button.sure { background: #c0392b; }
#pl-panel button:disabled { opacity: 0.4; cursor: default; }
#pl-panel .foot { display: flex; justify-content: space-between; align-items: center; gap: 1vh; margin-top: 1.4vh; }
#pl-panel .msg { font-size: 1.1vh; color: #a8342a; min-height: 1.4vh; margin-top: 1vh; }
#pl-panel .hint { font-size: 1vh; color: #7a5a3a; }
`;

export function initPlayersPanel(socket: Socket) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const toggle = document.createElement('button');
  toggle.id = 'pl-toggle';
  const panel = document.createElement('div');
  panel.id = 'pl-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <h3><span>Spieler</span><span class="hint">P = schließen</span></h3>
    <div class="list"></div>
    <div class="foot"><button data-act="all">Alle entfernen</button><span class="hint">Entfernte können per QR-Code neu beitreten.</span></div>
    <div class="msg"></div>`;
  document.body.append(toggle, panel);
  const list = panel.querySelector('.list') as HTMLElement;
  const msg = panel.querySelector('.msg') as HTMLElement;
  const allBtn = panel.querySelector('[data-act=all]') as HTMLButtonElement;

  let local = true;
  let key = '';

  // Der Server sagt nach 'host:hello', ob diese TV-Seite am Laptop selbst läuft (Loopback)
  socket.on('host:info', (r: { local?: boolean }) => ((local = !!r?.local), (key = ''), render()));

  const say = (text: string) => (msg.textContent = text);
  const result = (ok: string) => (r: KickResponse) => say(r?.ok ? ok.replace('#', String(r.removed ?? 0)) : (r?.error ?? 'Hat nicht geklappt.'));

  /** Zweistufig bestätigen statt confirm() (blockiert sonst das Spiel auf dem TV) */
  const confirmBtn = (b: HTMLButtonElement, label: string, run: () => void) => {
    let armed = 0;
    b.textContent = label;
    b.addEventListener('click', () => {
      if (performance.now() - armed < 3000) {
        run();
        armed = 0;
        b.textContent = label;
        b.classList.remove('sure');
        return;
      }
      armed = performance.now();
      b.textContent = 'Sicher?';
      b.classList.add('sure');
      setTimeout(() => {
        if (armed && performance.now() - armed >= 3000) ((b.textContent = label), b.classList.remove('sure'));
      }, 3100);
    });
  };
  confirmBtn(allBtn, 'Alle entfernen', () => socket.emit('host:kickAll', result('# Spieler entfernt.')));

  const visible = (s: GameState | null): PlayerPublic[] => s?.players.filter((p) => !p.removed) ?? [];
  const offMs = (p: PlayerPublic) => (p.offlineMs ?? 0) + (performance.now() - metaReceivedAt());
  const status = (p: PlayerPublic) => (p.connected ? 'online' : offlineLabel(offMs(p)));

  function render() {
    const players = visible(getState());
    const offline = players.filter((p) => !p.connected).length;
    toggle.textContent = offline ? `Spieler · ${offline} offline (P)` : 'Spieler (P)';
    toggle.classList.toggle('warn', offline > 0);
    if (panel.hidden) return;
    const k = `${local}|${players.map((p) => `${p.id}${p.name}${p.connected}${p.isVip}${p.bot}${p.connected ? '' : status(p)}`).join('|')}`;
    if (k === key) return;
    key = k;
    list.innerHTML = '';
    if (!players.length) list.innerHTML = '<p class="hint">Noch niemand da – QR-Code scannen!</p>';
    for (const p of players) {
      const row = document.createElement('div');
      row.className = `row${p.connected ? '' : ' off'}`;
      row.innerHTML = `<span class="dot"></span><div class="who"><div class="name"></div><div class="st"></div></div>`;
      (row.querySelector('.name') as HTMLElement).textContent = p.name;
      if (p.isVip || p.bot) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = ` ${[p.isVip ? 'VIP' : '', p.bot ? 'Bot' : ''].filter(Boolean).join(' · ')}`;
        row.querySelector('.name')!.append(tag);
      }
      (row.querySelector('.st') as HTMLElement).textContent = status(p);
      const b = document.createElement('button');
      b.disabled = !local;
      confirmBtn(b, 'Entfernen', () => socket.emit('host:kick', p.id, result(`${p.name} wurde entfernt.`)));
      row.append(b);
      list.append(row);
    }
    allBtn.disabled = !local || !players.length;
    if (!local) say('Spieler entfernen geht nur direkt am Laptop (http://localhost:…/tv.html).');
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    key = '';
    if (open) say('');
    render();
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || isMusicMenuOpen()) return;
    setOpen(panel.hidden);
  });
  bus.on('state', () => render());
  setInterval(render, 1000);
  render();
}
