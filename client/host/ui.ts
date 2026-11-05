import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { FONT, bus } from './store';
import { sfx } from './sfx';
import { say } from './speech';
import { Pix } from '../art/pix';
import { panelPix, tagPix } from '../art/objects';

export const INK = '#3d2414';
export const LIGHT = '#fff4d6';
export const GOLD = '#ffd25e';
export const RED_INK = '#a8342a';
export const BLUE_INK = '#2d64a8';
export const GREEN_INK = '#2f7d32';

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { size?: 8 | 16 | 24; color?: string; origin?: [number, number]; wrap?: number; align?: string; shadow?: boolean } = {},
) {
  const t = scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: `${opts.size ?? 8}px`,
    color: opts.color ?? LIGHT,
    align: opts.align ?? 'center',
    lineSpacing: 4,
    wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
  });
  t.setOrigin(...(opts.origin ?? [0.5, 0]));
  if (opts.shadow !== false) t.setShadow(1, 1, '#2d1b12', 0, false, true);
  return t;
}

/** Text in Tinte (für Pergament-Flächen) */
export function ink(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { size?: 8 | 16 | 24; color?: string; origin?: [number, number]; wrap?: number; align?: string } = {},
) {
  return txt(scene, x, y, text, { ...opts, color: opts.color ?? INK, shadow: false });
}

/** Erzeugt eine Textur einmalig aus Pixel-Art */
export function ensureTex(scene: Phaser.Scene, key: string, make: () => Pix | HTMLCanvasElement): string {
  if (!scene.textures.exists(key)) {
    const src = make();
    scene.textures.addCanvas(key, src instanceof Pix ? src.canvas : src);
  }
  return key;
}

/** Holzrahmen-Panel mit Pergament (Größe in Welt-Pixeln) */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, variant: 'paper' | 'dark' = 'paper') {
  const key = ensureTex(scene, `panel_${w}_${h}_${variant}`, () => panelPix(w, h, variant));
  return scene.add.image(x, y, key).setOrigin(0, 0);
}

/** Anzeigename für Schilder: ohne „Bot “-Präfix (sonst bleibt bei 8 Bots nur „Bot“ ×8 übrig) */
export const tagName = (name: string) => name.replace(/^Bot\s+/, '');

/**
 * Text auf eine Breite bringen: erst die Schrift verkleinern (bis `min`), erst danach kürzen.
 * Ersetzt das harte `name.slice(0, 6)` der Reihen-Szenen.
 */
export function fitText<T extends Phaser.GameObjects.Text>(t: T, maxW: number, min = 0.6): T {
  t.setScale(1);
  const w = t.width;
  if (w <= maxW) return t;
  if (w * min > maxW) {
    // Monospace-Schrift: 8 px pro Zeichen bei Größe 8 → so viele Zeichen passen bei `min`
    const per = w / Math.max(1, t.text.length);
    const n = Math.max(1, Math.floor(maxW / (per * min)) - 1);
    t.setText(`${t.text.slice(0, n)}.`);
  }
  t.setScale(Math.max(min, Math.min(1, maxW / t.width)));
  return t;
}

/**
 * Namensschild unter Figuren. Ohne „Bot “-Präfix; mit `maxW` wird das Schild höchstens so
 * breit und die Schrift schrumpft auf die Schildbreite statt abgeschnitten zu werden.
 */
export function nameTag(scene: Phaser.Scene, x: number, y: number, name: string, color = INK, maxW?: number) {
  const nm = tagName(name);
  const natural = Math.max(20, nm.length * 8 + 6);
  const w = maxW ? Math.max(20, Math.min(natural, Math.floor(maxW))) : natural;
  const key = ensureTex(scene, `tag_${w}`, () => tagPix(w));
  const c = scene.add.container(x, y);
  c.add(scene.add.image(0, 0, key).setOrigin(0.5, 0));
  const t = ink(scene, 0, 2, nm, { color });
  if (w < natural) {
    fitText(t, w - 4);
    t.setY(2 + (8 - t.displayHeight) / 2 + 0.5);
  }
  c.add(t);
  return c;
}

// ------------------------------------------------------------------ Namensschilder über Figuren

/** Eingabe für `layoutNameTags`: Anker (Mitte, Oberkante) und Breite voll/kurz */
export interface TagBox {
  x: number;
  y: number;
  /** Breite mit vollem Namen */
  w: number;
  /** Breite in Kurzform (Farbpunkt + Initiale) */
  ws: number;
  /** Vorheriges Ergebnis – sorgt für Ruhe (kein Flackern zwischen voll und kurz) */
  prev?: { dy: number; short: boolean };
}

