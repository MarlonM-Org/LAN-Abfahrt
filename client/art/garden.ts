/** Pixel-Art für die Wasserbomben-Schlacht im Ferienhaus-Garten */
import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintTiles, paintWoodFloor } from './ground';

/** Hecke von oben/vorn: w × h Grundfläche, oben 6 px "Höhe" */
export function hedge(w: number, h: number, seed = 21): Pix {
  const H = 6;
  const p = new Pix(w + 2, h + H + 2);
  const r = rng(seed);
  p.rect(1, 1, w, h + H, C.leafDark);
  p.overlayOn(() => {
    // Oberseite heller, Vorderseite dunkler
    p.rect(1, 1, w, h, C.leaf);
    for (let i = 0; i < (w * h) / 10; i++) p.disc(1 + r() * w, 1 + r() * h, 1 + r() * 2, r() < 0.5 ? C.leafLight : C.leaf);
    p.speckle(1, 1, w, h, C.leafTip, (w * h) / 14, r);
    p.speckle(1, 1, w, h, C.leafDarker, (w * h) / 18, r);
    p.rect(1, h + 1, w, H, C.leafDark);
    p.speckle(1, h + 1, w, H, C.leafDarker, (w * H) / 3, r);
    p.hline(1, h + 1, w, C.leafDarker);
  });
  // ein paar Blüten
  for (let i = 0; i < Math.max(1, (w * h) / 160); i++) p.px(2 + r() * (w - 2), 2 + r() * (h - 2), r() < 0.5 ? C.white : C.pink);
  p.outline(C.outline);
  return p;
}

/** Wassereimer in Teamfarbe */
export function bucket(color: string): Pix {
  const p = new Pix(16, 16);
  p.rect(3, 5, 10, 9, color).rect(4, 14, 8, 1, color);
  p.rect(3, 5, 10, 1, shade(color, 1.3)).vline(11, 6, 8, shade(color, 0.75)).vline(12, 6, 8, shade(color, 0.75));
  p.ellipse(8, 5, 5, 1.6, C.waterLight);
  p.px(6, 5, C.foam);
  // Henkel
  p.px(3, 3, '#a0a0a8').px(4, 2, '#a0a0a8').hline(5, 1, 6, '#a0a0a8').px(11, 2, '#a0a0a8').px(12, 3, '#a0a0a8');
  // Wasserbomben am Rand
  p.disc(14, 13, 1.6, C.pink);
  p.outline(C.outline);
  return p;
}

/** Gartenschlauch-Trommel mit Wasserhahn */
export function hoseReel(): Pix {
  const p = new Pix(26, 22);
  // Ständer
  p.rect(5, 18, 16, 2, '#4d4a47');
  p.rect(6, 6, 2, 13, '#6e6a62').rect(18, 6, 2, 13, '#6e6a62');
  // Trommel mit aufgewickeltem Schlauch
  p.disc(13, 11, 7, '#2f7d32');
  p.overlayOn(() => {
    for (let y = 4; y < 19; y += 2) p.hline(5, y, 16, '#3f9a42');
    p.hline(5, 6, 16, '#7fd47f');
  });
  p.disc(13, 11, 2, '#c9c1a8').px(13, 11, '#6e6a62');
  // Kurbel
  p.rect(20, 10, 4, 2, '#a0a0a8').rect(23, 8, 2, 4, C.red);
  p.outline(C.outline);
  return p;
}

/** Spritzdüse am Boden (Schlauchende) */
export function nozzle(): Pix {
  const p = new Pix(10, 6);
  p.rect(0, 2, 5, 2, '#2f7d32').rect(5, 1, 4, 4, C.orange).px(9, 2, '#a0a0a8').px(9, 3, '#a0a0a8');
  p.outline(C.outline);
  return p;
}

