/**
 * Ambient-Bewegung für leere Arenen (Boule, SUP, Golf, Flunkyball, Wraps …): Möwen, Wolken bzw.
 * Wolkenschatten, Wellenschaum und Zuschauer am Rand – alles reine Tweens, ohne Server.
 *
 * Pro Szene in `create()` aufrufen (die Objekte gehören der Szene und verschwinden beim Neustart).
 *
 *   gulls(this, { n: 2, y: [20, 70], depth: -500 });
 *   crowd(this, [[20, 250], [460, 250]], { depth: 5 });
 */
import Phaser from 'phaser';
import { randomLook } from '../../shared/avatar';
import { ensureTex } from './ui';
import { ensureAvatar } from './textures';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

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
export function gulls(scene: Phaser.Scene, o: { n?: number; y?: [number, number]; depth?: number; alpha?: number; scroll?: number } = {}) {
  gullTex(scene);
  const [y0, y1] = o.y ?? [16, 70];
  for (let i = 0; i < (o.n ?? 2); i++) {
    const img = scene.add.image(-20, rnd(y0, y1), 'amb_gull0').setDepth(o.depth ?? 900).setAlpha(o.alpha ?? 0.9).setScrollFactor(o.scroll ?? 1);
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
export function clouds(scene: Phaser.Scene, o: { n?: number; y?: [number, number]; depth?: number } = {}) {
  const [y0, y1] = o.y ?? [8, 40];
  ensureTex(scene, 'amb_cloud', canvas(30, 12, (g) => {
    g.fillStyle = '#ffffff';
    for (const [x, y, w, h] of [[4, 5, 22, 6], [8, 2, 10, 9], [15, 1, 9, 8], [1, 7, 28, 4]]) g.fillRect(x, y, w, h);
    g.fillStyle = '#dfe9f2';
    g.fillRect(2, 10, 26, 2);
  }));
  for (let i = 0; i < (o.n ?? 3); i++) {
    const img = scene.add.image(rnd(0, 480), rnd(y0, y1), 'amb_cloud').setDepth(o.depth ?? -950).setAlpha(0.9).setScale(rnd(0.8, 1.4));
    const drift = () => {
      scene.tweens.add({ targets: img, x: 520, duration: ((520 - img.x) / 560) * rnd(50000, 80000), onComplete: () => (img.setPosition(-40, rnd(y0, y1)), drift()) });
    };
    drift();
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
