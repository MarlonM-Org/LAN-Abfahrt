/**
 * Eingebaute Songs offline als WAV rendern (zum Anhören ohne Browser).
 * Aufruf: `npm run render:music -- <ordner> [song-id …] [--loops=2]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_SONGS } from '../shared/musicBuiltin';
import { db, peakOf, renderSong, rmsOf, wav } from './musicRender';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? 'dist/musik-wav';
const ids = args.filter((a) => !a.startsWith('--')).slice(1);
const loops = Number(args.find((a) => a.startsWith('--loops='))?.slice(8) ?? 1) || 1;
mkdirSync(dir, { recursive: true });
for (const s of BUILTIN_SONGS.filter((x) => !ids.length || ids.includes(x.id))) {
  const r = renderSong(s, 44100, loops);
  const file = join(dir, `${s.id}.wav`);
  writeFileSync(file, wav(r.mix, r.sr));
  console.log(`${file}: ${s.title} – ${(r.seconds * loops).toFixed(1)} s, Spitze ${db(peakOf(r.mix)).toFixed(1)} dBFS, RMS ${db(rmsOf(r.mix)).toFixed(1)} dBFS`);
}
