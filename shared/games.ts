import type { FieldType, KurvePower, MiniKind, Point, TttItemKind, TttRole, TttShopItem } from './types';

export interface MiniInfo {
  title: string;
  tagline: string;
  /** Kleines Erkennungs-Icon (Emoji) für Arcade-Kacheln, Laptop-Auswahl und Ansagen – Pflicht für jedes Spiel */
  icon: string;
  /** Vorbild als kleiner grauer Untertitel („à la …“) – die Spiele selbst heißen bewusst anders */
  inspiredBy?: string;
  minPlayers: number;
  /** Nur setzen, wenn ein Spiel nicht mit bis zu 12 Spielern (Lobby-Maximum) funktioniert */
  maxPlayers?: number;
  /** Wie das Handy gehalten wird – Pflicht (Ansage-Karte, Sperr-Overlay, TV-Banner, Android-Lock) */
  orientation: PhoneOrientation;
}

/** Handy-Haltung pro Spiel: quer = zwei Daumen wie am Gamepad, hochkant = eine Hand/Sensor/Listen/Text */
export type PhoneOrientation = 'portrait' | 'landscape' | 'any';

/** Ansage-Text zur Haltung (Handy-Karte, TV-Banner, Brett-Intro) */
export const ORIENT_TEXT: Record<PhoneOrientation, string> = {
  landscape: '📱↔ Handy QUER halten',
  portrait: '📱 Handy hochkant halten',
  any: '📱 Halte das Handy, wie du magst',
};

