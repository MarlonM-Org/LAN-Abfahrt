import type { KartState, Look } from '../../shared/types';
import { KART, KART_TRACKS, type TrackDef, getTrack, wrapAngle } from '../../shared/kart';
import { AV_H, AV_W, SHIRTS, drawAvatar } from '../../shared/avatar';
import { type KartProp, paintKartOutside, paintKartScene } from '../art/kart';
import { bananaPeel, coconut, itemBox, seagull } from '../art/kartsprites';
import { C } from '../art/palette';
import { Pix, rng, shade } from '../art/pix';
import type { KartPose } from './world';

/**
 * Mode-7-Renderer (SNES-Stil) für die Verfolger-Ansicht – Canvas 2D, ohne Phaser, läuft auf TV und Handy.
 *
 * Der Boden ist die vorhandene Draufsicht-Textur der Strecke (480 × 270), die zeilenweise perspektivisch
 * abgetastet wird (pro Bildzeile eine feste Entfernung, pro Pixel ein Schritt nach rechts). Alles, was steht
 * (Karts, Item-Boxen, Palmen, Möwen …), wird als Billboard-Sprite mit Tiefensortierung darübergezeichnet.
 * Gerendert wird in kleiner Auflösung (z. B. 320 × 148) und vom Browser pixelig hochskaliert.
 */

export const WORLD_W = 480;
export const WORLD_H = 270;
const TWO_PI = Math.PI * 2;
/** Wie viele Drehstufen die Kart-Sprites haben */
const KART_STEPS = 16;

export interface Camera {
  x: number;
  y: number;
  angle: number;
}

interface Assets {
  theme: TrackDef['theme'];
  ground: Uint32Array;
  outside: Uint32Array;
  props: KartProp[];
  sky: HTMLCanvasElement;
  skyTop: string;
  horizonColor: string;
}

const assets = new Map<number, Assets>();

function pixels(p: Pix): Uint32Array {
  return new Uint32Array(p.g.getImageData(0, 0, p.w, p.h).data.buffer);
}

/** Boden, Deko und Himmel einer Strecke (einmalig gebaut) */
export function kartAssets(trackIndex: number): Assets {
  const hit = assets.get(trackIndex);
  if (hit) return hit;
  const track = getTrack(trackIndex);
  const theme = track.def.theme;
  const scene = paintKartScene(track, WORLD_W, WORLD_H, false);
  const sky = paintSky(theme);
  const a: Assets = {
    theme,
    ground: pixels(scene.ground),
    outside: pixels(paintKartOutside(theme)),
    props: scene.props,
    sky: sky.canvas,
    skyTop: theme === 'harbor' ? '#4f86c9' : '#4ea5e8',
    horizonColor: theme === 'harbor' ? '#bfe3f2' : theme === 'pool' ? '#d7ecf7' : '#cfe8f5',
  };
  assets.set(trackIndex, a);
  return a;
}

const SKY_W = 1024;
const SKY_H = 64;

