/**
 * Ambient-Bewegung für leere Arenen (Boule, SUP, Golf, Flunkyball, Wraps …): Möwen, Wolken bzw.
 * Wolkenschatten, Wellenschaum, wehende Palmen und Zuschauer am Rand – alles reine Tweens, ohne Server.
 * Dazu die Tageszeit (`daylight()`): ein Multiply-Overlay über der Kulisse, das `GameMeta.timeOfDay` folgt.
 *
 * Pro Szene in `create()` aufrufen (die Objekte gehören der Szene und verschwinden beim Neustart).
 *
 *   gulls(this, { n: 2, y: [20, 70], depth: -500 });
 *   crowd(this, [[20, 250], [460, 250]], { depth: 5 });
 *   daylight(this, { depth: -950 });   // direkt über dem Hintergrund, unter Figuren und HUD
 *
 * `layer`: in Szenen mit HUD-Kamera (Smash, Bogen …) wandern die Objekte in den Welt-Container.
 */
import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { randomLook } from '../../shared/avatar';
import { ensureTex } from './ui';
import { ensureAvatar } from './textures';
import { bus, getState } from './store';
import { palm } from '../art/objects';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Layer = Phaser.GameObjects.Container | undefined;
const into = <T extends Phaser.GameObjects.GameObject>(layer: Layer, go: T): T => (layer?.add(go), go);

// ---------------------------------------------------------------- Tageszeit

/** Tageszeit → Farbe des Multiply-Overlays (0 Morgen, 0.35 Mittag, 0.8 Sonnenuntergang, 1 Nacht) */
export const DAY_KEYS: [number, number][] = [
  [0, 0xffe9d2],
  [0.35, 0xffffff],
  [0.6, 0xfff0d2],
  [0.8, 0xf8a878],
  [0.9, 0xa07a9a],
  [1, 0x5868a8],
];

export function dayColor(t: number): Phaser.Display.Color {
  let i = 0;
  while (i < DAY_KEYS.length - 2 && t > DAY_KEYS[i + 1][0]) i++;
  const [t0, c0] = DAY_KEYS[i];
  const [t1, c1] = DAY_KEYS[i + 1];
  const k = Phaser.Math.Clamp((t - t0) / (t1 - t0 || 1), 0, 1);
  const a = Phaser.Display.Color.ValueToColor(c0);
  const b = Phaser.Display.Color.ValueToColor(c1);
  const o = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, k * 100);
  return new Phaser.Display.Color(o.r, o.g, o.b);
}

/** Aktuelle Tageszeit des Raums (0…1), 0.35 (Mittag = neutral), solange noch kein Stand da ist */
export const timeOfDay = () => getState()?.timeOfDay ?? 0.35;

/**
 * Tageszeit-Overlay (Multiply) über der Kulisse: morgens warm, mittags neutral, abends orange, nachts blau.
 * Liegt bei `depth` (Standard −950: über dem Hintergrund, unter allem Spielgeschehen) und folgt dem Raumwert
 * `timeOfDay` mit einer weichen Blende. `strength` dämpft die Färbung (1 = wie auf dem Spielbrett).
 */
