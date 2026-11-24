import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RH } from '../shared/rhythmus';

/**
 * Ton-Versatz des TVs fürs Gespräch (`rhythm`), raumweit gespeichert in `data/rhythmus.json`: Wie viel später der
 * Ton am Fernseher ankommt, als die Uhr sagt (AirPlay-Spiegelung, HDMI-Tonverarbeitung, Bluetooth-Box …) plus die
 * übliche Touch-Verzögerung. Gemessen im Soundcheck des Spiels (Handys tippen im Takt zum Klick vom TV), gilt dann
 * für alle Handys – bis jemand neu einmisst. Pfad zum Testen per `RHYTHMUS_FILE` umlenkbar.
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
const file = () => process.env.RHYTHMUS_FILE ?? path.resolve(dir, '../data/rhythmus.json');

export interface GespeicherterVersatz {
  /** ms */
  versatz: number;
  /** Zeitpunkt der Messung (ms) */
  at: number;
  /** Aus so vielen Handys gemessen */
  handys: number;
}

let cache: GespeicherterVersatz | null | undefined;

export function ladeVersatz(): GespeicherterVersatz | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<GespeicherterVersatz>;
    const v = Number(raw.versatz);
    if (Number.isFinite(v) && v >= RH.KAL_MIN_MS && v <= RH.KAL_MAX_MS) cache = { versatz: Math.round(v), at: Number(raw.at) || 0, handys: Number(raw.handys) || 1 };
  } catch {
    /* noch nie gemessen */
  }
  return cache;
}

export function speichereVersatz(versatz: number, handys: number) {
  cache = { versatz: Math.round(versatz), at: Date.now(), handys };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('Konnte den Ton-Versatz nicht speichern:', e);
  }
}

/** Nur für Tests: Zwischenspeicher vergessen (nach Wechsel von `RHYTHMUS_FILE`) */
export function versatzNeuLaden() {
  cache = undefined;
}
