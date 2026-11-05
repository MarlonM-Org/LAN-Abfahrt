/** Gemeinsame Texte rund um Offline-/Entfernt-Anzeige (Handy + TV). */

/** Bot-Stärke: „normal“ spielt mit menschlicher Reaktionszeit und kleinen Fehlern, „profi“ reagiert sofort und exakt */
export type BotSkill = 'leicht' | 'normal' | 'profi';
export const BOT_SKILLS: BotSkill[] = ['leicht', 'normal', 'profi'];
export const BOT_SKILL_LABEL: Record<BotSkill, string> = { leicht: 'Leicht', normal: 'Normal', profi: 'Profi' };
export const asBotSkill = (v: unknown): BotSkill => (BOT_SKILLS.includes(v as BotSkill) ? (v as BotSkill) : 'normal');

/** „offline seit 2 min“ */
export function offlineLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'offline seit eben';
  const m = Math.floor(s / 60);
  if (m < 60) return `offline seit ${m} min`;
  return `offline seit ${Math.floor(m / 60)} h`;
}

/** „Bens“, „Max’“, „Bot Lenas“ – Genitiv für Knopftexte wie „Bens Zug überspringen“ */
export function possessive(name: string): string {
  const n = name.trim();
  return /(?:[sßxz]|ce)$/i.test(n) ? `${n}’` : `${n}s`;
}