export const MINI_INFO: Record<MiniKind, MiniInfo> = {
  flunky: { title: 'Flunkyball', icon: '🍺', tagline: 'Werfen, trinken, laufen!', minPlayers: 2 , orientation: 'portrait' },
  wwe: { title: 'Wer würde eher ...?', icon: '🗳️', tagline: 'Stimmt ab – wer ist gemeint?', minPlayers: 2 , orientation: 'portrait' },
  sprint: { title: 'Liegestuhl-Sprint', icon: '🏖️', tagline: 'Handtuch drauf, sobald die Sonne aufgeht!', minPlayers: 2 , orientation: 'any' },
  murder: { title: 'Mord im Ferienhaus', icon: '🔪', inspiredBy: 'Among Us', tagline: 'Einer von euch ist nicht zum Entspannen hier ...', minPlayers: 4 , orientation: 'portrait' },
  descent: { title: 'Der Abstieg', icon: '⛰️', tagline: 'Den Abhang runter zum Rhein – springen!', minPlayers: 1 , orientation: 'any' },
  rhythm: { title: 'Das erste Gespräch', icon: '💬', tagline: 'Bleibt im Takt – dann funkt es!', minPlayers: 1, maxPlayers: 2 , orientation: 'portrait' },
  wrap: { title: 'Wraps mit Sriracha-Mayo', icon: '🌯', tagline: 'Zutaten in der richtigen Reihenfolge greifen!', minPlayers: 1 , orientation: 'portrait' },
  stars: { title: 'Tanz unter den Sternen', icon: '✨', tagline: 'Verbindet die Sterne zu Sternbildern!', minPlayers: 1, maxPlayers: 2 , orientation: 'any' },
  nhie: { title: 'Ich hab noch nie ...', icon: '🙊', tagline: 'Wer es schon getan hat, trinkt!', minPlayers: 2 , orientation: 'portrait' },
  hilo: { title: 'Höher oder Tiefer', icon: '🃏', tagline: 'Falsch geraten? Schluck!', minPlayers: 2 , orientation: 'portrait' },
  bomb: { title: 'Tick-Tack-Bumm', icon: '⏰', tagline: 'Begriff sagen, Bombe weitergeben!', minPlayers: 2 , orientation: 'portrait' },
  kingscup: { title: 'Kings Cup', icon: '👑', tagline: 'Karte ziehen, Regel befolgen – auf den König!', minPlayers: 2 , orientation: 'portrait' },
  sup: { title: 'SUP-Rennen', icon: '🏄', tagline: 'Zu zweit auf dem Board: einer links, einer rechts!', minPlayers: 1 , orientation: 'portrait' },
  tidy: { title: 'Aufräumen!', icon: '🧺', tagline: 'Schiebt das Chaos in euren Korb – Joystick am Handy!', minPlayers: 1 , orientation: 'landscape' },
  flieger: { title: 'Urlaubsflieger', icon: '✈️', inspiredBy: 'Spaceteam', tagline: 'Ruft euch die Anweisungen zu – sonst geht der Sprit aus!', minPlayers: 2 , orientation: 'portrait' },
  kurve: { title: 'Kurven-Duell', icon: '🌀', inspiredBy: '„Achtung, die Kurve!“', tagline: 'Links, rechts – und bloß keine Spur rammen!', minPlayers: 2 , orientation: 'landscape' },
  arena: { title: 'Bomben-Arena', icon: '💣', inspiredBy: 'Bomberman', tagline: 'Kokosnüsse legen, Sandburgen sprengen – wer bleibt trocken?', minPlayers: 2 , orientation: 'landscape' },
  bowling: { title: 'Strand-Bowling', icon: '🎳', tagline: 'Handy schwingen wie eine Bowlingkugel – Strike!', minPlayers: 2 , orientation: 'portrait' },
  enten: { title: 'Ententeich', icon: '🦆', inspiredBy: 'Duck Hunt', tagline: 'Handy auf den TV richten und abdrücken – aber nicht auf die Badegäste!', minPlayers: 2 , orientation: 'portrait' },
  ttt: { title: 'Verräter im Ferienhaus', icon: '🏊', inspiredBy: 'Trouble in Terrorist Town', tagline: 'Poolnudeln raus – wer spielt falsch?', minPlayers: 4 , orientation: 'landscape' },
  verstecken: { title: 'Versteckspiel mit Möbeln', icon: '🪴', inspiredBy: 'Prop Hunt', tagline: 'Werdet zur Kühlbox – und bloß nicht bewegen!', minPlayers: 3 , orientation: 'landscape' },
  parcours: { title: 'Fallen-Parcours', icon: '🏁', inspiredBy: 'Ultimate Chicken Horse', tagline: 'Baut Fallen – und schafft es selbst zur Cocktailbar!', minPlayers: 2 , orientation: 'landscape' },
  kart: { title: 'Kart-Rennen', icon: '🏎️', inspiredBy: 'Mario Kart', tagline: 'Verfolger-Kamera wie auf dem SNES – Gas, Drift, Items!', minPlayers: 2 , orientation: 'landscape' },
  turm: { title: 'Wackelturm', icon: '🗼', inspiredBy: 'Tricky Towers', tagline: 'Stapelt euer Urlaubsgepäck bis zum Gipfelkreuz!', minPlayers: 2 , orientation: 'landscape' },
  igel: { title: 'Igel-Krieg', icon: '🦔', inspiredBy: 'Worms', tagline: 'Kokosnüsse, Wasserbomben – wer bleibt auf der Insel?', minPlayers: 2 , orientation: 'landscape' },
  smash: { title: 'Smash-Arena', icon: '🥊', inspiredBy: 'Super Smash Bros.', tagline: 'Hau sie von der Bühne – wer zuletzt steht, gewinnt!', minPlayers: 2 , orientation: 'landscape' },
  wasser: { title: 'Wasserbomben-Schlacht', icon: '💦', tagline: 'Zielen, werfen, platsch – wer wird klatschnass?', minPlayers: 2 , orientation: 'landscape' },
  stillepost: { title: 'Stille Post mit Bildern', icon: '🖍️', inspiredBy: 'Gartic Phone', tagline: 'Schreiben, malen, raten – und dann lachen!', minPlayers: 3 , orientation: 'portrait' },
  fangen: { title: 'Urlaubs-Fangen', icon: '🕵️', inspiredBy: 'Mario Chase', tagline: 'Der Animateur ist unsichtbar – nur sein Handy kennt die Karte!', minPlayers: 3 , orientation: 'landscape' },
  geist: { title: 'Geisterjagd', icon: '👻', inspiredBy: "Luigi's Ghost Mansion", tagline: 'Stromausfall! Ein unsichtbarer Geist spukt durchs Haus ...', minPlayers: 3 , orientation: 'landscape' },
  grill: { title: 'Grill-Chaos', icon: '🔥', inspiredBy: 'Overcooked', tagline: 'Schnippeln, grillen, servieren – bevor die Gäste meckern!', minPlayers: 2 , orientation: 'landscape' },
  boule: { title: 'Boule am Strand', icon: '🥥', tagline: 'Legen oder schießen – wer liegt am Schweinchen?', minPlayers: 2 , orientation: 'portrait' },
  sumo: { title: 'Sumo-Steg', icon: '🤼', tagline: 'Rempeln, schubsen, platsch – wer bleibt auf dem Steg?', minPlayers: 2 , orientation: 'landscape' },
  volley: { title: 'Strand-Volleyball', icon: '🏐', inspiredBy: 'Slime Volleyball', tagline: 'Baggern, springen, schmettern – Team Sonne gegen Team Meer!', minPlayers: 2 , orientation: 'landscape' },
  tourist: { title: 'Wer ist der Tourist?', icon: '🧳', inspiredBy: 'Spyfall', tagline: 'Alle kennen den Ort – nur einer nicht. Fragt euch durch!', minPlayers: 4 , orientation: 'portrait' },
  sprueche: { title: 'Sprüche-Duell', icon: '🗯️', inspiredBy: 'Quiplash', tagline: 'Schreibt die lustigste Antwort – die anderen stimmen ab!', minPlayers: 3 , orientation: 'portrait' },
  pixel: { title: 'Pixel-Galerie', icon: '🖼️', tagline: 'Malt das Thema in 16 × 16 Pixeln – die Vernissage entscheidet!', minPlayers: 3 , orientation: 'portrait' },
  bogen: { title: 'Bogen-Arena', icon: '🏹', inspiredBy: 'TowerFall', tagline: 'Saugnapfpfeile, ein Treffer – und du bist raus!', minPlayers: 2, maxPlayers: 8 , orientation: 'landscape' },
  darts: { title: 'Darts an der Strandbar', icon: '🎯', tagline: 'Alle werfen gleichzeitig – Triple 20 oder Bullseye?', minPlayers: 2 , orientation: 'portrait' },
  golf: { title: 'Urlaubs-Minigolf', icon: '⛳', tagline: 'Alle putten gleichzeitig – Leuchtturm, Looping, Lagune!', minPlayers: 2 , orientation: 'portrait' },
  autoball: { title: 'Auto-Fußball', icon: '⚽', inspiredBy: 'Rocket League', tagline: 'Gas, Boost, Hüpfer – schiebt den Wasserball ins Tor!', minPlayers: 2 , orientation: 'landscape' },
  wpistole: { title: 'Wasserpistolen-Duell', icon: '🔫', inspiredBy: 'Wild Gunman', tagline: 'Hand ans Holster ... ZIEHT! Wer zuerst spritzt, bleibt trocken.', minPlayers: 2 , orientation: 'portrait' },
  zauber: { title: 'Zauber-Arena', icon: '🧙', inspiredBy: 'Spellsworn', tagline: 'Feuerbälle, Eilzauber, Lava – wer bleibt auf der Plattform?', minPlayers: 2 , orientation: 'landscape' },
  angeln: { title: 'Angeln', icon: '🎣', tagline: 'Auswerfen, anschlagen, drillen – wer zieht den dicksten Hecht aus dem See?', minPlayers: 2 , orientation: 'portrait' },
  spion: { title: 'Spion unter Gästen', icon: '🕶️', inspiredBy: 'Hidden in Plain Sight', tagline: 'Alle sehen gleich aus – nur dein Handy weiß, wer du bist!', minPlayers: 3 , orientation: 'portrait' },
  wackel: { title: 'Wackel-Prügelei', icon: '🤸', inspiredBy: 'Gang Beasts', tagline: 'Labbrige Puppen, Steg überm Meer – greifen, hauen, reinwerfen!', minPlayers: 2, maxPlayers: 8, orientation: 'landscape' },
  koffer: { title: 'Kofferpacken', icon: '🚗', tagline: 'Alles muss mit! Stapelt den Kofferraum voll, bevor Papa hupt.', minPlayers: 2 , orientation: 'landscape' },
  suess: { title: 'Süßigkeiten-Klau', icon: '🍬', inspiredBy: 'Animal Crossing: Sweet Day', tagline: 'Plündert die Minibar – aber je voller die Taschen, desto langsamer!', minPlayers: 3 , orientation: 'landscape' },
  umzug: { title: 'Umzugschaos', icon: '📦', inspiredBy: 'Moving Out', tagline: 'Sofa, Kühlschrank, Gartenzwerg – alles in den Laster, bevor der Vermieter klingelt!', minPlayers: 2, orientation: 'landscape' },
  werwolf: { title: 'Werwölfe im Ferienhaus', icon: '🐺', tagline: 'Vollmond über dem Ferienhaus – wer von euch hat Fell unterm Shirt?', minPlayers: 6 , orientation: 'portrait' },
};

