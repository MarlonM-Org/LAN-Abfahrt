import type { FieldType, KurvePower, MiniKind, Point, TttItemKind, TttRole, TttShopItem } from './types';

/** `maxPlayers`: nur setzen, wenn ein Spiel nicht mit bis zu 12 Spielern (Lobby-Maximum) funktioniert */
export const MINI_INFO: Record<MiniKind, { title: string; tagline: string; minPlayers: number; maxPlayers?: number }> = {
  flunky: { title: 'Flunkyball', tagline: 'Werfen, trinken, laufen!', minPlayers: 2 },
  wwe: { title: 'Wer würde eher ...?', tagline: 'Stimmt ab – wer ist gemeint?', minPlayers: 2 },
  sprint: { title: 'Liegestuhl-Sprint', tagline: 'Handtuch drauf, sobald die Sonne aufgeht!', minPlayers: 2 },
  murder: { title: 'Mord im Ferienhaus', tagline: 'Einer von euch ist nicht zum Entspannen hier ...', minPlayers: 4 },
  descent: { title: 'Der Abstieg', tagline: 'Den Abhang runter zum Rhein – springen!', minPlayers: 1 },
  rhythm: { title: 'Das erste Gespräch', tagline: 'Bleibt im Takt – dann funkt es!', minPlayers: 1, maxPlayers: 2 },
  wrap: { title: 'Wraps mit Sriracha-Mayo', tagline: 'Zutaten in der richtigen Reihenfolge greifen!', minPlayers: 1 },
  stars: { title: 'Tanz unter den Sternen', tagline: 'Verbindet die Sterne zu Sternbildern!', minPlayers: 1, maxPlayers: 2 },
  nhie: { title: 'Ich hab noch nie ...', tagline: 'Wer es schon getan hat, trinkt!', minPlayers: 2 },
  hilo: { title: 'Höher oder Tiefer', tagline: 'Falsch geraten? Schluck!', minPlayers: 2 },
  bomb: { title: 'Tick-Tack-Bumm', tagline: 'Begriff sagen, Bombe weitergeben!', minPlayers: 2 },
  sup: { title: 'SUP-Rennen', tagline: 'Zu zweit auf dem Board: einer links, einer rechts!', minPlayers: 1 },
  tidy: { title: 'Aufräumen!', tagline: 'Schiebt das Chaos in euren Korb – Joystick am Handy!', minPlayers: 1 },
  flieger: { title: 'Urlaubsflieger', tagline: 'Ruft euch die Anweisungen zu – sonst geht der Sprit aus!', minPlayers: 2 },
  kurve: { title: 'Kurven-Duell', tagline: 'Links, rechts – und bloß keine Spur rammen!', minPlayers: 2 },
  arena: { title: 'Bomben-Arena', tagline: 'Kokosnüsse legen, Sandburgen sprengen – wer bleibt trocken?', minPlayers: 2 },
  bowling: { title: 'Strand-Bowling', tagline: 'Handy schwingen wie eine Bowlingkugel – Strike!', minPlayers: 2 },
  enten: { title: 'Ententeich', tagline: 'Handy auf den TV richten und abdrücken – aber nicht auf die Badegäste!', minPlayers: 2 },
  ttt: { title: 'Verräter im Ferienhaus', tagline: 'Poolnudeln raus – wer spielt falsch?', minPlayers: 4 },
  verstecken: { title: 'Versteckspiel mit Möbeln', tagline: 'Werdet zur Kühlbox – und bloß nicht bewegen!', minPlayers: 3 },
  parcours: { title: 'Fallen-Parcours', tagline: 'Baut Fallen – und schafft es selbst zur Cocktailbar!', minPlayers: 2 },
  kart: { title: 'Kart-Rennen', tagline: 'Verfolger-Kamera wie auf dem SNES – Gas, Drift, Items!', minPlayers: 2 },
  turm: { title: 'Wackelturm', tagline: 'Stapelt euer Urlaubsgepäck bis zum Gipfelkreuz!', minPlayers: 2 },
  igel: { title: 'Igel-Krieg', tagline: 'Kokosnüsse, Wasserbomben – wer bleibt auf der Insel?', minPlayers: 2 },
  smash: { title: 'Smash-Arena', tagline: 'Hau sie von der Bühne – wer zuletzt steht, gewinnt!', minPlayers: 2 },
  wasser: { title: 'Wasserbomben-Schlacht', tagline: 'Zielen, werfen, platsch – wer wird klatschnass?', minPlayers: 2 },
  stillepost: { title: 'Stille Post mit Bildern', tagline: 'Schreiben, malen, raten – und dann lachen!', minPlayers: 3 },
  fangen: { title: 'Urlaubs-Fangen', tagline: 'Der Animateur ist unsichtbar – nur sein Handy kennt die Karte!', minPlayers: 3 },
  geist: { title: 'Geisterjagd', tagline: 'Stromausfall! Ein unsichtbarer Geist spukt durchs Haus ...', minPlayers: 3 },
  grill: { title: 'Grill-Chaos', tagline: 'Schnippeln, grillen, servieren – bevor die Gäste meckern!', minPlayers: 2 },
  boule: { title: 'Boule am Strand', tagline: 'Legen oder schießen – wer liegt am Schweinchen?', minPlayers: 2 },
  sumo: { title: 'Sumo-Steg', tagline: 'Rempeln, schubsen, platsch – wer bleibt auf dem Steg?', minPlayers: 2 },
  volley: { title: 'Strand-Volleyball', tagline: 'Baggern, springen, schmettern – Team Sonne gegen Team Meer!', minPlayers: 2 },
  tourist: { title: 'Wer ist der Tourist?', tagline: 'Alle kennen den Ort – nur einer nicht. Fragt euch durch!', minPlayers: 4 },
  sprueche: { title: 'Sprüche-Duell', tagline: 'Schreibt die lustigste Antwort – die anderen stimmen ab!', minPlayers: 3 },
  golf: { title: 'Urlaubs-Minigolf', tagline: 'Alle putten gleichzeitig – Leuchtturm, Looping, Lagune!', minPlayers: 2 },
  autoball: { title: 'Auto-Fußball', tagline: 'Gas, Boost, Hüpfer – schiebt den Wasserball ins Tor!', minPlayers: 2 },
  werwolf: { title: 'Werwölfe im Ferienhaus', tagline: 'Vollmond über dem Ferienhaus – wer von euch hat Fell unterm Shirt?', minPlayers: 6 },
};

