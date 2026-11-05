/**
 * Funkfrequenz (à la Wavelength) – Konstanten, Wertung und der Pool der Gegensatzpaare.
 *
 * Skala 0 … 100: 0 = linker Pol, 100 = rechter Pol. Das geheime Ziel kennt nur der Funker
 * (und der Server); sein Team stellt den Zeiger (Mittelwert aller Regler), das andere Team
 * wettet, ob das Ziel weiter links oder rechts liegt.
 */
import type { FunkSide, Team } from './types';

export type { FunkSide } from './types';

export const FUNK = {
  /** Rundenbanner („Team Sonne funkt!“) */
  INTRO_MS: 5000,
  /** Funker überlegt sich den Hinweis (danach startet das Drehen auch ohne ihn) */
  CLUE_MS: 30000,
  /** Team dreht am Regler – danach steht der Tipp (oder der Kapitän bestätigt früher) */
  TUNE_MS: 45000,
  /** Gegnerteam wettet links/rechts */
  BET_MS: 15000,
  REVEAL_MS: 9000,
  /** Runden: bis 8 Spieler 6 (3 pro Team), sonst 8 */
  ROUNDS_SMALL: 6,
  ROUNDS_BIG: 8,
  BIG_FROM: 9,
  /** Wer zuerst so viele Punkte hat, gewinnt sofort */
  WIN_SCORE: 10,
  /** Ziel liegt zwischen MIN und MAX (am Rand würden die Zonen sonst fast ganz abgeschnitten) */
  TARGET_MIN: 4,
  TARGET_MAX: 96,
  /** Höchstlänge des getippten Hinweises */
  MAX_CLUE: 32,
  /** Punkte für die richtige Richtungswette (gehen ans Gegnerteam) */
  BET_POINTS: 1,
} as const;

/** Zonen um das Ziel: Abstand ≤ r → Punkte (von innen nach außen) */
export const FUNK_ZONES: { r: number; points: number }[] = [
  { r: 5, points: 4 },
  { r: 12, points: 3 },
  { r: 20, points: 2 },
];

/** Punkte für einen Zeiger bei `dial`, wenn das Ziel bei `target` liegt */
export function funkPoints(target: number, dial: number): number {
  const d = Math.abs(target - dial);
  for (const z of FUNK_ZONES) if (d <= z.r) return z.points;
  return 0;
}

export const funkRounds = (players: number) => (players >= FUNK.BIG_FROM ? FUNK.ROUNDS_BIG : FUNK.ROUNDS_SMALL);

export const funkClamp = (v: number) => Math.max(0, Math.min(100, v));

/** Wie Handy und TV die Wette benennen */
export const FUNK_SIDE_TEXT: Record<FunkSide, string> = { left: 'weiter links', right: 'weiter rechts' };

export const funkOther = (t: Team): Team => (t === 'A' ? 'B' : 'A');

