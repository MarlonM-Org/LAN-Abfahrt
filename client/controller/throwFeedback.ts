/**
 * Spielspezifische Auswertung für die Feedback-Karte (siehe motionFeedback.ts):
 * übersetzt das Ergebnis der (unveränderten) Wurf-Umrechnung plus Rohdaten in Klartext und einen Tipp.
 * Reine Funktionen ohne DOM.
 */
import { BOULE } from '../../shared/boule';
import { DARTS } from '../../shared/darts';
import type { BowlThrow } from './bowlingThrow';
import { type Feedback, type FeedbackLine, type ThrowInfo, type Tone, lr, pct, spinText, timingLine, timingTip } from './motionFeedback';

const deg = (v: number) => `${Math.round(Math.abs(v))}°`;
const worst = (...t: (Tone | undefined)[]): Tone => (t.includes('bad') ? 'bad' : t.includes('warn') ? 'warn' : 'ok');

/** Zeile: wie das Handy (Sensor) bzw. der Finger (Wischen) seitlich bewegt wurde */
function turnLine(info: ThrowInfo): FeedbackLine | null {
  if (info.source === 'motion') {
    if (info.yawDeg === null) return { k: 'Handy', v: 'Drehung nicht messbar' };
    return { k: 'Handy', v: Math.abs(info.yawDeg) < 2 ? 'gerade gehalten' : `${deg(info.yawDeg)} nach ${lr(info.yawDeg)} gedreht` };
  }
  if (info.yawDeg === null) return null;
  return { k: 'Wischer', v: Math.abs(info.yawDeg) < 2 ? 'gerade nach oben' : `${deg(info.yawDeg)} schräg nach ${lr(info.yawDeg)}` };
}

const push = (lines: FeedbackLine[], l: FeedbackLine | null) => void (l && lines.push(l));

function strengthTip(info: ThrowInfo, low: boolean, high: boolean, verb: { more: string; less: string }): string | null {
  if (low) return info.source === 'motion' ? verb.more : 'Zu langsam – schneller und bis zum Rand wischen.';
  if (high) return info.source === 'motion' ? verb.less : 'Zu schnell – etwas ruhiger wischen.';
  return null;
}

// ------------------------------------------------------------------ Bowling

/** Empfohlener Tempobereich (Kugel trifft kräftig, Effet hat noch Zeit zu greifen) */
export const BOWL_GOOD = { lo: 0.55, hi: 0.88 };

export function bowlingFeedback(t: BowlThrow, info: ThrowInfo): Feedback {
  const low = t.speed < BOWL_GOOD.lo;
  const high = t.speed > BOWL_GOOD.hi;
  const lines: FeedbackLine[] = [];
  const dir = Math.abs(t.angle) < 0.05 ? 'geradeaus' : `${Math.abs(t.angle) < 0.4 ? 'leicht ' : ''}nach ${t.angle < 0 ? 'links' : 'rechts'}`;
  push(lines, turnLine(info));
  lines.push({ k: 'Kugel', v: dir, tone: Math.abs(t.angle) >= 0.4 ? 'warn' : 'ok' });
  lines.push({ k: 'Effet', v: spinText(t.spin) });
  push(lines, timingLine(info));
  const tip =
    strengthTip(info, low, high, {
      more: 'Zu schwach – schwing den Arm kräftiger durch.',
      less: 'Sehr hart – etwas lockerer, dann greift das Effet besser.',
    }) ??
    timingTip(info) ??
    (Math.abs(t.angle) >= 0.4
      ? `Kugel ging ${dir} – ${info.source === 'motion' ? 'Handy beim Schwingen gerader halten' : 'gerader wischen'} oder Startposition anpassen.`
      : Math.abs(t.spin) < 0.05 && info.source === 'motion'
        ? 'Guter Wurf! Für einen Haken das Handgelenk beim Loslassen drehen.'
        : 'Guter Wurf – genau so wiederholen!');
  return {
    title: info.source === 'motion' ? 'Dein Schwung' : 'Dein Wischer',
    info,
    bar: { label: 'Tempo', value: t.speed, lo: BOWL_GOOD.lo, hi: BOWL_GOOD.hi, text: `${pct(t.speed)} (gut: ${pct(BOWL_GOOD.lo)}–${pct(BOWL_GOOD.hi)})` },
    lines,
    tip,
    tone: worst(low || high ? 'warn' : 'ok', ...lines.map((l) => l.tone)),
  };
}

