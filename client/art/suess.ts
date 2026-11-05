import { C } from './palette';
import { Pix, rng, shade } from './pix';
import { paintGrass, paintTiles, paintWoodFloor } from './ground';
import { SUESS, SUESS_MAP, tileAt } from '../../shared/suess';

const T = SUESS.TILE;
const OY = SUESS.OY;
const NIGHT = 'rgba(16, 20, 58, 0.52)';

/** Zusammenhängende Kachel-Gruppen eines Zeichens → Begrenzungsrechtecke (Welt-Pixel) */
function groups(ch: string) {
  const seen = new Set<string>();
  const out: { x: number; y: number; w: number; h: number; col: number; row: number }[] = [];
  SUESS_MAP.forEach((line, row) =>
    [...line].forEach((c, col) => {
      if (c !== ch || seen.has(`${col},${row}`)) return;
      const stack = [[col, row]];
      seen.add(`${col},${row}`);
      let c0 = col, c1 = col, r0 = row, r1 = row;
      while (stack.length) {
        const [cc, rr] = stack.pop()!;
        c0 = Math.min(c0, cc); c1 = Math.max(c1, cc); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${cc + dc},${rr + dr}`;
          if (tileAt(cc + dc, rr + dr) === ch && !seen.has(k)) {
            seen.add(k);
            stack.push([cc + dc, rr + dr]);
          }
        }
      }
      out.push({ x: c0 * T, y: OY + r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T, col: c0, row: r0 });
    }),
  );
  return out;
}

const floorOf = (ch: string, col: number, row: number) => {
  // Möbel stehen auf dem Boden des Raums: Fliesen in Küche/Bad, Rasen im Garten, sonst Holz
  if (ch === ',' || 'kKw'.includes(ch)) return 'tile';
  if (ch === ':' || ch === 'T') return 'grass';
  if (ch === 'S') return col > 15 ? 'grass' : 'wood';
  if (ch === 'p' && (tileAt(col - 1, row) === ',' || tileAt(col, row - 1) === ',')) return 'tile';
  return 'wood';
};

/** Ferienhaus bei Nacht (480 × 270) als ein Hintergrundbild – für TV und Handy */
export function paintSuessHouse(w = 480, h = 270): Pix {
  const p = new Pix(w, h);
  const mapH = SUESS.ROWS * T;
  const layer = (paint: (l: Pix) => void) => {
    const l = new Pix(w, h);
    paint(l);
    return l;
  };
  const wood = layer((l) => paintWoodFloor(l, 0, OY, w, mapH, 1201, '#b07a48'));
  const tile = layer((l) => paintTiles(l, 0, OY, w, mapH, '#d9d4c4', '#b9c6c9', 8));
  const grass = layer((l) => paintGrass(l, 0, OY, w, mapH, 1203, true));
  const copy = (src: Pix, col: number, row: number) => p.g.drawImage(src.canvas, col * T, OY + row * T, T, T, col * T, OY + row * T, T, T);
  const r = rng(1207);

  p.rect(0, 0, w, h, '#151a33');
  SUESS_MAP.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch === '#') return;
      const f = floorOf(ch, col, row);
      copy(f === 'tile' ? tile : f === 'grass' ? grass : wood, col, row);
    }),
  );

  // Teppiche (flach, begehbar)
  const rug = (x: number, y: number, rw: number, rh: number, c: string) => {
    p.rect(x, y, rw, rh, c);
    p.rect(x + 2, y + 2, rw - 4, rh - 4, shade(c, 1.15));
    for (let i = x + 4; i < x + rw - 4; i += 4) p.px(i, y + rh / 2, shade(c, 0.8));
    for (let i = x; i < x + rw; i += 2) p.px(i, y - 1, C.white).px(i + 1, y + rh, C.white);
  };
  rug(9 * T + 4, OY + 11 * T + 6, 5 * T - 8, 3 * T - 10, '#9b3f5a');
  rug(23 * T + 6, OY + 3 * T + 4, 4 * T, 2 * T, '#3f6f9b');
  rug(2 * T, OY + 3 * T + 6, 4 * T, 3 * T - 6, '#4f9b6a');

  // Verstecke: Kissenburg (Decken + Kissen) und Zelt im Garten
  for (const g of groups('S')) {
    const garden = g.col > 15;
    if (garden) {
      p.rect(g.x + 1, g.y + 1, g.w - 2, g.h - 2, '#e0a43a');
      p.rect(g.x + 3, g.y + 3, g.w - 6, g.h - 6, '#f0c060');
      for (let y = g.y + 3; y < g.y + g.h - 3; y += 4) p.hline(g.x + 3, y, g.w - 6, '#e3b04c');
      // Zeltplane oben + Heringe
      p.rect(g.x - 2, g.y - 4, g.w + 4, 6, '#c4562f');
      p.hline(g.x - 2, g.y - 4, g.w + 4, '#e07a4a');
      for (const [hx, hy] of [[g.x - 3, g.y + g.h - 2], [g.x + g.w + 1, g.y + g.h - 2]]) p.rect(hx, hy, 2, 3, C.stoneLight);
    } else {
      p.rect(g.x + 1, g.y + 1, g.w - 2, g.h - 2, '#c86a9a');
      p.rect(g.x + 3, g.y + 3, g.w - 6, g.h - 6, '#e08ab6');
      for (let i = 0; i < 6; i++) p.px(g.x + 6 + r() * (g.w - 12), g.y + 6 + r() * (g.h - 12), '#ffd1e6');
      // Kissenwall rund herum (auf der Wandseite)
      const pillow = (x: number, y: number, c: string) => {
        p.rect(x, y, 8, 5, c).hline(x + 1, y, 6, shade(c, 1.25)).hline(x, y + 4, 8, shade(c, 0.75));
      };
      pillow(g.x + g.w - 6, g.y + 4, '#f2e6c9');
      pillow(g.x + g.w - 6, g.y + 14, '#8fc3e8');
      pillow(g.x + 4, g.y + g.h - 4, '#f2d36b');
      pillow(g.x + 14, g.y + g.h - 3, '#f2e6c9');
    }
    // Leuchtrahmen: hier ist man sicher
    for (let i = 0; i < g.w; i += 2) p.px(g.x + i, g.y, '#ffe9a0').px(g.x + i + 1, g.y + g.h - 1, '#ffe9a0');
    for (let j = 0; j < g.h; j += 2) p.px(g.x, g.y + j, '#ffe9a0').px(g.x + g.w - 1, g.y + j + 1, '#ffe9a0');
  }

  // Möbel
  const box = (x: number, y: number, bw: number, bh: number, top: string, front: string, frontH = 4) => {
    p.rect(x, y, bw, bh, top);
    p.rect(x, y + bh - frontH, bw, frontH, front);
    p.hline(x, y, bw, shade(top, 1.2));
    p.rect(x, y + bh, bw, 2, 'rgba(0,0,0,0.25)');
  };
  for (const g of groups('b')) {
    box(g.x + 1, g.y + 1, g.w - 2, g.h - 3, '#8d5629', '#5e3518', 3);
    const blanket = [C.blue, '#2fb5a5', C.purple, C.orange][(g.col + g.row) % 4];
    p.rect(g.x + 2, g.y + 8, g.w - 4, g.h - 13, blanket);
    for (let y = g.y + 10; y < g.y + g.h - 6; y += 4) p.hline(g.x + 2, y, g.w - 4, shade(blanket, 0.85));
    p.rect(g.x + 3, g.y + 2, g.w - 6, 5, C.white).hline(g.x + 3, g.y + 6, g.w - 6, '#d8d0c0');
  }
  for (const g of groups('k')) {
    box(g.x, g.y, g.w, g.h - 2, '#cfcbc1', '#8a857c', 4);
    for (let x = g.x + 4; x < g.x + g.w - 4; x += 16) p.vline(x, g.y + g.h - 6, 3, '#5d5850');
  }
  // Herdplatten + Spüle
  const kg = groups('k')[0];
  if (kg) {
    p.disc(kg.x + 10, kg.y + 6, 3, '#3a3a3a').disc(kg.x + 20, kg.y + 6, 3, '#3a3a3a');
    p.rect(kg.x + kg.w - 26, kg.y + 3, 14, 7, '#9fb5bd').rect(kg.x + kg.w - 24, kg.y + 4, 10, 5, '#7c949c');
  }
  for (const g of groups('K')) {
    p.rect(g.x + 1, g.y - 6, g.w - 2, g.h + 4, '#e8eef2');
    p.hline(g.x + 1, g.y + 2, g.w - 2, '#a9b6bf');
    p.vline(g.x + g.w - 4, g.y - 3, 4, '#8a979f').vline(g.x + g.w - 4, g.y + 5, 6, '#8a979f');
    p.rect(g.x + 1, g.y + g.h - 2, g.w - 2, 2, 'rgba(0,0,0,0.25)');
  }
  for (const g of groups('M')) {
    // Minibar mit offener Tür – innen leuchtet es
    p.rect(g.x + 1, g.y - 2, g.w - 2, g.h, '#6a3a2a');
    p.rect(g.x + 3, g.y + 1, g.w - 6, g.h - 6, '#fff3b0');
    p.hline(g.x + 3, g.y + 5, g.w - 6, '#d8c070');
    p.px(g.x + 5, g.y + 3, C.red).px(g.x + 8, g.y + 3, C.pink).px(g.x + 10, g.y + 3, C.green).px(g.x + 6, g.y + 7, C.orange).px(g.x + 9, g.y + 7, C.blue);
    p.rect(g.x + g.w - 1, g.y - 2, 4, g.h, '#8a4a36');
  }
  for (const g of groups('t')) {
    box(g.x + 2, g.y + 2, g.w - 4, g.h - 5, '#c48a4f', '#8d5629', 3);
    p.disc(g.x + g.w / 2, g.y + g.h / 2 - 2, 3, '#f2e6c9');
  }
  for (const g of groups('s')) {
    box(g.x, g.y + 2, g.w, g.h - 4, '#8f4a7d', '#6a3058', 4);
    p.rect(g.x, g.y, g.w, 5, '#a85a92');
    for (let x = g.x + g.w / 3; x < g.x + g.w - 2; x += g.w / 3) p.vline(x, g.y + 5, g.h - 10, '#7a3c6a');
  }
  for (const g of groups('w')) {
    p.rect(g.x + 1, g.y + 2, g.w - 3, g.h - 4, '#f4f6f8');
    p.rect(g.x + 3, g.y + 4, g.w - 7, g.h - 8, '#7fc6e8');
    p.hline(g.x + 4, g.y + 6, 4, C.foam);
  }
  for (const g of groups('p')) {
    const cx = g.x + T / 2;
    const cy = g.y + T / 2;
    p.rect(cx - 4, cy + 1, 8, 6, '#b5603a').hline(cx - 4, cy + 1, 8, '#d9804f');
    p.disc(cx, cy - 2, 6, C.leaf).disc(cx - 3, cy - 3, 3, C.leafLight).disc(cx + 3, cy, 3, C.leafDark);
  }
  for (const g of groups('T')) {
    const cx = g.x + T / 2;
    const cy = g.y + T / 2;
    p.ellipse(cx + 2, cy + 6, 9, 4, 'rgba(0,0,0,0.3)');
    p.disc(cx, cy, 9, C.leafDark).disc(cx - 2, cy - 2, 7, C.leaf).disc(cx - 4, cy - 4, 3, C.leafLight);
  }

  // Wände: Oberseite + Vorderkante, wo Boden drunter ist
  SUESS_MAP.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch !== '#') return;
      const x = col * T;
      const y = OY + row * T;
      const below = row + 1 < SUESS.ROWS && tileAt(col, row + 1) !== '#';
      p.rect(x, y, T, T, '#5a4a6e');
      p.speckle(x, y, T, T, '#65547a', 6, r);
      if (below) {
        p.rect(x, y + T - 6, T, 6, '#d8c7a4');
        p.hline(x, y + T - 6, T, '#efe2c2');
        p.hline(x, y + T - 1, T, C.outline);
        p.rect(x, y + T, T, 3, 'rgba(0,0,0,0.22)');
      }
      if (tileAt(col, row - 1) !== '#' && row > 0) p.hline(x, y, T, C.outline);
      if (tileAt(col - 1, row) !== '#' && col > 0) p.vline(x, y, T, C.outline);
      if (tileAt(col + 1, row) !== '#' && col < SUESS.COLS - 1) p.vline(x + T - 1, y, T, C.outline);
    }),
  );
  // Fenster in der Außenwand oben (Mondlicht)
  for (const col of [3, 11, 19, 25]) {
    const x = col * T + 2;
    p.rect(x, OY + 2, 12, 8, '#2b3d6e').rect(x + 1, OY + 3, 10, 6, '#6f8fd0').vline(x + 6, OY + 3, 6, '#2b3d6e');
  }

  // Nacht drüber legen, dann Lichtinseln aufhellen
  p.g.fillStyle = NIGHT;
  p.g.fillRect(0, OY, w, mapH);
  const glow = (x: number, y: number, rad: number, c: string) => {
    const gr = p.g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, c);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    p.g.save();
    p.g.globalCompositeOperation = 'lighter';
    p.g.fillStyle = gr;
    p.g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    p.g.restore();
  };
  for (const g of groups('M')) glow(g.x + g.w / 2, g.y + g.h, 46, 'rgba(255, 220, 120, 0.45)');
  for (const g of groups('K')) glow(g.x + g.w / 2, g.y + g.h + 4, 34, 'rgba(200, 230, 255, 0.35)');
  for (const g of groups('S')) glow(g.x + g.w / 2, g.y + g.h / 2, 30, 'rgba(255, 190, 120, 0.3)');
  for (const col of [3, 11, 19, 25]) glow(col * T + 8, OY + T + 10, 22, 'rgba(140, 170, 255, 0.18)');

  // HUD-Leiste oben
  p.rect(0, 0, w, OY, '#1d1838');
  p.hline(0, OY - 1, w, C.outline);
  return p;
}

// ------------------------------------------------------------------ Sprites

/** Süßigkeiten-Sprites nach Sorte (0 Bonbon, 1 Lolli, 2 Schokoriegel, 3 Riesen-Tafel) */
export function candySprite(t: number, variant = 0): Pix {
  const cols = ['#e04a3f', '#f07aa8', '#46b04a', '#3f8fe0', '#f2c230', '#9b5fc0'];
  const c = cols[variant % cols.length];
  if (t === 0) {
    const p = new Pix(11, 7);
    p.map(0, 0, [
      '...........',
      'xx.......xx',
      'xxx.ooo.xxx',
      '.xxoohoxx..',
      'xxx.ooo.xxx',
      'xx.......xx',
    ], { x: shade(c, 1.3), o: c, h: C.white });
    p.outline(C.outline);
    return p;
  }
  if (t === 1) {
    const p = new Pix(9, 13);
    p.disc(4.5, 4, 3.5, c);
    p.px(3, 3, C.white).px(5, 5, shade(c, 1.4)).px(4, 2, shade(c, 1.4)).px(2, 5, shade(c, 0.8));
    p.vline(4, 8, 4, '#f4ead8');
    p.outline(C.outline);
    return p;
  }
  if (t === 2) {
    const p = new Pix(13, 7);
    p.rect(1, 1, 11, 5, '#6a3a1e');
    p.rect(3, 1, 7, 5, c);
    p.hline(3, 1, 7, shade(c, 1.3));
    p.rect(5, 2, 3, 2, C.white);
    p.outline(C.outline);
    return p;
  }
  const p = new Pix(14, 12);
  p.rect(1, 1, 12, 10, '#7a4422');
  for (let x = 2; x < 13; x += 3) for (let y = 2; y < 11; y += 3) p.rect(x, y, 2, 2, '#9a5a2e');
  p.rect(1, 6, 12, 5, C.gold);
  p.hline(1, 6, 12, '#fff1a8');
  p.rect(5, 7, 4, 3, C.red);
  p.outline(C.outline);
  return p;
}

/** Beutesack der Naschkatze (14 × 14) */
export function lootSack(): Pix {
  const p = new Pix(14, 14);
  p.ellipse(7, 8.5, 6, 5, '#d9b47a');
  p.ellipse(5.5, 7.5, 3, 2.5, '#ecd0a0');
  p.rect(5, 1, 4, 3, '#d9b47a');
  p.hline(4, 3, 6, '#8d5629');
  p.px(3, 2, '#8d5629').px(10, 2, '#8d5629');
  p.px(7, 9, C.red).px(9, 7, C.pink).px(5, 11, C.green);
  p.outline(C.outline);
  return p;
}

/** Wächter-Mütze mit Schirm (14 × 6) */
export function guardCap(): Pix {
  const p = new Pix(14, 7);
  p.rect(2, 1, 10, 4, '#2d4f8f');
  p.hline(3, 1, 8, '#4a73b8');
  p.rect(0, 4, 14, 2, '#1d3566');
  p.rect(6, 2, 2, 2, C.gold);
  p.outline(C.outline);
  return p;
}

/** Sterne über dem Kopf, wenn man geschnappt wurde */
export function dizzyStar(): Pix {
  const p = new Pix(7, 7);
  p.map(0, 0, ['...x...', '..xxx..', 'xxxxxxx', '.xxxxx.', '.xx.xx.', 'x.....x'], { x: C.gold });
  return p;
}
