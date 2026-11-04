import type { FieldType, MiniKind, Point, TttItemKind, TttRole, TttShopItem } from './types';

export const MINI_INFO: Record<MiniKind, { title: string; tagline: string; minPlayers: number }> = {
  flunky: { title: 'Flunkyball', tagline: 'Werfen, trinken, laufen!', minPlayers: 2 },
  wwe: { title: 'Wer würde eher ...?', tagline: 'Stimmt ab – wer ist gemeint?', minPlayers: 2 },
  sprint: { title: 'Liegestuhl-Sprint', tagline: 'Handtuch drauf, sobald die Sonne aufgeht!', minPlayers: 2 },
  murder: { title: 'Mord im Ferienhaus', tagline: 'Einer von euch ist nicht zum Entspannen hier ...', minPlayers: 4 },
  descent: { title: 'Der Abstieg', tagline: 'Den Abhang runter zum Rhein – springen!', minPlayers: 1 },
  rhythm: { title: 'Das erste Gespräch', tagline: 'Bleibt im Takt – dann funkt es!', minPlayers: 1 },
  wrap: { title: 'Wraps mit Sriracha-Mayo', tagline: 'Zutaten in der richtigen Reihenfolge greifen!', minPlayers: 1 },
  stars: { title: 'Tanz unter den Sternen', tagline: 'Verbindet die Sterne zu Sternbildern!', minPlayers: 1 },
  nhie: { title: 'Ich hab noch nie ...', tagline: 'Wer es schon getan hat, trinkt!', minPlayers: 2 },
  hilo: { title: 'Höher oder Tiefer', tagline: 'Falsch geraten? Schluck!', minPlayers: 2 },
  bomb: { title: 'Tick-Tack-Bumm', tagline: 'Begriff sagen, Bombe weitergeben!', minPlayers: 2 },
  sup: { title: 'SUP-Rennen', tagline: 'Zu zweit auf dem Board: einer links, einer rechts!', minPlayers: 1 },
  tidy: { title: 'Aufräumen!', tagline: 'Schiebt das Chaos in euren Korb – Joystick am Handy!', minPlayers: 1 },
  ttt: { title: 'Verräter im Ferienhaus', tagline: 'Poolnudeln raus – wer spielt falsch?', minPlayers: 4 },
};

/** Minispiele im Trinkspiel-Modus */
export const DRINK_KINDS: MiniKind[] = ['wwe', 'nhie', 'hilo', 'bomb'];

/** Minispiele, die im Party-Modus vorkommen */
export const PARTY_KINDS: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'murder', 'ttt'];
/** Versteckte-Rollen-Spiele: eines davon ist das Finale im Party-Modus */
export const FINALE_KINDS: MiniKind[] = ['murder', 'ttt'];
/** Minispiele, die auf dem Spielbrett zufällig drankommen (Finale: Mord oder Verräter) */
export const BOARD_KINDS: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy'];
/** Minispiele der Date Night */
export const DATE_KINDS: MiniKind[] = ['descent', 'rhythm', 'wrap', 'stars'];

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

// ------------------------------------------------------------------ Trinkspiel

export const NHIE = { ROUNDS: 6, QUESTION_MS: 20000, REVEAL_MS: 6000 };
export const HILO = { ROUNDS: 7, GUESS_MS: 12000, REVEAL_MS: 4000 };
export const BOMB = { ROUNDS: 3, MIN_FUSE_MS: 15000, MAX_FUSE_MS: 38000, BOOM_MS: 4500, SIPS: 3, MIN_HOLD_MS: 900 };

export const DEFAULT_NHIE = [
  '... einen Flug oder Zug verpasst.',
  '... im Urlaub einen heftigen Sonnenbrand bekommen.',
  '... beim Karaoke gesungen.',
  '... eine Nachricht an die falsche Person geschickt.',
  '... nachts heimlich den Kühlschrank geplündert.',
  '... auf einem Festival gezeltet.',
  '... eine komplette Staffel an einem Tag geschaut.',
  '... beim Flunkyball geschummelt.',
  '... mich selbst ausgesperrt.',
  '... einen Strafzettel bekommen.',
  '... auf einem Tisch getanzt.',
  '... im Kino eingeschlafen.',
  '... so getan, als hätte ich jemanden nicht gesehen.',
  '... ein Geschenk weiterverschenkt.',
  '... den Namen von jemandem mitten im Gespräch vergessen.',
  '... bei einer Hochzeit geweint.',
  '... einen Kater mit Pizza bekämpft.',
  '... mein Handy in die Toilette fallen lassen.',
  '... vergessen, wo ich geparkt habe.',
  '... einen Liebesbrief geschrieben.',
];

