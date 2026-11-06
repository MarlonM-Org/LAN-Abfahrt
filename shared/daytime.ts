/**
 * Tageszeit als Wert 0…1 (0 = Morgen, 0.35 = Mittag, 0.8 = Sonnenuntergang, 1 = Nacht) – raumweit in `GameMeta.timeOfDay`.
 * Im Party-Modus kommt er vom Spielbrett (Runde 1 morgens … Finale nachts), sonst von der echten Uhrzeit.
 */

/** Stützpunkte: Stunde → Tageszeit (dazwischen linear; 5 → 6 Uhr ist die Dämmerung) */
const CLOCK_KEYS: [number, number][] = [
  [0, 1],
  [5, 1],
  [6, 0],
  [9, 0.1],
  [13, 0.35],
  [17, 0.5],
  [20, 0.8],
  [22, 1],
  [24, 1],
];

/** Tageszeit aus der echten Uhrzeit (lokale Zeit des Servers) */
export function clockTimeOfDay(date = new Date()): number {
  const h = date.getHours() + date.getMinutes() / 60;
  let i = 0;
  while (i < CLOCK_KEYS.length - 2 && h >= CLOCK_KEYS[i + 1][0]) i++;
  const [h0, v0] = CLOCK_KEYS[i];
  const [h1, v1] = CLOCK_KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  return Math.round((v0 + (v1 - v0) * k) * 100) / 100;
}