/** „🏎️ Kart-Rennen“ – Titel mit Icon für Listen und Ansagen */
export const miniLabel = (kind: MiniKind) => `${MINI_INFO[kind].icon} ${MINI_INFO[kind].title}`;
/** „à la Mario Kart“ (leer, wenn kein Vorbild eingetragen ist) */
export const miniInspired = (kind: MiniKind) => (MINI_INFO[kind].inspiredBy ? `à la ${MINI_INFO[kind].inspiredBy}` : '');

// ------------------------------------------------------------------ Regelkarte (Phase `intro`)

/** Ein Steuer-Piktogramm der Regelkarte: Emoji + kurzer Text */
export interface HowToControl {
  icon: string;
  text: string;
}

/**
 * Regelkarte vor jedem Minispiel (TV + Handy, Raum-Phase `intro`): ein Satz Ziel und 2–3 Steuer-Piktogramme.
 * Das Übungsfeld am Handy liest die Bedienung direkt aus diesen Zeilen:
 *   - Icon 🕹️ = schwebender Stick (zweimal 🕹️ = zwei Sticks: laufen + zielen)
 *   - Text „KNOPF: …“ (vor dem Doppelpunkt nur Großbuchstaben/Symbole) = echter Knopf, „A / B: …“ = zwei Knöpfe;
 *     ◀ ▶ LINKS RECHTS bewegen die Mini-Figur, solange man sie hält
 *   - sonst (Sensor, Listen, Text) zeigt das Handy nur einen Hinweis
 * Pflicht für jedes neue Minispiel – Texte kurz halten (TV-Kachel ≈ 2 × 17 Zeichen).
 */
