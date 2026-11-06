import Phaser from 'phaser';
import type { GameState, IntroState, MiniKind, MiniTeams, Team } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT, miniInspired, teamHandicap } from '../../shared/games';
import { playerColor } from '../../shared/players';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, isAtLaptop, playerById } from './store';
import { GREEN_INK, INK, RED_INK, background, fitText, ink, panel, txt } from './ui';
import { figure } from './textures';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { setScene } from './music';

/**
 * Regelkarte vor einem Minispiel ohne Aufwärmrunde (Raum-Phase `intro`; Spiele aus `WARMUP_KINDS` zeigen statt dessen
 * ihre echte Szene + WarmupScene): Icon, Titel, „à la …“, Ziel-Satz, bis zu 3 Steuer-Zeilen aus `MINI_HOWTO`
 * (eine Zeile pro Bedienung, passt sich der Länge an), Haltung des Handys, darunter alle Mitspieler mit Häkchen
 * „bereit“ (wer noch fehlt: „...“).
 * Kein Countdown: Das Spiel startet erst, wenn alle bereit sind – oder der VIP („▶ Jetzt starten“) bzw. der Laptop
 * (Enter) es erzwingt. Oben rechts „BEREIT x/y“, unter der Karte „Warte auf …“ mit Namen.
 */
export class IntroScene extends Phaser.Scene {
  private juice!: Juice;
  /** Welche Karte steht (Spiel + Team-Aufteilung) */
  private cardKey = '';
  private teams: MiniTeams | null = null;
  private card!: Phaser.GameObjects.Container;
  private crowd!: Phaser.GameObjects.Container;
  private count!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private figs = new Map<string, { fig: Phaser.GameObjects.Container; check: Phaser.GameObjects.Graphics; wait: Phaser.GameObjects.Text; ready: boolean }>();
  private crowdKey = '';

  constructor() {
    super('intro');
  }

