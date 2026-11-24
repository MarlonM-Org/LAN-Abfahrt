/**
 * Infospalte des gemeinsamen Querlayouts `.lx` passt sich dem Handy an.
 *
 * `.lx` ist auf 300 px Höhe ausgelegt. Auf kleineren Handys (oder wenn ein Spiel in der Mittelspalte viel Text/Knöpfe
 * zeigt) würde `.lx-mid` unten abgeschnitten (`overflow: hidden`) – stattdessen wird die Spalte per `zoom` verkleinert,
 * bis alles sichtbar ist (höchstens auf 62 %). Größere Geräte bleiben unverändert (kein Hochskalieren).
 * Nur die Mittelspalte: Stick-Zone und Knopf-Spalte rechnen mit Bildschirmkoordinaten.
 *
 * Läuft von selbst (beobachtet `#app`), Screens müssen nichts tun. Eingebunden über orientation.ts.
 */
const MIN_ZOOM = 0.62;

function fitCell(c: HTMLElement, reset: boolean) {
  if (reset) c.style.removeProperty('zoom');
  for (let i = 0; i < 4; i++) {
    const h = c.clientHeight;
    const w = c.clientWidth;
    const needH = c.scrollHeight;
    const needW = c.scrollWidth;
    if (!h || !w || (needH <= h + 2 && needW <= w + 2)) return;
    const cur = Number(c.style.getPropertyValue('zoom') || 1);
    const next = Math.max(MIN_ZOOM, Math.floor(cur * Math.min(h / needH, w / needW) * 100) / 100);
    if (next >= cur) return;
    c.style.setProperty('zoom', String(next));
  }
}

let queued = 0;
let queuedReset = false;
/** Zuletzt angepasste Spalten – ein neuer Screen (neue Elemente) wird von vorn gemessen */
let seen = new WeakSet<HTMLElement>();

/**
 * Im nächsten Frame anpassen. `reset` (Drehung, Größenänderung) misst von vorn; sonst werden nur neue Spalten
 * von vorn gemessen und bestehende höchstens weiter verkleinert (kein Flackern bei Wert-Updates).
 */
function queueFit(reset: boolean) {
  queuedReset ||= reset;
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    const all = queuedReset;
    queuedReset = false;
    if (all) seen = new WeakSet();
    for (const c of document.querySelectorAll<HTMLElement>('.lx-mid')) {
      fitCell(c, !seen.has(c));
      seen.add(c);
    }
  });
}

const app = document.getElementById('app');
if (app) new MutationObserver(() => queueFit(false)).observe(app, { childList: true, subtree: true, characterData: true, attributeFilter: ['class'] });
// Pseudo-Quer (html.pseudo-land) dreht die Anzeige ohne resize-Ereignis
new MutationObserver(() => queueFit(true)).observe(document.documentElement, { attributeFilter: ['class'] });
window.addEventListener('resize', () => queueFit(true));
window.addEventListener('orientationchange', () => queueFit(true));
