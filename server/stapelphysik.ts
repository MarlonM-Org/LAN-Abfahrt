import Matter from 'matter-js';

const { Body, Composite, Engine } = Matter;

/**
 * Gemeinsame Physik der Stapelspiele (Wackelturm, Kofferpacken): Teile sind Kompound-Körper aus quadratischen Zellen.
 *
 * Drei Fehlerquellen machten liegende Stapel unruhig („unten verschieben sich die Tetris-Blöcke komisch“, Marlon 24.11.):
 * 1. Drehträgheit: Matter summiert bei Kompound-Körpern nur die Trägheit der Einzelzellen um deren eigene Mitte –
 *    der Steiner-Anteil (Masse × Abstand² zum gemeinsamen Schwerpunkt) fehlt. Ein hochkant stehendes Surfbrett
 *    hatte so nur ein Drittel der Trägheit, die Matter für dieselbe Form als Einzelkörper rechnet, schaukelte sich
 *    am Boden auf und flog weg. `stapelTraegheit` rechnet sie richtig (in Matters Maßstab, Faktor 4 wie Einzelkörper).
 * 2. Aufprall: Landet ein Teil schnell auf dem Stapel, drückt es die Teile darunter in einem einzigen 60-Hz-Schritt
 *    zu tief ineinander – die Auflösung schiebt sie dann seitlich weg. Zwei Unterschritte pro Frame (120 Hz) halten das klein.
 * 3. Einschlafen beim Kippen: Matter schickt Körper schlafen, wenn Geschwindigkeit² + Winkelgeschwindigkeit² klein ist –
 *    die Winkelgeschwindigkeit (rad pro Schritt) ist aber fast immer winzig. Ein Teil, das langsam über eine Kante
 *    kippt, schlief deshalb schräg in der Luft ein. `stapelSchritt` hält Teile wach, solange ihre Außenkante sich merklich bewegt.
 * Messung: `npm run test:physik` – sauber abgestützte Stapel dürfen sich nicht bewegen, auch nicht bei hartem Aufprall.
 * Vorher (24.11.): im Kofferraum verrutschten 75 von 597 Teilen (mit Aufprall 363), im Wackelturm mit ▼ 112 von 289 – jetzt 0.
 */

/** Physik-Unterschritte pro 60-Hz-Frame */
export const SUBSTEPS = 2;

/** Zusätzlicher Faktor auf die richtige Trägheit: Teile kippen etwas gemütlicher, der Stapel wackelt, stürzt aber nicht bei jedem Hauch ein */
export const TRAEGHEIT_FAKTOR = 1.5;

/** Drehträgheit eines Kompound-Körpers inkl. Steiner-Anteil – so, wie Matter sie für einen Einzelkörper derselben Form rechnet */
export function stapelTraegheit(body: Matter.Body): number {
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  let inertia = 0;
  let mass = 0;
  for (const p of parts) {
    const dx = p.position.x - body.position.x;
    const dy = p.position.y - body.position.y;
    // p.inertia enthält schon Matters Faktor 4 (Body._inertiaScale) – der Steiner-Anteil bekommt denselben
    inertia += p.inertia + 4 * p.mass * (dx * dx + dy * dy);
    mass += p.mass;
  }
  // Body.setDensity ändert nur die Gesamtmasse, nicht die der Zellen → auf die echte Masse umrechnen
  return mass > 0 ? inertia * (body.mass / mass) : body.inertia;
}

/** Trägheit setzen (nach Body.setDensity aufrufen) */
export function stapelTraegheitSetzen(body: Matter.Body, faktor = TRAEGHEIT_FAKTOR) {
  Body.setInertia(body, stapelTraegheit(body) * faktor);
}

/** Ab dieser Geschwindigkeit der Außenkante (Einheiten pro 60-Hz-Frame) gilt ein Teil als „dreht sich noch“ */
const DREH_WACH = 0.12;

/** Ein 60-Hz-Frame Physik in SUBSTEPS Unterschritten */
export function stapelSchritt(engine: Matter.Engine, ms: number) {
  const bodies = Composite.allBodies(engine.world);
  for (let i = 0; i < SUBSTEPS; i++) {
    // Wer sich noch dreht (kippt), darf nicht einschlafen – sonst hängt er schräg über der Kante
    for (const b of bodies) {
      if (b.isStatic || b.isSleeping) continue;
      const r = Math.hypot(b.bounds.max.x - b.bounds.min.x, b.bounds.max.y - b.bounds.min.y) / 2;
      // sleepCounter: Matters Zähler bis zum Einschlafen (fehlt in den Typen)
      if (Body.getAngularSpeed(b) * r > DREH_WACH) (b as Matter.Body & { sleepCounter: number }).sleepCounter = 0;
    }
    Engine.update(engine, ms / SUBSTEPS);
  }
}

/** Liegt der Körper ruhig? (Geschwindigkeit pro 60-Hz-Frame – unabhängig von den Unterschritten) */
export function ruhig(b: Matter.Body, speed = 0.25, angular = 0.01) {
  return b.isSleeping || b.isStatic || (Body.getSpeed(b) < speed && Body.getAngularSpeed(b) < angular);
}
