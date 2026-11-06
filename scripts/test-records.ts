import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Records } from '../server/records';

/** Tests ohne Browser für die ewige Bestenliste der Board-Spiele: `npm run test:records` */
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), 'records.json');
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ok ' : ' FEHLER'} ${name}${ok ? '' : ` – ${JSON.stringify(got)} statt ${JSON.stringify(want)}`}`);
};

const r = new Records(file);
eq('Erster Sprung ist Rekord', r.submit('skisprung', 'Lena', 118.5, '95.0 P'), 'record');
eq('Kürzerer Sprung desselben Spielers zählt nicht', r.submit('skisprung', 'Lena', 100, ''), null);
eq('Anderer Spieler, kürzer: persönliche Bestleistung', r.submit('skisprung', 'Tobi', 90, ''), 'pb');
eq('Anderer Spieler, weiter: neuer Rekord', r.submit('skisprung', 'Tobi', 131.5, '120.0 P'), 'record');
eq('Eigener Rekord verbessert', r.submit('skisprung', 'Tobi', 140, ''), 'record');
eq('Top: weiteste zuerst', r.top('skisprung').map((e) => e.name), ['Tobi', 'Lena']);
eq('Zeiten: kleiner ist besser (Rekord)', r.submit('teppich', 'Lena', 21.4), 'record');
eq('Zeiten: langsamer = nichts', r.submit('teppich', 'Lena', 25), null);
eq('Zeiten: schneller = Rekord', r.submit('teppich', 'Tobi', 19.9), 'record');
eq('Zeiten: Top = schnellste zuerst', r.top('teppich').map((e) => `${e.name} ${e.value}`), ['Tobi 19.9', 'Lena 21.4']);
eq('Kugel getrennt von Teppich', r.top('kugel'), []);
eq('Ungültiger Wert wird ignoriert', r.submit('kugel', 'Lena', NaN), null);
const again = new Records(file);
eq('Wird gespeichert und neu geladen', again.top('skisprung', 1), [{ name: 'Tobi', value: 140 }]);
process.exit(fails ? 1 : 0);
