/**
 * Geräteabhängige Größe der Quer-Layouts.
 *
 * Maßstab ist das iPhone 12 Pro: Safari quer ≈ 844 × 340 px, abzüglich Notch/Home-Balken bleiben ≈ 750 × 320
 * (das gemeinsame Querlayout `.lx` ist auf 300 px Höhe ausgelegt). Auf kleineren Handys oder wenn ein Spiel
 * in der Infospalte viel Text/Knöpfe zeigt, wird diese Spalte per `zoom` verkleinert, bis alles sichtbar ist –
 * statt dass unten Knöpfe abgeschnitten werden. Größere Geräte bleiben unverändert (kein Hochskalieren).
 *
 * Nur die Mittelspalte wird gezoomt: Stick-Zone und Knopf-Spalte rechnen mit Bildschirmkoordinaten.
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

export function fitScreen(reset = true) {
  for (const c of document.querySelectorAll<HTMLElement>('.lx-mid')) fitCell(c, reset);
}

let queued = 0;
let queuedReset = false;
/**
 * Im nächsten Frame anpassen. `reset` (neuer Screen, Drehung, Größenänderung) misst von vorn;
 * sonst wird nur weiter verkleinert, falls neue Inhalte nicht mehr passen (kein Flackern bei Updates).
 */
export function queueFit(reset = true) {
  queuedReset ||= reset;
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    const r = queuedReset;
    queuedReset = false;
    fitScreen(r);
  });
}

window.addEventListener('resize', () => queueFit());
window.addEventListener('orientationchange', () => queueFit());
