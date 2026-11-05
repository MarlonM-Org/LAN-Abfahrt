/**
 * Mini-Toolkit für prozedurale Pixel-Art auf einem Canvas.
 * Alles wird pixelgenau gezeichnet; `outline()` legt automatisch eine dunkle Kontur
 * um alle Formen – das macht den typischen "cozy Farm-Game"-Look aus.
 */
export class Pix {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingEnabled = false;
  }

  px(x: number, y: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    return this;
  }

  hline(x: number, y: number, w: number, c: string) {
    return this.rect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: string) {
    return this.rect(x, y, 1, h, c);
  }

  /** Gefüllte Ellipse, pixelig */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.g.fillStyle = c;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.g.fillRect(x, y, 1, 1);
      }
    }
    return this;
  }

  disc(cx: number, cy: number, r: number, c: string) {
    return this.ellipse(cx, cy, r, r, c);
  }

  /** Pixel-Map: jedes Zeichen → Farbe aus `pal`, '.' = transparent */
  map(x: number, y: number, rows: string[], pal: Record<string, string>) {
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch !== '.' && pal[ch]) this.px(x + i, y + j, pal[ch]);
      }),
    );
    return this;
  }

  /** Dunkle Kontur um alle nicht-transparenten Pixel (4er-Nachbarschaft). */
  outline(c: string) {
    const { w, h } = this;
    const img = this.g.getImageData(0, 0, w, h);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.data[(y * w + x) * 4 + 3]);
    const todo: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a(x, y) > 0) continue;
        if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) todo.push([x, y]);
      }
    }
    for (const [x, y] of todo) this.px(x, y, c);
    return this;
  }

  /** Zufällige Sprenkel einer Farbe (für Texturen) */
  speckle(x: number, y: number, w: number, h: number, c: string, count: number, rnd: () => number, size = 1) {
    for (let i = 0; i < count; i++) this.rect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), size, size, c);
    return this;
  }

  /** Zeichnen nur innerhalb eines Rechtecks */
  clip(x: number, y: number, w: number, h: number, fn: () => void) {
    this.g.save();
    this.g.beginPath();
    this.g.rect(x, y, w, h);
    this.g.clip();
    fn();
    this.g.restore();
    return this;
  }

  /** Nur auf bereits gefüllten Pixeln zeichnen (z. B. Highlights auf einer Form) */
  overlayOn(fn: () => void) {
    this.g.globalCompositeOperation = 'source-atop';
    fn();
    this.g.globalCompositeOperation = 'source-over';
    return this;
  }

  draw(other: Pix | HTMLCanvasElement, x: number, y: number, flip = false) {
    const src = other instanceof Pix ? other.canvas : other;
    if (flip) {
      this.g.save();
      this.g.translate(Math.floor(x) + src.width, Math.floor(y));
      this.g.scale(-1, 1);
      this.g.drawImage(src, 0, 0);
      this.g.restore();
    } else {
      this.g.drawImage(src, Math.floor(x), Math.floor(y));
    }
    return this;
  }
}

/** Deterministischer Zufall, damit Texturen nicht bei jedem Laden anders aussehen */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Farbe aufhellen (>1) oder abdunkeln (<1) */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Parallax: Hintergrundmaler zeichnen wahlweise nur eine Ebene – `far` (Himmel, Sonne, Horizont),
 * `mid` (Kulisse: Hütten, Palmen, Meer) oder `near` (Boden/Spielfläche); `all` = alles in ein Bild.
 */
export type BgLayer = 'all' | 'far' | 'mid' | 'near';

export const bgLayers = (layer: BgLayer) => ({
  far: layer === 'all' || layer === 'far',
  mid: layer === 'all' || layer === 'mid',
  near: layer === 'all' || layer === 'near',
});