/** Himmel-Panorama (1024 breit = einmal rundherum), Horizont ganz unten; oben darf abgeschnitten werden */
function paintSky(theme: TrackDef['theme']): Pix {
  const H = SKY_H;
  const p = new Pix(SKY_W, H);
  const r = rng(theme === 'beach' ? 31 : theme === 'harbor' ? 32 : 33);
  const top = theme === 'harbor' ? '#4f86c9' : '#4ea5e8';
  const mid = theme === 'harbor' ? '#8fc0e6' : '#8fd0f4';
  const low = theme === 'harbor' ? '#bfe3f2' : theme === 'pool' ? '#d7ecf7' : '#cfe8f5';
  for (let y = 0; y < H; y++) p.hline(0, y, SKY_W, y < H * 0.3 ? top : y < H * 0.62 ? mid : low);
  // Sonne
  const sunX = theme === 'pool' ? 840 : 220;
  p.disc(sunX, 30, 9, '#ffe27a').disc(sunX, 30, 6, '#fff6c8');
  // Wolken
  for (let i = 0; i < 16; i++) {
    const x = r() * SKY_W;
    const y = 18 + r() * 26;
    const w = 10 + r() * 16;
    p.ellipse(x, y, w, 4, '#fdfdff').ellipse(x - w * 0.4, y + 1, w * 0.5, 3.5, '#fdfdff').ellipse(x + w * 0.4, y + 2, w * 0.55, 3, '#fdfdff');
    p.ellipse(x, y + 3, w, 2, '#e6eef8');
  }
  if (theme === 'beach') {
    // Meer am Horizont mit Segelbooten
    p.rect(0, H - 8, SKY_W, 8, '#2b6ba6').hline(0, H - 8, SKY_W, '#7fc4ee');
    for (let i = 0; i < 10; i++) {
      const x = 20 + r() * (SKY_W - 40);
      p.rect(x - 3, H - 6, 7, 2, '#f4efe2').rect(x, H - 11, 1, 5, '#e0503f').rect(x + 1, H - 10, 2, 3, '#f4efe2');
    }
  } else if (theme === 'harbor') {
    // Kräne und Containerschiffe als Silhouetten
    p.rect(0, H - 5, SKY_W, 5, '#3b6e9c');
    for (let i = 0; i < 9; i++) {
      const x = 30 + i * 110 + r() * 30;
      p.rect(x, H - 28, 3, 24, '#2f4a6a').rect(x - 14, H - 28, 34, 2, '#2f4a6a').rect(x + 18, H - 26, 1, 8, '#2f4a6a');
    }
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 200 + r() * 40;
      p.rect(x, H - 13, 40, 8, '#4a3f55').rect(x + 8, H - 19, 12, 6, '#f4efe2').rect(x + 4, H - 16, 30, 3, '#e0503f');
    }
  } else {
    // Hügel und ein Hotel
    for (let i = 0; i < 14; i++) p.ellipse(r() * SKY_W, H + 4, 40 + r() * 50, 14 + r() * 8, i % 2 ? '#79b857' : '#6aa84a');
    for (const hx of [300, 760]) {
      p.rect(hx, H - 32, 60, 32, '#f1dcb8').rect(hx, H - 32, 60, 2, '#d8473c');
      for (let y = H - 28; y < H - 4; y += 6) for (let x = hx + 4; x < hx + 58; x += 8) p.rect(x, y, 4, 3, '#4fa3e0');
    }
    p.rect(0, H - 4, SKY_W, 4, '#5e9c3c');
  }
  return p;
}

// ------------------------------------------------------------------ Sprites

const spriteCache = new Map<string, Pix>();
const cached = (key: string, make: () => Pix) => {
  let p = spriteCache.get(key);
  if (!p) {
    p = make();
    spriteCache.set(key, p);
  }
  return p;
};

/**
 * Kart schräg von hinten/seitlich in einer von 16 Drehstufen (0 = von hinten gesehen), 24 × 20 px ≙ 12 × 10 Weltpixel.
 * Pseudo-3D: Draufsicht-Punkte werden gedreht, Tiefe auf 45 % gestaucht und Höhe nach oben aufgetragen.
 */