export function daylight(scene: Phaser.Scene, o: { depth?: number; w?: number; h?: number; strength?: number; layer?: Phaser.GameObjects.Container; scroll?: number } = {}) {
  const w = o.w ?? 480;
  const h = o.h ?? 270;
  const strength = o.strength ?? 0.8;
  // Etwas größer als die Welt, damit bei Kamerafahrten (Parallax, Zoom) kein Rand frei bleibt
  const rect = scene.add.rectangle(-w / 2, -h / 2, w * 2, h * 2, 0xffffff, 1).setOrigin(0).setDepth(o.depth ?? -950).setBlendMode(Phaser.BlendModes.MULTIPLY);
  if (o.scroll !== undefined) rect.setScrollFactor(o.scroll);
  into(o.layer, rect);
  let shown = -1;
  let tween: Phaser.Tweens.Tween | null = null;
  const apply = (t: number) => {
    const c = dayColor(t);
    const white = Phaser.Display.Color.ValueToColor(0xffffff);
    const m = Phaser.Display.Color.Interpolate.ColorWithColor(white, c, 100, strength * 100);
    rect.setFillStyle(Phaser.Display.Color.GetColor(m.r, m.g, m.b), 1);
  };
  const set = (t: number) => {
    t = Phaser.Math.Clamp(t, 0, 1);
    if (t === shown) return;
    const from = shown < 0 ? t : shown;
    shown = t;
    tween?.stop();
    const v = { t: from };
    apply(from);
    tween = scene.tweens.add({ targets: v, t, duration: from === t ? 1 : 2500, ease: 'Sine.inOut', onUpdate: () => apply(v.t) });
  };
  const onState = (s: GameState) => set(s.timeOfDay ?? 0.35);
  bus.on('state', onState);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
  set(timeOfDay());
  return rect;
}

function canvas(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  return () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d')!);
    return c;
  };
}

/** Möwe in zwei Flügelstellungen (oben / unten) */
function gullTex(scene: Phaser.Scene) {
  const px = (g: CanvasRenderingContext2D, pts: [number, number][], col: string) => {
    g.fillStyle = col;
    for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
  };
  ensureTex(scene, 'amb_gull0', canvas(9, 5, (g) => {
    px(g, [[0, 0], [1, 1], [2, 2], [3, 2], [5, 2], [6, 2], [7, 1], [8, 0]], '#3d2414');
    px(g, [[4, 3], [3, 3], [5, 3]], '#f4efe2');
    px(g, [[4, 4]], '#f0973a');
  }));
  ensureTex(scene, 'amb_gull1', canvas(9, 5, (g) => {
    px(g, [[0, 3], [1, 3], [2, 2], [3, 2], [5, 2], [6, 2], [7, 3], [8, 3]], '#3d2414');
    px(g, [[4, 2], [3, 3], [4, 3], [5, 3]], '#f4efe2');
    px(g, [[4, 4]], '#f0973a');
  }));
}

/** Möwen ziehen in Abständen quer übers Bild (mit Flügelschlag und leichtem Auf und Ab) */
export function gulls(scene: Phaser.Scene, o: { n?: number; y?: [number, number]; depth?: number; alpha?: number; scroll?: number; layer?: Layer } = {}) {
  gullTex(scene);
  const [y0, y1] = o.y ?? [16, 70];
  for (let i = 0; i < (o.n ?? 2); i++) {
    const img = into(o.layer, scene.add.image(-20, rnd(y0, y1), 'amb_gull0').setDepth(o.depth ?? 900).setAlpha(o.alpha ?? 0.9).setScrollFactor(o.scroll ?? 1));
    let frame = 0;
    scene.time.addEvent({ delay: 170 + i * 20, loop: true, callback: () => img.setTexture(`amb_gull${(frame = 1 - frame)}`) });
    const fly = () => {
      const ltr = Math.random() < 0.5;
      const y = rnd(y0, y1);
      img.setPosition(ltr ? -20 : 500, y).setFlipX(!ltr);
      scene.tweens.add({ targets: img, x: ltr ? 500 : -20, duration: rnd(9000, 15000), delay: rnd(500, 6000), onComplete: fly });
      scene.tweens.add({ targets: img, y: y + rnd(-8, 8), duration: rnd(1200, 2000), yoyo: true, repeat: 4, ease: 'Sine.inOut' });
    };
    fly();
  }
}

