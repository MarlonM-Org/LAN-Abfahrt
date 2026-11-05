/**
 * „Wer ist der Tourist?“ (Vorbild: Spyfall) – Orte, Rollen und Zeiten.
 * Die Ortsliste ist öffentlich (alle Handys zeigen sie zum Abhaken),
 * welcher Ort gerade gespielt wird, weiß nur der Server.
 */

/**
 * Zeiten. Die Rundenzeit (tourRoundMs) ist Spielzeit – läuft sie ab, hat der Tourist überlebt – und bleibt.
 * Abstimmungen haben kein Limit mehr (`null`, vorher 30 s): Sie enden, wenn alle gestimmt haben, oder per VIP.
 * Info-Screens sind länger (vorher Intro 7 s, Auflösung 12 s) und überspringbar.
 */
export const TOUR = {
  INTRO_MS: 12000,
  VOTE_MS: null as number | null,
  VOTE_RESULT_MS: 6000,
  REVEAL_MS: 20000,
  MAX_ROUNDS: 4,
  /** Ab so vielen Spielern gibt es zwei Touristen (die sich gegenseitig nicht kennen) */
  TWO_TOURISTS_FROM: 9,
  /** Punkte */
  GUESS_POINTS: 4,
  SURVIVE_POINTS: 2,
  CATCH_POINTS: 1,
  ACCUSER_POINTS: 2,
};

/** Rundenzeit: 6 Minuten bei 4 Spielern, +15 s pro weiterem Spieler, höchstens 8 Minuten */
export const tourRoundMs = (players: number) => Math.max(360000, Math.min(480000, 360000 + (players - 4) * 15000));