// ------------------------------------------------------------------ Boule

/** Toleranz um die Schweinchen-Kraft, die noch als „passt“ gilt */
const BOULE_TOL = 0.05;

/**
 * `jackPow` = Kraft, die genau bis zum Schweinchen reicht (0 … 1, null = noch kein Schweinchen);
 * `jackAng` = Richtung zum Schweinchen in Wurf-Einheiten (−1 … 1 wie `t.angle`).
 */
export function bouleFeedback(t: BowlThrow, info: ThrowInfo, jackPow: number | null, jackAng: number, shoot: boolean): Feedback {
  const lines: FeedbackLine[] = [];
  const lo = jackPow === null ? 0.3 : Math.max(0, jackPow - BOULE_TOL);
  const hi = jackPow === null ? 0.7 : Math.min(1, jackPow + BOULE_TOL);
  const short = t.speed < lo;
  const long = t.speed > hi;
  if (jackPow !== null) lines.push({ k: 'Weite', v: short ? 'zu kurz' : long ? 'zu weit' : 'passt', tone: short || long ? 'warn' : 'ok' });
  const offDeg = ((t.angle - jackAng) * BOULE.ANGLE_MAX * 180) / Math.PI;
  push(lines, turnLine(info));
  lines.push({ k: 'Richtung', v: Math.abs(offDeg) < 1 ? 'aufs Schweinchen' : `${deg(offDeg)} ${lr(offDeg)} vom Schweinchen`, tone: Math.abs(offDeg) >= 2.5 ? 'warn' : 'ok' });
  lines.push({ k: 'Effet', v: spinText(t.spin) });
  push(lines, timingLine(info));
  const tip =
    (short
      ? info.source === 'motion'
        ? `Zu kurz – etwa ${Math.round((lo + BOULE_TOL - t.speed) * 100)} % mehr Schwung.`
        : 'Zu kurz – etwas schneller wischen.'
      : long
        ? info.source === 'motion'
          ? `Zu weit – etwa ${Math.round((t.speed - hi + BOULE_TOL) * 100)} % weniger Schwung.`
          : 'Zu weit – etwas langsamer wischen.'
        : null) ??
    timingTip(info) ??
    (Math.abs(offDeg) >= 2.5
      ? info.source === 'motion'
        ? `Handy beim Schwingen etwas mehr nach ${offDeg > 0 ? 'links' : 'rechts'} drehen.`
        : `Etwas mehr nach ${offDeg > 0 ? 'links' : 'rechts'} wischen.`
      : 'Schöner Wurf – so bleibt die Kugel nah dran!');
  return {
    title: shoot ? 'Dein Schuss' : info.source === 'motion' ? 'Dein Schwung' : 'Dein Wischer',
    info,
    bar: {
      label: 'Kraft',
      value: t.speed,
      lo,
      hi,
      text: jackPow === null ? pct(t.speed) : `${pct(t.speed)} (Schweinchen: ${pct(jackPow)})`,
    },
    lines,
    tip,
    tone: worst(short || long ? 'warn' : 'ok', ...lines.map((l) => l.tone)),
  };
}

// ------------------------------------------------------------------ Darts