export const MINI_HOWTO: Record<MiniKind, { goal: string; controls: HowToControl[] }> = {
  flunky: { goal: 'Trefft die Flasche – dann trinkt, bis die anderen sie wieder aufgestellt haben.', controls: [{ icon: '🎯', text: 'Wischen: Ball werfen (Wind!)' }, { icon: '🍺', text: 'TRINKEN!: schnell tippen' }, { icon: '🏃', text: 'LAUFEN!: Flasche aufstellen' }] },
  wwe: { goal: 'Wer würde eher …? Stimmt geheim ab – Punkte gibt’s für die Mehrheit.', controls: [{ icon: '🗳️', text: 'Spieler antippen = Stimme' }, { icon: '🤫', text: 'Geheim – niemand sieht es' }, { icon: '📺', text: 'Auflösung auf dem TV' }] },
  sprint: { goal: 'Sobald die Sonne aufgeht: als Erster das Handtuch auf den Liegestuhl!', controls: [{ icon: '🌙', text: 'Warten, bis die Sonne kommt' }, { icon: '👆', text: 'JETZT!: so schnell wie möglich' }, { icon: '⚠️', text: 'Zu früh = Fehlstart' }] },
  murder: { goal: 'Erledigt Aufgaben im Ferienhaus – und entlarvt den Mörder, bevor er alle erwischt.', controls: [{ icon: '🤫', text: 'Rolle geheim (gedrückt halten)' }, { icon: '🚪', text: 'Raum antippen = hingehen' }, { icon: '🚨', text: 'Leiche melden, dann abstimmen' }] },
  descent: { goal: 'Springt gemeinsam den Abhang zum Rhein hinunter – Steinen ausweichen!', controls: [{ icon: '↔️', text: 'LINKS / RECHTS: laufen' }, { icon: '⤴️', text: 'SPRINGEN!: über Steine' }] },
  rhythm: { goal: 'Tippt im Takt, wenn die Noten unten ankommen – dann funkt es!', controls: [{ icon: '🔊', text: 'Ton am TV aufdrehen' }, { icon: '🥁', text: 'LINKS / RECHTS: im Takt tippen' }] },
  wrap: { goal: 'Greift die Zutaten in der richtigen Reihenfolge vom Rad.', controls: [{ icon: '📺', text: 'Reihenfolge steht auf dem TV' }, { icon: '✋', text: 'GREIFEN!: wenn die Zutat oben ist' }] },
  stars: { goal: 'Verbindet die Sterne gemeinsam zu Sternbildern.', controls: [{ icon: '✨', text: 'Wischen: von Stern zu Stern' }, { icon: '📺', text: 'Vorlage auf dem TV' }] },
  nhie: { goal: 'Ich hab noch nie … – wer es schon getan hat, trinkt!', controls: [{ icon: '👆', text: '„Noch nie!“ oder „Hab ich schon!“' }, { icon: '🍻', text: 'Als Einziger? Doppelt trinken' }] },
  hilo: { goal: 'Ist die nächste Karte höher oder tiefer? Falsch geraten = Schluck.', controls: [{ icon: '🃏', text: 'HÖHER / TIEFER: tippen' }, { icon: '🍻', text: 'Falsch geraten = trinken' }] },
  bomb: { goal: 'Sagt einen Begriff zur Kategorie und gebt die Bombe weiter – bevor sie knallt!', controls: [{ icon: '🗣️', text: 'Begriff laut sagen' }, { icon: '💣', text: 'WEITERGEBEN!: Bombe abgeben' }, { icon: '💥', text: 'Knall bei dir = 3 Schlücke' }] },
  kingscup: { goal: 'Reihum Karte ziehen und die Regel befolgen – auf den König!', controls: [{ icon: '🃏', text: 'Du bist dran: Karte ziehen' }, { icon: '📺', text: 'Die Regel steht auf dem TV' }, { icon: '⚡', text: 'Knopf-Rennen: schnell sein!' }] },
  sup: { goal: 'Paddelt zu zweit ins Ziel – gleichmäßig, sonst kippt das Board!', controls: [{ icon: '🚣', text: 'LINKS / RECHTS: paddeln' }, { icon: '⚖️', text: 'Gleichmäßig – sonst PLATSCH' }, { icon: '🪨', text: 'Felsen und Quallen ausweichen' }] },
  tidy: { goal: 'Schiebt das Chaos in den Korb eures Teams!', controls: [{ icon: '🕹️', text: 'Stick: laufen und schieben' }, { icon: '💨', text: 'SPRINT: kurz schneller' }, { icon: '🧺', text: 'Alles in euren Korb' }] },
  flieger: { goal: 'Ruft euch die Anweisungen zu – sie betreffen meist ein anderes Handy!', controls: [{ icon: '📣', text: 'Anweisung oben laut vorlesen' }, { icon: '🎛️', text: 'Eigene Knöpfe und Schalter' }, { icon: '⛽', text: 'Verpasst = weniger Sprit' }] },
  kurve: { goal: 'Zieht eure Spur und rammt weder Rand noch fremde Spuren!', controls: [{ icon: '↩️', text: 'LINKS / RECHTS: halten = lenken' }, { icon: '⭐', text: 'Power-ups einsammeln' }, { icon: '🏆', text: 'Wer überlebt, punktet' }] },
  arena: { goal: 'Sprengt euch den Weg frei und erwischt die anderen – wer trocken bleibt, gewinnt.', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '💣', text: 'BOMBE: Kokosnuss legen' }, { icon: '🌊', text: 'Nach 60 s kommt die Flut' }] },
  bowling: { goal: 'Räumt alle Pins ab – Strike!', controls: [{ icon: '📱', text: 'Knopf halten, Handy schwingen, loslassen' }, { icon: '👆', text: 'Ohne Sensor: nach oben wischen' }, { icon: '🎳', text: 'Reihum – zwei Würfe pro Frame' }] },
  enten: { goal: 'Schießt Enten, Möwen und Flamingos – aber keine Badegäste!', controls: [{ icon: '📱', text: 'Handy auf den TV richten' }, { icon: '👆', text: 'Tippen = schießen' }, { icon: '🔄', text: 'Nach unten wischen = laden' }] },
  ttt: { goal: 'Findet die Verräter – oder knockt als Verräter heimlich alle aus.', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '🏊', text: 'ANGRIFF: Poolnudel & Co.' }, { icon: '🔍', text: 'BENUTZEN: aufheben, untersuchen' }] },
  verstecken: { goal: 'Verstecker werden zu Möbeln – Sucher prüfen alles, was verdächtig aussieht.', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '🪴', text: 'VERWANDELN / EINRASTEN: Möbel werden' }, { icon: '🔍', text: 'PRÜFEN: Sucher testet Möbel' }] },
  parcours: { goal: 'Baut Fallen in die Strecke – und schafft es selbst zur Cocktailbar.', controls: [{ icon: '🕹️', text: 'Stick: Teil setzen, laufen' }, { icon: '🧱', text: 'PLATZIEREN: Teil einbauen' }, { icon: '⤴️', text: 'SPRINGEN: länger = höher' }] },
  kart: { goal: 'Drei Runden mit Items aus den ?-Boxen – wer kommt zuerst ins Ziel?', controls: [{ icon: '🕹️', text: 'Stick: lenken' }, { icon: '🏎️', text: 'GAS / BREMSE: halten' }, { icon: '✨', text: 'DRIFT: halten + lenken = Turbo' }] },
  turm: { goal: 'Stapelt euer Gepäck bis zum Gipfelkreuz und haltet den Turm 2 s.', controls: [{ icon: '↔️', text: '◀ / ▶: verschieben' }, { icon: '🔄', text: '⟳: drehen' }, { icon: '⬇️', text: '▼: halten = schneller fallen' }] },
  igel: { goal: 'Werft reihum Kokosnüsse und Wasserbomben – wer bleibt auf der Insel?', controls: [{ icon: '🦔', text: '◀ / ▶ / SPRUNG: laufen' }, { icon: '🎯', text: 'Ziel-Pad: in Schussrichtung ziehen' }, { icon: '🔥', text: 'FEUER: abschießen' }] },
  smash: { goal: 'Haut die anderen von der Bühne – je höher die Prozente, desto weiter fliegen sie.', controls: [{ icon: '🕹️', text: 'Stick: laufen, Richtung = Schlag' }, { icon: '🥊', text: 'SCHLAG / SPEZIAL: hauen' }, { icon: '🛡️', text: 'SPRUNG / SCHILD: springen, blocken' }] },
  wasser: { goal: 'Werft Wasserbomben auf die anderen – wer am trockensten bleibt, gewinnt.', controls: [{ icon: '🕹️', text: 'Linker Stick: laufen' }, { icon: '🕹️', text: 'Rechter Stick: zielen, loslassen = Wurf' }, { icon: '💦', text: 'Treffer machen nass' }] },
  stillepost: { goal: 'Schreiben, malen, raten – reihum wandert alles weiter. Am Ende wird gelacht.', controls: [{ icon: '✍️', text: 'Satz schreiben' }, { icon: '🖍️', text: 'Das Bild dazu malen' }, { icon: '🤔', text: 'Bild beschreiben' }] },
  fangen: { goal: 'Der Animateur ist unsichtbar – fangt ihn gemeinsam (oder entkommt als Animateur)!', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '💨', text: 'SPRINT / ABLENKUNG: Spezialknopf' }, { icon: '👣', text: 'Auf Fußspuren achten, rufen!' }] },
  geist: { goal: 'Ein unsichtbarer Geist spukt – leuchtet ihn an, bevor er euch erschreckt.', controls: [{ icon: '🕹️', text: 'Stick: laufen, Lampe zeigt nach vorn' }, { icon: '🔦', text: 'LICHT AN: Geist anleuchten' }, { icon: '👻', text: 'Als Geist: unsichtbar schweben' }] },
  grill: { goal: 'Arbeitet die Bestellungen ab: schnippeln, grillen, servieren!', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '🥕', text: 'NEHMEN: aufheben, ablegen' }, { icon: '🔪', text: 'AKTION: halten = schneiden, löschen' }] },
  boule: { goal: 'Bringt eure Kugeln am nächsten ans Schweinchen.', controls: [{ icon: '🥥', text: 'Legen oder Schießen wählen' }, { icon: '📱', text: 'Knopf halten, Handy schwingen' }, { icon: '👆', text: 'Ohne Sensor: nach oben wischen' }] },
  sumo: { goal: 'Schubst die anderen vom Steg – wer zuletzt steht, gewinnt.', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '💥', text: 'REMPELN: kurzer Sprint' }, { icon: '🌊', text: 'Der Steg bricht weg!' }] },
  volley: { goal: 'Team Sonne gegen Team Meer – der Ball darf nicht in eurem Sand landen.', controls: [{ icon: '↔️', text: '◀ / ▶: laufen' }, { icon: '⤴️', text: 'SPRUNG: Ball treffen' }, { icon: '💥', text: 'SCHMETTERN: nur in der Luft' }] },
  tourist: { goal: 'Alle kennen den Urlaubsort – nur der Tourist nicht. Findet ihn durch Fragen!', controls: [{ icon: '🃏', text: 'Karte zeigt Ort + Rolle (geheim)' }, { icon: '🗣️', text: 'Reihum fragen: Spieler antippen' }, { icon: '☝️', text: 'Verdacht? Anklagen!' }] },
  sprueche: { goal: 'Schreibt die lustigste Antwort – die anderen stimmen ab.', controls: [{ icon: '✍️', text: 'Lücke lustig füllen' }, { icon: '🗳️', text: 'Lieblingsantwort wählen' }, { icon: '🏆', text: 'Stimmen = Punkte' }] },
  pixel: { goal: 'Malt das Thema in 16 × 16 Pixeln – die Vernissage stimmt ab.', controls: [{ icon: '🎨', text: 'Farbe wählen, tippen oder wischen' }, { icon: '🪣', text: 'Eimer, Radierer, Zurück' }, { icon: '🗳️', text: 'Lieblingsbild wählen' }] },
  bogen: { goal: 'Ein Treffer und du bist raus – verschossene Pfeile wieder einsammeln!', controls: [{ icon: '🕹️', text: 'Stick: laufen und zielen' }, { icon: '🏹', text: 'SCHUSS: Pfeil abfeuern' }, { icon: '⤴️', text: 'SPRUNG / DASH: springen, ausweichen' }] },
  darts: { goal: 'Alle werfen gleichzeitig – Triple 20 oder Bullseye?', controls: [{ icon: '🎯', text: 'Ziehen: Fadenkreuz setzen' }, { icon: '✋', text: 'Ruhig halten = ruhiger' }, { icon: '👆', text: 'Wischen oder schnippen: werfen' }] },
  golf: { goal: 'Alle putten gleichzeitig – wer braucht die wenigsten Schläge?', controls: [{ icon: '⛳', text: 'Zurückziehen wie eine Schleuder' }, { icon: '📏', text: 'Ziehweg = Kraft' }, { icon: '📱', text: 'Mit Sensor: Handy pendeln' }] },
  autoball: { goal: 'Team Sonne gegen Team Meer: schiebt den Wasserball ins gegnerische Tor!', controls: [{ icon: '🕹️', text: 'Stick: lenken' }, { icon: '🏎️', text: 'GAS / BREMSE: fahren' }, { icon: '🚀', text: 'BOOST / HÜPFER: Turbo, Sprung' }] },
  wpistole: { goal: 'Wer nach „ZIEHT!“ zuerst trifft, bleibt trocken – wer zuckt, kriegt den Eimer.', controls: [{ icon: '✋', text: 'Hand ans Holster, warten' }, { icon: '📣', text: 'Erst bei „ZIEHT!“ ziehen' }, { icon: '💦', text: 'Zielen und spritzen' }] },
  zauber: { goal: 'Schleudert die anderen in die Lava – wer zuletzt steht, gewinnt.', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '🔥', text: 'ANGRIFF: Feuerball' }, { icon: '💨', text: 'EILE: kurzer Sprint' }] },
  angeln: { goal: 'Wer zieht den dicksten Fisch aus dem See?', controls: [{ icon: '🎣', text: 'Auswerfen: halten und schwingen' }, { icon: '❗', text: 'ANSCHLAGEN: beim Biss sofort' }, { icon: '🌀', text: 'Drill: halten = kurbeln' }] },
  spion: { goal: 'Erledige unauffällig deine vier Aufträge – und enttarne die anderen Spione.', controls: [{ icon: '🗺️', text: 'Karte antippen = hinschlendern' }, { icon: '✋', text: 'PLAUDERN / ERLEDIGEN: Aufträge' }, { icon: '🎈', text: 'Wasserballon: Spion enttarnen' }] },
  wackel: { goal: 'Werft die anderen labbrigen Puppen vom Steg ins Meer!', controls: [{ icon: '🕹️', text: 'Stick: torkeln und lehnen' }, { icon: '👊', text: 'HAUEN / SPRINGEN: in Stick-Richtung' }, { icon: '🤲', text: 'GREIFEN: halten = festkleben' }] },
  koffer: { goal: 'Packt den Kofferraum voll – was über die Kante hängt, fällt raus.', controls: [{ icon: '↔️', text: '◀ / ▶: verschieben' }, { icon: '🔄', text: '⟳: drehen' }, { icon: '⬇️', text: '▼: halten = rein damit' }] },
  suess: { goal: 'Plündert die Minibar und bringt die Beute ins Versteck – der Wächter jagt euch!', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '🍬', text: 'ABLEGEN / SPRINT: Beute, Tempo' }, { icon: '🐢', text: 'Volle Taschen = langsam' }] },
  umzug: { goal: 'Alles muss in den Laster, bevor der Vermieter klingelt!', controls: [{ icon: '🕹️', text: 'Stick: laufen' }, { icon: '📦', text: 'GREIFEN: halten = tragen' }, { icon: '💨', text: 'SPRINT: ohne Teil (sonst werfen)' }] },
  werwolf: { goal: 'Dorf gegen Werwölfe: Findet die Wölfe, bevor sie euch fressen.', controls: [{ icon: '🃏', text: 'Rolle geheim (verdeckte Karte)' }, { icon: '🌙', text: 'Nachts: alle tippen jemanden an' }, { icon: '🗳️', text: 'Tags: diskutieren, abstimmen' }] },
};

