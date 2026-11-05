/**
 * Leaderboard des Abends auf dem TV (Ergebnis eines Einzelspiels und Lobby):
 * Platz mit ▲▼, Avatar, Name (offline/weg markiert), ggf. Serien-Spalte, Punkte des letzten Spiels, Gesamtpunkte.
 */
import Phaser from 'phaser';
import type { SessionState } from '../../shared/types';
import { MINI_INFO } from '../../shared/games';
import { ensurePortrait } from './textures';
import { GREEN_INK, INK, RED_INK, ink, panel } from './ui';

const SOFT = '#7a5a3a';
const GOLD_INK = '#c98a10';

export interface BoardBox {
  x: number;
  y: number;
  w: number;
  /** Unterkante, die nicht überschritten werden darf */
  maxBottom: number;
}

/** Überschrift der Serie, z. B. „Kart-Rennen – Rennen 3“ (null = keine Serie) */
export function seriesTitle(s: SessionState): string | null {
  const ser = s.series;
  if (!ser || ser.round < 2) return null;
  return `${MINI_INFO[ser.kind].title} – ${ser.label}`;
}

export function drawSessionBoard(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, s: SessionState, box: BoardBox, opts: { title?: string; animate?: boolean } = {}) {
  const { x, y, w } = box;
  const rows = s.rows.slice(0, 12);
  const withSeries = !!s.series && s.series.round > 1;
  const avail = box.maxBottom - y - 34;
  const rowH = Math.max(11, Math.min(18, Math.floor(avail / Math.max(1, rows.length))));
  const h = 34 + Math.max(1, rows.length) * rowH;
  layer.add(panel(scene, x, y, w, h));
  const title = opts.title ?? `LEADERBOARD HEUTE · ${s.games} ${s.games === 1 ? 'SPIEL' : 'SPIELE'}`;
  layer.add(ink(scene, x + w / 2, y + 8, title, { color: RED_INK }));

  const colTotal = x + w - 12;
  const colLast = x + w - 62;
  const colSeries = x + w - 104;
  layer.add(ink(scene, colTotal, y + 21, 'Pkt', { origin: [1, 0], color: SOFT }));
  layer.add(ink(scene, colLast, y + 21, '+', { origin: [1, 0], color: SOFT }));
  if (withSeries) layer.add(ink(scene, colSeries, y + 21, s.series!.label.split(' ')[0].slice(0, 6), { origin: [1, 0], color: SOFT }));
  if (!rows.length) layer.add(ink(scene, x + w / 2, y + 34, 'Noch niemand da.'));

  rows.forEach((r, i) => {
    const ry = y + 32 + i * rowH;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const gone = r.status !== 'online';
    const color = gone ? SOFT : r.rank === 1 && r.points > 0 ? GOLD_INK : INK;
    objs.push(ink(scene, x + 10, ry, `${r.rank}.`, { origin: [0, 0], color }));
    // Bewegung seit dem letzten Spiel
    if (r.prevRank !== null) {
      const d = r.prevRank - r.rank;
      const mark = d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '–';
      objs.push(ink(scene, x + 34, ry, mark, { origin: [0, 0], color: d > 0 ? GREEN_INK : d < 0 ? RED_INK : SOFT }));
    } else if (r.games) {
      objs.push(ink(scene, x + 34, ry, 'neu', { origin: [0, 0], color: SOFT }));
    }
    const portrait = scene.add.image(x + 70, ry + Math.min(rowH, 14) - 1, ensurePortrait(scene, r.look)).setOrigin(0.5, 1);
    if (rowH < 14) portrait.setScale(rowH / 14);
    if (gone) portrait.setAlpha(0.45);
    objs.push(portrait);
    const tag = r.status === 'removed' ? ' (weg)' : r.status === 'offline' ? ' (off)' : '';
    const maxName = withSeries ? 9 : 12;
    objs.push(ink(scene, x + 82, ry, `${r.name.slice(0, maxName)}${tag}`, { origin: [0, 0], color }));
    if (withSeries) objs.push(ink(scene, colSeries, ry, String(s.series!.totals[r.id] ?? 0), { origin: [1, 0], color: SOFT }));
    if (r.last !== null) objs.push(ink(scene, colLast, ry, `+${r.last}`, { origin: [1, 0], color: GREEN_INK }));
    objs.push(ink(scene, colTotal, ry, String(r.points), { origin: [1, 0], color }));
    for (const o of objs) {
      layer.add(o);
      if (opts.animate) {
        const t = o as unknown as Phaser.GameObjects.Components.Alpha & { alpha: number };
        const target = t.alpha;
        t.setAlpha(0);
        scene.tweens.add({ targets: o, alpha: target, duration: 250, delay: 120 + i * 90 });
      }
    }
  });
  return h;
}