function kartBody(color: string, step: number): Pix {
  return cached(`kb_${color}_${step}`, () => {
    const p = new Pix(24, 20);
    const rel = (step / KART_STEPS) * TWO_PI;
    const cs = Math.cos(rel);
    const sn = Math.sin(rel);
    const S = 1.7;
    const cx = 12;
    const cy = 14;
    // lf = nach vorn, lr = nach rechts (Welt), h = Höhe → Bildkoordinaten
    const P = (lf: number, lr: number, h: number) => {
      const d = lf * cs - lr * sn;
      const l = lf * sn + lr * cs;
      return [cx + l * S, cy - d * S * 0.45 - h * S] as const;
    };
    const poly = (pts: (readonly [number, number])[], col: string) => {
      p.g.fillStyle = col;
      p.g.beginPath();
      pts.forEach(([x, y], i) => (i ? p.g.lineTo(x, y) : p.g.moveTo(x, y)));
      p.g.closePath();
      p.g.fill();
    };
    const wheelAt = (lf: number, lr: number) => {
      const [x, y] = P(lf, lr, 0);
      p.rect(x - 2, y - 3, 4, 4, '#2b2630');
      p.px(x - 1, y - 3, '#4a4452');
    };
    const wheels: [number, number][] = [
      [-3.2, -3.4],
      [-3.2, 3.4],
      [3.2, -3.4],
      [3.2, 3.4],
    ];
    // Hintere (weiter entfernte) Räder zuerst
    wheels.sort((a, b) => b[0] * cs - b[1] * sn - (a[0] * cs - a[1] * sn));
    wheels.slice(0, 2).forEach(([f, r]) => wheelAt(f, r));
    // Karosserie: Sockel dunkel, Oberseite in Shirt-Farbe
    const body = (h: number) => [P(-4, -2.6, h), P(3.5, -2.6, h), P(4.5, 0, h), P(3.5, 2.6, h), P(-4, 2.6, h)];
    poly(body(0.4), shade(color, 0.6));
    poly(body(1.2), shade(color, 0.8));
    poly(body(2.1), color);
    // Sitz, Frontspoiler (weiß), Auspuff
    poly([P(-2.5, -1.4, 2.2), P(0.2, -1.4, 2.2), P(0.2, 1.4, 2.2), P(-2.5, 1.4, 2.2)], '#3a3440');
    poly([P(3.6, -2.8, 2.2), P(4.6, -2.8, 2.2), P(4.6, 2.8, 2.2), P(3.6, 2.8, 2.2)], '#e8e2d6');
    const [ex, ey] = P(-4.6, 1.2, 1);
    p.rect(ex - 1, ey - 1, 2, 2, '#9a948a');
    wheels.slice(2).forEach(([f, r]) => wheelAt(f, r));
    p.outline(C.outline);
    return p;
  });
}

function portrait(look: Look): Pix {
  const key = `pt_${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}_${look.beard ?? 0}`;
  return cached(key, () => {
    const full = new Pix(AV_W, AV_H);
    drawAvatar(full.g, look);
    const p = new Pix(AV_W, 14);
    p.g.drawImage(full.canvas, 0, 0, AV_W, 14, 0, 0, AV_W, 14);
    return p;
  });
}

const sprites = {
  box: [() => cached('box0', () => itemBox(0)), () => cached('box1', () => itemBox(2))],
  coconut: () => cached('coco', coconut),
  banana: () => cached('banana', bananaPeel),
  gull: [() => cached('gull0', () => seagull(0)), () => cached('gull1', () => seagull(1))],
};

// ------------------------------------------------------------------ Renderer

interface Billboard {
  z: number;
  draw: () => void;
}

export interface RenderOpts {
  lookOf: (id: string) => Look | undefined;
  /** performance.now() für Animationen */
  now: number;
}

