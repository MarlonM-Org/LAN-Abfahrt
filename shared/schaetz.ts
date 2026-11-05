/** Schätzkönig (à la Wits & Wagers) – Zeiten, Quoten, Fragen-Pool und Gruppenfragen */
import { possessive } from './players';

export const SCHAETZ = {
  /** Arcade/Einzelspiel: so viele Fragen */
  ROUNDS: 4,
  /** Spielbrett (`ctx.mode === 'party'`): eine Frage, ca. 90 s */
  PARTY_ROUNDS: 1,
  /** Zahl eintippen */
  GUESS_MS: 25_000,
  /** Karten fliegen auf den Zahlenstrahl */
  LINE_MS: 3_500,
  /** Chips setzen */
  BET_MS: 20_000,
  /** Gruppenfrage: so lange hat der VIP Zeit, die richtige Zahl einzutippen (danach zählt der Median) */
  TRUTH_MS: 45_000,
  /** Trommelwirbel vor der Auflösung */
  DRUM_MS: 2_400,
  REVEAL_MS: 9_000,
  /** Zwischenstand zwischen den Runden (nur Arcade) */
  SCORES_MS: 6_000,
  /** Chips pro Spieler und Runde */
  CHIPS: 2,
  /** Der Autor der Gewinnerkarte bekommt so viele Punkte */
  AUTHOR_BONUS: 3,
  /** Quote des Felds „Alle zu hoch“ ganz links */
  LOW_ODDS: 5,
  /** Größte erlaubte Schätzung (12 Ziffern) */
  MAX_GUESS: 999_999_999_999,
  MAX_DIGITS: 12,
};

/**
 * Quote einer Karte auf dem Zahlenstrahl (Index `i` von `n` Karten, aufsteigend sortiert):
 * Mitte ×2, nach außen ×3 und ×4 (wie bei Wits & Wagers – die Exoten zahlen mehr).
 */
export function schaetzOdds(i: number, n: number): number {
  const d = Math.abs(i - (n - 1) / 2);
  return Math.min(4, 2 + Math.floor(d));
}

/** Zahl mit Tausenderpunkten („1.440“, „384.400“) */
export const fmtNum = (n: number) => Math.round(n).toLocaleString('de-DE');

/** Kurz für enge TV-Karten: bis 999.999 voll, darüber „1,2 Mio.“ / „21 Mrd.“ */
export function fmtShort(n: number): string {
  const a = Math.abs(n);
  const unit = (v: number, w: string) => `${v >= 100 ? Math.round(v) : (Math.round(v * 10) / 10).toLocaleString('de-DE')} ${w}`;
  if (a >= 1e9) return unit(n / 1e9, 'Mrd.');
  if (a >= 1e6) return unit(n / 1e6, 'Mio.');
  return fmtNum(n);
}

export interface SchaetzFact {
  q: string;
  a: number;
  unit: string;
}

export interface SchaetzGroupQ {
  /** `{name}` = Name des Spielers, `{gen}` = Genitiv („Bens“) */
  q: string;
  unit: string;
  /** Typischer Bereich – nur für die Bots (Schätzen und VIP-Auflösung) */
  lo: number;
  hi: number;
}

/**
 * Schätzfragen mit eindeutig bekannten Zahlen (Stand der gängigen Nachschlagewerke).
 * Lieber gerundete „rund“-Fragen als zweifelhafte Exaktheit – bewertet wird ja nur die Reihenfolge.
 */
