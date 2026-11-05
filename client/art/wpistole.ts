/** Pixel-Art fürs Wasserpistolen-Duell (Western-Duell im Ferienhaus-Garten) */
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintWoodFloor } from './ground';

/** Gartenzwerg Gustav (16 × 27, gleiche Größe wie ein Avatar) */
export function gnome(): Pix {
  const p = new Pix(16, 27);
  // Zipfelmütze
  p.rect(7, 1, 2, 2, C.red).rect(6, 3, 4, 2, C.red).rect(5, 5, 6, 3, C.red);
  p.px(8, 1, '#e86a5c').px(6, 5, '#e86a5c');
  // Gesicht + Rauschebart
  p.rect(5, 8, 6, 3, '#f2c39b');
  p.px(6, 9, C.outline).px(9, 9, C.outline).rect(7, 10, 2, 1, '#e08a7a');
  p.rect(4, 11, 8, 5, C.white).rect(5, 16, 6, 2, C.white).rect(6, 18, 4, 1, '#e6e6ee');
  // Kittel + Gürtel
  p.rect(3, 13, 2, 7, C.blue).rect(11, 13, 2, 7, C.blue);
  p.rect(4, 19, 8, 3, C.blue).hline(4, 20, 8, C.woodDarker).px(8, 20, C.gold);
  // Stiefel
  p.rect(4, 22, 3, 3, C.woodDark).rect(9, 22, 3, 3, C.woodDark).hline(3, 25, 4, C.woodDarker).hline(9, 25, 4, C.woodDarker);
  p.outline(C.outline);
  return p;
}

/** Sheriff-Stern (Finale, Siegerehrung) */
export function sheriffStar(): Pix {
  const p = new Pix(15, 15);
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 3 : 7;
    pts.push([7.5 + Math.cos(a) * r, 7.5 + Math.sin(a) * r]);
  }
  p.g.fillStyle = C.gold;
  p.g.beginPath();
  pts.forEach(([x, y], i) => (i ? p.g.lineTo(x, y) : p.g.moveTo(x, y)));
  p.g.closePath();
  p.g.fill();
  p.disc(7.5, 7.5, 2, shade(C.gold, 0.8));
  p.outline(C.outline);
  return p;
}

/** Duell-Garten: Terrasse oben, Zaun, je Duell eine Kiesbahn mit Hecken-Hintergrund für beide Zielkästen */
export function paintWpGarden(p: Pix, lanes: { y: number; h: number; boxes: { x: number; y: number; w: number; h: number }[] }[]) {
  paintGrass(p, 0, 0, 480, 270, 381, true);
  paintWoodFloor(p, 0, 0, 480, 26, 382);
  p.hline(0, 26, 480, C.woodDarker).hline(0, 27, 480, 'rgba(0,0,0,0.18)');
  // Gartenzaun unter der Terrasse
  for (let x = 2; x < 480; x += 8) {
    p.rect(x, 28, 5, 6, C.paper).hline(x, 28, 5, C.white);
    p.vline(x + 4, 29, 5, C.paperDark);
  }
  p.hline(0, 30, 480, C.paperDark);
  const r = rng(383);
  for (const lane of lanes) {
    // Kiesweg quer durch den Garten
    const my = lane.y + lane.h / 2;
    const ph = Math.max(6, Math.round(lane.h * 0.28));
    p.rect(0, my - ph / 2, 480, ph, C.dirtLight);
    p.speckle(0, my - ph / 2, 480, ph, C.dirt, (480 * ph) / 9, r);
    p.speckle(0, my - ph / 2, 480, ph, C.stoneLight, (480 * ph) / 30, r);
    p.hline(0, my - ph / 2, 480, C.dirtDark).hline(0, my + ph / 2, 480, shade(C.grassDark, 0.9));
    // Zielkästen: Hecke hinten, Rasenfleck vorn
    for (const b of lane.boxes) {
      p.rect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, C.leafDarker);
      p.rect(b.x, b.y, b.w, b.h * 0.55, C.leafDark);
      p.speckle(b.x, b.y, b.w, b.h * 0.55, C.leaf, (b.w * b.h) / 6, r, 2);
      p.speckle(b.x, b.y, b.w, b.h * 0.55, C.leafLight, (b.w * b.h) / 20, r);
      for (let i = 0; i < b.w / 10; i++) p.px(b.x + 2 + r() * (b.w - 4), b.y + 2 + r() * b.h * 0.4, r() < 0.5 ? C.white : C.pink);
      p.rect(b.x, b.y + b.h * 0.55, b.w, b.h * 0.45, C.grassLight);
      p.speckle(b.x, b.y + b.h * 0.55, b.w, b.h * 0.45, C.grassTip, (b.w * b.h) / 14, r);
      p.hline(b.x, Math.floor(b.y + b.h * 0.55), b.w, C.grassDark);
    }
  }
}