/** Minispiele im Trinkspiel-Modus */
export const DRINK_KINDS: MiniKind[] = ['wwe', 'nhie', 'hilo', 'bomb'];

/** Passt die Spielerzahl zu einem Minispiel (min. und ggf. max.)? */
export const fitsPlayers = (kind: MiniKind, n: number) => n >= MINI_INFO[kind].minPlayers && n <= (MINI_INFO[kind].maxPlayers ?? Infinity);

/** Minispiele, die im Party-Modus vorkommen */
export const PARTY_KINDS: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'murder', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'stillepost', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'tourist', 'sprueche', 'golf', 'autoball', 'volley', 'werwolf'];
/** Versteckte-Rollen-Spiele: eines davon ist das Finale im Party-Modus */
export const FINALE_KINDS: MiniKind[] = ['murder', 'ttt'];
/** Minispiele, die auf dem Spielbrett zufällig drankommen (Finale: Mord oder Verräter) */
export const BOARD_KINDS: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'autoball', 'volley'];
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
  COLORS: [0xe0503f, 0x3f8fe0, 0x46b04a, 0xf2c33a, 0x9b5fc0, 0x2fb5a5],
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

// ------------------------------------------------------------------ Urlaubsflieger

export const FLIEGER = {
  /** Zwischenstopps: Etappe i fliegt von ROUTE[i] nach ROUTE[i + 1] */
  ROUTE: ['Düsseldorf', 'Mallorca', 'Kreta', 'Malediven', 'Bali'],
  /** Zeit pro Anweisung je Etappe (wird später knapper) */
  ORDER_MS: [14000, 12500, 11000, 10000],
  /** Erste Etappe: länger zum Reinkommen */
  FIRST_INTRO_MS: 7000,
  INTRO_MS: 4500,
  CLEARED_MS: 4500,
  END_MS: 5500,
  /** Pause, bevor jemand nach einer Anweisung die nächste bekommt */
  NEXT_ORDER_MS: 900,
  /** Wahrscheinlichkeit, dass sich die Anweisung aufs eigene Cockpit bezieht */
  OWN_CHANCE: 0.25,
  REFUEL: 20,
};