/** Übungsfeld-Bedienung aus der Regelkarte (siehe `MINI_HOWTO`): Anzahl Sticks und Knopf-Beschriftungen */
export function howToPractice(kind: MiniKind): { sticks: number; buttons: string[] } {
  const controls = MINI_HOWTO[kind]?.controls ?? [];
  const sticks = Math.min(2, controls.filter((c) => c.icon === '🕹️').length);
  const buttons: string[] = [];
  for (const c of controls) {
    const m = /^([^:]+):\s/.exec(c.text);
    if (!m || /[a-zäöüß]/.test(m[1])) continue;
    for (const b of m[1].split('/').map((x) => x.trim())) if (b && !buttons.includes(b)) buttons.push(b);
  }
  return { sticks, buttons };
}

/** Minispiele im Trinkspiel-Modus */
export const DRINK_KINDS: MiniKind[] = ['wwe', 'nhie', 'hilo', 'bomb', 'kingscup'];

/** Passt die Spielerzahl zu einem Minispiel (min. und ggf. max.)? */
export const fitsPlayers = (kind: MiniKind, n: number) => n >= MINI_INFO[kind].minPlayers && n <= (MINI_INFO[kind].maxPlayers ?? Infinity);

/** Minispiele, die im Party-Modus vorkommen */
export const PARTY_KINDS: MiniKind[] = ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'murder', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'stillepost', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'volley', 'tourist', 'sprueche', 'werwolf', 'pixel', 'bogen', 'darts', 'golf', 'autoball', 'wpistole', 'zauber', 'angeln', 'koffer', 'suess', 'spion', 'umzug', 'wackel'];
/** Versteckte-Rollen-Spiele: eines davon ist das Finale im Party-Modus */
export const FINALE_KINDS: MiniKind[] = ['murder', 'ttt'];
/**
 * Minispiele, die auf dem Spielbrett zufällig drankommen (Finale: Mord oder Verräter).
 * Ohne Igel/Turm (zu lang) und ohne Date-Night-Kapitel (Abstieg, Wraps). Lange Spiele (`MINI_LENGTH`)
 * zieht das Brett nur mit der VIP-Option „Lange Spiele“.
 */
