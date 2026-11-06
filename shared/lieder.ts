/** Guess the Song (à la SongPop, intern „lieder“) – Zeiten, Punkte, Genres und Rundenplan */

export const LIEDER = {
  /** Genres wählen (wer nicht fertig wird, bekommt zufällige dazu) */
  PICK_MS: 35_000,
  /** Übersicht „Wer hat was gewählt?“ */
  GENRES_MS: 6_000,
  /** Ansage der Runde – der TV lädt solange den Song vor; frühestens nach PREP_MIN_MS, spätestens nach PREP_MAX_MS weiter */
  PREP_MIN_MS: 2_600,
  PREP_MAX_MS: 8_000,
  /** Song läuft, alle tippen */
  PLAY_MS: 20_000,
  /** Auflösung (der Song läuft weiter) */
  REVEAL_MS: 7_000,
  /** Alle haben getippt → so lange noch weiterhören */
  ALL_DONE_MS: 1_500,
  /** Punkte: richtig + Tempo-Bonus (≤ 4 s +3, ≤ 8 s +2, ≤ 12 s +1) + Schnellster +1 */
  BASE: 2,
  FAST_STEPS_MS: [4_000, 8_000, 12_000],
  FIRST_BONUS: 1,
  /** So viele Lieder braucht ein Genre mindestens, damit man es wählen kann */
  MIN_SONGS: 3,
  /** Ausschnitt aus eigenen Dateien: Start zwischen diesen Sekunden (der TV kürzt bei kurzen Liedern) */
  FILE_START_S: [30, 60] as const,
};

/** Wie viele Genres wählt jeder? 1 gegen 1: 4 · zu dritt: 3 · 4–6: 2 · ab 7: 1 */
export function liederPerPlayer(n: number): number {
  if (n <= 2) return 4;
  if (n === 3) return 3;
  if (n <= 6) return 2;
  return 1;
}

/** Runden: jedes gewählte Genre kommt genau einmal dran (2 Spieler: 8, 3: 9, 4: 8, 5: 10, 6: 12, ab 7: einmal pro Spieler) */
export const liederRounds = (n: number) => Math.max(1, n) * liederPerPlayer(n);

/** Antwortmöglichkeiten: erstes Drittel 4, zweites 6, letztes 8 */
export function liederOptions(round: number, rounds: number): number {
  const f = (round - 1) / Math.max(1, rounds);
  return f < 1 / 3 ? 4 : f < 2 / 3 ? 6 : 8;
}

/** Punkte für eine richtige Antwort nach `ms` (ohne Schnellster-Bonus) */
export function liederPoints(ms: number): number {
  const fast = LIEDER.FAST_STEPS_MS.filter((t) => ms <= t).length;
  return LIEDER.BASE + fast;
}

export interface LiederGenre {
  id: string;
  name: string;
  icon: string;
}

/** Genre der eingebauten 8-Bit-Songs (und eigener Songs aus der Musik-Werkstatt) – geht immer, ganz ohne Lizenzfragen */
export const SOUNDTRACK_GENRE: LiederGenre = { id: 'soundtrack', name: 'LAN-Abfahrt-Soundtrack', icon: '🕹️' };

/** Genres des Katalogs (`server/liederkatalog.ts`); eigene Ordner unter `data/lieder/` kommen als weitere Genres dazu */
export const LIEDER_GENRES: LiederGenre[] = [
  SOUNDTRACK_GENRE,
  { id: 'oldies', name: '60er & 70er', icon: '🌼' },
  { id: '80er', name: '80er', icon: '🕺' },
  { id: '90er', name: '90er', icon: '📼' },
  { id: '2000er', name: '2000er', icon: '💿' },
  { id: '2010er', name: '2010er', icon: '📱' },
  { id: 'aktuell', name: 'Aktuelle Hits', icon: '🔥' },
  { id: 'deutsch', name: 'Deutschpop', icon: '🇩🇪' },
  { id: 'schlager', name: 'Schlager & Malle', icon: '🍻' },
  { id: 'rock', name: 'Rock', icon: '🎸' },
  { id: 'hiphop', name: 'Hip-Hop & R&B', icon: '🎤' },
  { id: 'deutschrap', name: 'Deutschrap', icon: '🧢' },
  { id: 'dance', name: 'Dance & Elektro', icon: '🎧' },
  { id: 'film', name: 'Film & Serie', icon: '🎬' },
  { id: 'balladen', name: 'Balladen', icon: '💔' },
];

/** Vergleichsform für Titel/Interpreten: klein, ohne Akzente, Klammern, „feat.“ und Satzzeichen */
export function liederNorm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Genre-ID aus einem Ordnernamen („Meine Lieblinge“ → „meine-lieblinge“) */
export function liederGenreId(name: string): string {
  return (
    liederNorm(name)
      .replace(/\s+/g, '-')
      .slice(0, 32) || 'eigene'
  );
}

/** Farben der Antwortfelder (Handy und TV gleich, damit man auch auf den TV schauen kann) */
export const LIEDER_COLORS = ['#c0392b', '#2f6fd0', '#2f8f3a', '#d08a1c', '#a3307a', '#1f8f99', '#6a43b8', '#8a5a2b'];