export const SCHAETZ_FACTS: SchaetzFact[] = [
  // Deutschland
  { q: 'Wie hoch ist die Zugspitze?', a: 2962, unit: 'Meter' },
  { q: 'Wie lang ist der Rhein?', a: 1233, unit: 'Kilometer' },
  { q: 'Wie viele Einwohner hat Düsseldorf (rund)?', a: 630_000, unit: 'Einwohner' },
  { q: 'Wie hoch ist der Kölner Dom?', a: 157, unit: 'Meter' },
  { q: 'Wie viele Stufen führen im Kölner Dom hinauf zur Aussichtsplattform?', a: 533, unit: 'Stufen' },
  { q: 'Wie hoch ist der Berliner Fernsehturm?', a: 368, unit: 'Meter' },
  { q: 'Wie hoch ist das Brandenburger Tor?', a: 26, unit: 'Meter' },
  { q: 'Wie tief ist der Bodensee an der tiefsten Stelle?', a: 251, unit: 'Meter' },
  { q: 'Wie lang ist die Elbe?', a: 1094, unit: 'Kilometer' },
  { q: 'Wie hoch ist der Brocken im Harz?', a: 1141, unit: 'Meter' },
  { q: 'Wie hoch ist der Feldberg im Schwarzwald?', a: 1493, unit: 'Meter' },
  { q: 'In welchem Jahr fiel die Berliner Mauer?', a: 1989, unit: '' },
  { q: 'In welchem Jahr wurde die Berliner Mauer gebaut?', a: 1961, unit: '' },
  { q: 'In welchem Jahr wurde Deutschland zum ersten Mal Fußball-Weltmeister?', a: 1954, unit: '' },
  { q: 'In welchem Jahr lief der allererste „Tatort“ im Fernsehen?', a: 1970, unit: '' },
  { q: 'Wie viele Tore fielen im WM-Halbfinale 2014 Brasilien gegen Deutschland insgesamt?', a: 8, unit: 'Tore' },
  { q: 'Wie viele Bundesliga-Tore hat Gerd Müller geschossen?', a: 365, unit: 'Tore' },
  { q: 'Wie viele Kilometer Autobahn gibt es in Deutschland (rund)?', a: 13_200, unit: 'Kilometer' },
  { q: 'Wie viele Brücken hat Hamburg (rund)?', a: 2500, unit: 'Brücken' },
  { q: 'Wie viele Brotsorten stehen im deutschen Brotregister (rund)?', a: 3200, unit: 'Sorten' },
  { q: 'Wie viele Buchstaben hat das deutsche Alphabet mit Ä, Ö, Ü und ß?', a: 30, unit: 'Buchstaben' },
  // Urlaub & Reisen
  { q: 'Wie hoch ist der Teide auf Teneriffa?', a: 3715, unit: 'Meter' },
  { q: 'Wie hoch ist der Vesuv?', a: 1281, unit: 'Meter' },
  { q: 'Wie hoch ist der Eiffelturm mit Antenne?', a: 330, unit: 'Meter' },
  { q: 'Wie hoch ist der Schiefe Turm von Pisa?', a: 56, unit: 'Meter' },
  { q: 'Wie viele Stufen hat der Schiefe Turm von Pisa?', a: 294, unit: 'Stufen' },
  { q: 'Wie hoch ist die Freiheitsstatue mit Sockel?', a: 93, unit: 'Meter' },
  { q: 'Wie lang ist die Golden Gate Bridge?', a: 2737, unit: 'Meter' },
  { q: 'Wie lang ist der Gotthard-Basistunnel?', a: 57, unit: 'Kilometer' },
  { q: 'Wie lang ist der Panamakanal?', a: 82, unit: 'Kilometer' },
  { q: 'Wie viele Inseln gehören zu den Malediven (rund)?', a: 1200, unit: 'Inseln' },
  { q: 'Wie viele Passagiere darf ein Airbus A380 höchstens an Bord haben?', a: 853, unit: 'Passagiere' },
  { q: 'Wie schnell fliegt ein Ferienflieger auf Reiseflughöhe (rund)?', a: 900, unit: 'km/h' },
  { q: 'Wie lang ist die Chinesische Mauer mit allen Abschnitten (rund)?', a: 21_200, unit: 'Kilometer' },
  { q: 'Wie viele Sterne sind auf der Flagge der EU?', a: 12, unit: 'Sterne' },
  { q: 'Wie hoch ist der Salto Ángel, der höchste Wasserfall der Welt?', a: 979, unit: 'Meter' },
  // Essen & Trinken
  { q: 'Wie viele Kilokalorien haben 100 g Nutella?', a: 539, unit: 'kcal' },
  { q: 'Wie viele Kilokalorien hat ein Big Mac in Deutschland (rund)?', a: 500, unit: 'kcal' },
  { q: 'Wie viele Gramm Zucker stecken in einer 0,33-Liter-Dose Cola?', a: 35, unit: 'Gramm' },
  { q: 'Wie viele Liter Wasser braucht man für 1 kg Rindfleisch (rund)?', a: 15_400, unit: 'Liter' },
  { q: 'Wie viele Kilokalorien hat ein Liter Pils (rund)?', a: 430, unit: 'kcal' },
  { q: 'Wie viele Eier legt eine Legehenne im Jahr (rund)?', a: 300, unit: 'Eier' },
  { q: 'Wie viel Prozent einer Wassermelone sind Wasser (rund)?', a: 92, unit: 'Prozent' },
  // Tiere
  { q: 'Wie viele Herzen hat ein Oktopus?', a: 3, unit: 'Herzen' },
  { q: 'Wie viele Augen hat eine Honigbiene?', a: 5, unit: 'Augen' },
  { q: 'Wie viele Halswirbel hat eine Giraffe?', a: 7, unit: 'Wirbel' },
  { q: 'Wie viele Beine hat ein Hummer?', a: 10, unit: 'Beine' },
  { q: 'Wie viele Monate ist eine Elefantenkuh trächtig (rund)?', a: 22, unit: 'Monate' },
  { q: 'Wie viele Stunden am Tag schläft ein Koala (rund)?', a: 20, unit: 'Stunden' },
  { q: 'Wie lang wird ein Blauwal höchstens (rund)?', a: 30, unit: 'Meter' },
  { q: 'Wie viele Kilometer fliegt eine Küstenseeschwalbe im Jahr (rund)?', a: 70_000, unit: 'Kilometer' },
  { q: 'Wie viele Eier legt eine Meeresschildkröte pro Gelege (rund)?', a: 100, unit: 'Eier' },
  // Körper & Alltag
  { q: 'Wie viele Knochen hat ein erwachsener Mensch?', a: 206, unit: 'Knochen' },
  { q: 'Wie viele Zähne hat ein Erwachsener mit Weisheitszähnen?', a: 32, unit: 'Zähne' },
  { q: 'Wie oft schlägt ein Herz an einem Tag (rund)?', a: 100_000, unit: 'Mal' },
  { q: 'Wie viele Haare hat ein Mensch auf dem Kopf (rund)?', a: 100_000, unit: 'Haare' },
  { q: 'Wie viele Minuten hat ein Tag?', a: 1440, unit: 'Minuten' },
  { q: 'Wie viele Stunden hat ein Jahr (ohne Schaltjahr)?', a: 8760, unit: 'Stunden' },
  { q: 'Wie viele Meter läuft man bei einem Marathon?', a: 42_195, unit: 'Meter' },
  { q: 'Wie viele Tasten hat ein Klavier?', a: 88, unit: 'Tasten' },
  { q: 'Wie viele Felder hat ein Schachbrett?', a: 64, unit: 'Felder' },
  { q: 'Wie viele Karten hat ein Skatblatt?', a: 32, unit: 'Karten' },
  { q: 'Wie viele Augen hat ein normaler Spielwürfel zusammen?', a: 21, unit: 'Augen' },
  { q: 'Wie viele Folgen hat die Serie „Friends“?', a: 236, unit: 'Folgen' },
  { q: 'Wie viele Minuten dauert der Film „Titanic“?', a: 194, unit: 'Minuten' },
  { q: 'Wie viel Gramm darf ein Fußball höchstens wiegen?', a: 450, unit: 'Gramm' },
  // Rekorde & Welt
  { q: 'Wie hoch ist der Mount Everest?', a: 8849, unit: 'Meter' },
  { q: 'Wie hoch ist der Burj Khalifa in Dubai?', a: 828, unit: 'Meter' },
  { q: 'Wie lang ist der Nil (rund)?', a: 6650, unit: 'Kilometer' },
  { q: 'Wie tief ist der Marianengraben (rund)?', a: 11_000, unit: 'Meter' },
  { q: 'Wie lang ist der Erdumfang am Äquator?', a: 40_075, unit: 'Kilometer' },
  { q: 'Wie weit ist der Mond im Schnitt von der Erde entfernt?', a: 384_400, unit: 'Kilometer' },
  { q: 'Wie viele Sekunden braucht das Sonnenlicht bis zur Erde (rund)?', a: 499, unit: 'Sekunden' },
  { q: 'Wie viele Menschen standen bisher auf dem Mond?', a: 12, unit: 'Menschen' },
  { q: 'In welchem Jahr landeten die ersten Menschen auf dem Mond?', a: 1969, unit: '' },
  { q: 'In welchem Jahr sank die Titanic?', a: 1912, unit: '' },
  { q: 'In welchem Jahr kam das erste iPhone auf den Markt?', a: 2007, unit: '' },
  { q: 'Wie viele Staaten sind Mitglied der Vereinten Nationen?', a: 193, unit: 'Staaten' },
  { q: 'Wie viele olympische Medaillen hat Michael Phelps gewonnen?', a: 28, unit: 'Medaillen' },
  { q: 'Wie schnell fährt die schnellste Achterbahn der Welt, die Formula Rossa?', a: 240, unit: 'km/h' },
];