export const BOARD_KINDS: MiniKind[] = ['flunky', 'sprint', 'sup', 'tidy', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'parcours', 'kart', 'smash', 'wasser', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'bogen', 'darts', 'golf', 'autoball', 'volley', 'wpistole', 'zauber', 'angeln', 'koffer', 'suess', 'spion', 'umzug', 'wackel'];

export type MiniLength = 'kurz' | 'mittel' | 'lang';
/**
 * Ungefähre Spieldauer bei einer typischen Gruppe (8–12 Spieler), aus den Konstanten geschätzt:
 * kurz ≤ 2 min, mittel ≤ 4 min, lang > 4 min. Das Spielbrett zieht standardmäßig nur kurz + mittel.
 */
export const MINI_LENGTH: Record<MiniKind, MiniLength> = {
  suess: 'mittel',
  spion: 'mittel',
  umzug: 'mittel',
  flunky: 'mittel',
  wwe: 'mittel',
  sprint: 'kurz',
  murder: 'lang',
  descent: 'kurz',
  rhythm: 'kurz',
  wrap: 'kurz',
  stars: 'kurz',
  nhie: 'mittel',
  hilo: 'kurz',
  bomb: 'kurz',
  kingscup: 'mittel',
  sup: 'kurz',
  tidy: 'kurz',
  flieger: 'mittel',
  kurve: 'mittel',
  arena: 'mittel',
  // reihum: bei 12 Spielern ca. 6 min
  bowling: 'lang',
  enten: 'kurz',
  // 2 × 100 s ab 6 Spielern, sonst 3 Runden
  ttt: 'lang',
  verstecken: 'mittel',
  parcours: 'mittel',
  kart: 'mittel',
  turm: 'mittel',
  igel: 'lang',
  smash: 'mittel',
  wasser: 'kurz',
  stillepost: 'lang',
  fangen: 'mittel',
  geist: 'mittel',
  grill: 'mittel',
  boule: 'mittel',
  sumo: 'kurz',
  volley: 'mittel',
  tourist: 'lang',
  sprueche: 'lang',
  pixel: 'mittel',
  bogen: 'mittel',
  darts: 'mittel',
  // 6 Bahnen à ca. 75 s (Party-Modus: 5)
  golf: 'lang',
  autoball: 'mittel',
  wpistole: 'kurz',
  zauber: 'mittel',
  angeln: 'mittel',
  koffer: 'mittel',
  // bis 5 Runden à 15–60 s (Flut beendet jede Runde)
  wackel: 'mittel',
  werwolf: 'lang',
};
/** Minispiele der Date Night */
export const DATE_KINDS: MiniKind[] = ['descent', 'rhythm', 'wrap', 'stars'];

