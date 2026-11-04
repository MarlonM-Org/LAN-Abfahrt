import type { MiniKind } from './types';

/**
 * Date-Night-Versionen. Texte frei anpassbar!
 * Platzhalter: {A} = Spieler 1 (VIP), {B} = Spieler 2.
 */
export interface DateChapterDef {
  kind: MiniKind;
  title: string;
  story: string;
}

export interface DateVersionDef {
  id: string;
  title: string;
  subtitle: string;
  intro: string;
  outro: string;
  chapters: DateChapterDef[];
}

export const DATE_VERSIONS: DateVersionDef[] = [
  {
    id: 'erstes-date',
    title: 'Unser erstes Date',
    subtitle: 'Am Rhein, unter der Brücke',
    intro:
      'Ein warmer Abend am Rhein.\n{A} und {B} treffen sich zum ersten Mal.\nEin bisschen nervös – aber neugierig.',
    outro:
      'Unter der Brücke, auf den warmen Steinen,\nmit Sriracha-Mayo und Sternen über dem Rhein ...\n\n... so hat alles angefangen.',
    chapters: [
      {
        kind: 'descent',
        title: 'Der Abstieg',
        story: 'Unter der Brücke geht es einen steinigen Abhang hinunter zum Wasser.\nSpringt über Steine, Flaschen und Tauben – und kommt heil unten an!',
      },
      {
        kind: 'rhythm',
        title: 'Das erste Gespräch',
        story: 'Ihr sitzt auf den Steinen, schaut aufs Wasser und redet.\nBleibt im Takt des Gesprächs – dann springt der Funke über.',
      },
      {
        kind: 'wrap',
        title: 'Wraps mit Sriracha-Mayo',
        story: 'Hunger! Jeder baut dem anderen einen Wrap.\nGreift die Zutaten in der richtigen Reihenfolge vom Rad.',
      },
      {
        kind: 'stars',
        title: 'Tanz unter den Sternen',
        story: 'Die Stadt wird leise, ihr tanzt am Ufer.\nÜber euch leuchten die Sterne – verbindet sie zu Sternbildern.',
      },
    ],
  },
];

/** Platzhalter für kommende Versionen (werden im Menü ausgegraut angezeigt) */
export const DATE_COMING_SOON = ['Date Nr. 2', 'Jahrestag'];

export function fillNames(text: string, a: string, b: string) {
  return text.replaceAll('{A}', a).replaceAll('{B}', b);
}

/** Herzen pro Kapitel (max.) */
export const HEARTS_PER_CHAPTER = 10;

export function heartsRating(total: number, max: number): string {
  const r = total / Math.max(1, max);
  if (r >= 0.85) return 'Seelenverwandte! Das schreit nach einem zweiten Date.';
  if (r >= 0.65) return 'Da hat es ordentlich gefunkt!';
  if (r >= 0.4) return 'Süß und ein bisschen chaotisch – genau richtig.';
  return 'Holprig ... aber hey, ihr seid ja trotzdem zusammen!';
}