/** Wasserbombe (gefüllter Ballon) */
export function waterBalloon(color: string): Pix {
  const p = new Pix(9, 10);
  p.ellipse(4.5, 4, 3.6, 3.8, color);
  p.overlayOn(() => {
    p.ellipse(3.5, 3, 1.6, 1.4, shade(color, 1.45));
    p.ellipse(5.5, 6, 2.4, 1.6, shade(color, 0.8));
  });
  p.px(3, 2, C.white);
  p.px(4, 8, shade(color, 0.6)).px(5, 8, shade(color, 0.6)).px(4, 9, shade(color, 0.6));
  p.outline(C.outline);
  return p;
}

/** Wasserpistole (Power-up) */
export function waterPistol(): Pix {
  const p = new Pix(16, 12);
  // Tank
  p.rect(5, 1, 6, 4, C.waterLight).hline(5, 1, 6, C.foam);
  // Körper
  p.rect(1, 5, 14, 3, C.orange).hline(1, 5, 14, '#ffb867');
  p.rect(13, 6, 3, 1, '#2d64a8');
  // Griff
  p.rect(3, 8, 4, 4, C.orange).vline(6, 8, 4, '#c06a1f');
  p.px(8, 8, '#c06a1f').px(8, 9, '#c06a1f');
  p.outline(C.outline);
  return p;
}

/** Garten-Hintergrund (480 × 270) */
export function paintGarden(p: Pix, area: { x: number; y: number; w: number; h: number }, pool: { x: number; y: number; w: number; h: number }, hose: { x: number; y: number }) {
  paintGrass(p, 0, 0, 480, 270, 211);
  // Terrasse oben (unter der Anzeige)
  paintWoodFloor(p, 0, 0, 480, area.y - 4, 212);
  p.hline(0, area.y - 4, 480, C.woodDarker).hline(0, area.y - 3, 480, 'rgba(0,0,0,0.18)');
  // Rasenkante unten/seitlich etwas dunkler
  p.rect(0, area.y + area.h, 480, 270 - area.y - area.h, C.grassDarker);
  // Gemähte Streifen
  for (let x = 0; x < 480; x += 32) p.rect(x, area.y, 16, area.h, 'rgba(255,255,255,0.035)');
  // Pool mit Fliesenrand
  const b = 5;
  paintTiles(p, pool.x - b, pool.y - b, pool.w + b * 2, pool.h + b * 2, '#e9e4d4', '#d8d0bb', 5);
  const r = rng(213);
  for (let j = 0; j < pool.h; j++) p.hline(pool.x, pool.y + j, pool.w, j < 4 ? '#2f8fc9' : j < pool.h / 2 ? '#3aa6dd' : '#56bde8');
  for (let i = 0; i < 40; i++) {
    const wx = pool.x + 2 + Math.floor(r() * (pool.w - 8));
    const wy = pool.y + 4 + Math.floor(r() * (pool.h - 6));
    p.hline(wx, wy, 2 + Math.floor(r() * 4), r() < 0.6 ? '#9fe0ff' : '#2f8fc9');
  }
  // Leiter + Schwimmring
  p.vline(pool.x + pool.w - 12, pool.y - 2, 8, '#c9c9d1').vline(pool.x + pool.w - 7, pool.y - 2, 8, '#c9c9d1');
  p.hline(pool.x + pool.w - 12, pool.y + 1, 6, '#c9c9d1').hline(pool.x + pool.w - 12, pool.y + 4, 6, '#c9c9d1');
  p.disc(pool.x + 20, pool.y + 22, 6, C.red);
  p.disc(pool.x + 20, pool.y + 22, 3, '#3aa6dd');
  for (let a = 0; a < 4; a++) p.px(pool.x + 20 + Math.round(Math.cos(a * 1.57 + 0.78) * 5), pool.y + 22 + Math.round(Math.sin(a * 1.57 + 0.78) * 5), C.white);
  // Matschige Pfütze rund um den Schlauch
  p.ellipse(hose.x, hose.y - 4, 24, 15, '#4a8a2c');
  p.ellipse(hose.x, hose.y - 2, 18, 10, '#5d9a5a');
  p.ellipse(hose.x + 3, hose.y + 1, 10, 5, '#7fbfd6');
  p.px(hose.x - 4, hose.y, C.foam).px(hose.x + 6, hose.y + 2, C.foam);
  // Trittsteine von den Lagern zur Mitte
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const sx = 240 + side * (60 + i * 26);
      const sy = hose.y + Math.sin(i * 1.3) * 4;
      p.ellipse(sx, sy, 5, 3, C.stoneDark);
      p.ellipse(sx - 0.5, sy - 0.5, 4, 2.2, C.stoneLight);
    }
  }
  // Blumenbeet am Terrassenrand
  for (let x = 6; x < 480; x += 9) {
    if (x > pool.x - 10 && x < pool.x + pool.w + 10) continue;
    const c = [C.pink, C.white, '#ffe36b', '#a9c8ff'][Math.floor(x / 9) % 4];
    p.rect(x, area.y - 2, 5, 3, C.leafDark).px(x + 2, area.y - 3, c);
  }
}