// ------------------------------------------------------------------ Spielbrett

export const BOARD_SIZE = 24;

/**
 * Zeiten auf dem Spielbrett. Alle würfeln gleichzeitig im Würfelfenster (wer nicht würfelt, für den würfelt
 * am Ende der Server), danach laufen die Züge nacheinander im Schnelldurchlauf.
 */
export const BOARD_TIMING = {
  /** Ein Feld weiterhüpfen (vorher 280) */
  STEP_MS: 160,
  /** Würfel über der Figur, bevor sie losläuft */
  MOVE_LEAD_MS: 150,
  /** Pause nach einem Zug (vorher 1800) – nach Ereignis oder Cocktail etwas länger zum Lesen */
  PAUSE_MS: 700,
  EVENT_PAUSE_MS: 1100,
  /** Ansage des nächsten Minispiels (VIP kann sie überspringen) */
  INTRO_MS: 6000,
  /** Würfelfenster: so lange dürfen alle gleichzeitig würfeln */
  ROLL_WINDOW_MS: 10000,
  /** Bonus-Cocktails am Ende: Trommelwirbel, dann Auflösung pro Karte */
  BONUS_DRUM_MS: 1600,
  BONUS_SHOW_MS: 3600,
};
export const COCKTAIL_PRICE = 10;
/** Finale (Mord/Verräter) im Party-Modus: Sieger bekommen so viele Cocktails (zusätzlich zu den Münzen) */
export const FINALE_COCKTAILS = 2;
/** In den letzten Runden zählen blaue/rote Felder doppelt („Endspurt“) */
export const DOUBLE_ROUNDS = 2;
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

/**
 * Punkte-Staffel nach Spielerzahl: Platz 1 bekommt 10, der Letzte 1 (Trost), dazwischen linear
 * `round(10 · (n − Platz) / (n − 1))`. Bei 2 Spielern 10/5, allein 10.
 * `place` ist der Wettkampfrang (1 + Spieler in besseren Gruppen), `n` die Zahl der gewerteten Spieler.
 */
function placeScale(place: number, n: number) {
  if (n <= 1) return 10;
  if (n === 2) return place <= 1 ? 10 : 5;
  const p = Math.min(Math.max(1, place), n);
  return Math.max(1, Math.round((10 * (n - p)) / (n - 1)));
}

/** Münzen nach Platzierung im Minispiel (Party-Modus) */
export const placeCoins = (place: number, n: number) => placeScale(place, n);

/** Rang (1-basiert, bei Gleichstand gleicher Rang) jeder Gruppe: [[a, b], [c]] → [1, 3] */
export const groupPlaces = (groups: string[][]) => {
  let seen = 0;
  return groups.map((g) => {
    const place = seen + 1;
    seen += g.length;
    return place;
  });
};

// ------------------------------------------------------------------ Mord im Ferienhaus

export const ROOMS = [
  { name: 'Küche', task: 'Abwaschen' },
  { name: 'Wohnzimmer', task: 'Sofa aufräumen' },
  { name: 'Bad', task: 'Klo putzen' },
  { name: 'Schlafzimmer', task: 'Betten machen' },
  { name: 'Pool', task: 'Laub fischen' },
  { name: 'Garten', task: 'Grill sauber machen' },
];

/**
 * Zeiten im Mörderspiel. Die Aufgaben-Phase ist Spielzeit (bleibt). Diskussion und Abstimmung haben kein
 * Zeitlimit mehr (`null`; vorher 60 s / 30 s) – die Abstimmung endet, wenn alle gestimmt haben, der VIP kann
 * beides im Menü beenden. Rollen-/Rauswurf-Screens sind länger (vorher 8 s / 6 s) und überspringbar.
 */
export const MURDER = {
  ROLES_MS: 12000,
  TASKS_MS: 60000,
  MEETING_MS: null as number | null,
  VOTE_MS: null as number | null,
  EJECT_MS: 10000,
  TASK_TAPS: 15,
  TASKS_PER_PLAYER: 9,
};

