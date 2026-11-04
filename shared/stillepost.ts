import type { PostDrawing } from './types';

/** Stille Post mit Bildern – Zeiten, Pinsel, Farben, Startsätze */
export const POST = {
  WRITE_MS: 45000,
  DRAW_MS: 70000,
  DESCRIBE_MS: 45000,
  VOTE_MS: 25000,
  /** Mehr Schritte pro Kette werden zu lang (≈ 6–8 Minuten Spielzeit) */
  MAX_STEPS: 8,
  MAX_TEXT: 90,
  /** Zeichenfläche: Koordinaten 0 … GRID (ganzzahlig, 1 Byte) */
  GRID: 255,
  MAX_POINTS: 2400,
  MAX_STROKES: 300,
};

/** Gemütliche 8-Farben-Palette (Index 8 = Radierer = Papierfarbe) */
export const POST_COLORS = ['#3d2414', '#e04a3f', '#f0973a', '#f2c33a', '#46b04a', '#3f8fe0', '#8f4a7d', '#c98a5e'];
export const POST_PAPER = '#fff6dc';
export const POST_ERASER = POST_COLORS.length;
/** Pinseldicken in Raster-Einheiten (bei GRID = 255) */
export const POST_BRUSHES = [3, 7, 16];

export const postColor = (c: number) => (c >= 0 && c < POST_COLORS.length ? POST_COLORS[c] : POST_PAPER);

/** Anzahl Punkte einer Zeichnung */
export const drawingPoints = (d: PostDrawing | null | undefined) => (d?.s ?? []).reduce((n, st) => n + st.p.length / 2, 0);

/**
 * Zeichnet eine Zeichnung weich (Canvas 2D, Kurven durch Mittelpunkte) – fürs Handy.
 * `size` = Kantenlänge in Canvas-Pixeln.
 */
export function paintDrawing(g: CanvasRenderingContext2D, d: PostDrawing | null | undefined, size: number, bg = true) {
  if (bg) {
    g.fillStyle = POST_PAPER;
    g.fillRect(0, 0, size, size);
  }
  for (const st of d?.s ?? []) paintStroke(g, st.c, st.w, st.p, size);
}