const TAG_H = 9;
const TAG_LIFT = 10;

/**
 * Namensschilder gegeneinander versetzen: Jedes Schild probiert seinen Platz, dann eine Zeile
 * höher; kollidiert es dann immer noch, zeigt es nur Farbpunkt + Initiale (wieder erst unten,
 * dann oben). Gibt pro Schild Versatz nach oben (`dy`, ≤ 0) und Kurzform zurück.
 */
export function layoutNameTags(tags: TagBox[]): { dy: number; short: boolean }[] {
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const out: { dy: number; short: boolean }[] = tags.map(() => ({ dy: 0, short: false }));
  const hits = (l: number, r: number, t: number, b: number) => placed.some((p) => l < p.r && r > p.l && t < p.b && b > p.t);
  // Von unten nach oben: vordere Figuren (größeres y) zuerst, die hinteren weichen aus
  const order = tags.map((_, i) => i).sort((a, b) => tags[b].y - tags[a].y || tags[a].x - tags[b].x);
  for (const i of order) {
    const g = tags[i];
    // Hysterese: wer schon kurz war, braucht etwas mehr Platz, um wieder lang zu werden
    const pad = g.prev?.short ? 3 : 0;
    const lifts = g.prev && g.prev.dy < 0 ? [-TAG_LIFT, 0] : [0, -TAG_LIFT];
    let done = false;
    for (const short of [false, true]) {
      const w = (short ? g.ws : g.w) + (short ? 0 : pad * 2);
      for (const dy of lifts) {
        const l = g.x - w / 2 - 1;
        const r = g.x + w / 2 + 1;
        const t = g.y + dy;
        if (hits(l, r, t, t + TAG_H)) continue;
        out[i] = { dy, short };
        placed.push({ l, r, t, b: t + TAG_H });
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) {
      out[i] = { dy: 0, short: true };
      placed.push({ l: g.x - g.ws / 2, r: g.x + g.ws / 2, t: g.y, b: g.y + TAG_H });
    }
  }
  return out;
}

export interface NameTagSpec {
  id: string;
  /** Mitte des Schilds */
  x: number;
  /** Oberkante des Schilds (ohne Versatz) */
  y: number;
  name: string;
  /** Textfarbe ('#rrggbb') */
  color: string;
  /** Farbe des Punkts in der Kurzform (Standard: Textfarbe) */
  dot?: number;
  alpha?: number;
  scale?: number;
}

/**
 * Namensschilder für bewegte Figuren: eigene Ebene über den Figuren, jedes Bild neu verteilt
 * (`layoutNameTags`). Pro Szene in `create()` neu anlegen, in `update()` mit allen sichtbaren
 * Figuren füttern (fehlende ids verschwinden).
 */
export class NameTags {
  private tags = new Map<string, { t: Phaser.GameObjects.Text; dot: Phaser.GameObjects.Rectangle; name: string; color: string; last: { dy: number; short: boolean } }>();

  constructor(
    private scene: Phaser.Scene,
    private depth = 1040,
    private layer?: Phaser.GameObjects.Container,
  ) {}

  update(specs: NameTagSpec[]) {
    const seen = new Set<string>();
    const boxes: TagBox[] = [];
    for (const s of specs) {
      seen.add(s.id);
      const k = s.scale ?? 1;
      let o = this.tags.get(s.id);
      const nm = tagName(s.name);
      if (!o) {
        const t = txt(this.scene, 0, 0, nm, { color: s.color });
        const dot = this.scene.add.rectangle(0, 0, 5, 5, s.dot ?? parseInt(s.color.slice(1), 16)).setStrokeStyle(1, 0x2d1b12).setOrigin(0.5, 0);
        if (this.layer) this.layer.add([dot, t]);
        else (t.setDepth(this.depth + 1), dot.setDepth(this.depth));
        o = { t, dot, name: nm, color: s.color, last: { dy: 0, short: false } };
        this.tags.set(s.id, o);
      }
      if (o.color !== s.color) {
        o.color = s.color;
        o.t.setColor(s.color);
        o.dot.setFillStyle(s.dot ?? parseInt(s.color.slice(1), 16));
      }
      o.name = nm;
      boxes.push({ x: s.x, y: s.y, w: nm.length * 8 * k, ws: 16 * k, prev: o.last });
    }
    const res = layoutNameTags(boxes);
    specs.forEach((s, i) => {
      const o = this.tags.get(s.id)!;
      const r = res[i];
      o.last = r;
      const k = s.scale ?? 1;
      const want = r.short ? o.name.charAt(0).toUpperCase() : o.name;
      if (o.t.text !== want) o.t.setText(want);
      o.t.setScale(k).setAlpha(s.alpha ?? 1);
      if (r.short) {
        o.t.setPosition(s.x + 4 * k, s.y + r.dy);
        o.dot.setVisible(true).setScale(k).setAlpha(s.alpha ?? 1).setPosition(s.x - 4 * k, s.y + r.dy + 1.5 * k);
      } else {
        o.t.setPosition(s.x, s.y + r.dy);
        o.dot.setVisible(false);
      }
      o.t.setVisible(true);
    });
    for (const [id, o] of this.tags) {
      if (seen.has(id)) continue;
      o.t.destroy();
      o.dot.destroy();
      this.tags.delete(id);
    }
  }

  clear() {
    for (const o of this.tags.values()) (o.t.destroy(), o.dot.destroy());
    this.tags.clear();
  }
}

/** Hintergrund einmalig malen und als Bild einfügen */
export function background(scene: Phaser.Scene, key: string, w: number, h: number, paint: (p: Pix) => void) {
  const k = ensureTex(scene, `bg_${key}`, () => {
    const p = new Pix(w, h);
    paint(p);
    return p;
  });
  return scene.add.image(0, 0, k).setOrigin(0, 0).setDepth(-1000);
}

/** Sprite aus Pixel-Art einfügen (Ursprung unten mittig – für Tiefensortierung) */
export function prop(scene: Phaser.Scene, key: string, make: () => Pix, x: number, y: number) {
  const img = scene.add.image(x, y, ensureTex(scene, key, make)).setOrigin(0.5, 1);
  img.setDepth(y);
  return img;
}

/** Lokaler Countdown aus dem Server-Wert "endsIn" (ms). */
export class Countdown {
  private endsAt = 0;
  /** Phase ohne Zeitlimit (Server schickt endsIn 0) → keinen Countdown anzeigen */
  none = false;

  set(endsInMs: number) {
    this.endsAt = performance.now() + endsInMs;
    this.none = endsInMs <= 0;
  }

  get remaining() {
    return Math.max(0, this.endsAt - performance.now());
  }

  get seconds() {
    return Math.ceil(this.remaining / 1000);
  }
}

export const PLACE_COLORS = ['#c98a10', '#6e6a62', '#a5602a', INK];

// ------------------------------------------------------------------ Start-Countdown (zentral)

/**
 * Countdown-Piep + „LOS“ für alle Minispiele mit Phase `sub: 'countdown'` (und `endsIn`):
 * Piep + Sprecher („Drei“, „Zwei“, „Eins“) in den letzten drei Sekunden, beim Wechsel in die
 * Spielphase Start-Ton + „Los!“. Hängt einmal am Zustands-Bus, die Szenen müssen nichts tun.
 * Eine eigene lokale Uhr, weil der Server während des Countdowns nicht unbedingt sendet.
 */
const CUE_WORDS = ['', 'Eins', 'Zwei', 'Drei'];
const cue = { kind: '', sub: '', sec: 0, endsAt: 0, timer: 0 };

function cueTick() {
  if (cue.sub !== 'countdown') {
    window.clearInterval(cue.timer);
    cue.timer = 0;
    return;
  }
  const sec = Math.ceil((cue.endsAt - performance.now()) / 1000);
  if (sec !== cue.sec && sec >= 1 && sec <= 3) {
    sfx('countdown');
    say(CUE_WORDS[sec], { interrupt: true, rate: 1.15 });
  }
  cue.sec = sec;
}

function onCueState(s: GameState) {
  const kind = s.phase === 'mini' && s.mini ? s.mini.kind : '';
  const st = (s.mini?.state ?? null) as { sub?: unknown; endsIn?: unknown } | null;
  const sub = kind && typeof st?.sub === 'string' ? st.sub : '';
  if (kind !== cue.kind) {
    cue.kind = kind;
    cue.sub = '';
    cue.sec = 0;
  }
  if (sub === 'countdown' && typeof st?.endsIn === 'number') {
    cue.endsAt = performance.now() + st.endsIn;
    cue.sub = sub;
    if (!cue.timer) cue.timer = window.setInterval(cueTick, 50);
    cueTick();
    return;
  }
  if (cue.sub === 'countdown' && sub && sub !== 'over') {
    sfx('go');
    say('Los!', { interrupt: true, rate: 1.15 });
  }
  cue.sub = sub;
  cue.sec = 0;
  cueTick();
}

bus.on('state', onCueState);