  create() {
    this.cardKey = '';
    this.teams = null;
    this.crowdKey = '';
    this.figs = new Map();
    this.juice = new Juice(this);
    background(this, 'intro_wood', WORLD.W, WORLD.H, (p) => paintWoodFloor(p, 0, 0, WORLD.W, WORLD.H, 23));
    this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.35).setOrigin(0).setDepth(-900);
    this.card = this.add.container(0, 0);
    this.crowd = this.add.container(0, 0);
    this.count = ink(this, 452, 14, '', { origin: [1, 0] }).setDepth(10);
    this.hint = ink(this, WORLD.W / 2, 166, '', { color: '#7a5a3a' }).setDepth(10);
    this.status = txt(this, WORLD.W / 2, 186, '', { color: '#ffd25e' }).setDepth(10);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    const it = s.phase === 'intro' ? s.intro : null;
    if (!it) return;
    const key = `${it.kind}|${it.teams?.label ?? ''}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.teams = it.teams ?? null;
      this.crowdKey = '';
      this.buildCard(it.kind, it.short, it.teams ?? null);
    }
    this.renderCrowd(it);
  }

  /** Statische Regelkarte: Titel, Ziel, Steuer-Zeilen, Haltung */
  private buildCard(kind: MiniKind, short: boolean, teams: MiniTeams | null) {
    this.card.removeAll(true);
    const info = MINI_INFO[kind];
    const how = MINI_HOWTO[kind];
    // Musik des Spiels läuft schon während der Regelkarte
    setScene(kind);
    if (teams) {
      // Team-Spiel vom Brett: Aufteilung ansagen („Anna und Ben gegen Clara, Dani und Emil“)
      const names = (ids: string[]) => {
        const n = ids.map((id) => spokenName(playerById(id)?.name));
        return n.length > 1 ? `${n.slice(0, -1).join(', ')} und ${n[n.length - 1]}` : n[0] ?? 'niemand';
      };
      say(`${info.title}, ${teams.label}! ${names(teams.A)} gegen ${names(teams.B)}.`);
    } else say(short ? `${info.title}!` : `${info.title}. Macht euch bereit!`);

    const c = this.card;
    c.add(panel(this, 12, 6, 456, 176));
    c.add(ink(this, 28, 14, teams ? `~ Regelkarte · ${teams.label.toUpperCase()} ~` : '~ Regelkarte ~', { color: RED_INK, origin: [0, 0] }));
    const title = ink(this, WORLD.W / 2, 26, `${info.icon} ${info.title}`, { size: 16 });
    fitText(title, 420, 0.6);
    c.add(title);
    let y = 46;
    const insp = miniInspired(kind);
    if (insp) {
      c.add(ink(this, WORLD.W / 2, y, insp, { color: '#7a5a3a' }));
      y += 12;
    }
    const goal = ink(this, WORLD.W / 2, y + 2, how.goal, { wrap: 420 });
    // Sehr lange Ziel-Sätze (Balance Board, Verräter) kleiner statt über die Steuer-Zeilen hinaus
    if (goal.height > 40) goal.setScale(Math.max(0.75, 40 / goal.height));
    c.add(goal);
    y = goal.y + goal.displayHeight + 6;

    // Steuer-Zeilen: Icon + Text in einer dunklen Leiste, volle Breite – nichts läuft mehr über
    const rows = how.controls.slice(0, 3);
    const rh = rows.length > 2 && y > 100 ? 14 : y < 90 ? 18 : 16;
    const rw = 380;
    const rx = WORLD.W / 2 - rw / 2;
    rows.forEach((ctl, i) => {
      const ry = y + i * (rh + 3);
      const bg = this.add.rectangle(rx, ry, rw, rh, 0x3b2a22).setOrigin(0, 0).setStrokeStyle(1, 0x8d5629);
      const icon = txt(this, rx + 13, ry + rh / 2 + 1, ctl.icon, { size: 16, origin: [0.5, 0.5] }).setScale(rh > 14 ? 0.7 : 0.6);
      const label = txt(this, rx + 28, ry + rh / 2 - 4, ctl.text, { origin: [0, 0] });
      fitText(label, rw - 36, 0.7);
      label.setY(ry + (rh - label.displayHeight) / 2 + 1);
      for (const [j, o] of [bg, icon, label].entries()) {
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, duration: 250, delay: 150 + i * 120 + j * 10 });
      }
      c.add([bg, icon, label]);
    });
    // Haltung des Handys (Quer-Spiele grün), darunter der Start-Hinweis (this.hint, außerhalb des Containers)
    y += rows.length * (rh + 3) + 1;
    const orient = info.orientation;
    c.add(ink(this, WORLD.W / 2, y, ORIENT_TEXT[orient], { color: orient === 'landscape' ? GREEN_INK : INK }));
    this.hint.setY(Math.min(170, y + 12));

    c.setScale(0.6).setAlpha(0);
    c.setPosition(WORLD.W * 0.2, 270 * 0.2);
    this.tweens.add({ targets: c, scale: 1, x: 0, y: 0, alpha: 1, duration: 380, ease: 'Back.out' });
    // Zähler und Start-Hinweis liegen auf der Karte, gehören aber nicht zum Container → nach dem Aufklappen einblenden
    this.count.setAlpha(0);
    this.hint.setAlpha(0);
    this.tweens.add({ targets: [this.count, this.hint], alpha: 1, delay: 320, duration: 200 });
    sfx('whoosh', { vol: 0.6 });
  }

  /**
   * Alle Mitspieler unten, abgedunkelt bis „bereit“ (dann Häkchen + Hüpfer + Ton). Bei einem Team-Spiel vom Brett
   * stehen sie nach Teams gruppiert (Sonne links, Meer rechts, „VS“ dazwischen), Namen in Spielerfarbe.
   */
  private renderCrowd(it: IntroState) {
    const key = it.ids.join(',');
    if (key !== this.crowdKey) {
      this.crowdKey = key;
      this.crowd.removeAll(true);
      this.figs.clear();
      const teams = this.teams;
      const n = it.ids.length;
      const rows = teams || n <= 6 ? 1 : 2;
      const perRow = Math.ceil(n / rows);
      const step = Math.min(76, 456 / perRow);
      // Platz pro Figur: ohne Teams eine Reihe (bzw. zwei ab 7), mit Teams zwei Gruppen um 128 und 352
      const slots = new Map<string, { x: number; feet: number; step: number }>();
      if (teams) {
        // Wer mitspielt, aber in keinem Team steht (Nachzügler), kommt zur kleineren Seite
        const groups: Record<Team, string[]> = { A: teams.A.filter((id) => it.ids.includes(id)), B: teams.B.filter((id) => it.ids.includes(id)) };
        for (const id of it.ids) if (!groups.A.includes(id) && !groups.B.includes(id)) (groups.A.length <= groups.B.length ? groups.A : groups.B).push(id);
        const tStep = Math.min(52, 200 / Math.max(groups.A.length, groups.B.length));
        for (const t of ['A', 'B'] as Team[]) {
          const ids = groups[t];
          const cx = t === 'A' ? 128 : 352;
          ids.forEach((id, i) => slots.set(id, { x: cx + (i - (ids.length - 1) / 2) * tStep, feet: 240, step: tStep }));
          // Handicap (kleineres Team startet mit Vorsprung) direkt am Team – die Zeile darüber zeigt, auf wen gewartet wird
          const hc = teamHandicap(teams.A.length, teams.B.length)[t];
          this.crowd.add(txt(this, cx, 196, `${t === 'A' ? '☀' : '🌊'} ${TEAM_INFO[t].name}${hc ? ` · +${hc} Vorsprung` : ''}`, { color: TEAM_INFO[t].color }));
        }
        this.crowd.add(txt(this, WORLD.W / 2, 206, 'VS', { size: 16, color: '#ffd25e' }));
      } else {
        it.ids.forEach((id, i) => {
          const row = Math.floor(i / perRow);
          const inRow = Math.min(perRow, n - row * perRow);
          slots.set(id, { x: WORLD.W / 2 + (i % perRow - (inRow - 1) / 2) * step, feet: rows === 1 ? 240 : 224 + row * 34, step });
        });
      }
      it.ids.forEach((id) => {
        const p = playerById(id);
        const slot = slots.get(id);
        if (!p || !slot) return;
        const { x, feet } = slot;
        const fig = figure(this, p.look, x, feet, 1);
        const name = txt(this, x, feet + 1, p.name, teams ? { color: playerColor(p.color).hex } : {});
        if (name.width > slot.step - 4) name.setScale((slot.step - 4) / name.width);
        const check = this.add.graphics();
        check.fillStyle(0x2f7d32).fillCircle(x + 9, feet - 26, 6).lineStyle(2, 0xffffff);
        check.lineBetween(x + 6, feet - 26, x + 8, feet - 23).lineBetween(x + 8, feet - 23, x + 12, feet - 29);
        check.setVisible(false);
        // Noch nicht bereit: blinkendes „...“ an derselben Stelle wie später das Häkchen
        const wait = txt(this, x + 9, feet - 32, '...', { color: '#ffd25e' });
        this.tweens.add({ targets: wait, alpha: 0.25, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.crowd.add([fig, name, check, wait]);
        this.figs.set(id, { fig, check, wait, ready: false });
      });
    }
    let fresh = 0;
    for (const [id, f] of this.figs) {
      const ready = it.ready.includes(id);
      f.fig.setAlpha(ready ? 1 : 0.5);
      f.check.setVisible(ready);
      f.wait.setVisible(!ready);
      if (ready && !f.ready) {
        fresh++;
        this.tweens.add({ targets: f.fig, y: f.fig.y - 6, duration: 110, yoyo: true, ease: 'Quad.out' });
        this.juice.burst(f.fig.x, f.fig.y - 20, 'spark', 6);
      }
      f.ready = ready;
    }
    if (fresh) sfx('select', { pitch: 1 + Math.min(0.4, it.ready.length * 0.04) });

    // Kein Countdown: „BEREIT x/y“ oben rechts, darunter auf wen gewartet wird (Offline-Handys sind gar nicht erst in `ids`)
    const waiting = it.ids.filter((id) => !it.ready.includes(id));
    this.count.setText(`BEREIT ${it.ready.length}/${it.ids.length}`).setColor(waiting.length ? INK : GREEN_INK);
    if (!waiting.length) this.status.setText('Alle bereit – los geht’s!').setColor('#9be37b');
    else {
      const names = waiting.map((id) => playerById(id)?.name ?? '?');
      const list = names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
      this.status.setScale(1).setText(`Am Handy BEREIT drücken · Warte auf ${list}`).setColor('#ffd25e');
      // Zu lang → Namen gehen vor die Anleitung
      if (this.status.width > 466) this.status.setText(`Warte auf ${list}`);
    }
    fitText(this.status, 466, 0.75);
    this.hint.setText(isAtLaptop() ? 'Sofort starten: VIP-Handy oder Enter am Laptop' : 'Sofort starten: „Jetzt starten“ am VIP-Handy');
    fitText(this.hint, 430);
  }
}
