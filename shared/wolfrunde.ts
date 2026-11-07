/**
 * Werwolf mit Erzähler – Rollen, Kartenstapel und Zustandstypen.
 *
 * Das Spiel selbst macht nur zwei Dinge: Karten auslosen (jeder sieht nur seine eigene) und dem Erzähler eine
 * Übersicht geben (alle Karten + Totenkopf-Knopf pro Spieler). Alles andere erzählt und entscheidet der Erzähler.
 * Der öffentliche Zustand (`WrState`, geht auch an den TV) enthält KEINE Karten – erst am Spielende (`roles`).
 * Karten gehen nur per `privateFor()` raus: jeder Spieler seine eigene, der Erzähler alle (`WrPrivate.book`).
 */

export type WrRole = 'werwolf' | 'seher' | 'hexe' | 'jaeger' | 'amor' | 'maedchen' | 'dieb' | 'dorf';
export type WrTeam = 'dorf' | 'wolf';

export const WR_ROLES: Record<WrRole, { name: string; plural: string; icon: string; color: string; team: WrTeam; text: string }> = {
  werwolf: { name: 'Werwolf', plural: 'Werwölfe', icon: '🐺', color: '#a8342a', team: 'wolf', text: 'Nachts sucht ihr euch ein Opfer.' },
  seher: { name: 'Seher', plural: 'Seher', icon: '🔮', color: '#7b3fa8', team: 'dorf', text: 'Jede Nacht siehst du eine Karte.' },
  hexe: { name: 'Hexe', plural: 'Hexen', icon: '🧪', color: '#2f7d32', team: 'dorf', text: 'Ein Heiltrank, ein Gifttrank.' },
  jaeger: { name: 'Jäger', plural: 'Jäger', icon: '🎯', color: '#8d5629', team: 'dorf', text: 'Stirbst du, nimmst du einen mit.' },
  amor: { name: 'Amor', plural: 'Amor', icon: '💘', color: '#b0306a', team: 'dorf', text: 'Verliebt in der 1. Nacht zwei Leute.' },
  maedchen: { name: 'Mädchen', plural: 'Mädchen', icon: '👧', color: '#c0567e', team: 'dorf', text: 'Darf nachts heimlich blinzeln.' },
  dieb: { name: 'Dieb', plural: 'Diebe', icon: '🦹', color: '#4a4f6e', team: 'dorf', text: 'Darf in der 1. Nacht tauschen.' },
  dorf: { name: 'Dorfbewohner', plural: 'Dorfbewohner', icon: '🏡', color: '#2d64a8', team: 'dorf', text: 'Findet die Werwölfe!' },
};

/** Sonderrollen, die der Erzähler an-/abwählen kann (Reihenfolge = Anzeige) */
export const WR_SPECIALS: WrRole[] = ['seher', 'hexe', 'jaeger', 'amor', 'maedchen', 'dieb'];

/** Reihenfolge in der Übersicht des Erzählers (≈ Weckreihenfolge, Dorfbewohner zuletzt) */
export const WR_ORDER: WrRole[] = ['dieb', 'amor', 'seher', 'werwolf', 'maedchen', 'hexe', 'jaeger', 'dorf'];

export const wrTeam = (r: WrRole): WrTeam => WR_ROLES[r].team;

/** Mindestens so viele Mitspieler mit Karte (ohne Erzähler) */
export const WR_MIN_CARDS = 4;

export const WR = {
  /** Ende: Sieger-Ansage auf dem TV, dann Ergebnis */
  OVER_MS: 7000,
};

/** Kartenstapel: Werwölfe + gewählte Sonderrollen, Rest Dorfbewohner */
export interface WrConfig {
  wolves: number;
  specials: WrRole[];
}

/** Höchstens knapp unter der Hälfte Werwölfe (4 → 1, 6 → 2, 8 → 3, 12 → 5) */
export const wrMaxWolves = (n: number) => Math.max(1, Math.ceil(n / 2) - 1);

/** Mit Dieb kommen zwei Karten mehr in den Stapel – die zwei übrigen kann er in der ersten Nacht tauschen */
export const wrDeckSize = (c: WrConfig, n: number) => n + (c.specials.includes('dieb') ? 2 : 0);

/** Vorschlag nach Spielerzahl (ohne Erzähler): ≈ 1 Werwolf pro 4, Seher + Hexe immer, Jäger ab 6, Amor ab 7, Mädchen ab 9 */
export function wrDefaultConfig(n: number): WrConfig {
  const specials: WrRole[] = ['seher', 'hexe'];
  if (n >= 6) specials.push('jaeger');
  if (n >= 7) specials.push('amor');
  if (n >= 9) specials.push('maedchen');
  return wrFixConfig({ wolves: Math.floor((n + 1) / 4), specials }, n);
}

/** Gültig machen: Werwölfe 1 … max, Sonderrollen einmalig und so viele, wie in den Stapel passen */
export function wrFixConfig(c: WrConfig, n: number): WrConfig {
  const wolves = Math.max(1, Math.min(wrMaxWolves(n), Math.round(Number(c.wolves) || 1)));
  const specials = WR_SPECIALS.filter((r) => c.specials.includes(r));
  while (specials.length && wolves + specials.length > wrDeckSize({ wolves, specials }, n)) {
    // Zuerst die hinterste Sonderrolle außer dem Dieb streichen (der Dieb bringt selbst zwei Karten mit)
    let i = specials.length - 1;
    while (i > 0 && specials[i] === 'dieb') i--;
    specials.splice(specials[i] === 'dieb' ? specials.length - 1 : i, 1);
  }
  return { wolves, specials };
}

