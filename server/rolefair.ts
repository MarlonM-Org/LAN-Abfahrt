/**
 * Faire Wertung für asymmetrische Rollen-Spiele (Urlaubs-Fangen, Geisterjagd), wenn nicht jeder
 * die Sonderrolle (Animateur/Geist) bekommt: Punkte werden nur innerhalb der Rolle verglichen.
 *
 * - Jäger-Punkte werden auf gleich viele Runden hochgerechnet (wer Sonderrolle war, hat eine Jäger-Runde weniger).
 * - Sonderrollen-Punkte zählen nur als Abweichung vom Schnitt aller, die die Rolle hatten
 *   (besser als die anderen Animateure = Plus, schlechter = Minus). In Summe ist das 0, also kein Vorteil fürs Losglück.
 *
 * Hatte jeder die Sonderrolle, bleibt es bei der einfachen Summe.
 */
export function fairRoleScores(
  ids: string[],
  rounds: number,
  total: Record<string, number>,
  rolePts: Record<string, number>,
  huntedRounds: Record<string, number>,
  specials: string[],
): Record<string, number> {
  const special = new Set(specials);
  if (ids.every((id) => special.has(id)) || !specials.length) return { ...total };
  const avgRole = specials.reduce((a, id) => a + (rolePts[id] ?? 0), 0) / specials.length;
  const out: Record<string, number> = {};
  for (const id of ids) {
    const hunt = (total[id] ?? 0) - (rolePts[id] ?? 0);
    const hr = huntedRounds[id] ?? 0;
    const huntNorm = hr > 0 ? (hunt / hr) * rounds : 0;
    const roleDelta = special.has(id) ? (rolePts[id] ?? 0) - avgRole : 0;
    out[id] = Math.round((huntNorm + roleDelta) * 10) / 10;
  }
  return out;
}
