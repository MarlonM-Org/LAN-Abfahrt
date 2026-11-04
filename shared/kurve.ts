import type { KurveHead } from './types';

/** Wie weit TV bzw. Bot die Spur eines Spielers schon übernommen haben */
export interface TrailCursor {
  /** Index des zuletzt übernommenen Punkts (−1 = noch keiner) */
  idx: number;
  x: number;
  y: number;
}

/**
 * Hängt die neuen Punkte aus dem Snapshot an (per Index) und ruft für jedes
 * zu zeichnende Linienstück `seg` auf. Fehlen Punkte (z. B. TV kam mitten in der
 * Runde dazu), wird nicht über die Lücke hinweg verbunden.
 */
export function ingestTrail(head: KurveHead, cur: TrailCursor, seg: (x0: number, y0: number, x1: number, y1: number) => void) {
  const t = head.trail;
  for (let k = 0; k + 2 < t.length; k += 3) {
    const idx = head.trailStart + k / 3;
    if (idx <= cur.idx) continue;
    const x = t[k];
    const y = t[k + 1];
    if (t[k + 2] === 1 && cur.idx === idx - 1) seg(cur.x, cur.y, x, y);
    cur.idx = idx;
    cur.x = x;
    cur.y = y;
  }
}

/** Ruft `dot` für jedes Pixel entlang einer Strecke auf (Schritt ≤ 1 px) */
export function walkLine(x0: number, y0: number, x1: number, y1: number, dot: (x: number, y: number) => void) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}