export const TOUR_LOCATIONS: { name: string; roles: string[] }[] = [
  { name: 'Strandbar', roles: ['Barkeeper', 'Betrunkener Animateur', 'Möwe', 'Rentnerin mit Sonnenhut', 'DJ mit Ukulele', 'Cocktail-Kellnerin', 'Influencerin mit Selfie-Stick', 'Rettungsschwimmer in der Pause'] },
  { name: 'Flughafen-Gate', roles: ['Pilotin', 'Vater mit Drillingen', 'Gate-Mitarbeiter', 'Vielflieger mit Nackenkissen', 'Junggeselle im Partyshirt', 'Reinigungskraft', 'Passagierin, die ein Upgrade will'] },
  { name: 'Hotelbuffet', roles: ['Koch am Omelett-Stand', 'Kind mit fünf Puddings', 'Kellner', 'Rentner mit Tupperdose', 'Hotelmanagerin', 'Wespe', 'Gast im Bademantel'] },
  { name: 'Bananenboot', roles: ['Bootsfahrer', 'Kreischende Tante', 'Überschätzter Sportler', 'Kind mit Schwimmflügeln', 'Rettungsschwimmerin', 'Fotograf am Ufer', 'Qualle'] },
  { name: 'Kreuzfahrtschiff', roles: ['Kapitän', 'Entertainer im Glitzeranzug', 'Seekranker Passagier', 'Buffet-Stürmerin', 'Zimmermädchen', 'Rentnerpaar beim Tanztee', 'Schiffsärztin', 'Blinder Passagier'] },
  { name: 'Ballermann-Bude', roles: ['Schlagersänger', 'Kellner mit Sangria-Eimer', 'Kegelclub-Präsident', 'Türsteher', 'Junggesellin mit Krone', 'Polizistin', 'Strohhalm-Verkäufer'] },
  { name: 'Souvenirladen', roles: ['Ladenbesitzerin', 'Kind, das alles anfasst', 'Postkarten-Sammler', 'Schnapsglas-Fan', 'Taschendieb', 'Ehemann, der draußen wartet', 'Magnet-Sammlerin'] },
  { name: 'Wasserpark', roles: ['Bademeister', 'Rutschen-Profi', 'Kind im Wellenbecken', 'Pommes-Verkäufer', 'Mutter mit Sonnencreme', 'Teenager-Pärchen', 'Verlorene Badehose'] },
  { name: 'Campingplatz', roles: ['Platzwart', 'Camper mit Gartenzwerg', 'Grillmeister', 'Holländer mit Wohnwagen', 'Mücke', 'Pfadfinderin', 'Nachbar mit Kofferradio'] },
  { name: 'Hotelpool', roles: ['Liegen-Reservierer um 6 Uhr', 'Aqua-Fitness-Trainerin', 'Poolboy', 'Kind mit Arschbombe', 'Sonnenanbeterin', 'Cocktail-Kellner', 'Schwimmnudel'] },
  { name: 'Reisebus', roles: ['Busfahrer', 'Reiseleiterin mit Mikrofon', 'Reisekrankes Kind', 'Rentner mit Thermoskanne', 'Schläfer in der letzten Reihe', 'Kegelschwester', 'Mitsing-Animateur'] },
  { name: 'Fischmarkt', roles: ['Aal-Verkäufer', 'Marktschreierin', 'Möwe', 'Frühaufsteher mit Kater', 'Koch auf Einkaufstour', 'Hafenkatze', 'Fischbrötchen-Fan', 'Hafenarbeiter'] },
  { name: 'Disco', roles: ['DJ', 'Türsteherin', 'Tanzende Tante', 'Barkeeper', 'Schüchterner Typ an der Wand', 'Garderobenfrau', 'Schaumparty-Animateur'] },
  { name: 'Mietwagenschalter', roles: ['Mitarbeiterin am Schalter', 'Kunde ohne Führerschein', 'Versicherungs-Verkäufer', 'Familie mit neun Koffern', 'Mechaniker', 'Wartender seit zwei Stunden', 'Mann mit falscher Buchung'] },
  { name: 'Skihütte', roles: ['Hüttenwirt', 'Après-Ski-DJ', 'Skilehrerin', 'Gestürzter Anfänger', 'Kellnerin mit Jagertee', 'Snowboarder', 'Bernhardiner'] },
  { name: 'Hotelrezeption', roles: ['Rezeptionist', 'Gast mit Beschwerde', 'Kofferträger', 'Hochzeitspaar', 'Zimmermädchen', 'Gast ohne Buchung', 'Hotelkatze'] },
  { name: 'Badestrand', roles: ['Eisverkäufer', 'Sandburg-Architektin', 'Rettungsschwimmer', 'Sonnenbrillen-Händler', 'Sonnenbrand-Opfer', 'Krabbe', 'Beachvolleyball-Profi'] },
  { name: 'Tauchschule', roles: ['Tauchlehrerin', 'Nervöser Anfänger', 'Unterwasser-Fotograf', 'Kapitän des Tauchboots', 'Clownfisch', 'Flaschenfüller', 'Seeigel'] },
  { name: 'Freizeitpark', roles: ['Achterbahn-Mitarbeiter', 'Maskottchen im Kostüm', 'Kind, das zu klein ist', 'Zuckerwatte-Verkäuferin', 'Gruselhaus-Erschrecker', 'Erschöpfter Vater', 'Fotografin am Looping'] },
  { name: 'Festival', roles: ['Headlinerin', 'Ordner', 'Dixi-Klo-Reiniger', 'Crowdsurferin', 'Bierverkäufer', 'Verlorener Kumpel', 'Glitzer-Fee'] },
  { name: 'Weinprobe', roles: ['Winzer', 'Sommelière', 'Gast, der nur Saft trinkt', 'Weinkenner mit Monokel', 'Kellnerin', 'Weinbergschnecke', 'Busfahrer der Gruppe'] },
  { name: 'Luxusjacht', roles: ['Kapitänin', 'Millionärin', 'Matrose', 'Schiffskoch', 'Influencer', 'Delfin', 'Hund in Schwimmweste'] },
  { name: 'Eisdiele', roles: ['Eisverkäufer', 'Kind mit drei Kugeln', 'Wespe', 'Kellnerin', 'Spaghetti-Eis-Fan', 'Rentnerin mit Eiskaffee', 'Hund unter dem Tisch'] },
  { name: 'Wellness-Spa', roles: ['Masseur', 'Gast mit Gurkenmaske', 'Saunameister', 'Bademantel-Dieb', 'Yoga-Lehrerin', 'Gestresste Managerin', 'Rezeptionistin'] },
  { name: 'Minigolfplatz', roles: ['Platzwart', 'Ehrgeiziger Opa', 'Kind, das schummelt', 'Pärchen beim ersten Date', 'Kiosk-Verkäuferin', 'Ente im Teich', 'Ball, der ins Wasser fiel'] },
  { name: 'Autofähre', roles: ['Kapitän', 'LKW-Fahrerin', 'Seekranke Familie', 'Möwe', 'Kiosk-Verkäufer', 'Hund im Auto', 'Rucksackreisende'] },
  { name: 'Hostel-Schlafsaal', roles: ['Rezeptionist', 'Schnarcher', 'Backpackerin aus Australien', 'Partygänger um 5 Uhr', 'Gitarrenspieler', 'Langschläferin', 'Sockenwäscher'] },
  { name: 'Kofferband', roles: ['Gepäckarbeiter', 'Passagier ohne Koffer', 'Spürhund', 'Zollbeamtin', 'Mann mit pinkem Koffer', 'Kind auf dem Band', 'Fundbüro-Mitarbeiterin'] },
  { name: 'Gipfelkreuz', roles: ['Bergführerin', 'Wanderer in Flip-Flops', 'Gämse', 'Gipfel-Fotograf', 'Schnaufender Onkel', 'Hüttenwirtin', 'Gleitschirmflieger'] },
  { name: 'Strandparty', roles: ['Gitarrist am Lagerfeuer', 'Stockbrot-Bäckerin', 'Feuerwehrmann', 'Pärchen am Wasser', 'Kind mit Wunderkerze', 'Mücke', 'Limbo-Meisterin'] },
  { name: 'Safari-Jeep', roles: ['Ranger', 'Löwe', 'Fotograf mit Riesenobjektiv', 'Ängstliche Urlauberin', 'Fahrerin', 'Giraffe', 'Affe, der Sonnenbrillen klaut'] },
  { name: 'Karaoke-Bar', roles: ['Mikro-Besetzer', 'Barkeeperin', 'Schiefsänger', 'Fan in der ersten Reihe', 'Technikerin', 'Schüchterne Kollegin', 'Elvis-Imitator'] },
  { name: 'Strandkorb-Verleih', roles: ['Vermieter', 'Paar im Strandkorb', 'Kind mit Eimer', 'Möwe', 'Kurtaxe-Kontrolleurin', 'Windschutz-Aufbauer', 'Sonnenschirm-Dieb'] },
  { name: 'Wattwanderung', roles: ['Wattführerin', 'Wattwurm', 'Gummistiefel-Verlierer', 'Krabbe', 'Familie mit Eimern', 'Fotografin', 'Seehund'] },
];

/** Überschrift der Auflösung (TV + Handy) */
export function tourOutcomeText(r: import('./types').TourState['reveal'], nameOf: (id: string | null) => string): string {
  if (!r) return '';
  const tw = r.touristen.length > 1 ? 'die Touristen sind' : 'der Tourist ist';
  switch (r.outcome) {
    case 'guess-right':
      return `${nameOf(r.guesser)} hat den Ort erraten!`;
    case 'guess-wrong':
      return `${nameOf(r.guesser)} tippt auf „${r.guess}“ – falsch!`;
    case 'caught':
      return `Erwischt! ${nameOf(r.accused)} ist der Tourist!`;
    case 'wrong-accuse':
      return `Falscher Verdacht! ${nameOf(r.accused)} war einheimisch.`;
    case 'timeout':
      return `Zeit um – ${tw} durchgekommen!`;
  }
}
