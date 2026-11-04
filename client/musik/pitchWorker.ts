/**
 * Web Worker fürs Einsingen: bekommt Audiofenster, liefert Tonhöhe (YIN) + Pegel zurück,
 * damit die Erkennung die Oberfläche nicht ausbremst.
 */
import { hzToMidi, rms, yin } from '../music/pitch';

export interface PitchRequest {
  t: number;
  sampleRate: number;
  buf: Float32Array;
}
export interface PitchResponse {
  t: number;
  midi: number | null;
  rms: number;
  clarity: number;
}

self.onmessage = (e: MessageEvent<PitchRequest>) => {
  const { t, sampleRate, buf } = e.data;
  const p = yin(buf, sampleRate, { minRms: 0.004, fmin: 60, fmax: 1200 });
  const res: PitchResponse = { t, midi: p && p.clarity > 0.8 ? hzToMidi(p.hz) : null, rms: rms(buf), clarity: p?.clarity ?? 0 };
  (self as unknown as Worker).postMessage(res);
};