/** Gruppenfragen: Die Antwort kennt nur die Gruppe – der VIP tippt sie am Ende ein (fragt nach!) */
export const SCHAETZ_GROUP: SchaetzGroupQ[] = [
  { q: 'Wie viele Minuten hat {name} heute im Bad verbracht?', unit: 'Minuten', lo: 5, hi: 60 },
  { q: 'Wie viel Prozent Akku hat {gen} Handy gerade?', unit: 'Prozent', lo: 5, hi: 100 },
  { q: 'Wie viele Fotos sind auf {gen} Handy?', unit: 'Fotos', lo: 300, hi: 25_000 },
  { q: 'Wie viele Apps sind auf {gen} Handy?', unit: 'Apps', lo: 30, hi: 200 },
  { q: 'Wie viele ungelesene Nachrichten hat {name} gerade?', unit: 'Nachrichten', lo: 0, hi: 300 },
  { q: 'Wie viele Kontakte hat {name} im Handy?', unit: 'Kontakte', lo: 80, hi: 1500 },
  { q: 'Wie viele Schritte ist {name} heute gegangen?', unit: 'Schritte', lo: 800, hi: 20_000 },
  { q: 'Wie viele Stunden hat {name} letzte Nacht geschlafen?', unit: 'Stunden', lo: 3, hi: 11 },
  { q: 'Wie viele Paar Schuhe besitzt {name}?', unit: 'Paar', lo: 3, hi: 40 },
  { q: 'In wie vielen Ländern war {name} schon?', unit: 'Länder', lo: 2, hi: 45 },
  { q: 'Wie viele Euro Bargeld hat {name} gerade dabei?', unit: 'Euro', lo: 0, hi: 150 },
  { q: 'Wie viele Tabs sind in {gen} Handy-Browser offen?', unit: 'Tabs', lo: 1, hi: 120 },
  { q: 'Wie viele Tassen Kaffee hat {name} heute schon getrunken?', unit: 'Tassen', lo: 0, hi: 6 },
  { q: 'Wie alt war {name} beim ersten Konzert?', unit: 'Jahre', lo: 6, hi: 25 },
  { q: 'Wie viele Minuten braucht {name} morgens vom Wecker bis zur Haustür?', unit: 'Minuten', lo: 10, hi: 90 },
];

/** Gruppenfrage für einen Spieler ausformulieren (ohne „Bot “-Präfix) */
export function groupQuestion(g: SchaetzGroupQ, name: string): string {
  const n = name.replace(/^Bot\s+/, '').trim() || 'Jemand';
  return g.q.replace('{name}', n).replace('{gen}', possessive(n));
}