export function dartsFeedback(t: BowlThrow, info: ThrowInfo): Feedback {
  const lo = DARTS.POWER_IDEAL - DARTS.POWER_TOL;
  const hi = DARTS.POWER_IDEAL + DARTS.POWER_TOL;
  const low = t.speed < lo;
  const high = t.speed > hi;
  const lines: FeedbackLine[] = [];
  lines.push({ k: 'Wirkung', v: low ? 'landet tiefer' : high ? 'landet höher' : 'fliegt aufs Kreuz', tone: low || high ? 'warn' : 'ok' });
  const sideMm = Math.round(t.angle * DARTS.SIDE_MM);
  push(lines, turnLine(info));
  lines.push({ k: 'Seite', v: sideMm === 0 ? 'kein Versatz' : `${Math.abs(sideMm)} mm nach ${sideMm < 0 ? 'links' : 'rechts'}`, tone: Math.abs(sideMm) >= 15 ? 'warn' : 'ok' });
  push(lines, timingLine(info));
  const tip =
    strengthTip(info, low, high, {
      more: 'Zu schwach – schnipp kräftiger aus dem Handgelenk.',
      less: 'Zu stark – lockerer schnippen, nur aus dem Handgelenk.',
    }) ??
    (Math.abs(sideMm) >= 15
      ? info.source === 'motion'
        ? 'Handy beim Schnippen nicht drehen – gerade nach vorn.'
        : 'Gerade nach oben wischen.'
      : (timingTip(info) ?? 'Perfekte Kraft – genau so!'));
  return {
    title: info.source === 'motion' ? 'Dein Schnippen' : 'Dein Wischer',
    info,
    bar: { label: 'Kraft', value: t.speed, lo, hi, text: `${pct(t.speed)} (ideal ${pct(lo)}–${pct(hi)})` },
    lines,
    tip,
    tone: worst(low || high ? 'warn' : 'ok', ...lines.map((l) => l.tone)),
  };
}

// ------------------------------------------------------------------ Minigolf

/** Spielraum um die geschätzt nötige Kraft */
const GOLF_TOL = 0.08;

/**
 * `ideal` = geschätzt nötige Kraft (ebene Bahn, ohne Hindernisse), `corrDeg` = Richtungskorrektur durch
 * Drehen des Handys (nur Sensor), `info` = null beim Zurückziehen.
 */
export function golfFeedback(power: number, ideal: number, info: ThrowInfo | null, corrDeg: number | null): Feedback {
  const lo = Math.max(0, ideal - GOLF_TOL);
  const hi = Math.min(1, ideal + GOLF_TOL);
  const low = power < lo;
  const high = power > hi;
  const lines: FeedbackLine[] = [];
  lines.push({ k: 'Länge', v: low ? 'eher zu kurz' : high ? 'eher zu lang' : 'passt etwa', tone: low || high ? 'warn' : 'ok' });
  if (info && corrDeg !== null) {
    push(lines, turnLine(info));
    lines.push({ k: 'Richtung', v: Math.abs(corrDeg) < 0.5 ? 'wie gezielt' : `${deg(corrDeg)} ${lr(corrDeg)} vom Pfeil`, tone: Math.abs(corrDeg) >= 4 ? 'warn' : 'ok' });
  }
  if (info) push(lines, timingLine(info));
  const motion = !!info;
  const tip =
    (low ? (motion ? 'Zu sanft – etwas weiter ausholen.' : 'Zu sanft – weiter zurückziehen.') : null) ??
    (high ? (motion ? 'Zu fest – ruhiger pendeln.' : 'Zu fest – weniger weit zurückziehen.') : null) ??
    (info ? timingTip(info) : null) ??
    (corrDeg !== null && Math.abs(corrDeg) >= 4 ? 'Handy beim Pendeln gerade halten – die Richtung kommt vom Pfeil.' : 'Gute Dosierung!');
  return {
    title: 'Dein Putt',
    info: info ?? undefined,
    bar: { label: 'Kraft', value: power, lo, hi, text: `${pct(power)} (nötig ca. ${pct(ideal)})` },
    lines,
    tip,
    tone: worst(low || high ? 'warn' : 'ok', ...lines.map((l) => l.tone)),
  };
}
