import { C } from './palette';
import { Pix, rng, shade } from './pix';

/** Pixel-Art für die Zauber-Arena: Lavasee, Steinkacheln (12 × 12 + Seitenkante), Zauberer, Feuerball */

const LAVA = ['#5a0f0a', '#7a1a0c', '#a02a0e', '#c8410f', '#e8661a', '#f79a2a', '#ffd25e'];

/** Lavasee: dunkle Kruste, glühende Adern, helle Blasen */
export function paintZauberLava(p: Pix, w: number, h: number) {
  const r = rng(9191);
  // Grundglut mit großen, weichen Flecken
  p.rect(0, 0, w, h, LAVA[2]);
  for (let i = 0; i < 260; i++) p.ellipse(r() * w, r() * h, 8 + r() * 26, 4 + r() * 12, r() < 0.5 ? LAVA[3] : LAVA[1]);
  for (let i = 0; i < 90; i++) p.ellipse(r() * w, r() * h, 4 + r() * 12, 2 + r() * 6, LAVA[4]);
  // Erkaltete Kruste (dunkle Schollen mit heller Kante)
  for (let i = 0; i < 70; i++) {
    const x = r() * w;
    const y = r() * h;
    const rx = 5 + r() * 14;
    const ry = 3 + r() * 7;
    p.ellipse(x, y, rx, ry, '#3a0d0a');
    p.ellipse(x - 1, y - 1, rx - 2, ry - 1.5, '#4e1510');
    p.hline(x - rx / 2, y + ry - 1, rx, LAVA[4]);
  }
  // Glühende Adern
  for (let i = 0; i < 46; i++) {
    let x = r() * w;
    let y = r() * h;
    const len = 6 + Math.floor(r() * 18);
    for (let k = 0; k < len; k++) {
      p.px(x, y, k % 5 === 0 ? LAVA[6] : LAVA[5]);
      x += r() < 0.6 ? 1 : 0;
      y += r() < 0.5 ? (r() < 0.5 ? -1 : 1) : 0;
    }
  }
  // Helle Funkelpunkte
  for (let i = 0; i < 120; i++) p.px(r() * w, r() * h, r() < 0.3 ? '#fff4b0' : LAVA[6]);
  // HUD-Bereich oben abdunkeln (Rauch)
  for (let y = 0; y < 40; y++) p.hline(0, y, w, `rgba(20,6,18,${0.55 * (1 - y / 40)})`);
}

/** Steinkachel (12 × 12 Oberseite + 5 px Seitenkante mit Lavaglut). v = Variante */
export function zauberStone(v: number, cracked = false): Pix {
  const p = new Pix(12, 17);
  const r = rng(311 + v * 17);
  const tones = ['#6e6480', '#655b78', '#776d88', '#6a6080'];
  const base = tones[v % tones.length];
  // Seitenkante (dunkler Fels) + Glut am Fuß
  p.rect(0, 12, 12, 5, '#2c2236');
  p.hline(0, 12, 12, '#3f3350');
  p.hline(0, 15, 12, '#c8410f');
  p.hline(0, 16, 12, 'rgba(255,154,42,0.65)');
  p.speckle(0, 13, 12, 2, '#3b2d48', 4, r);
  // Oberseite
  p.rect(0, 0, 12, 12, base);
  p.hline(0, 0, 12, shade(base, 1.22));
  p.vline(0, 0, 12, shade(base, 1.12));
  p.hline(0, 11, 12, shade(base, 0.72));
  p.vline(11, 0, 12, shade(base, 0.8));
  p.speckle(1, 1, 10, 10, shade(base, 1.12), 6, r);
  p.speckle(1, 1, 10, 10, shade(base, 0.84), 5, r);
  // Fugen-Kerbe
  if (v % 2 === 0) p.hline(2 + Math.floor(r() * 4), 6, 4, shade(base, 0.72));
  // Leuchtende Rune auf manchen Kacheln
  if (v === 5) {
    p.px(5, 3, '#c79bff').px(6, 4, '#c79bff').px(5, 5, '#c79bff').px(7, 5, '#c79bff').px(6, 6, '#e6d0ff').px(5, 7, '#c79bff').px(7, 7, '#c79bff');
  }
  if (cracked) {
    const cr = '#1c1424';
    const pts: [number, number][] = [[1, 2], [2, 3], [3, 3], [4, 5], [6, 5], [7, 6], [8, 8], [9, 9], [10, 10]];
    for (const [x, y] of pts) p.px(x, y, cr);
    p.px(4, 6, cr).px(4, 7, cr).px(8, 3, cr).px(9, 2, cr).px(7, 4, cr);
    // Glut schimmert durch die Risse
    p.px(5, 5, '#f79a2a').px(8, 7, '#f79a2a').px(4, 8, '#e8661a');
  }
  return p;
}