/** Weiche Wolkenschatten, die langsam über den Boden ziehen (nur eine Spur dunkler) */
export function cloudShadows(scene: Phaser.Scene, o: { n?: number; y?: [number, number]; depth?: number; alpha?: number } = {}) {
  const [y0, y1] = o.y ?? [40, 240];
  ensureTex(scene, 'amb_cloudshadow', canvas(64, 24, (g) => {
    g.fillStyle = '#000000';
    for (const [x, y, w, h] of [[8, 8, 48, 10], [4, 11, 56, 6], [16, 4, 26, 18], [30, 6, 22, 14]]) g.fillRect(x, y, w, h);
  }));
  for (let i = 0; i < (o.n ?? 3); i++) {
    const img = scene.add.image(rnd(0, 480), rnd(y0, y1), 'amb_cloudshadow').setDepth(o.depth ?? -900).setAlpha(o.alpha ?? 0.07).setScale(rnd(1.2, 2));
    const drift = () => {
      scene.tweens.add({
        targets: img, x: 560, duration: ((560 - img.x) / 560) * rnd(40000, 60000),
        onComplete: () => (img.setPosition(-80, rnd(y0, y1)), drift()),
      });
    };
    drift();
  }
}

/** Kleine Pixel-Wolken am Himmel, die langsam treiben */
export function clouds(scene: Phaser.Scene, o: { n?: number; y?: [number, number]; depth?: number; alpha?: number; scroll?: number; layer?: Layer; tint?: number } = {}) {
  const [y0, y1] = o.y ?? [8, 40];
  ensureTex(scene, 'amb_cloud', canvas(30, 12, (g) => {
    g.fillStyle = '#ffffff';
    for (const [x, y, w, h] of [[4, 5, 22, 6], [8, 2, 10, 9], [15, 1, 9, 8], [1, 7, 28, 4]]) g.fillRect(x, y, w, h);
    g.fillStyle = '#dfe9f2';
    g.fillRect(2, 10, 26, 2);
  }));
  for (let i = 0; i < (o.n ?? 3); i++) {
    const img = into(o.layer, scene.add.image(rnd(0, 480), rnd(y0, y1), 'amb_cloud').setDepth(o.depth ?? -950).setAlpha(o.alpha ?? 0.9).setScale(rnd(0.8, 1.4)));
    if (o.scroll !== undefined) img.setScrollFactor(o.scroll);
    if (o.tint !== undefined) img.setTint(o.tint);
    const drift = () => {
      scene.tweens.add({ targets: img, x: 520, duration: ((520 - img.x) / 560) * rnd(50000, 80000), onComplete: () => (img.setPosition(-40, rnd(y0, y1)), drift()) });
    };
    drift();
  }
}

/** Wehen: Objekte (Palmen, Schirme, Fahnen) pendeln leicht um ihren Fußpunkt – Ursprung unten setzen (`prop()` tut das) */
export function sway(scene: Phaser.Scene, targets: Phaser.GameObjects.Components.Transform[], o: { angle?: number; ms?: number } = {}) {
  targets.forEach((t, i) => {
    const a = o.angle ?? 2;
    scene.tweens.add({ targets: t, angle: { from: -a, to: a }, duration: (o.ms ?? 1800) + i * 230, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 310 });
  });
}

/** Palmen am Rand, die im Wind wehen (Fußpunkt = x/y). `flip` ab der Bildmitte automatisch */
export function palms(scene: Phaser.Scene, spots: [number, number, number?][], o: { depth?: number; scale?: number; layer?: Layer; scroll?: number; alpha?: number } = {}) {
  const imgs = spots.map(([x, y, seed], i) => {
    const key = ensureTex(scene, `amb_palm${seed ?? 6}`, () => palm(seed ?? 6));
    const img = into(o.layer, scene.add.image(x, y, key).setOrigin(0.5, 1).setDepth(o.depth ?? y).setScale(o.scale ?? 1).setAlpha(o.alpha ?? 1));
    img.setFlipX(x > 240 !== (i % 3 === 0));
    if (o.scroll !== undefined) img.setScrollFactor(o.scroll);
    return img;
  });
  sway(scene, imgs, { angle: 1.6 });
  return imgs;
}