/** Benötigte erledigte Anweisungen pro Etappe (mehr Spieler → mehr Anweisungen gleichzeitig) */
export const fliegerTarget = (stage: number, players: number) => Math.round(3 + 2 * stage + players * (1.2 + 0.4 * stage));

/** Treibstoff-Verlust pro verpasster Anweisung */
export const fliegerMissCost = (players: number) => Math.max(6, Math.min(15, Math.round(36 / players)));

/** Bedienelemente pro Handy */
export const fliegerPanelSize = (players: number) => (players <= 3 ? 6 : players <= 6 ? 5 : 4);

/** Namen der Bedienelemente – 12 Spieler × 6 Elemente dürfen sich nie wiederholen */
export const FLIEGER_NAMES = [
  'Sonnenschirm-Klappe', 'Cocktail-Druck', 'Flamingo-Ventil', 'Sonnencreme-Düse', 'Gepäck-Rutsche', 'Ballermann-Modus',
  'Strandtuch-Reservierer', 'Sangria-Pumpe', 'Badelatschen-Bremse', 'Luftmatratzen-Gebläse', 'Kokosnuss-Kanone', 'Schlager-Regler',
  'Aperol-Spritzer', 'Liegestuhl-Hebel', 'Bräunungs-Turbo', 'Animateur-Alarm', 'Muschel-Radar', 'Sandburg-Stabilisator',
  'Eiswürfel-Spender', 'Palmen-Wedler', 'Schnorchel-Sensor', 'Hawaiihemd-Heizung', 'Wasserball-Werfer', 'Souvenir-Schleuder',
  'Pool-Nudel-Propeller', 'Buffet-Beschleuniger', 'Cabrio-Klappe', 'Sonnenbrand-Warner', 'All-inclusive-Knopf', 'Schwimmflügel-Pumpe',
  'Selfie-Stab-Antenne', 'Möwen-Abwehr', 'Strandbar-Kompass', 'Piña-Colada-Mixer', 'Quallen-Detektor', 'Urlaubsgeld-Zähler',
  'Ansichtskarten-Drucker', 'Fön-Turbine', 'Handtuch-Katapult', 'Sonnenhut-Lift', 'Kofferband-Kurbel', 'Duty-free-Schalter',
  'Kreuzfahrt-Hupe', 'Bananenboot-Bremse', 'Wellen-Simulator', 'Mallorca-Melder', 'Grill-Zünder', 'Sonnendeck-Dimmer',
  'Flip-Flop-Flattermann', 'Limbo-Stange', 'Ukulele-Verstärker', 'Tropen-Thermostat', 'Mückenspray-Nebler', 'Siesta-Sicherung',
  'Hängematten-Schaukel', 'Schaumparty-Regler', 'Frühstücks-Wecker', 'Strandkorb-Drehteller', 'Fischbrötchen-Fach', 'Kurtaxe-Klappe',
  'Tauchermasken-Wischer', 'Paddelboot-Pedal', 'Sonnenuntergangs-Zoom', 'Bordkarten-Stempel', 'Rettungsring-Rolle', 'Wasserrutschen-Wachs',
  'Lavalampen-Lüfter', 'Margarita-Mühle', 'Partyhut-Presse', 'Klimaanlagen-Knüppel', 'Sandalen-Socken-Sperre', 'Ananas-Antrieb',
  'Luftkissen-Lüfter', 'Kaktus-Kühler', 'Disco-Kugel-Drehzahl', 'Delfin-Dolmetscher',
];