/** Gegensatzpaare [links, rechts] – kurz halten (TV: ≈ 18 Zeichen pro Pol) */
export const FUNK_PAIRS: [string, string][] = [
  // Urlaub & Strand
  ['eiskalt', 'glühend heiß'],
  ['Strandbar', 'Sternerestaurant'],
  ['Pauschalreise', 'Abenteuerurlaub'],
  ['Jugendherberge', 'Luxushotel'],
  ['Balkonien', 'Weltreise'],
  ['Campingplatz', 'Kreuzfahrt'],
  ['mieses Souvenir', 'tolles Souvenir'],
  ['Wellness', 'Party'],
  ['Hängematte', 'Fallschirmsprung'],
  ['Sonnenbrand', 'perfekte Bräune'],
  ['Regentag', 'Kaiserwetter'],
  ['Liegen-Reservierer', 'Langschläfer'],
  ['Touristenfalle', 'Geheimtipp'],
  ['Strandurlaub', 'Städtetrip'],
  ['Ostsee', 'Karibik'],
  ['Freibad', 'Wasserpark'],
  ['Liegestuhl', 'Wanderschuh'],
  ['Bettenburg', 'Baumhaus'],
  ['nur Handgepäck', 'fünf Koffer'],
  ['Last Minute', 'ein Jahr geplant'],
  ['Postkarte', 'Instagram-Story'],
  ['Reiseführer', 'treiben lassen'],
  ['erholsam', 'stressig'],
  ['mieses Hotelbuffet', 'Traum-Buffet'],
  // Essen & Trinken
  ['eklig', 'lecker'],
  ['ungesund', 'gesund'],
  ['Frühstück', 'Mitternachtssnack'],
  ['Imbiss', 'Gourmet'],
  ['mild', 'höllisch scharf'],
  ['süß', 'salzig'],
  ['Kindergetränk', 'Erwachsenengetränk'],
  ['miese Pizza-Zutat', 'beste Pizza-Zutat'],
  ['Grillen für Anfänger', 'Grillen für Profis'],
  ['billiger Wein', 'teurer Wein'],
  ['macht Kater', 'heilt Kater'],
  ['Beilage', 'Hauptgericht'],
  ['Fingerfood', 'Messer und Gabel'],
  ['Sommer-Getränk', 'Winter-Getränk'],
  ['überbewertetes Essen', 'unterschätztes Essen'],
  ['Eis für Kinder', 'Eis für Erwachsene'],
  ['Pommesbude', 'Candlelight-Dinner'],
  ['Fast Food', 'Slow Food'],
  // Stimmung & Charakter
  ['peinlich', 'cool'],
  ['langweilig', 'aufregend'],
  ['harmlos', 'gefährlich'],
  ['schüchtern', 'Rampensau'],
  ['spießig', 'wild'],
  ['nervig', 'liebenswert'],
  ['unterschätzt', 'überschätzt'],
  ['altmodisch', 'modern'],
  ['traurig', 'fröhlich'],
  ['ehrlich', 'verlogen'],
  ['faul', 'fleißig'],
  ['romantisch', 'unromantisch'],
  ['kindisch', 'erwachsen'],
  ['normal', 'verrückt'],
  ['ruhig', 'laut'],
  ['bescheiden', 'angeberisch'],
  ['unauffällig', 'auffällig'],
  ['sinnlos', 'sinnvoll'],
  ['gruselig', 'gemütlich'],
  ['mutig', 'feige'],
  ['tiefenentspannt', 'gestresst'],
  ['klischeehaft', 'originell'],
  ['schlechte Angewohnheit', 'gute Angewohnheit'],
  ['schlechte Ausrede', 'gute Ausrede'],
  ['mieser Partytrick', 'genialer Partytrick'],
  ['schlimmstes Date', 'perfektes Date'],
  ['mieser Spitzname', 'toller Spitzname'],
  ['Red Flag', 'Green Flag'],
  ['Morgenmuffel', 'Frühaufsteher'],
  ['introvertiert', 'extrovertiert'],
  // Zeit & Alltag
  ['Montag', 'Freitag'],
  ['morgens', 'abends'],
  ['Januar', 'Juli'],
  ['Alltag', 'Abenteuer'],
  ['vergänglich', 'für die Ewigkeit'],
  ['Kindheit', 'Rente'],
  ['Hobby', 'Beruf'],
  ['schnell erledigt', 'dauert ewig'],
  ['früher besser', 'heute besser'],
  ['analog', 'digital'],
  ['unwichtig', 'lebenswichtig'],
  ['Luxus', 'Grundbedürfnis'],
  ['mieses Geschenk', 'tolles Geschenk'],
  ['Pflicht', 'Vergnügen'],
  ['billig', 'teuer'],
  ['kinderleicht', 'unmöglich'],
  ['leise', 'ohrenbetäubend'],
  ['sauber', 'dreckig'],
  ['ordentlich', 'chaotisch'],
  ['nutzloses Ding', 'nützliches Ding'],
  ['Wegwerfartikel', 'Erbstück'],
  // Natur & Tiere
  ['süßes Tier', 'hässliches Tier'],
  ['Haustier', 'Wildtier'],
  ['kleines Tier', 'großes Tier'],
  ['harmloses Tier', 'gefährliches Tier'],
  ['im Wasser', 'an Land'],
  ['Stadt', 'Land'],
  ['Wald', 'Wüste'],
  ['Berge', 'Meer'],
  ['Hundemensch', 'Katzenmensch'],
  ['weich', 'hart'],
  ['federleicht', 'tonnenschwer'],
  ['winzig', 'riesig'],
  ['nass', 'trocken'],
  ['natürlich', 'künstlich'],
  ['dunkel', 'hell'],
  ['rund', 'eckig'],
  // Kultur & Freizeit
  ['schlechter Film', 'guter Film'],
  ['Schlager', 'Heavy Metal'],
  ['Karaoke-Flop', 'Karaoke-Hit'],
  ['Kinderspiel', 'Erwachsenenspiel'],
  ['Brettspiel', 'Extremsport'],
  ['Mainstream', 'Nische'],
  ['Kunst', 'Kitsch'],
  ['Hit', 'Flop'],
  ['mieser Superheld', 'bester Superheld'],
  ['Bösewicht', 'Held'],
  ['Märchen', 'Horrorfilm'],
  ['Sport für Faule', 'Sport für Profis'],
  ['Mannschaftssport', 'Einzelsport'],
  ['Hobby für Rentner', 'Hobby für Teenies'],
  ['Fernsehabend', 'Clubnacht'],
  ['Geheimnis', 'weiß jeder'],
  ['Fakt', 'Mythos'],
  ['realistisch', 'reine Fantasie'],
  ['Wissenschaft', 'Aberglaube'],
  ['berühmt', 'unbekannt'],
  ['legal', 'illegal'],
  ['miese Erfindung', 'geniale Erfindung'],
  ['Horror-Job', 'Traumjob'],
  ['mieser Partyort', 'perfekter Partyort'],
  ['mieses Reiseziel', 'Traumziel'],
  ['miese Superkraft', 'geniale Superkraft'],
  ['mieser Bandname', 'genialer Bandname'],
  ['Tattoo-Reue', 'Tattoo-Stolz'],
  // Party & Gruppe
  ['Party-Killer', 'Party-Retter'],
  ['Feierabendbier', 'Junggesellenabschied'],
  ['stocknüchtern', 'sternhagelvoll'],
  ['Spielverderber', 'Stimmungskanone'],
  ['früh ins Bett', 'bis Sonnenaufgang'],
  ['peinlicher Tanzmove', 'genialer Tanzmove'],
  ['peinliches Hobby', 'cooles Hobby'],
  ['peinlicher Moment', 'legendärer Moment'],
  ['harmloser Streich', 'fieser Streich'],
  ['unangenehme Stille', 'gute Unterhaltung'],
  ['Foto-Muffel', 'Selfie-Profi'],
];

/** Kurze Hinweise für Bots (sie können ja nicht laut etwas sagen) */
export const FUNK_BOT_CLUES = ['…', 'Hmm …', 'Sonnencreme', 'Oma', 'Glühwein', 'Dienstag', 'Flamingo', 'Gartenzwerg', 'Schlager', 'Pommes', 'Strandkorb', 'Kreuzfahrt'];