export const BOMB_CATEGORIES = [
  'Automarken', 'Biersorten', 'Länder in Europa', 'Pizza-Beläge', 'Fußballvereine', 'Dinge im Kühlschrank',
  'Städte in NRW', 'Tiere mit vier Beinen', 'Cocktails', 'Dinge am Strand', 'Berufe', 'Obst & Gemüse',
  'Marken von Turnschuhen', 'Dinge im Badezimmer', 'Urlaubsziele', 'Brettspiele',
];

export const CARD_LABELS: Record<number, string> = { 11: 'B', 12: 'D', 13: 'K', 14: 'A' };
export const cardLabel = (v: number) => CARD_LABELS[v] ?? String(v);

// ------------------------------------------------------------------ Controller-Spiele

export const SUP = {
  LENGTH: 1700,
  TOP: 46,
  BOTTOM: 252,
  STROKE: 16,
  TURN: 0.16,
  WOBBLE: 0.3,
  DRAG: 0.6,
  FALL_MS: 1800,
  TIME_MS: 80000,
  COUNTDOWN_MS: 3000,
  BOARD_R: 9,
  COLORS: [0xe0503f, 0x3f8fe0, 0x46b04a, 0xf2c33a],
};

export const TIDY = {
  SPEED: 78,
  DASH_SPEED: 150,
  DASH_MS: 450,
  DASH_COOLDOWN: 1800,
  PLAYER_R: 7,
  ITEM_R: 5,
  ITEMS: 26,
  TIME_MS: 60000,
  COUNTDOWN_MS: 3000,
  AREA: { x: 22, y: 44, w: 436, h: 210 },
  ITEM_TYPES: ['shirt', 'sock', 'can', 'pizza', 'bottle', 'book', 'towel', 'cap'],
};

// ------------------------------------------------------------------ Verräter im Ferienhaus

export const TTT = {
  ROLES_MS: 7000,
  ROUND_MS: 180000,
  ROUND_END_MS: 9000,
  SPEED: 62,
  PLAYER_R: 5,
  HP: 3,
  NOODLE_RANGE: 20,
  NOODLE_COOLDOWN: 700,
  PISTOL_RANGE: 140,
  PISTOL_AMMO: 4,
  PISTOL_COOLDOWN: 550,
  COCONUT_RANGE: 100,
  COCONUT_DAMAGE: 2,
  USE_RANGE: 16,
  STUN_MS: 1800,
  CLOAK_MS: 9000,
  TRACKER_MS: 5000,
  TRAP_R: 8,
  /** Punkte */
  WIN_POINTS: 3,
  SURVIVE_POINTS: 1,
  GOOD_KO: 1,
  TEAM_KO: -2,
};

export const TTT_SHOP: Record<TttShopItem, { title: string; cost: number; text: string }> = {
  trap: { title: 'Bananenschale', cost: 1, text: 'Unsichtbare Falle in eine Tür legen: −1 Herz und ausgerutscht.' },
  cloak: { title: 'Tarnumhang', cost: 1, text: 'Ein paar Sekunden unsichtbar auf dem Fernseher.' },
  radio: { title: 'Fake-Funkspruch', cost: 1, text: 'Im Namen eines anderen etwas „gesehen“ haben ...' },
};

export const TTT_ITEMS: Record<TttItemKind, string> = {
  pistol: 'Wasserpistole',
  coconut: 'Kokosnuss',
  medkit: 'Erste-Hilfe-Kasten',
};

export const TTT_ROLES: Record<TttRole, { name: string; color: string }> = {
  innocent: { name: 'Unschuldig', color: '#2f7d32' },
  traitor: { name: 'Verräter', color: '#a8342a' },
  detective: { name: 'Detektiv', color: '#2d64a8' },
};

/** Farbnamen der Shirts (für den Spurensucher des Detektivs: „ein ___ Shirt“) */
export const SHIRT_NAMES = ['rotes', 'blaues', 'grünes', 'gelbes', 'lila', 'oranges', 'türkises', 'weißes', 'schwarzes', 'rosa'];
