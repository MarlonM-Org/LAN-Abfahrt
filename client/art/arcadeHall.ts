/**
 * Pixel-Art für die TV-Startseite als Arcade-Halle (LobbyScene): dunkler Boden mit Leucht-Teppich,
 * Rückwand mit Neonstreifen, Spielautomaten (Bildschirm bleibt frei – die Szene legt das Spiel-Icon
 * drauf), Neon-Schild mit Lauflicht, QR-Automat und dunkle Panels mit Neonrand für Adresse/Hinweis.
 * Alles prozedural, damit es zum übrigen Look passt (Kontur, 1-px-Highlights).
 */
import { Pix, rng, shade } from './pix';

export const HALL = {
  outline: '#0c0918',
  wall: '#1c1634',
  wallDark: '#150f28',
  wallLine: '#271e4a',
  floor: '#2a2246',
  floorDark: '#221a3a',
  floorLight: '#332a56',
  neonPink: '#ff4fa3',
  neonCyan: '#3ee6ff',
  neonYellow: '#ffd25e',
  neonPurple: '#9b6cff',
  neonGreen: '#5df2a0',
  cab: '#3a3160',
  cabDark: '#2a2347',
  cabLight: '#4c4078',
  screen: '#0a1626',
  panelBg: '#141026',
  metal: '#8a8aa8',
  metalDark: '#5c5c78',
  bulbOff: '#6a4a12',
};

/** Linie Boden/Wand in der Halle (Welt-Y) */
export const HALL_FLOOR_Y = 100;

/** Akzentfarben der Automaten (Kopfleiste + Seitenstreifen), rotieren über die Reihe */
export const CABINET_ACCENTS = [HALL.neonPink, HALL.neonCyan, HALL.neonYellow, HALL.neonPurple, HALL.neonGreen, '#ff8a4a'];

export const CABINET_W = 40;
export const CABINET_H = 56;
/** Bildschirm im Automaten (relativ zur linken oberen Ecke) */
export const CABINET_SCREEN = { x: 8, y: 14, w: 24, h: 17 };

/** Ganze Halle: Rückwand mit Neonstreifen oben, Leucht-Teppich unten */
export function paintHall(p: Pix, w: number, h: number, seed = 7) {
  const r = rng(seed);
  // Rückwand: dunkle Paneele mit feinen Fugen
  p.rect(0, 0, w, HALL_FLOOR_Y, HALL.wall);
  for (let x = 0; x < w; x += 40) p.vline(x, 0, HALL_FLOOR_Y, HALL.wallLine);
  for (let y = 12; y < HALL_FLOOR_Y; y += 22) p.hline(0, y, w, HALL.wallDark);
  p.speckle(0, 0, w, HALL_FLOOR_Y, HALL.wallDark, (w * HALL_FLOOR_Y) / 90, r);
  // Neonstreifen quer über die Wand (hinter den Automaten)
  p.hline(0, 46, w, HALL.neonPink).hline(0, 47, w, shade(HALL.neonPink, 0.55));
  p.hline(0, 50, w, HALL.neonCyan).hline(0, 51, w, shade(HALL.neonCyan, 0.55));
  // Sockelleiste
  p.rect(0, HALL_FLOOR_Y - 4, w, 4, HALL.cabDark).hline(0, HALL_FLOOR_Y - 4, w, HALL.cabLight);
  // Boden: dunkler Teppich mit Schachbrett-Schimmer …
  p.rect(0, HALL_FLOOR_Y, w, h - HALL_FLOOR_Y, HALL.floor);
  for (let y = HALL_FLOOR_Y; y < h; y += 12) {
    for (let x = ((y - HALL_FLOOR_Y) / 12) % 2 ? 0 : 24; x < w; x += 48) p.rect(x, y, 24, 12, HALL.floorDark);
  }
  // … und den typischen 80er-Arcade-Konfetti-Mustern in Neon (gedämpft)
  const cols = [shade(HALL.neonPink, 0.6), shade(HALL.neonCyan, 0.55), shade(HALL.neonYellow, 0.5), shade(HALL.neonPurple, 0.7)];
  for (let i = 0; i < (w * (h - HALL_FLOOR_Y)) / 170; i++) {
    const x = Math.floor(r() * w);
    const y = HALL_FLOOR_Y + 2 + Math.floor(r() * (h - HALL_FLOOR_Y - 4));
    const c = cols[Math.floor(r() * cols.length)];
    const k = r();
    if (k < 0.4) p.rect(x, y, 2, 2, c);
    else if (k < 0.7) p.px(x, y, c).px(x + 1, y + 1, c).px(x + 2, y + 2, c);
    else if (k < 0.85) p.hline(x, y, 4, c);
    else p.px(x, y, c).px(x + 2, y, c).px(x + 1, y - 1, c).px(x + 1, y + 1, c);
  }
  // Lichtschein von der Wand auf den Boden
  p.hline(0, HALL_FLOOR_Y, w, HALL.floorLight);
  p.speckle(0, HALL_FLOOR_Y + 1, w, 6, HALL.floorLight, w / 3, r);
}