/** Beschriftungen für Mehrfach-Schalter */
export const FLIEGER_SWITCHES = [
  ['Aus', 'Mild', 'Tropisch'],
  ['0', '1', '2', '3'],
  ['Lau', 'Warm', 'Heiß'],
  ['Ebbe', 'Flut'],
  ['Piano', 'Forte', 'Ballermann'],
  ['S', 'M', 'L', 'XL'],
  ['Nord', 'Ost', 'Süd', 'West'],
  ['Bier', 'Wein', 'Sekt'],
  ['Schatten', 'Sonne', 'Grill'],
  ['LSF 15', 'LSF 30', 'LSF 50'],
  ['Chillig', 'Party', 'Eskalation'],
  ['Mo', 'Mi', 'Fr', 'So'],
  ['Pommes', 'Paella', 'Gyros'],
  ['Leise', 'Laut', 'Nachbarn'],
];
// ------------------------------------------------------------------ Kurven-Duell

export const KURVE = {
  /** Spielfläche (darüber: Punktetafel) */
  ARENA: { x: 6, y: 30, w: 468, h: 234 },
  /** Grundtempo in px/s und Drehgeschwindigkeit in rad/s (→ Wenderadius ≈ 16 px) */
  SPEED: 46,
  TURN: 2.9,
  /** Linienstärke (TV, Kollision) */
  LINE: 3,
  /** Lücken: alle 1,5–3 s, so lang (px), dass man durchpasst */
  GAP_MIN_MS: 1500,
  GAP_MAX_MS: 3000,
  GAP_PX: 12,
  /** Die letzten n px der eigenen Spur zählen nicht als Hindernis */
  SELF_GRACE: 8,
  /** Runden je nach Spielerzahl (viele Spieler = kurze Runden) → Spiel dauert ca. 2–4 Minuten */
  roundsFor: (n: number) => (n <= 3 ? 5 : n <= 6 ? 6 : 7),
  COUNTDOWN_MS: 3000,
  ROUND_END_MS: 3500,
  /** Nach STORM_MS werden alle langsam schneller, nach ROUND_MAX_MS ist die Runde vorbei */
  STORM_MS: 25000,
  STORM_ACCEL: 0.07,
  ROUND_MAX_MS: 55000,
  POWER_MIN_MS: 3500,
  POWER_MAX_MS: 7000,
  POWER_MAX: 3,
  POWER_R: 7,
  POWER_LIFE_MS: 14000,
  TURBO_MS: 4000,
  TURBO_F: 1.6,
  SLOW_MS: 4000,
  SLOW_F: 0.55,
  WRAP_MS: 6000,
  /** So viele Spurpunkte pro Spieler stehen im Snapshot */
  TAIL: 32,
  /** 12 gut unterscheidbare Farben – Index 0–9 passt zu den T-Shirt-Farben (SHIRTS) */
  COLORS: ['#e0503f', '#3f8fe0', '#46b04a', '#f2c33a', '#b07ae0', '#f0973a', '#2fb5a5', '#f4efe2', '#8fd8ff', '#f07aa8', '#b6e05a', '#c98a5a'],
  COLOR_NAMES: ['Rot', 'Blau', 'Grün', 'Gelb', 'Lila', 'Orange', 'Türkis', 'Weiß', 'Hellblau', 'Rosa', 'Limette', 'Kupfer'],
};

