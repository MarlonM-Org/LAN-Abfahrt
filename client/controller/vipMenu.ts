/**
 * Kleines VIP-Menü während Zug-/Warte-Phasen: ein unauffälliger „⋯“-Reiter oben in der Mitte,
 * der ein kompaktes Blatt mit „… überspringen“ (und „Spiel abbrechen“) öffnet.
 *
 * Liegt außerhalb von #app (eigenes DOM, wie der Spieler-Knopf), damit der Spiel-Screen nie neu
 * gebaut werden muss (pickScreen-Regel) und Taps/Wischgesten im Spiel nicht verloren gehen.
 * Erscheint nur, wenn der Server `skippable` meldet – in Echtzeit-Spielen also nie.
 */
import type { SkipInfo } from '../../shared/types';
import { el, me, q, socket, store, toast } from './core';

export function initVipMenu() {
  const tab = el(`<button class="vm-tab hidden" aria-label="VIP-Menü">⋯</button>`).firstElementChild as HTMLButtonElement;
  const sheet = el(`
    <div class="vm-sheet hidden">
      <div class="vm-panel">
        <div class="vm-title">VIP-Menü</div>
        <button class="vm-skip" data-act="skip"></button>
        <button class="secondary small vm-abort" data-act="abort">Spiel abbrechen</button>
        <button class="secondary small" data-act="close">Schließen</button>
      </div>
    </div>
  `).firstElementChild as HTMLElement;
  document.body.append(tab, sheet);
  const skipBtn = q<HTMLButtonElement>(sheet, '[data-act=skip]');
  let open = false;
  let info: SkipInfo | null = null;

  const setOpen = (v: boolean) => {
    open = v;
    update();
  };
  tab.addEventListener('click', () => setOpen(!open));
  // Tipp neben das Blatt schließt es
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) setOpen(false);
  });
  q(sheet, '[data-act=close]').addEventListener('click', () => setOpen(false));
  q(sheet, '[data-act=abort]').addEventListener('click', () => {
    if (confirm('Spiel wirklich abbrechen und zurück in die Lobby?')) {
      socket.emit('vip:lobby');
      setOpen(false);
    }
  });
  skipBtn.addEventListener('click', () => {
    if (!info) return setOpen(false);
    skipBtn.disabled = true;
    socket.timeout(3000).emit('vip:skip', (err: unknown, r?: { ok: boolean; msg?: string }) => {
      skipBtn.disabled = false;
      if (err) toast('Server antwortet nicht.');
      else if (!r?.ok) toast(r?.msg ?? 'Hat nicht geklappt.');
      else toast(r.msg ?? 'Übersprungen.');
    });
    setOpen(false);
  });

  function update() {
    const s = store.state;
    const vip = !!me()?.isVip;
    const active = !!s && store.joined && !store.editing && vip && (s.phase === 'mini' || s.phase === 'board');
    info = active ? (s?.skippable ?? null) : null;
    // Zuschauer (später zurückgekommen) bekommen das Menü trotzdem – der VIP leitet das Spiel
    tab.classList.toggle('hidden', !info);
    if (!info) open = false;
    sheet.classList.toggle('hidden', !open);
    tab.classList.toggle('open', open);
    if (info) skipBtn.textContent = info.label;
  }

  socket.on('state', update);
  setInterval(update, 1000);
  update();
}