/** Spielautomat: Kopfleiste in Akzentfarbe, Bildschirm (dunkel, wird von der Szene gefüllt), Bedienfeld, Münzschlitz */
export function cabinet(accent: string, seed = 1): Pix {
  const W = CABINET_W;
  const H = CABINET_H;
  const p = new Pix(W, H + 4);
  const r = rng(seed);
  // Korpus
  p.rect(4, 30, W - 8, H - 30, HALL.cabDark);
  p.rect(2, 8, W - 4, 26, HALL.cab);
  p.vline(2, 8, 26, HALL.cabLight).vline(W - 3, 8, 26, shade(HALL.cab, 0.7));
  p.vline(4, 30, H - 30, HALL.cab).vline(W - 5, 30, H - 30, shade(HALL.cabDark, 0.7));
  // Seitenstreifen in Akzentfarbe
  p.vline(3, 10, 22, accent).vline(W - 4, 10, 22, accent);
  p.vline(5, 32, H - 34, shade(accent, 0.7)).vline(W - 6, 32, H - 34, shade(accent, 0.7));
  // Kopfleiste (Marquee)
  p.rect(2, 2, W - 4, 8, accent);
  p.hline(3, 3, W - 6, shade(accent, 1.35));
  p.hline(3, 8, W - 6, shade(accent, 0.65));
  for (let x = 6; x < W - 6; x += 6) p.px(x, 5, shade(accent, 1.5));
  // Bildschirm mit Rahmen
  const s = CABINET_SCREEN;
  p.rect(s.x - 2, s.y - 2, s.w + 4, s.h + 4, HALL.outline);
  p.rect(s.x, s.y, s.w, s.h, HALL.screen);
  p.hline(s.x, s.y, s.w, shade(HALL.screen, 2.2));
  // Bedienfeld (leicht schräg) mit Stick und zwei Knöpfen
  p.rect(4, 33, W - 8, 6, HALL.cabLight).hline(4, 33, W - 8, shade(HALL.cabLight, 1.3));
  p.rect(11, 29, 2, 5, HALL.metalDark).disc(12, 28, 2, '#e04a3f');
  p.disc(23, 35, 1.6, accent).disc(29, 35, 1.6, HALL.neonYellow);
  // Münzschlitz + Lautsprecher-Löcher
  p.rect(15, 44, 10, 7, HALL.metal).rect(16, 45, 8, 5, HALL.metalDark).hline(18, 47, 4, HALL.outline);
  for (let x = 8; x < W - 8; x += 3) p.px(x, 41, HALL.outline);
  p.speckle(4, 30, W - 8, H - 30, shade(HALL.cabDark, 1.25), 12, r);
  p.outline(HALL.outline);
  // Bodenschatten
  const out = new Pix(W, H + 4);
  out.ellipse(W / 2, H + 1, W / 2 - 3, 3, 'rgba(0,0,0,0.35)');
  out.draw(p, 0, 0);
  return out;
}

/** QR-Automat: dunkler Kasten mit Neonrahmen, in der Mitte frei für den QR-Code (die Szene malt ihn weiß drauf) */
export function qrKiosk(w: number, h: number): Pix {
  const p = new Pix(w, h + 6);
  p.rect(0, 0, w, h, HALL.cabDark);
  p.rect(1, 1, w - 2, h - 2, HALL.cab);
  p.hline(1, 1, w - 2, HALL.cabLight).vline(1, 1, h - 2, HALL.cabLight);
  p.rect(4, 4, w - 8, h - 8, HALL.outline);
  p.rect(5, 5, w - 10, h - 10, HALL.neonCyan);
  p.rect(7, 7, w - 14, h - 14, HALL.panelBg);
  // Füße
  p.rect(8, h, 10, 6, HALL.cabDark).rect(w - 18, h, 10, 6, HALL.cabDark);
  // Münzschlitz-Andeutung unten mittig
  p.rect(w / 2 - 6, h - 10, 12, 3, HALL.metal).hline(w / 2 - 4, h - 9, 8, HALL.outline);
  p.outline(HALL.outline);
  return p;
}

/** Dunkles Panel mit Neonrand (Adresse, Hinweis, Spiel-Titel) */
export function neonPanel(w: number, h: number, accent = HALL.neonCyan): Pix {
  const p = new Pix(w, h);
  p.rect(0, 0, w, h, HALL.outline);
  p.rect(1, 1, w - 2, h - 2, accent);
  p.rect(3, 3, w - 6, h - 6, HALL.panelBg);
  p.hline(3, 3, w - 6, shade(HALL.panelBg, 1.6));
  for (const [x, y] of [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ]) p.px(x, y, shade(accent, 1.4));
  return p;
}

/**
 * Neon-Schild mit Glühbirnen-Lauflicht am Rand: `phase` 0/1 versetzt die leuchtenden Birnen –
 * die Szene wechselt beide Texturen im Takt.
 */
export function marquee(w: number, h: number, phase: 0 | 1): Pix {
  const p = new Pix(w, h);
  p.rect(0, 0, w, h, HALL.outline);
  p.rect(1, 1, w - 2, h - 2, '#7a2a6a');
  p.rect(3, 3, w - 6, h - 6, HALL.panelBg);
  p.hline(3, 3, w - 6, '#2a2050');
  // Birnen oben und unten im Wechsel
  for (let x = 6; x < w - 4; x += 8) {
    const on = (Math.floor(x / 8) + phase) % 2 === 0;
    const c = on ? HALL.neonYellow : HALL.bulbOff;
    p.rect(x, 1, 3, 2, c).rect(x, h - 3, 3, 2, c);
    if (on) p.px(x + 1, 0, shade(HALL.neonYellow, 1.3)).px(x + 1, h - 1, shade(HALL.neonYellow, 1.3));
  }
  for (let y = 8; y < h - 6; y += 8) {
    const on = (Math.floor(y / 8) + phase) % 2 === 1;
    const c = on ? HALL.neonPink : HALL.bulbOff;
    p.rect(1, y, 2, 3, c).rect(w - 3, y, 2, 3, c);
  }
  return p;
}
