import type { Look } from '../../shared/types';
import { AV_H, AV_W, drawAvatar } from '../../shared/avatar';
import { KUG, type KugelCourse, cellX, cellY, distToPath, routePoint } from '../../shared/kugel';
import { seeded } from '../../shared/balance';
import { Pix } from '../art/pix';

/**
 * Verfolgerkamera für die Tempel-Kugel (Mode-7 wie im Kart, Canvas 2D, ohne Phaser).
 * Der Boden ist das Labyrinth als Draufsicht-Textur (2× aufgelöst), zeilenweise perspektivisch abgetastet; alles, was
 * steht (Fackeln, Säulen im Abgrund, Ziel-Altar, die Kugel mit der Figur obendrauf), kommt als Billboard darüber.
 * Dazu eine Minikarte oben rechts – im Labyrinth muss man ja wissen, wo das Ziel liegt.
 */

export const WORLD_W = 480;
export const WORLD_H = 270;
const TEX = 2;
const TWO_PI = Math.PI * 2;
const SKY_W = 1024;
const SKY_H = 64;
const BALL_R = KUG.BALL_R;
/** Abstand der Kamera hinter der Kugel (px) und Höhe über dem Boden */
const CAM_D = 50;
const CAM_H = 30;

// ------------------------------------------------------------------ Texturen

interface Assets {
  ground: Uint32Array;
  groundCanvas: HTMLCanvasElement;
  sky: HTMLCanvasElement;
  pillars: { x: number; y: number; h: number; w: number; c: number }[];
}

const cache = new Map<number, { course: KugelCourse; assets: Assets }>();

function newCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Labyrinth als Boden: Abgrund, Mauerrand, Moosrand, Steinplatten mit Fugen und Moos, Start-Rune, Ziel-Glühen */
function paintGround(course: KugelCourse, seed: number): HTMLCanvasElement {
  const cv = newCanvas(WORLD_W * TEX, WORLD_H * TEX);
  const g = cv.getContext('2d')!;
  g.scale(TEX, TEX);
  g.fillStyle = '#03050b';
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  const shape = (r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    for (const [c1, r1, c2, r2] of course.links) {
      const x1 = cellX(Math.min(c1, c2));
      const x2 = cellX(Math.max(c1, c2));
      const y1 = cellY(Math.min(r1, r2));
      const y2 = cellY(Math.max(r1, r2));
      g.rect(x1 - r, y1 - r, x2 - x1 + 2 * r, y2 - y1 + 2 * r);
    }
    const seen = new Set<number>();
    for (const [c1, r1, c2, r2] of course.links)
      for (const [c, r] of [[c1, r1], [c2, r2]]) {
        const k = r * KUG.COLS + c;
        if (seen.has(k)) continue;
        seen.add(k);
        g.moveTo(cellX(c) + r, cellY(r));
        g.arc(cellX(c), cellY(r), r, 0, TWO_PI);
      }
    g.fill();
  };
  // Dunst-Hof um den Pfad, Mauerwand, Moosrand, Stein
  shape(KUG.R + 12, '#05080f');
  shape(KUG.R + 7, '#080c16');
  shape(KUG.R + 4, '#0f141d');
  shape(KUG.R + 3, '#232b21');
  shape(KUG.R + 1.6, '#3a4531');
  shape(KUG.R + 0.4, '#4f8a3c');
  shape(KUG.R - 1.4, '#9c9f90');

  // Fugen, dunkle Platten und Moos
  let rs = seed % 9973 || 7;
  const rnd = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);
  for (const [c1, r1, c2, r2] of course.links) {
    const horiz = r1 === r2;
    const a = horiz ? cellX(Math.min(c1, c2)) : cellY(Math.min(r1, r2));
    const b = horiz ? cellX(Math.max(c1, c2)) : cellY(Math.max(r1, r2));
    const fixed = horiz ? cellY(r1) : cellX(c1);
    g.lineWidth = 0.6;
    g.strokeStyle = '#7a7f70';
    for (let t = a + 5; t < b; t += 8 + Math.floor(rnd() * 4)) {
      g.beginPath();
      if (horiz) {
        g.moveTo(t, fixed - KUG.R + 2);
        g.lineTo(t, fixed + KUG.R - 2);
      } else {
        g.moveTo(fixed - KUG.R + 2, t);
        g.lineTo(fixed + KUG.R - 2, t);
      }
      g.stroke();
    }
    for (let k = 0; k < 7; k++) {
      const t = a + rnd() * (b - a);
      const off = (rnd() < 0.5 ? -1 : 1) * (KUG.R - 2.5 - rnd() * 3);
      g.fillStyle = rnd() < 0.5 ? '#6fa84a' : '#58923c';
      g.beginPath();
      g.arc(horiz ? t : fixed + off, horiz ? fixed + off : t, 1.2 + rnd() * 2.2, 0, TWO_PI);
      g.fill();
    }
    for (let k = 0; k < 5; k++) {
      g.fillStyle = 'rgba(70,74,62,0.35)';
      g.fillRect(horiz ? a + rnd() * (b - a) : fixed - KUG.R + 3 + rnd() * 10, horiz ? fixed - KUG.R + 3 + rnd() * 10 : a + rnd() * (b - a), 3, 2);
    }
  }
  // Start-Rune
  const s = course.start;
  g.strokeStyle = '#ffd25e';
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(cellX(s.c), cellY(s.r), KUG.R - 3, 0, TWO_PI);
  g.stroke();
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(cellX(s.c), cellY(s.r), KUG.R - 6.5, 0, TWO_PI);
  g.stroke();
  // Ziel: goldenes Leuchten
  const e = course.goal;
  const gr = g.createRadialGradient(cellX(e.c), cellY(e.r), 1, cellX(e.c), cellY(e.r), KUG.R + 2);
  gr.addColorStop(0, 'rgba(255,241,168,0.95)');
  gr.addColorStop(1, 'rgba(255,210,94,0.15)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cellX(e.c), cellY(e.r), KUG.R - 1, 0, TWO_PI);
  g.fill();
  return cv;
}

