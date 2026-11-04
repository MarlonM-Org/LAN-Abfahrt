import type { DateRunState, MiniKind } from '../shared/types';
import { type DateVersionDef, HEARTS_PER_CHAPTER, fillNames, heartsRating } from '../shared/dates';

/**
 * Ablauf einer Date Night: Intro → (Kapitel-Karte → Minispiel → Ergebnis) × n → Outro.
 */
export class DateRun {
  state: DateRunState;
  /** Steht nach der aktuellen Karte ein Minispiel an? */
  private pending: MiniKind | null = null;

  constructor(
    private def: DateVersionDef,
    couple: [string, string],
    private names: [string, string],
  ) {
    this.state = {
      version: def.id,
      versionTitle: def.title,
      chapter: -1,
      chapters: def.chapters.map((c) => ({ title: c.title, kind: c.kind })),
      hearts: def.chapters.map(() => null),
      totalHearts: 0,
      maxHearts: def.chapters.length * HEARTS_PER_CHAPTER,
      card: { kicker: 'Date Night', title: def.title, text: this.fill(def.intro), final: false },
      couple,
    };
  }

  private fill(t: string) {
    return fillNames(t, this.names[0], this.names[1]);
  }

  /** "Weiter" auf einer Story-Karte. Gibt das zu startende Minispiel zurück (oder null). */
  next(): MiniKind | 'end' | null {
    const s = this.state;
    if (s.card?.final) return 'end';
    if (this.pending) {
      const k = this.pending;
      this.pending = null;
      s.card = null;
      return k;
    }
    this.showChapter(s.chapter + 1);
    return null;
  }

  /** Nach dem Ergebnis eines Kapitels */
  recordHearts(hearts: number) {
    const s = this.state;
    if (s.chapter >= 0) s.hearts[s.chapter] = hearts;
    s.totalHearts = s.hearts.reduce<number>((a, h) => a + (h ?? 0), 0);
    this.showChapter(s.chapter + 1);
  }

  private showChapter(i: number) {
    const s = this.state;
    s.chapter = i;
    if (i >= this.def.chapters.length) {
      s.card = {
        kicker: `${s.totalHearts} / ${s.maxHearts} Herzen`,
        title: 'Ende des ersten Dates',
        text: `${this.fill(this.def.outro)}\n\n${heartsRating(s.totalHearts, s.maxHearts)}`,
        final: true,
      };
      return;
    }
    const ch = this.def.chapters[i];
    s.card = { kicker: `Kapitel ${i + 1} von ${this.def.chapters.length}`, title: ch.title, text: this.fill(ch.story), final: false };
    this.pending = ch.kind;
  }
}