// ------------------------------------------------------------------ Wer würde eher …?

/** `null` = kein Zeitlimit – aufgelöst wird, wenn alle abgestimmt haben (oder der VIP überspringt) */
export const WWE = { ROUNDS: 5, QUESTION_MS: null as number | null, REVEAL_MS: 15000 };

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

/**
 * Zeiten der Trinkspiele. `null` = kein Zeitlimit: Die Runde wird aufgelöst, sobald alle (verbundenen)
 * geantwortet haben – oder wenn der VIP im Menü überspringt. Auflösungen schalten großzügig von selbst weiter.
 */
export const NHIE = { ROUNDS: 6, QUESTION_MS: null as number | null, REVEAL_MS: 15000 };
export const HILO = { ROUNDS: 7, GUESS_MS: null as number | null, REVEAL_MS: 12000 };
/** Tick-Tack-Bumm: die Lunte ist Spielzeit (bleibt), nur die Pause nach dem Knall ist länger */
export const BOMB = { ROUNDS: 3, MIN_FUSE_MS: 15000, MAX_FUSE_MS: 38000, BOOM_MS: 9000, SIPS: 3, MIN_HOLD_MS: 900 };

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
};

// ------------------------------------------------------------------ Verräter im Ferienhaus

export const TTT = {
  ROLES_MS: 7000,
  ROUND_MS: 100000,
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
  /** Seitliches Raster des gesteuerten Teils (Blöcke): Zellkanten liegen immer auf diesem Raster */
  STEP: 0.5,
  /** Lock-Delay: so lange bleibt ein aufgesetztes Teil noch steuerbar (ms) – mit ▼ kürzer */
  LOCK_MS: 450,
  LOCK_FAST_MS: 120,
  /** Höchstens so lange ab dem ersten Aufsetzen (verhindert endloses Hin- und Herschieben) */
  LOCK_MAX_MS: 1600,
  /** Ausweichen beim Verschieben/Drehen, wenn es knapp klemmt (Blöcke, nach oben/unten) */
  KICK: 0.5,
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

/**
 * Rastet die x-Position (Schwerpunkt) so ein, dass die Zellkanten auf dem Halbblock-Raster liegen
 * (wie die Plattformkanten). Der Schwerpunkt selbst liegt bei L-, J- und gedrehten T-Teilen ein
 * Viertel daneben – deshalb wird über die Kanten gerastert, nicht über den Schwerpunkt.
 */
export function turmSnapX(shape: number, rot: number, x: number): number {
  const offs = turmCellOffsets(shape, (rot * Math.PI) / 2);
  const h = TURM.STEP * TURM.BLOCK;
  const left = x + Math.min(...offs.map((o) => o.x)) - TURM.BLOCK / 2;
  return Math.round((x + Math.round(left / h) * h - left) * 1000) / 1000;
}

// ------------------------------------------------------------------ Arcade

/**
 * Leaderboard-Punkte nach Platz und Spielerzahl (gleiche Staffel wie `placeCoins`: 1. 10 … Letzter 1).
 * Teamsiege: alle Sieger stehen in Gruppe 1 und bekommen die vollen Punkte.
 */
export const arcadePoints = (place: number, n: number) => placeScale(place, n);
/** Feste Punkte für gemeinsame Spiele ohne Herzen (alle in einer Gruppe) */
export const ARCADE_COOP_POINTS = 7;

/** Wort für ein Spiel einer Serie („Kart-Rennen · Rennen 3“) */
const SERIES_WORD: Partial<Record<MiniKind, string>> = { kart: 'Rennen', sup: 'Rennen', sprint: 'Lauf', parcours: 'Lauf', golf: 'Turnier', bowling: 'Spiel', darts: 'Spiel' };
export const seriesLabel = (kind: MiniKind, round: number) => `${SERIES_WORD[kind] ?? 'Runde'} ${round}`;

/** Zufallsauswahl im Arcade-Modus (ohne reine Trinkspiele und ohne Date-Night-Kapitel) */
export const ARCADE_RANDOM: MiniKind[] = ['flunky', 'sprint', 'sup', 'tidy', 'murder', 'wwe', 'flieger', 'kurve', 'arena', 'bowling', 'enten', 'ttt', 'verstecken', 'parcours', 'kart', 'turm', 'igel', 'smash', 'wasser', 'fangen', 'geist', 'grill', 'boule', 'sumo', 'bogen', 'darts', 'golf', 'autoball', 'volley', 'pixel', 'wpistole', 'zauber', 'angeln', 'koffer', 'suess', 'spion', 'umzug', 'wackel'];

/** Alle Spiele, nach Kategorie sortiert (für das Arcade-Menü) */
export const ARCADE_GROUPS: { title: string; kinds: MiniKind[] }[] = [
  { title: 'Action', kinds: ['flunky', 'sprint', 'descent', 'wrap', 'sup', 'tidy', 'kurve', 'arena', 'kart', 'smash', 'parcours', 'wasser', 'sumo', 'bogen', 'autoball', 'volley', 'zauber', 'suess', 'wackel'] },
  { title: 'Zielen & Werfen', kinds: ['bowling', 'boule', 'darts', 'golf', 'enten', 'wpistole', 'angeln', 'igel', 'turm', 'koffer'] },
  { title: 'Gemeinsam', kinds: ['rhythm', 'stars', 'flieger', 'grill', 'umzug'] },
  { title: 'Geheime Rollen', kinds: ['murder', 'ttt', 'verstecken', 'fangen', 'geist', 'spion', 'tourist', 'werwolf'] },
  { title: 'Partyklassiker', kinds: ['wwe', 'nhie', 'hilo', 'bomb', 'kingscup', 'stillepost', 'sprueche', 'pixel'] },
];