export class Mode7Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  w = 0;
  h = 0;
  /** Horizontzeile, Brennweite, Kamerahöhe */
  private yh = 0;
  private f = 0;
  private camH = 11;
  private assets: Assets;

  constructor(trackIndex: number, w: number, h: number) {
    this.assets = kartAssets(trackIndex);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    w = Math.max(32, Math.round(w));
    h = Math.max(32, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.yh = Math.round(h * 0.36);
    this.f = Math.min(w * 0.55, h * 1.3);
  }

  /** Kamera hinter einem Kart (Abstand wächst leicht mit der Geschwindigkeit) */
  static chase(pose: KartPose, camAngle: number): Camera {
    const d = 30 + Math.min(10, pose.speed * 0.07);
    return { x: pose.x - Math.cos(camAngle) * d, y: pose.y - Math.sin(camAngle) * d, angle: camAngle };
  }

  render(cam: Camera, st: KartState, poses: KartPose[], o: RenderOpts) {
    const { w, h, yh, f, camH } = this;
    const A = this.assets;
    const g = this.ctx;
    const cs = Math.cos(cam.angle);
    const sn = Math.sin(cam.angle);
    // Rechts-Vektor: Blickrichtung um 90° im Uhrzeigersinn (Bildschirm-y zeigt nach unten)
    const rx = -sn;
    const ry = cs;

    // 1) Boden zeilenweise
    const buf = this.buf;
    const ground = A.ground;
    const outside = A.outside;
    const GW = WORLD_W;
    const GH = WORLD_H;
    for (let y = yh + 1; y < h; y++) {
      const z = (camH * f) / (y - yh);
      const step = z / f;
      let wx = cam.x + cs * z - rx * step * (w / 2);
      let wy = cam.y + sn * z - ry * step * (w / 2);
      const dx = rx * step;
      const dy = ry * step;
      let i = y * w;
      for (let x = 0; x < w; x++) {
        if (wx >= 0 && wy >= 0 && wx < GW && wy < GH) buf[i] = ground[(wy | 0) * GW + (wx | 0)];
        else buf[i] = outside[((wy | 0) & 31) * 32 + ((wx | 0) & 31)];
        i++;
        wx += dx;
        wy += dy;
      }
    }
    g.putImageData(this.img, 0, 0);

    // 2) Himmel (scrollt mit der Blickrichtung) + Dunst am Horizont
    const hfov = 2 * Math.atan(w / 2 / f);
    const skyW = (w * TWO_PI) / hfov;
    const scale = skyW / SKY_W;
    const skyH = yh + 1;
    const drawH = Math.min(skyH, Math.round(SKY_H * scale));
    const srcH = drawH / scale;
    if (drawH < skyH) {
      g.fillStyle = A.skyTop;
      g.fillRect(0, 0, w, skyH - drawH + 1);
    }
    const offset = ((((cam.angle / TWO_PI) * skyW) % skyW) + skyW) % skyW;
    for (let sx = -offset; sx < w; sx += skyW) g.drawImage(A.sky, 0, SKY_H - srcH, SKY_W, srcH, Math.round(sx), skyH - drawH, Math.ceil(skyW), drawH);
    const fog = g.createLinearGradient(0, yh, 0, yh + Math.max(6, h * 0.14));
    fog.addColorStop(0, A.horizonColor);
    fog.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fog;
    g.fillRect(0, yh, w, Math.max(6, h * 0.14) + 1);

    // 3) Billboards sammeln
    const list: Billboard[] = [];
    const project = (x: number, y: number) => {
      const dx = x - cam.x;
      const dy = y - cam.y;
      const z = dx * cs + dy * sn;
      const l = dx * rx + dy * ry;
      return { z, sx: w / 2 + (l * f) / z, sy: yh + (camH * f) / z, s: f / z };
    };
    const far = 230;
    const blit = (img: Pix, sx: number, sy: number, s: number, k: number, lift = 0) => {
      const dw = img.w * s * k;
      const dh = img.h * s * k;
      if (sx + dw / 2 < 0 || sx - dw / 2 > w || sy - dh - lift * s > h) return;
      g.drawImage(img.canvas, Math.round(sx - dw / 2), Math.round(sy - dh - lift * s), Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)));
    };
    const shadow = (sx: number, sy: number, rxp: number, ryp: number, alpha = 0.25) => {
      g.fillStyle = `rgba(0,0,0,${alpha})`;
      g.beginPath();
      g.ellipse(sx, sy, Math.max(1, rxp), Math.max(0.7, ryp), 0, 0, TWO_PI);
      g.fill();
    };

    for (const pr of A.props) {
      const q = project(pr.x, pr.y);
      if (q.z < 1.5 || q.z > far) continue;
      list.push({ z: q.z, draw: () => blit(pr.img, q.sx, q.sy, q.s, 1) });
    }
    st.boxes.forEach((b, i) => {
      if (!b.on) return;
      const q = project(b.x, b.y);
      if (q.z < 1.5 || q.z > far) return;
      const frame = Math.floor(o.now / 250 + i) % 2;
      const bob = 3 + Math.sin(o.now / 300 + i) * 1;
      list.push({
        z: q.z,
        draw: () => {
          shadow(q.sx, q.sy, 5 * q.s, 1.8 * q.s, 0.2);
          blit(sprites.box[frame](), q.sx, q.sy, q.s, 1, bob);
        },
      });
    });
    for (const hz of st.hazards) {
      const q = project(hz.x, hz.y);
      if (q.z < 1.5 || q.z > far) continue;
      const img = hz.kind === 'coconut' ? sprites.coconut() : sprites.banana();
      list.push({ z: q.z, draw: () => blit(img, q.sx, q.sy, q.s, 1, hz.kind === 'coconut' ? 1.5 : 0) });
    }
    for (const gl of st.gulls) {
      const q = project(gl.x, gl.y);
      if (q.z < 1.5 || q.z > far) continue;
      const img = sprites.gull[Math.floor(o.now / 120) % 2]();
      list.push({
        z: q.z,
        draw: () => {
          shadow(q.sx, q.sy, 4 * q.s, 1.3 * q.s, 0.15);
          blit(img, q.sx, q.sy, q.s, 1, 9);
        },
      });
    }
    for (const k of poses) {
      const q = project(k.x, k.y);
      if (q.z < 2 || q.z > far) continue;
      list.push({ z: q.z, draw: () => this.drawKart(k, q, cam, o, blit, shadow) });
    }

    // 4) Von hinten nach vorn zeichnen
    list.sort((a, b) => b.z - a.z);
    for (const b of list) b.draw();
  }

  private drawKart(
    k: KartPose,
    q: { z: number; sx: number; sy: number; s: number },
    cam: Camera,
    o: RenderOpts,
    blit: (img: Pix, sx: number, sy: number, s: number, k: number, lift?: number) => void,
    shadow: (sx: number, sy: number, rx: number, ry: number, alpha?: number) => void,
  ) {
    const g = this.ctx;
    const look = o.lookOf(k.id);
    const color = look ? (SHIRTS[look.shirt] ?? C.red) : C.red;
    let rel = wrapAngle(k.angle - cam.angle);
    if (k.spin > 0) rel += (o.now / 55) % TWO_PI;
    else if (k.drift) rel += k.drift * 0.35;
    const step = ((Math.round((rel / TWO_PI) * KART_STEPS) % KART_STEPS) + KART_STEPS) % KART_STEPS;
    const K = 0.42;
    const s = q.s;
    if (k.finished) g.globalAlpha = 0.6;
    shadow(q.sx, q.sy, 6.5 * s, 2.2 * s);
    // Effekte hinter dem Kart (im Bild: unter/neben den Hinterrädern)
    const seed = (o.now / 40) | 0;
    const rnd = rng(seed + k.id.charCodeAt(0) * 7);
    if (k.boost) {
      for (let i = 0; i < 4; i++) {
        const px = q.sx + (rnd() - 0.5) * 8 * s;
        const py = q.sy - rnd() * 3 * s;
        const r = (1.5 + rnd() * 2) * s;
        g.fillStyle = rnd() < 0.5 ? '#ffd25e' : '#f0973a';
        g.fillRect(px - r / 2, py - r / 2, r, r);
      }
    } else if (k.drift) {
      const cols = k.charged ? ['#f0973a', '#ffd25e', '#fff4d6'] : ['#93d3f3', '#ffffff', '#5fb4e8'];
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const px = q.sx + side * (4.5 + rnd() * 2) * s * K * 2 + (rnd() - 0.5) * 2 * s;
          const py = q.sy - rnd() * 2.5 * s;
          const r = (0.8 + rnd() * 1.4) * s;
          g.fillStyle = cols[(rnd() * cols.length) | 0];
          g.fillRect(px - r / 2, py - r / 2, r, r);
        }
      }
    } else if (k.offroad && k.speed > 15 && !k.finished) {
      for (let i = 0; i < 3; i++) {
        const px = q.sx + (rnd() - 0.5) * 10 * s;
        const py = q.sy - rnd() * 2 * s;
        const r = (1 + rnd() * 1.5) * s;
        g.fillStyle = this.assets.theme === 'pool' ? '#86c957' : this.assets.theme === 'harbor' ? '#bdb8ae' : '#dfb878';
        g.fillRect(px - r / 2, py - r / 2, r, r);
      }
    }
    blit(kartBody(color, step), q.sx, q.sy + 2 * s * K, s, K);
    if (look) blit(portrait(look), q.sx, q.sy, s * 0.75, K, 6.5);
    g.globalAlpha = 1;
  }
}

/** Strecken-Name fürs HUD */
export const trackName = (i: number) => KART_TRACKS[i]?.name ?? 'Strecke';
export const trackTheme = (i: number) => KART_TRACKS[i]?.theme ?? 'beach';
export { KART };
