import Phaser from 'phaser';
import type { GameState, IntroState, MiniKind } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT } from '../../shared/games';
import { bus, getState, isAtLaptop, playerById } from './store';
import { GOLD, backPlate, fitText, txt } from './ui';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

/** Läuft gerade die Aufwärmrunde (Phase `intro` mit Übungsspiel)? Dann zeigt der TV die echte Szene + diese Leiste. */
export const isWarmup = (s: GameState) => s.phase === 'intro' && !!s.intro?.warm && !!s.mini && s.mini.kind === s.intro.kind;

/** Spiele mit HUD am unteren Rand: dort liegt die Leiste (sonst oben, über dem HUD – das zählt in der Übung nicht) */
const BOTTOM: MiniKind[] = ['smash'];
const BAR_H = 32;

/**
 * Aufwärmrunde auf dem TV (Raum-Phase `intro` mit `intro.warm`): läuft als eigene Szene ÜBER der echten Spielszene
 * (main.ts startet sie mit `scene.run('warmup')`). Schmale Leiste über dem HUD des Spiels: AUFWÄRMEN · Titel · Ziel,
 * darunter „BEREIT x/y · Warte auf …“ und wie man sofort startet. Zum Start ein kurzer Hinweis „nichts zählt“ + Haltung.
 * Bereit-/Start-Logik wie bei der Regelkarte (IntroScene) – kein Timer.
 */
export class WarmupScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private title!: Phaser.GameObjects.Text;
  private count!: Phaser.GameObjects.Text;
  private wait!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private flash: Phaser.GameObjects.Text[] = [];
  /** Für welche Karte (Nummer) die Leiste steht */
  private seq = -1;
  private kind: MiniKind | null = null;
  private readyIds = new Set<string>();

  constructor() {
    super('warmup');
  }

  create() {
    this.seq = -1;
    this.kind = null;
    this.readyIds = new Set();
    this.flash = [];
    this.root = this.add.container(0, 0).setDepth(10);
    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    const it = isWarmup(s) ? s.intro : null;
    if (!it) return;
    if (it.seq !== this.seq || it.kind !== this.kind) this.build(it);
    this.update2(it);
  }

  /** Leiste für eine neue Karte aufbauen (+ Ansage und kurzer Hinweis in der Bildmitte) */
  private build(it: IntroState) {
    this.seq = it.seq;
    this.kind = it.kind;
    this.readyIds = new Set(it.ready);
    this.root.removeAll(true);
    for (const t of this.flash) t.destroy();
    this.flash = [];
    const info = MINI_INFO[it.kind];
    const how = MINI_HOWTO[it.kind];
    const bottom = BOTTOM.includes(it.kind);
    const y0 = bottom ? WORLD.H - BAR_H : 0;

    const plate = this.add.rectangle(0, y0, WORLD.W, BAR_H, 0x2d1b12, 0.92).setOrigin(0, 0);
    const line = this.add.rectangle(0, bottom ? y0 : y0 + BAR_H - 2, WORLD.W, 2, 0xffd25e).setOrigin(0, 0);
    const tagBg = this.add.rectangle(5, y0 + 4, 78, 12, 0xffd25e).setOrigin(0, 0);
    const tag = txt(this, 44, y0 + 6, 'AUFWÄRMEN', { color: '#2d1b12', shadow: false }).setOrigin(0.5, 0);
    fitText(tag, 74, 0.75);
    this.tweens.add({ targets: tagBg, alpha: 0.65, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const teams = it.teams ? `${it.teams.label} · ` : '';
    this.title = txt(this, 90, y0 + 6, `${info.icon} ${info.title} · ${teams}${how?.goal ?? info.tagline}`, { color: GOLD, origin: [0, 0] });
    fitText(this.title, WORLD.W - 96, 0.75);
    this.count = txt(this, 6, y0 + 19, '', { origin: [0, 0] });
    this.wait = txt(this, 6, y0 + 19, '', { color: GOLD, origin: [0, 0] });
    this.hint = txt(this, WORLD.W - 6, y0 + 19, '', { color: '#c9b998', origin: [1, 0] });
    this.root.add([plate, line, tagBg, tag, this.title, this.count, this.wait, this.hint]);

    // Kurzer Hinweis im unteren (bzw. oberen) Drittel – die Bildmitte gehört dem Countdown des Spiels
    const fy = bottom ? 52 : 196;
    const big = txt(this, WORLD.W / 2, fy, 'AUFWÄRMEN!', { size: 16, color: GOLD }).setOrigin(0.5, 0).setDepth(20);
    const sub = txt(this, WORLD.W / 2, fy + 22, 'Probiert die Steuerung aus – nichts zählt.', {}).setOrigin(0.5, 0).setDepth(20);
    const orient = txt(this, WORLD.W / 2, fy + 34, `${ORIENT_TEXT[info.orientation]} · fertig? Am Handy BEREIT drücken`, { color: info.orientation === 'landscape' ? '#9be37b' : '#fff4d6' }).setOrigin(0.5, 0).setDepth(20);
    fitText(sub, 440);
    fitText(orient, 440);
    this.flash = [big, sub, orient];
    backPlate(this, this.flash, 19);
    big.setScale(0.6);
    this.tweens.add({ targets: big, scale: 1, duration: 320, ease: 'Back.out' });
    this.tweens.add({ targets: this.flash, alpha: 0, delay: 4200, duration: 600 });
    sfx('whoosh', { vol: 0.6 });

    if (it.teams) {
      const names = (ids: string[]) => {
        const n = ids.map((id) => spokenName(playerById(id)?.name));
        return n.length > 1 ? `${n.slice(0, -1).join(', ')} und ${n[n.length - 1]}` : n[0] ?? 'niemand';
      };
      say(`${info.title}, ${it.teams.label}! ${names(it.teams.A)} gegen ${names(it.teams.B)}. Erst aufwärmen!`);
    } else say(it.short ? `${info.title} – aufwärmen!` : `${info.title}. Aufwärmrunde – probiert die Steuerung aus!`);
  }

  /** BEREIT x/y, auf wen gewartet wird, Start-Hinweis */
  private update2(it: IntroState) {
    const waiting = it.ids.filter((id) => !it.ready.includes(id));
    const fresh = it.ready.filter((id) => !this.readyIds.has(id));
    this.readyIds = new Set(it.ready);
    if (fresh.length) sfx('select', { pitch: 1 + Math.min(0.4, it.ready.length * 0.04) });

    this.count.setText(`BEREIT ${it.ready.length}/${it.ids.length}`).setColor(waiting.length ? '#fff4d6' : '#9be37b');
    this.hint.setText(isAtLaptop() ? 'Sofort los: VIP-Handy / Enter' : 'Sofort los: VIP-Handy');
    fitText(this.hint, 190, 0.75);
    const x = 6 + this.count.displayWidth + 8;
    let text: string;
    if (!waiting.length) text = '· Alle bereit – los geht’s!';
    else {
      const names = waiting.map((id) => playerById(id)?.name ?? '?');
      text = `· Warte auf ${names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ')}`;
    }
    this.wait.setPosition(x, this.wait.y).setText(text).setColor(waiting.length ? '#ffd25e' : '#9be37b');
    fitText(this.wait, WORLD.W - 6 - this.hint.displayWidth - 10 - x, 0.75);
  }
}