export const KURVE_POWER_INFO: Record<KurvePower, { label: string; desc: string; color: string }> = {
  turbo: { label: 'TURBO!', desc: 'Du bist kurz schneller', color: '#f0973a' },
  slow: { label: 'SCHNECKE!', desc: 'Alle anderen werden langsam', color: '#46b04a' },
  wrap: { label: 'DURCH WÄNDE!', desc: 'Du fährst kurz durch den Rand', color: '#b07ae0' },
};

// ------------------------------------------------------------------ Ententeich

export const ENTEN = {
  /** Spielfeld (rechts davon steht die Rangliste) */
  FIELD_W: 404,
  /** Schilfkante: hier starten die Enten */
  REED_Y: 226,
  /** Wasserbereich, auf dem die Badegäste treiben */
  FLOAT_MIN_Y: 168,
  FLOAT_MAX_Y: 212,
  INTRO_MS: 6000,
  BANNER_MS: 2400,
  AMMO: 3,
  RELOAD_MS: 750,
  SHOT_COOLDOWN_MS: 140,
  /** Treffer innerhalb dieser Zeit zählen als Combo */
  COMBO_MS: 2200,
  COMBO_BONUS: 5,
  COMBO_MAX_BONUS: 25,
  /** Wie weit ein Fehlschuss Vögel aufschreckt */
  DODGE_R: 42,
  /** Rückblick für die Treffer-Prüfung (Netz-/Anzeigeverzögerung) */
  LAG_MS: 220,
  POINTS: { duck: 10, gull: 20, flamingo: 30, float: -15 } as Record<string, number>,
  RADIUS: { duck: 9, gull: 8, flamingo: 11, float: 11 } as Record<string, number>,
  WAVES: [
    { name: 'Enten-Aufwärmen', ms: 24000, maxBirds: 3, every: 1100, speed: 1, life: 6500, floats: 1, weights: { duck: 0.82, gull: 0.13, flamingo: 0.05 } },
    { name: 'Möwen-Alarm!', ms: 26000, maxBirds: 4, every: 850, speed: 1.25, life: 5500, floats: 2, weights: { duck: 0.55, gull: 0.35, flamingo: 0.1 } },
    { name: 'Flamingo-Fieber', ms: 26000, maxBirds: 6, every: 620, speed: 1.5, life: 4600, floats: 3, weights: { duck: 0.45, gull: 0.37, flamingo: 0.18 } },
  ],
  /** 12 gut unterscheidbare Fadenkreuz-Farben */
  COLORS: [0xff4040, 0x3f8fff, 0x4ee04e, 0xffe03a, 0xff7ad8, 0xff9a2e, 0xa67bff, 0x3fe8d8, 0xffffff, 0xc8ff3a, 0xd89a5a, 0xc0305f],
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

// ------------------------------------------------------------------ Wackelturm

/** Alle Längen in Physik-Einheiten (1 Block = BLOCK), Höhen in Blöcken über der Plattform */
export const TURM = {
  BLOCK: 16,
  /** Breite der Plattform in Blöcken */
  PLATFORM_W: 6,
  /** Zielhöhe (Gipfelkreuz) in Blöcken */
  GOAL: 22,
  /** Sichtbarer Bereich der Bahn: oberhalb / unterhalb der Plattform (Blöcke) */
  VIEW_TOP: 25,
  VIEW_BOTTOM: 1.5,
  /** So weit (Blöcke ab Mitte) darf man das fallende Teil seitlich schieben */
  LANE_HALF: 5,
  /** Fallgeschwindigkeit in Blöcken pro Sekunde (normal / mit ▼) */
  FALL: 2,
  FAST: 11,
  /** Neue Teile erscheinen zufällig bis zu so viele Blöcke neben der Mitte */
  SPAWN_JITTER: 1.5,
  /** Abstand des neuen Teils über dem höchsten Punkt des Turms (Blöcke) */
  SPAWN_GAP: 5,
  LIVES: 3,
  /** Weitere verlorene Teile innerhalb dieser Zeit kosten kein zusätzliches Leben */
  LOSS_GRACE_MS: 2000,
  /** So lange muss der Turm über dem Ziel stehen bleiben */
  HOLD_MS: 2000,
  TIME_MS: 150000,
  /** Nach dem ersten Gipfel haben die anderen noch so lange Zeit */
  AFTER_FINISH_MS: 20000,
  COUNTDOWN_MS: 3500,
  GUST_EVERY_MS: 30000,
  GUST_MS: 3500,
  /** Bahnfarben (Bestmarke, Namensschild) */
  COLORS: [0xe0503f, 0x3f8fe0, 0x46b04a, 0xf2c33a, 0x9b5fc0, 0xf0973a, 0x2fb5a5, 0xf07aa8, 0x8d5629, 0x5f6bd6, 0xa8c43a, 0x7f7b73],
};

/** Urlaubs-Teile in Tetromino-Form. Zellen als [Spalte, Zeile], Zeile nach unten. */
export const TURM_SHAPES: { name: string; cells: [number, number][] }[] = [
  { name: 'Surfbrett', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'Kühlbox', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: 'Liegestuhl', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: 'Koffer', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: 'Reisetasche', cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: 'Cocktailkiste', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: 'Sangriakiste', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
];

/** Schwerpunkt einer Form in Zellen (Mittelwert der Zellmitten) */
export function turmCom(shape: number): { x: number; y: number; cols: number; rows: number } {
  const cells = TURM_SHAPES[shape].cells;
  let x = 0;
  let y = 0;
  let cols = 0;
  let rows = 0;
  for (const [c, r] of cells) {
    x += c + 0.5;
    y += r + 0.5;
    cols = Math.max(cols, c + 1);
    rows = Math.max(rows, r + 1);
  }
  return { x: x / cells.length, y: y / cells.length, cols, rows };
}

/**
 * Zellmitten einer Form relativ zum Schwerpunkt, gedreht um `angle`
 * (Bildschirm-Koordinaten: y nach unten, positive Winkel = im Uhrzeigersinn).
 */
export function turmCellOffsets(shape: number, angle: number): { x: number; y: number }[] {
  const com = turmCom(shape);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return TURM_SHAPES[shape].cells.map(([c, r]) => {
    const dx = (c + 0.5 - com.x) * TURM.BLOCK;
    const dy = (r + 0.5 - com.y) * TURM.BLOCK;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  });
}

// ------------------------------------------------------------------ Arcade

/** Punkte nach Platzierung im Arcade-Modus */
export const ARCADE_POINTS = [10, 6, 3, 1];

/** Zufallsauswahl im Arcade-Modus (ohne reine Trinkspiele) */
export const ARCADE_RANDOM: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'rhythm', 'stars', 'murder', 'wwe', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'golf', 'autoball', 'volley'];

/** Alle Spiele, nach Kategorie sortiert (für das Arcade-Menü) */
export const ARCADE_GROUPS: { title: string; kinds: MiniKind[] }[] = [
  { title: 'Action', kinds: ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'kurve', 'arena', 'kart', 'smash', 'parcours', 'wasser', 'sumo', 'autoball', 'volley'] },
  { title: 'Zielen & Werfen', kinds: ['bowling', 'boule', 'golf', 'enten', 'igel', 'turm'] },
  { title: 'Gemeinsam', kinds: ['rhythm', 'stars', 'flieger', 'grill'] },
  { title: 'Geheime Rollen', kinds: ['murder', 'ttt', 'verstecken', 'fangen', 'geist', 'tourist', 'werwolf'] },
  { title: 'Partyklassiker', kinds: ['wwe', 'nhie', 'hilo', 'bomb', 'stillepost', 'sprueche'] },
];