/** Nachthimmel-Panorama (1024 breit = einmal rundherum), Horizont ganz unten */
function paintSky(): HTMLCanvasElement {
  const p = new Pix(SKY_W, SKY_H);
  const r = seeded(77);
  const bands = ['#070b1a', '#0b1230', '#121b46', '#1d2860', '#31387a', '#4e4f90'];
  bands.forEach((c, i) => p.rect(0, Math.floor((i * SKY_H) / bands.length), SKY_W, Math.ceil(SKY_H / bands.length), c));
  for (let i = 0; i < 160; i++) p.px(r() * SKY_W, r() * SKY_H * 0.7, r() < 0.2 ? '#fff4d6' : '#9fb2e8');
  p.disc(330, 20, 8, '#fff7c9').disc(334, 18, 7, '#e9e3b3');
  // Tempel-Silhouetten am Horizont: Stufenpyramiden, Säulenreihen, Tore
  for (let i = 0; i < 9; i++) {
    const x = i * 118 + r() * 40;
    const kind = Math.floor(r() * 3);
    const col = '#0f1430';
    if (kind === 0) for (let k = 0; k < 5; k++) p.rect(x + k * 3, SKY_H - 8 - (5 - k) * 3 - 3, 40 - k * 6, 3, col);
    else if (kind === 1) for (let k = 0; k < 5; k++) p.rect(x + k * 7, SKY_H - 22, 3, 22, col).rect(x + k * 7 - 1, SKY_H - 23, 5, 2, col);
    else p.rect(x, SKY_H - 20, 4, 20, col).rect(x + 20, SKY_H - 20, 4, 20, col).rect(x - 2, SKY_H - 24, 28, 5, col);
  }
  // Dunst am Horizont
  for (let y = SKY_H - 10; y < SKY_H; y++) p.g.fillStyle = `rgba(110,110,170,${(y - (SKY_H - 10)) / 22})`, p.g.fillRect(0, y, SKY_W, 1);
  return p.canvas;
}