export function paintStroke(g: CanvasRenderingContext2D, c: number, w: number, p: number[], size: number) {
  if (p.length < 2) return;
  const k = size / POST.GRID;
  g.strokeStyle = g.fillStyle = postColor(c);
  g.lineWidth = (POST_BRUSHES[w] ?? POST_BRUSHES[1]) * k;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const n = p.length / 2;
  if (n === 1) {
    g.beginPath();
    g.arc(p[0] * k, p[1] * k, g.lineWidth / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  g.beginPath();
  g.moveTo(p[0] * k, p[1] * k);
  for (let i = 1; i < n - 1; i++) {
    const mx = ((p[i * 2] + p[i * 2 + 2]) / 2) * k;
    const my = ((p[i * 2 + 1] + p[i * 2 + 3]) / 2) * k;
    g.quadraticCurveTo(p[i * 2] * k, p[i * 2 + 1] * k, mx, my);
  }
  g.lineTo(p[(n - 1) * 2] * k, p[(n - 1) * 2 + 1] * k);
  g.stroke();
}

/**
 * Pixelgenaues Nachzeichnen für den TV (keine Kantenglättung → passt zum Pixel-Look).
 * `advance(n)` malt die nächsten n Punkte – damit lässt sich die Zeichnung Strich für Strich abspielen.
 */
export class DrawingRaster {
  readonly data: Uint8ClampedArray;
  readonly total: number;
  drawn = 0;
  private si = 0;
  private pi = 0;
  private rgb: [number, number, number][];

  constructor(
    private d: PostDrawing | null | undefined,
    readonly size: number,
  ) {
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rgb = [...POST_COLORS, POST_PAPER].map(hexRgb);
    const [r, g, b] = hexRgb(POST_PAPER);
    for (let i = 0; i < size * size; i++) {
      this.data[i * 4] = r;
      this.data[i * 4 + 1] = g;
      this.data[i * 4 + 2] = b;
      this.data[i * 4 + 3] = 255;
    }
    this.total = drawingPoints(d);
  }

  get finished() {
    return this.drawn >= this.total;
  }

  /** Malt bis zu n weitere Punkte; gibt true zurück, wenn sich etwas geändert hat */
  advance(n = Infinity): boolean {
    const strokes = this.d?.s ?? [];
    let changed = false;
    while (n > 0 && this.si < strokes.length) {
      const st = strokes[this.si];
      const k = this.size / POST.GRID;
      const r = ((POST_BRUSHES[st.w] ?? POST_BRUSHES[1]) * k) / 2;
      const col = this.rgb[Math.min(st.c, POST_COLORS.length)] ?? this.rgb[0];
      const i = this.pi;
      const x = st.p[i * 2] * k;
      const y = st.p[i * 2 + 1] * k;
      if (i === 0) this.disc(x, y, r, col);
      else this.segment(st.p[i * 2 - 2] * k, st.p[i * 2 - 1] * k, x, y, r, col);
      changed = true;
      this.drawn++;
      n--;
      this.pi++;
      if (this.pi >= st.p.length / 2) {
        this.si++;
        this.pi = 0;
      }
    }
    return changed;
  }

  private segment(x0: number, y0: number, x1: number, y1: number, r: number, col: [number, number, number]) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.6)));
    for (let i = 1; i <= steps; i++) this.disc(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r, col);
  }

  private disc(cx: number, cy: number, r: number, [cr, cg, cb]: [number, number, number]) {
    const S = this.size;
    const rr = Math.max(0.5, r);
    const x0 = Math.max(0, Math.floor(cx - rr));
    const x1 = Math.min(S - 1, Math.ceil(cx + rr));
    const y0 = Math.max(0, Math.floor(cy - rr));
    const y1 = Math.min(S - 1, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > rr * rr + 0.25) continue;
        const o = (y * S + x) * 4;
        this.data[o] = cr;
        this.data[o + 1] = cg;
        this.data[o + 2] = cb;
      }
    }
  }
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lustige Urlaubs-Startsätze für "Zufällig" (und für Bots) */
export const POST_PROMPTS = [
  'Ein Flamingo verliert beim Limbo',
  'Oma tanzt auf dem Ballermann',
  'Ein Krokodil im Schwimmring',
  'Der Kühlschrank ist leer, alle weinen',
  'Eine Möwe klaut eine Pommes',
  'Papa grillt im Regen',
  'Ein Kamel mit Sonnenbrand',
  'Der Koffer platzt am Flughafen',
  'Ein Hai spielt Wasserball',
  'Zwei Schnecken beim Wettrennen',
  'Ein Pinguin im Liegestuhl',
  'Der Bus fährt ohne uns los',
  'Eine Kokosnuss fällt auf den Kopf',
  'Ein Bär klaut das Picknick',
  'Sandburg wird von einer Welle zerstört',
  'Ein Elefant auf dem Sprungbrett',
  'Der Pilot macht ein Nickerchen',
  'Ein Delfin macht ein Selfie',
  'Opa verliert seine Badehose',
  'Eine Qualle auf der Luftmatratze',
  'Ein Hund surft auf einer Welle',
  'Der Eiswagen fährt weg',
  'Ein Schneemann im Hochsommer',
  'Zelt fliegt im Sturm davon',
  'Ein Tintenfisch spielt Schlagzeug',
  'Die Klimaanlage ist kaputt',
  'Ein Pirat sucht seinen Schatz am FKK-Strand',
  'Ein Huhn fährt Jetski',
  'Karaoke-Abend mit einem Esel',
  'Mama schläft am Pool ein',
  'Ein Seestern sonnt sich',
  'Ein Löwe am All-inclusive-Buffet',
  'Die Pizza landet im Pool',
  'Ein Koala hängt am Sonnenschirm',
  'Ein Tourist verliert seine Karte',
  'Ein Faultier beim Frühsport',
  'Der Nachbar mäht um 6 Uhr Rasen',
  'Ein Bierfass rollt den Berg runter',
  'Eine Kuh auf Skiern',
  'Ein Geist im Ferienhaus',
  'Ein Affe klaut die Sonnenbrille',
  'Wohnmobil steckt im Schlamm fest',
  'Die Schwiegermutter kommt mit',
  'Ein Dino im Wasserpark',
  'Ein Kaktus will umarmt werden',
  'Party auf dem Schlauchboot',
  'Ein Vulkan bricht beim Grillen aus',
  'Ein Robbenbaby lernt schwimmen',
  'Der Wecker klingelt im Urlaub',
  'Ein Einhorn an der Cocktailbar',
  'Die Sonnencreme ist alle',
  'Eine Ente leitet das Animationsprogramm',
  'Ein Bauarbeiter tanzt Ballett',
  'Ein Hamster im Hamsterrad-Marathon',
  'Ein Pferd im Autoscooter',
  'Ein Wal macht einen Kopfsprung',
  'Ein Alien bucht Pauschalreise',
  'Die Mücke gewinnt',
  'Ein Kängurustaffellauf',
  'Ein Tiger hat Angst vor Gurken',
  'Ein Ritter am Strand mit Rüstung',
  'Ein Fisch angelt einen Menschen',
  'Ein Eichhörnchen hortet Chips',
  'Ein Zug voller Schafe',
  'Ein Roboter lernt Flunkyball',
  'Der Grill ist zu heiß',
  'Eine Spinne strickt eine Hängematte',
  'Ein Pfau zeigt seine Urlaubsfotos',
  'Das Ferienhaus steht auf Stelzen',
  'Ein Riesenkrake im Whirlpool',
  'Ein Hai hat Angst vor Wasser',
  'Eine Katze auf dem Kreuzfahrtschiff',
  'Der Taxifahrer fährt in den See',
  'Ein Schaf im Fallschirm',
  'Eine Giraffe im Doppeldeckerbus',
  'Ein Kater nach der Strandparty',
  'Ein Frosch im Cocktailglas',
  'Das Navi schickt uns in den Wald',
  'Ein Maulwurf beim Minigolf',
  'Ein Hummer bekommt einen Sonnenbrand',
  'Ein Gorilla im Bademantel',
  'Ein Huhn legt ein Osterei am Strand',
  'Ein Pinguin verkauft Eis in der Wüste',
  'Der Hotelpool ist voller Gummienten',
  'Eine Schildkröte gewinnt das Wettrennen',
  'Oma springt vom Zehnmeterbrett',
];
