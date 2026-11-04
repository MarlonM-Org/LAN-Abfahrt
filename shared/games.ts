import type { FieldType, MiniKind, Point } from './types';

export const MINI_INFO: Record<MiniKind, { title: string; tagline: string; minPlayers: number }> = {
  flunky: { title: 'Flunkyball', tagline: 'Werfen, trinken, laufen!', minPlayers: 2 },
  wwe: { title: 'Wer würde eher ...?', tagline: 'Stimmt ab – wer ist gemeint?', minPlayers: 2 },
  sprint: { title: 'Liegestuhl-Sprint', tagline: 'Handtuch drauf, sobald die Sonne aufgeht!', minPlayers: 2 },
  murder: { title: 'Mord im Ferienhaus', tagline: 'Einer von euch ist nicht zum Entspannen hier ...', minPlayers: 4 },
};

// ------------------------------------------------------------------ Spielbrett

export const BOARD_SIZE = 24;
export const COCKTAIL_PRICE = 10;
export const PARTY_ROUND_OPTIONS = [3, 5, 8];

/** Feldpositionen: Rundweg am Rand der 480 × 270-Welt */
export const FIELD_POS: Point[] = (() => {
  const pts: Point[] = [];
  const left = 36, right = 444, top = 80, bottom = 252;
  const stepX = (right - left) / 8;
  const stepY = (bottom - top) / 4;
  for (let i = 0; i <= 8; i++) pts.push({ x: left + i * stepX, y: top });
  for (let i = 1; i <= 3; i++) pts.push({ x: right, y: top + i * stepY });
  for (let i = 0; i <= 8; i++) pts.push({ x: right - i * stepX, y: bottom });
  for (let i = 1; i <= 3; i++) pts.push({ x: left, y: bottom - i * stepY });
  return pts;
})();

export const FIELD_TYPES: FieldType[] = Array.from({ length: BOARD_SIZE }, (_, i) => {
  if (i === 0) return 'start';
  if (i % 6 === 3) return 'event';
  if (i % 5 === 4) return 'red';
  return 'blue';
});

export const FIELD_COINS = { blue: 3, red: -3 };

/** Münzen nach Platzierung im Minispiel */
export const PLACE_COINS = [10, 6, 3, 1];

// ------------------------------------------------------------------ Mord im Ferienhaus

export const ROOMS = [
  { name: 'Küche', task: 'Abwaschen' },
  { name: 'Wohnzimmer', task: 'Sofa aufräumen' },
  { name: 'Bad', task: 'Klo putzen' },
  { name: 'Schlafzimmer', task: 'Betten machen' },
  { name: 'Pool', task: 'Laub fischen' },
  { name: 'Garten', task: 'Grill sauber machen' },
];

export const MURDER = {
  ROLES_MS: 8000,
  TASKS_MS: 60000,
  MEETING_MS: 60000,
  VOTE_MS: 30000,
  EJECT_MS: 6000,
  TASK_TAPS: 15,
  TASKS_PER_PLAYER: 9,
};

// ------------------------------------------------------------------ Wer würde eher …?

export const WWE = { ROUNDS: 5, QUESTION_MS: 20000, REVEAL_MS: 7000 };

export const DEFAULT_QUESTIONS = [
  '... am Pool einschlafen und Sonnenbrand bekommen?',
  '... den Haustürschlüssel verlieren?',
  '... als Erstes den Kühlschrank leer essen?',
  '... sich im Urlaubsort verlaufen?',
  '... um 4 Uhr morgens noch tanzen?',
  '... das Frühstück verschlafen?',
  '... mit Einheimischen Freundschaft schließen?',
  '... ein komplett unnötiges Souvenir kaufen?',
  '... den Flug verpassen?',
  '... beim Flunkyball schummeln?',
  '... heimlich die letzte Pizza essen?',
  '... im Urlaub trotzdem Mails checken?',
  '... die meisten Fotos machen?',
  '... spontan auswandern?',
  '... beim Karaoke das Mikro nicht mehr hergeben?',
  '... am lautesten schnarchen?',
  '... als Erstes ins kalte Wasser springen?',
  '... den Grill anzünden – mit zu viel Spiritus?',
  '... die Gruppen-Kasse vergessen?',
  '... im Ferienhaus etwas kaputt machen?',
];

// ------------------------------------------------------------------ Liegestuhl-Sprint

export const SPRINT = { ROUNDS: 3, MIN_WAIT_MS: 2000, MAX_WAIT_MS: 6000, GO_MS: 3000, REVEAL_MS: 4000 };
export const SPRINT_POINTS = [3, 2, 1];