function assetsFor(seed: number, course: KugelCourse): Assets {
  const hit = cache.get(seed);
  if (hit) return hit.assets;
  cache.clear();
  const groundCanvas = paintGround(course, seed);
  const px = groundCanvas.getContext('2d')!.getImageData(0, 0, groundCanvas.width, groundCanvas.height);
  const r = seeded(seed ^ 0x5bd1);
  const pillars: Assets['pillars'] = [];
  for (let tries = 0; pillars.length < 22 && tries < 300; tries++) {
    const x = -30 + r() * (WORLD_W + 60);
    const y = -30 + r() * (WORLD_H + 80);
    if (distToPath(course, x, y) < KUG.R + 18) continue;
    pillars.push({ x, y, h: 26 + r() * 60, w: 7 + r() * 9, c: r() });
  }
  const assets: Assets = { ground: new Uint32Array(px.data.buffer), groundCanvas, sky: paintSky(), pillars };
  cache.set(seed, { course, assets });
  return assets;
}

// ------------------------------------------------------------------ Figur

const figs = new Map<string, Pix>();
/** Die Figur von hinten (Hinterkopf mit Haaren, Arme zum Balancieren seitlich) */
function figureBack(look: Look): Pix {
  const key = `${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}`;
  let p = figs.get(key);
  if (!p) {
    p = new Pix(AV_W, AV_H);
    drawAvatar(p.g, look, 0, 0, 1, { view: 'back', arms: 'out' });
    figs.set(key, p);
  }
  return p;
}

export interface KugelFrame {
  x: number;
  y: number;
  ang: number;
  vx: number;
  vy: number;
  fall: number;
  /** Anzahl erreichter Kontrollpunkte */
  cp: number;
  /** Zeigt die Kugel (nicht in `ready`/`over`) */
  show: boolean;
}

export interface KugelRenderOpts {
  look?: Look;
  /** Spielerfarbe '#rrggbb' */
  color: string;
  /** Abgerollte Strecke (px) – dreht die Kugel */
  roll: number;
  now: number;
}

/** Bildschirm-Lage eines Weltpunkts der letzten Ansicht (für Effekte der Szene) */
export interface Screen {
  sx: number;
  sy: number;
  s: number;
  z: number;
}