/** Feuerball (Kern gelb, Rand rot) */
export function zauberBolt(): Pix {
  const p = new Pix(9, 9);
  p.disc(4.5, 4.5, 4.5, '#c8410f');
  p.disc(4.5, 4.5, 3.4, '#f0973a');
  p.disc(4.2, 4.2, 2.2, '#ffd25e');
  p.disc(3.8, 3.8, 1, '#fff8d0');
  return p;
}

/** Weicher Leuchtpunkt für Glüh-Effekte (additiv) */
export function zauberGlow(color: string, r = 8): Pix {
  const p = new Pix(r * 2, r * 2);
  for (let k = r; k >= 1; k--) {
    const a = 0.08 + 0.5 * (1 - k / r) ** 2;
    p.g.globalAlpha = a;
    p.disc(r, r, k, color);
  }
  p.g.globalAlpha = 1;
  return p;
}

/**
 * Zauberer: Spitzhut + Kopf des Avatars + Robe in Spielerfarbe. 18 × 34, Füße unten mittig.
 * `head` ist das 16 × 15-Kopf-Porträt (wird ab Zeile 8 eingesetzt).
 */
export function zauberWizard(color: string, head: HTMLCanvasElement): Pix {
  const p = new Pix(18, 34);
  const robe = color;
  const robeS = shade(color, 0.72);
  const robeL = shade(color, 1.22);
  const hat = shade(color, 0.62);
  const hatL = shade(color, 0.85);
  // Robe (Trapez, unten weiter)
  for (let y = 21; y < 33; y++) {
    const t = (y - 21) / 11;
    const half = Math.round(3.5 + t * 4);
    p.hline(9 - half, y, half * 2, robe);
    p.px(9 + half - 1, y, robeS);
    p.px(9 + half - 2, y, robeS);
    if (y > 22) p.px(9 - half + 1, y, robeL);
  }
  // Saum + goldene Borte + Gürtel
  p.hline(2, 32, 14, robeS);
  p.hline(3, 31, 12, C.gold);
  p.hline(5, 25, 8, C.goldDark);
  p.px(9, 25, C.gold);
  // Stern auf der Brust
  p.px(7, 23, '#fff4b0').px(6, 23, C.gold).px(8, 23, C.gold).px(7, 22, C.gold).px(7, 24, C.gold);
  // Ärmel + Hände
  p.rect(3, 22, 2, 5, robeS).rect(13, 22, 2, 5, robeS);
  p.px(3, 27, '#f9d8bd').px(14, 27, '#f9d8bd');
  // Füße (Schuhspitzen)
  p.rect(5, 33, 3, 1, '#3b2d48').rect(10, 33, 3, 1, '#3b2d48');
  // Kopf
  p.g.drawImage(head, 1, 8);
  // Spitzhut: Krempe auf der Stirn, Spitze leicht geknickt
  p.hline(0, 12, 18, hat);
  p.hline(1, 13, 16, shade(color, 0.5));
  p.hline(1, 11, 16, hat);
  for (let y = 2; y < 11; y++) {
    const half = Math.max(1, Math.round((y - 1) * 0.62));
    const cx = 9 + (y < 5 ? 5 - y : 0);
    p.hline(cx - half, y, half * 2, hat);
    p.px(cx - half, y, hatL);
  }
  p.rect(13, 0, 2, 2, hat);
  p.px(15, 1, hat);
  p.hline(4, 10, 10, C.gold);
  p.px(8, 6, '#fff4b0').px(10, 4, C.gold);
  p.outline(C.outline);
  return p;
}

/** Kleiner Hut für die HUD-Leiste (wer verpufft ist) */
export function zauberPuffIcon(): Pix {
  const p = new Pix(10, 8);
  p.disc(3, 4, 3, '#b9a6cf');
  p.disc(6.5, 3.5, 3.2, '#d6c8e6');
  p.disc(5, 5.5, 2.5, '#9a86b3');
  return p;
}