// ------------------------------------------------------------------ Symbole (TV-Schilder, Legende und Handy)

const DROP = ['...a...', '..aaa..', '..aaa..', '.aaaaa.', '.waaaab', 'awaaaab', 'aaaaabb', '.aaabb.', '..bbb..'];

/** Wassertropfen = Auffüllen (Eimer) */
export function dropIcon(color: string = C.waterLight): Pix {
  const p = new Pix(9, 11);
  p.map(1, 1, DROP, { a: color, w: C.foam, b: shade(color, 0.72) });
  p.outline(C.outline);
  return p;
}

/** Tropfen mit Tempo-Strichen = schnell auffüllen (Gartenschlauch) */
export function fastDropIcon(): Pix {
  const p = new Pix(14, 11);
  p.hline(1, 4, 3, C.foam).hline(0, 6, 4, C.foam).hline(2, 8, 2, C.foam);
  p.map(6, 1, DROP, { a: C.waterLight, w: C.foam, b: shade(C.waterLight, 0.72) });
  p.outline(C.outline);
  return p;
}

/** Gefaltetes Handtuch = Trocknen */
export function towelIcon(color: string): Pix {
  const p = new Pix(12, 10);
  p.map(1, 1, ['aaaaaaaaaa', 'wwwwwwwwww', 'aaaaaaaaaa', 'aaaaaaaaaa', 'wwwwwwwwww', 'aaaaaaaaaa', 'bbbbbbbbbb', '.bbbbbbbbb'], {
    a: color,
    w: C.white,
    b: shade(color, 0.7),
  });
  p.outline(C.outline);
  return p;
}

/** Schild = Deckung (grün wie die Hecken) */
export function shieldIcon(): Pix {
  const p = new Pix(11, 12);
  p.map(1, 1, ['rrrrrrrrr', 'rlllllggr', 'rlllllggr', 'rlllllggr', 'rlllllggr', '.rlllggr.', '.rllgggr.', '..rlggr..', '...rgr...', '....r....'], {
    r: '#efe6c8',
    l: C.leafLight,
    g: C.leaf,
  });
  p.px(3, 3, '#bfe8a0').px(3, 4, '#bfe8a0');
  p.outline(C.outline);
  return p;
}

/** Sonne = trocknet (wer eine Weile nicht getroffen wird) */
export function sunIcon(): Pix {
  const p = new Pix(13, 13);
  const ray = '#ffb43a';
  p.vline(6, 0, 2, ray).vline(6, 11, 2, ray).hline(0, 6, 2, ray).hline(11, 6, 2, ray);
  p.px(2, 2, ray).px(10, 2, ray).px(2, 10, ray).px(10, 10, ray);
  p.disc(6.5, 6.5, 3.6, C.gold);
  p.px(5, 5, '#fff4b0').px(5, 6, '#fff4b0');
  p.outline(C.outline);
  return p;
}

/** Zeigepfeil nach unten (Hinweise der Aufwärm-Tour) */
export function downArrow(color: string = C.gold): Pix {
  const p = new Pix(9, 8);
  p.map(1, 1, ['..aaa..', '..aaa..', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...'], { a: color });
  p.outline(C.outline);
  return p;
}
