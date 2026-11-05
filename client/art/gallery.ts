/** Entwickler-Galerie aller prozeduralen Sprites: http://localhost:3000/art.html */
import { drawAvatar, drawAvatarSheet, AV_H, AV_W, AV_SHEET_COLS, AV_SHEET_ROWS, HAIR_STYLES } from '../../shared/avatar';
import { PLAYER_COLORS } from '../../shared/players';
import * as O from './objects';
import { C } from './palette';
import { Pix } from './pix';
import { paintGrass, paintPath, paintSand, paintWater, paintShore, paintWoodFloor, paintTiles, paintSky } from './ground';

const SCALE = 3;
const sheet = new Pix(480, 470);
paintGrass(sheet, 0, 0, 480, 470, 1);
paintPath(sheet, [{ x: 0, y: 290 }, { x: 480, y: 290 }], 14);
paintSand(sheet, 300, 150, 180, 60);
paintWater(sheet, 300, 210, 180, 40);
paintShore(sheet, 300, 210, 180);
paintWoodFloor(sheet, 300, 250, 90, 30);
paintTiles(sheet, 390, 250, 90, 30, '#e9e4d4', '#c9c1a8');
paintSky(sheet, 0, 0, 120, 40, ['#2b3a6b', '#e2788f', '#f6b867', '#ffe3a1']);

const items: Pix[] = [
  O.tree(1), O.tree(7), O.fruitTree(3), O.bush(3), O.bush(4, true), O.rock(), O.fence(32), O.palm(), O.umbrella(),
  O.towel(C.red), O.towel(C.blue), O.deckchair(C.orange), O.campfire(0), O.campfire(1), O.crate(),
  O.fieldStone(C.blue), O.fieldStone(C.red), O.fieldStone(C.orange, 'q'), O.fieldStone(C.green, 's'), O.cocktail(), O.coinIcon(),
  O.bed(), O.sofa(), O.bathtub(), O.counter(), O.plant(), O.rug(), O.table(), O.grill(), O.silhouette(), O.bottle(), O.ball(), O.heart(),
  O.flower(C.pink), O.flower(C.white),
];
let x = 130, y = 4, rowH = 0;
for (const it of items) {
  if (x + it.w > 296) { x = 130; y += rowH + 4; rowH = 0; }
  sheet.draw(it, x, y);
  x += it.w + 4;
  rowH = Math.max(rowH, it.h);
}
sheet.draw(O.cottage(), 4, 150);
sheet.draw(O.noticeBoard(80, 50), 120, 200);
sheet.draw(O.panelPix(90, 40), 210, 210);

// Avatare
for (let i = 0; i < 16; i++) {
  const c = document.createElement('canvas');
  c.width = AV_W; c.height = AV_H;
  drawAvatar(c.getContext('2d')!, { skin: i % 6, hair: i % 10, hairStyle: i % HAIR_STYLES.length, shirt: (i * 3) % 10, beard: i % 5 });
  sheet.draw(c, 4 + (i % 8) * 18, 44 + Math.floor(i / 8) * 30);
}

// Avatar-Animationen (Zeilen: Stand+Blinzeln, Laufen ×4, Sprung, Treffer, Jubel ×2)
const looks = [
  { skin: 0, hair: 2, hairStyle: 1, shirt: 0, beard: 0 },
  { skin: 3, hair: 0, hairStyle: 3, shirt: 1, beard: 2 },
  { skin: 1, hair: 3, hairStyle: 4, shirt: 4, beard: 0 },
  { skin: 4, hair: 6, hairStyle: 6, shirt: 2, beard: 1 },
];
looks.forEach((look, i) => {
  const c = document.createElement('canvas');
  c.width = AV_SHEET_COLS * (AV_W + 2);
  c.height = AV_SHEET_ROWS.length * (AV_H + 2);
  drawAvatarSheet(c.getContext('2d')!, look, 1, 2);
  sheet.rect(4 + i * 76 - 1, 312 - 1, c.width + 1, c.height + 1, 'rgba(255,255,255,0.18)');
  sheet.draw(c, 4 + i * 76, 312);
});

// Spielerfarben des Abends (Reihenfolge = Vergabe beim Beitritt)
PLAYER_COLORS.forEach((c, i) => {
  const x = 320 + (i % 4) * 40;
  const y = 312 + Math.floor(i / 4) * 30;
  sheet.rect(x - 1, y - 1, 34, 22, '#2d1b12').rect(x, y, 32, 20, c.hex);
});

const out = document.getElementById('c') as HTMLCanvasElement;
out.width = sheet.w * SCALE;
out.height = sheet.h * SCALE;
const g = out.getContext('2d')!;
g.imageSmoothingEnabled = false;
g.drawImage(sheet.canvas, 0, 0, out.width, out.height);
