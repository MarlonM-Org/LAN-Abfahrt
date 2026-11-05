import Phaser from 'phaser';
import type { GameState, IntroState, MiniKind, MiniTeams, Team } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT, miniInspired, teamHandicapText } from '../../shared/games';
import { playerColor } from '../../shared/players';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { GREEN_INK, INK, RED_INK, background, ink, panel, txt } from './ui';
import { figure } from './textures';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { toLocalPerf } from '../timesync';
import { setScene } from './music';

/**
 * Regelkarte vor jedem Minispiel (Raum-Phase `intro`): Icon, Titel, „à la …“, Ziel-Satz, bis zu 3 Steuer-Kacheln
 * aus `MINI_HOWTO`, Haltung des Handys, darunter alle Mitspieler mit Häkchen „bereit“ und der Countdown.
 * Das Spiel startet, sobald alle bereit sind (spätestens nach 15 s, bekannte Spiele nach 5 s).
 */
export class IntroScene extends Phaser.Scene {
  private juice!: Juice;
  /** Welche Karte steht (Spiel + Team-Aufteilung) */
  private cardKey = '';
  private teams: MiniTeams | null = null;
  private card!: Phaser.GameObjects.Container;
  private crowd!: Phaser.GameObjects.Container;
  private timer!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private figs = new Map<string, { fig: Phaser.GameObjects.Container; check: Phaser.GameObjects.Graphics; ready: boolean }>();
  private crowdKey = '';
  private endsAt = 0;
  private short = false;

  constructor() {
    super('intro');
  }

  create() {
    this.cardKey = '';
    this.teams = null;
    this.crowdKey = '';
    this.figs = new Map();
    this.endsAt = 0;
    this.short = false;
    this.juice = new Juice(this);
    background(this, 'intro_wood', WORLD.W, WORLD.H, (p) => paintWoodFloor(p, 0, 0, WORLD.W, WORLD.H, 23));
    this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.35).setOrigin(0).setDepth(-900);
    this.card = this.add.container(0, 0);
    this.crowd = this.add.container(0, 0);
    this.timer = txt(this, 452, 14, '', { size: 16, color: '#ffd25e', origin: [1, 0] }).setDepth(10);
    this.status = txt(this, WORLD.W / 2, 186, '', { color: '#fff4d6' }).setDepth(10);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    if (!this.endsAt) return;
    const sec = Math.max(0, Math.ceil((toLocalPerf(this.endsAt) - performance.now()) / 1000));
    const t = String(sec);
    if (this.timer.text !== t) this.timer.setText(t);
  }

  private render(s: GameState) {
    const it = s.phase === 'intro' ? s.intro : null;
    if (!it) return;
    this.endsAt = it.endsAt;
    this.short = it.short;
    const key = `${it.kind}|${it.teams?.label ?? ''}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.teams = it.teams ?? null;
      this.crowdKey = '';
      this.buildCard(it.kind, it.short, it.teams ?? null);
    }
    this.renderCrowd(it);
  }

  /** Statische Regelkarte: Titel, Ziel, Steuer-Kacheln, Haltung */
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
    const title = ink(this, WORLD.W / 2, 24, `${info.icon} ${info.title}`, { size: 16, wrap: 380 });
    c.add(title);
    let y = title.y + title.height + 3;
    const insp = miniInspired(kind);
    if (insp) {
      c.add(ink(this, WORLD.W / 2, y, insp, { color: '#7a5a3a' }));
      y += 12;
    }
    const goal = ink(this, WORLD.W / 2, y + 4, how.goal, { wrap: 420 });
    c.add(goal);
    y = Math.max(goal.y + goal.height + 8, 84);

    // Steuer-Kacheln (2–3 nebeneinander)
    const tiles = how.controls.slice(0, 3);
    const tw = 138;
    const gap = 9;
    const x0 = WORLD.W / 2 - (tiles.length * tw + (tiles.length - 1) * gap) / 2;
    const th = Math.min(60, 150 - y);
    tiles.forEach((ctl, i) => {
      const x = x0 + i * (tw + gap);
      c.add(panel(this, x, y, tw, th, 'dark'));
      c.add(txt(this, x + tw / 2, y + 6, ctl.icon, { size: 16 }));
      c.add(txt(this, x + tw / 2, y + 26, ctl.text, { wrap: tw - 14 }));
      const tile = c.list[c.list.length - 1] as Phaser.GameObjects.Text;
      tile.setAlpha(0);
      this.tweens.add({ targets: tile, alpha: 1, duration: 250, delay: 150 + i * 120 });
    });
    const orient = info.orientation;
    c.add(ink(this, WORLD.W / 2, y + th + 6, ORIENT_TEXT[orient], { color: orient === 'landscape' ? GREEN_INK : INK }));

    c.setScale(0.6).setAlpha(0);
    c.setPosition(WORLD.W * 0.2, 270 * 0.2);
    this.tweens.add({ targets: c, scale: 1, x: 0, y: 0, alpha: 1, duration: 380, ease: 'Back.out' });
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
          this.crowd.add(txt(this, cx, 196, `${t === 'A' ? '☀' : '🌊'} ${TEAM_INFO[t].name}`, { color: TEAM_INFO[t].color }));
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
        this.crowd.add([fig, name, check]);
        this.figs.set(id, { fig, check, ready: false });
      });
    }
    const s = getState();
    let fresh = 0;
    for (const [id, f] of this.figs) {
      const ready = it.ready.includes(id);
      const online = !!s?.players.find((p) => p.id === id)?.connected;
      f.fig.setAlpha(ready ? 1 : online ? 0.5 : 0.25);
      f.check.setVisible(ready);
      if (ready && !f.ready) {
        fresh++;
        this.tweens.add({ targets: f.fig, y: f.fig.y - 6, duration: 110, yoyo: true, ease: 'Quad.out' });
        this.juice.burst(f.fig.x, f.fig.y - 20, 'spark', 6);
      }
      f.ready = ready;
    }
    if (fresh) sfx('select', { pitch: 1 + Math.min(0.4, it.ready.length * 0.04) });
    const online = it.ids.filter((id) => s?.players.find((p) => p.id === id)?.connected);
    const nReady = online.filter((id) => it.ready.includes(id)).length;
    const hc = this.teams ? teamHandicapText(this.teams, it.kind) : '';
    this.status.setText(
      this.teams
        ? `${this.teams.label}${hc ? ` · ${hc}` : ' · Rot gegen Blau'} · ${nReady}/${online.length} bereit`
        : this.short
          ? `Kennt ihr schon – gleich geht's los! (${nReady}/${online.length} bereit)`
          : `Am Handy üben, dann BEREIT drücken · ${nReady}/${online.length} bereit`,
    );
  }
}