/** Passt noch eine Karte mehr (Werwolf bzw. Sonderrolle) in den Stapel? */
export function wrFits(c: WrConfig, n: number, add: { wolf?: boolean; role?: WrRole }): boolean {
  const wolves = c.wolves + (add.wolf ? 1 : 0);
  if (wolves > wrMaxWolves(n)) return false;
  const specials = add.role && !c.specials.includes(add.role) ? [...c.specials, add.role] : c.specials;
  return wolves + specials.length <= wrDeckSize({ wolves, specials }, n);
}

/** Alle Karten des Stapels (n Spieler + beim Dieb zwei übrige) */
export function wrDeck(c: WrConfig, n: number): WrRole[] {
  const deck: WrRole[] = [];
  for (let i = 0; i < c.wolves; i++) deck.push('werwolf');
  deck.push(...c.specials);
  while (deck.length < wrDeckSize(c, n)) deck.push('dorf');
  return deck;
}

/** „2 Werwölfe · Seher · Hexe · 3 Dorfbewohner“ */
export function wrSummary(c: WrConfig, n: number): string {
  const villagers = wrDeckSize(c, n) - c.wolves - c.specials.length;
  const parts = [c.wolves === 1 ? '1 Werwolf' : `${c.wolves} Werwölfe`, ...c.specials.map((r) => WR_ROLES[r].name)];
  if (villagers > 0) parts.push(`${villagers} Dorfbewohner`);
  return parts.join(' · ');
}

/** Weckreihenfolge für den Erzähler – nur die Rollen im Spiel, ein Wort pro Schritt */
export function wrWakeOrder(c: WrConfig, firstNight: boolean): string[] {
  const has = (r: WrRole) => c.specials.includes(r);
  const out: string[] = [];
  if (firstNight && has('dieb')) out.push('Dieb');
  if (firstNight && has('amor')) out.push('Amor', 'Verliebte');
  if (has('seher')) out.push('Seher');
  out.push(has('maedchen') ? 'Werwölfe 👧' : 'Werwölfe');
  if (has('hexe')) out.push('Hexe');
  return out;
}

export type WrSub = 'setup' | 'play' | 'over';
/** Tageszeit, die der Erzähler umschaltet (nur Stimmung am TV): `dusk` = Karten ansehen, vor der ersten Nacht */
export type WrTime = 'dusk' | 'night' | 'day';
export type WrWinner = 'dorf' | 'wolf' | 'liebe';

export const WR_WINNER: Record<WrWinner, { title: string; button: string }> = {
  dorf: { title: 'Das Dorf gewinnt!', button: '🏡 Dorf gewinnt' },
  wolf: { title: 'Die Werwölfe gewinnen!', button: '🐺 Werwölfe gewinnen' },
  liebe: { title: 'Die Verliebten gewinnen!', button: '💘 Verliebte gewinnen' },
};

/** Öffentlich – geht an TV und alle Handys. Keine Karten (außer `roles` am Ende). */
export interface WrState {
  sub: WrSub;
  endsIn: number;
  /** Vom VIP gewählt (null = noch keiner) */
  narrator: string | null;
  /** Mitspieler mit Karte (alle außer dem Erzähler) – in `setup` die, die gerade eine bekämen */
  players: string[];
  /** Zusammensetzung des Stapels (öffentlich wie beim Kartenspiel: welche Rollen dabei sind, nicht wer) */
  config: WrConfig;
  alive: Record<string, boolean>;
  time: WrTime;
  /** Nummer der Nacht (0 = noch keine); Tag n folgt auf Nacht n */
  round: number;
  /** Zählt jedes Austeilen – neue Karten → Handys bauen die Karte neu */
  deal: number;
  winner: WrWinner | null;
  /** Alle Karten – erst am Spielende */
  roles: Record<string, WrRole> | null;
}

/** Übersicht nur für den Erzähler */
export interface WrBook {
  cards: Record<string, WrRole>;
  /** Wer ursprünglich die Dieb-Karte hatte (null = kein Dieb im Spiel) */
  dieb: string | null;
  /** Der Dieb hat sich entschieden (getauscht oder behalten) */
  stolen: boolean;
  /** Die zwei übrigen Karten (nur mit Dieb; nach dem Tausch liegt dort die Dieb-Karte) */
  rest: WrRole[];
}

/** Geheim – nur für den jeweiligen Spieler */
export interface WrPrivate {
  deal: number;
  /** Eigene Karte (null = keine: Erzähler oder nicht dabei) */
  card: WrRole | null;
  /** Dieb vor seiner Entscheidung: die zwei übrigen Karten (sonst null) */
  steal: WrRole[] | null;
  /** Hat als Dieb getauscht – `card` ist die neue Karte */
  wasDieb: boolean;
  /** Nur der Erzähler */
  book: WrBook | null;
}