export class KugelRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  w = 0;
  h = 0;
  private yh = 0;
  private f = 0;
  private cam = { x: 0, y: 0, angle: 0 };
  private assets: Assets;
  private outside: number;

  constructor(
    private course: KugelCourse,
    seed: number,
    w: number,
    h: number,
  ) {
    this.assets = assetsFor(seed, course);
    this.outside = this.assets.ground[0];
    this.canvas = newCanvas(w, h);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    w = Math.max(64, Math.round(w));
    h = Math.max(64, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.yh = Math.round(h * 0.3);
    this.f = Math.min(w * 0.55, h * 1.3);
  }

  /** Weltpunkt → Bildschirm (nach `render`) */
  project(x: number, y: number): Screen {
    const { cam, w, yh, f } = this;
    const cs = Math.cos(cam.angle);
    const sn = Math.sin(cam.angle);
    const dx = x - cam.x;
    const dy = y - cam.y;
    const z = dx * cs + dy * sn;
    const l = -dx * sn + dy * cs;
    return { z, sx: w / 2 + (l * f) / z, sy: yh + (CAM_H * f) / z, s: f / z };
  }

  render(k: KugelFrame, o: KugelRenderOpts) {
    const { w, h, yh, f } = this;
    const g = this.ctx;
    const A = this.assets;
    const cs = Math.cos(k.ang);
    const sn = Math.sin(k.ang);
    this.cam = { x: k.x - cs * CAM_D, y: k.y - sn * CAM_D, angle: k.ang };
    const cam = this.cam;
    const rx = -sn;
    const ry = cs;

    // 1) Boden zeilenweise
    const buf = this.buf;
    const GW = WORLD_W * TEX;
    const GH = WORLD_H * TEX;
    const ground = A.ground;
    const out = this.outside;
    for (let y = yh + 1; y < h; y++) {
      const z = (CAM_H * f) / (y - yh);
      const step = z / f;
      let wx = (cam.x + cs * z - rx * step * (w / 2)) * TEX;
      let wy = (cam.y + sn * z - ry * step * (w / 2)) * TEX;
      const dx = rx * step * TEX;
      const dy = ry * step * TEX;
      let i = y * w;
      for (let x = 0; x < w; x++) {
        buf[i++] = wx >= 0 && wy >= 0 && wx < GW && wy < GH ? ground[(wy | 0) * GW + (wx | 0)] : out;
        wx += dx;
        wy += dy;
      }
    }
    g.putImageData(this.img, 0, 0);

    // 2) Himmel (scrollt mit der Blickrichtung) und Dunst am Horizont
    const hfov = 2 * Math.atan(w / 2 / f);
    const skyW = (w * TWO_PI) / hfov;
    const scale = skyW / SKY_W;
    const skyH = yh + 1;
    const drawH = Math.min(skyH, Math.round(SKY_H * scale));
    const srcH = drawH / scale;
    if (drawH < skyH) {
      g.fillStyle = '#070b1a';
      g.fillRect(0, 0, w, skyH - drawH + 1);
    }
    const offset = ((((cam.angle / TWO_PI) * skyW) % skyW) + skyW) % skyW;
    for (let sx = -offset; sx < w; sx += skyW) g.drawImage(A.sky, 0, SKY_H - srcH, SKY_W, srcH, Math.round(sx), skyH - drawH, Math.ceil(skyW), drawH);
    const fogH = Math.max(8, h * 0.3);
    const fog = g.createLinearGradient(0, yh, 0, yh + fogH);
    fog.addColorStop(0, 'rgba(78,79,144,0.95)');
    fog.addColorStop(1, 'rgba(78,79,144,0)');
    g.fillStyle = fog;
    g.fillRect(0, yh, w, fogH + 1);

    // 3) Billboards
    const list: { z: number; draw: () => void }[] = [];
    const far = 360;
    const proj = (x: number, y: number) => this.project(x, y);

    // Säulen und Mauerreste im Abgrund (nur zur Tiefe)
    for (const p of A.pillars) {
      const q = proj(p.x, p.y);
      if (q.z < 4 || q.z > far) continue;
      list.push({
        z: q.z,
        draw: () => {
          const bw = p.w * q.s;
          const bh = p.h * q.s;
          g.fillStyle = p.c < 0.5 ? '#1b2231' : '#202a38';
          g.fillRect(q.sx - bw / 2, q.sy - bh, bw, bh);
          g.fillStyle = '#2b3646';
          g.fillRect(q.sx - bw / 2, q.sy - bh, Math.max(1, bw * 0.25), bh);
          g.fillStyle = '#35553a';
          g.fillRect(q.sx - bw / 2, q.sy - bh, bw, Math.max(1, bh * 0.07));
        },
      });
    }

    // Fackeln an den Kontrollpunkten
    this.course.checkpoints.forEach((idx, i) => {
      const p = routePoint(this.course, idx);
      const q = proj(p.x + KUG.R - 1, p.y - KUG.R + 3);
      if (q.z < 3 || q.z > far) return;
      const lit = i < k.cp;
      list.push({
        z: q.z,
        draw: () => {
          const s = q.s;
          g.fillStyle = '#5e3518';
          g.fillRect(q.sx - 1 * s, q.sy - 9 * s, 2 * s, 9 * s);
          g.fillStyle = '#3a3f4a';
          g.fillRect(q.sx - 2 * s, q.sy - 10 * s, 4 * s, 1.5 * s);
          if (lit) {
            const fl = 1 + Math.sin(o.now / 80 + i * 3) * 0.12;
            const glow = g.createRadialGradient(q.sx, q.sy - 13 * s, 1, q.sx, q.sy - 13 * s, 12 * s * fl);
            glow.addColorStop(0, 'rgba(255,190,90,0.55)');
            glow.addColorStop(1, 'rgba(255,190,90,0)');
            g.fillStyle = glow;
            g.fillRect(q.sx - 14 * s, q.sy - 27 * s, 28 * s, 28 * s);
            g.fillStyle = '#ffa83a';
            g.beginPath();
            g.ellipse(q.sx, q.sy - 13 * s, 2.2 * s * fl, 3.4 * s * fl, 0, 0, TWO_PI);
            g.fill();
            g.fillStyle = '#fff1a8';
            g.beginPath();
            g.ellipse(q.sx, q.sy - 12.4 * s, 1 * s, 1.8 * s, 0, 0, TWO_PI);
            g.fill();
          } else {
            g.fillStyle = '#6b6f78';
            g.beginPath();
            g.ellipse(q.sx, q.sy - 12 * s, 2 * s, 2.6 * s, 0, 0, TWO_PI);
            g.fill();
          }
        },
      });
    });

    // Ziel: Altar mit Lichtsäule (von weitem zu sehen)
    {
      const q = proj(cellX(this.course.goal.c), cellY(this.course.goal.r));
      if (q.z > 3) {
        list.push({
          z: q.z,
          draw: () => {
            const s = q.s;
            const beam = g.createLinearGradient(0, q.sy - 70 * s, 0, q.sy);
            beam.addColorStop(0, 'rgba(255,241,168,0)');
            beam.addColorStop(1, 'rgba(255,241,168,0.55)');
            g.fillStyle = beam;
            g.fillRect(q.sx - 7 * s, q.sy - 70 * s, 14 * s, 70 * s);
            g.fillStyle = '#c9a24a';
            g.fillRect(q.sx - 4 * s, q.sy - 6 * s, 8 * s, 6 * s);
            g.fillStyle = '#e8c868';
            g.fillRect(q.sx - 4 * s, q.sy - 6 * s, 8 * s, 1.5 * s);
            const pulse = 1 + Math.sin(o.now / 200) * 0.15;
            g.fillStyle = '#4fd1e8';
            g.beginPath();
            g.moveTo(q.sx, q.sy - 15 * s * pulse);
            g.lineTo(q.sx + 3 * s, q.sy - 10 * s);
            g.lineTo(q.sx, q.sy - 6 * s);
            g.lineTo(q.sx - 3 * s, q.sy - 10 * s);
            g.closePath();
            g.fill();
          },
        });
      }
    }

    // Die Kugel mit der Figur obendrauf
    if (k.show) {
      const q = proj(k.x, k.y);
      list.push({ z: q.z, draw: () => this.drawBall(k, q, o) });
    }

    list.sort((a, b) => b.z - a.z);
    for (const b of list) b.draw();

    // 4) Nebelschleier über dem fernen Boden
    const mist = g.createLinearGradient(0, yh, 0, yh + h * 0.22);
    mist.addColorStop(0, 'rgba(30,38,72,0.5)');
    mist.addColorStop(1, 'rgba(30,38,72,0)');
    g.fillStyle = mist;
    g.fillRect(0, yh, w, h * 0.22);

    this.minimap(k, o);
  }

  private drawBall(k: KugelFrame, q: Screen, o: KugelRenderOpts) {
    const g = this.ctx;
    const s = q.s;
    const r = BALL_R * s;
    const fall = k.fall;
    const sink = fall * 22 * s;
    const sc = 1 - fall * 0.8;
    g.save();
    g.globalAlpha = 1 - fall * 0.75;
    const cx = q.sx;
    const cy = q.sy - r * sc - 0.5 * s + sink;
    const rr = r * sc;
    if (fall === 0) {
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.beginPath();
      g.ellipse(q.sx, q.sy, r * 1.15, r * 0.4, 0, 0, TWO_PI);
      g.fill();
    }
    // Kugel
    g.fillStyle = o.color;
    g.beginPath();
    g.arc(cx, cy, rr, 0, TWO_PI);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, rr, 0, TWO_PI);
    g.clip();
    // Drehende Flecken: wandern an der sichtbaren Rückseite nach unten
    for (let i = 0; i < 3; i++) {
      const a = o.roll / BALL_R + (i * TWO_PI) / 3;
      const c = Math.cos(a);
      if (c <= 0) continue;
      g.fillStyle = `rgba(255,255,255,${0.55 * c})`;
      g.beginPath();
      g.arc(cx + (i - 1) * rr * 0.5, cy + Math.sin(a) * rr * 0.85, rr * 0.2 * c + 0.4, 0, TWO_PI);
      g.fill();
    }
    const shade = g.createRadialGradient(cx - rr * 0.35, cy - rr * 0.4, rr * 0.1, cx, cy, rr);
    shade.addColorStop(0, 'rgba(255,255,255,0.35)');
    shade.addColorStop(0.55, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = shade;
    g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    g.restore();
    g.strokeStyle = 'rgba(20,10,5,0.8)';
    g.lineWidth = Math.max(1, s * 0.4);
    g.beginPath();
    g.arc(cx, cy, rr, 0, TWO_PI);
    g.stroke();

    // Figur obendrauf, wippt mit der Querbewegung
    if (o.look) {
      const img = figureBack(o.look);
      const lateral = -k.vx * Math.sin(k.ang) + k.vy * Math.cos(k.ang);
      const sway = Math.max(-0.35, Math.min(0.35, lateral / 90)) + Math.sin(o.now / 170) * 0.03;
      const fs = s * 0.5 * sc;
      g.translate(cx, cy - rr * 0.85);
      g.rotate(sway);
      g.drawImage(img.canvas, Math.round(-img.w * fs * 0.5), Math.round(-img.h * fs), Math.max(1, Math.round(img.w * fs)), Math.max(1, Math.round(img.h * fs)));
    }
    g.restore();
  }

  /** Minikarte oben rechts: Labyrinth, Fackeln, Ziel, Kugel mit Blickrichtung */
  private minimap(k: KugelFrame, o: KugelRenderOpts) {
    const g = this.ctx;
    const sx0 = cellX(0) - KUG.R - 8;
    const sy0 = cellY(0) - KUG.R - 8;
    const sw = cellX(KUG.COLS - 1) + KUG.R + 8 - sx0;
    const sh = cellY(KUG.ROWS - 1) + KUG.R + 8 - sy0;
    const mw = Math.round(this.w * 0.25);
    const mh = Math.round((mw * sh) / sw);
    const mx = this.w - mw - 5;
    const my = 30;
    const sc = mw / sw;
    g.save();
    g.fillStyle = 'rgba(8,12,24,0.78)';
    g.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
    g.drawImage(this.assets.groundCanvas, sx0 * TEX, sy0 * TEX, sw * TEX, sh * TEX, mx, my, mw, mh);
    const P = (x: number, y: number) => [mx + (x - sx0) * sc, my + (y - sy0) * sc] as const;
    this.course.checkpoints.forEach((idx, i) => {
      const p = routePoint(this.course, idx);
      const [x, y] = P(p.x, p.y);
      g.fillStyle = i < k.cp ? '#ffa83a' : '#6b6f78';
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    });
    const [gx, gy] = P(cellX(this.course.goal.c), cellY(this.course.goal.r));
    g.fillStyle = '#4fd1e8';
    g.beginPath();
    g.arc(gx, gy, 3 + Math.sin(o.now / 200) * 0.7, 0, TWO_PI);
    g.fill();
    if (k.show) {
      const [bx, by] = P(k.x, k.y);
      g.fillStyle = o.color;
      g.strokeStyle = '#1a0f08';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(bx, by, 2.6, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.strokeStyle = '#fff4d6';
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(k.ang) * 6, by + Math.sin(k.ang) * 6);
      g.stroke();
    }
    g.strokeStyle = 'rgba(160,200,255,0.6)';
    g.strokeRect(mx - 1.5, my - 1.5, mw + 3, mh + 3);
    g.restore();
  }
}