/** Wellen: helle Kämme, die über eine Wasserfläche wandern (Seitenansicht: Horizontlinie; Draufsicht: ganze Fläche) */
export function waves(scene: Phaser.Scene, o: { x?: [number, number]; y: [number, number]; n?: number; depth?: number; color?: number; layer?: Layer; scroll?: number }) {
  const [x0, x1] = o.x ?? [0, 480];
  for (let i = 0; i < (o.n ?? 12); i++) {
    const x = rnd(x0, x1);
    const y = rnd(o.y[0], o.y[1]);
    const w = into(o.layer, scene.add.rectangle(x, y, rnd(5, 12), 1, o.color ?? 0xeaf8ff, 0.7).setDepth(o.depth ?? -900));
    if (o.scroll !== undefined) w.setScrollFactor(o.scroll);
    scene.tweens.add({ targets: w, x: x + rnd(4, 9), alpha: 0.1, duration: rnd(1300, 2300), yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: rnd(0, 1500) });
  }
}

/** Wellenschaum: helle Striche entlang einer Wasserlinie, die rhythmisch auf- und ablaufen */
export function foam(scene: Phaser.Scene, o: { y: number; x?: [number, number]; n?: number; depth?: number; spread?: number }) {
  const [x0, x1] = o.x ?? [0, 480];
  const n = o.n ?? 10;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0) + rnd(-8, 8);
    const y = o.y + rnd(-(o.spread ?? 3), o.spread ?? 3);
    const r = scene.add.rectangle(x, y, rnd(6, 14), 1, 0xffffff, 0.75).setDepth(o.depth ?? -800);
    scene.tweens.add({ targets: r, x: x + rnd(3, 7), alpha: 0.05, scaleX: 0.4, duration: rnd(1400, 2200), yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: rnd(0, 1500) });
  }
}

/** Zuschauer am Rand: zufällige Avatare, die ab und zu hüpfen bzw. jubeln (`cheer()`) */
export function crowd(scene: Phaser.Scene, spots: [number, number][], o: { depth?: number; scale?: number; alpha?: number } = {}) {
  const imgs = spots.map(([x, y], i) => {
    const img = scene.add.image(x, y, ensureAvatar(scene, randomLook())).setOrigin(0.5, 1).setDepth(o.depth ?? y).setScale(o.scale ?? 1).setAlpha(o.alpha ?? 1);
    img.setFlipX(x > 240);
    scene.time.addEvent({
      delay: rnd(2500, 5000) + i * 200, loop: true,
      callback: () => {
        if (Math.random() < 0.5) scene.tweens.add({ targets: img, y: y - 3, duration: 140, yoyo: true, ease: 'Quad.Out' });
      },
    });
    return img;
  });
  return {
    /** Alle kurz jubeln lassen (z. B. bei Treffer oder Punkt) */
    cheer() {
      imgs.forEach((img, i) => {
        const y0 = img.getData('y0') ?? img.y;
        img.setData('y0', y0);
        scene.tweens.add({ targets: img, y: y0 - 5, duration: 160, yoyo: true, repeat: 1, delay: i * 40, ease: 'Quad.Out', onComplete: () => img.setY(y0) });
      });
    },
  };
}

/** Funkeln: Sterne am Nachthimmel bzw. Lichtreflexe auf dem Wasser (kleine Punkte, die auf- und abblenden) */
export function twinkle(scene: Phaser.Scene, o: { n?: number; x?: [number, number]; y: [number, number]; color?: number; depth?: number; w?: number }) {
  const [x0, x1] = o.x ?? [0, 480];
  for (let i = 0; i < (o.n ?? 12); i++) {
    const r = scene.add.rectangle(rnd(x0, x1), rnd(o.y[0], o.y[1]), o.w ?? 1, 1, o.color ?? 0xfff4d6, 0).setDepth(o.depth ?? -900);
    scene.tweens.add({ targets: r, alpha: rnd(0.5, 1), duration: rnd(500, 1200), yoyo: true, repeat: -1, delay: rnd(0, 3000), repeatDelay: rnd(400, 2500) });
  }
}
