// Spieleübersicht im README aus shared/games.ts erzeugen (Block zwischen <!-- games:start --> und <!-- games:end -->)
// und die ausführliche Spieleliste gegen MINI_INFO prüfen (jedes Spiel genau einmal als „- 🎮 **Titel**“-Eintrag).
// Aufruf: node scripts/readme-games.mjs          → README.md neu schreiben
//         node scripts/readme-games.mjs --check  → nur prüfen (Exit 1 bei Abweichungen), nichts schreiben
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const games = readFileSync(new URL('shared/games.ts', root), 'utf8');
const readmeUrl = new URL('README.md', root);
const readme = readFileSync(readmeUrl, 'utf8');
const check = process.argv.includes('--check');

// ---------------------------------------------------------------- shared/games.ts lesen (ohne TypeScript-Build)
const section = (name) => {
  const start = games.indexOf(name);
  if (start < 0) throw new Error(`${name} nicht in shared/games.ts gefunden`);
  return games.slice(start, games.indexOf('\n};', start));
};
const list = (name) => {
  const m = new RegExp(`export const ${name}[^=]*= \\[([^\\]]*)\\]`).exec(games);
  if (!m) throw new Error(`${name} nicht gefunden`);
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
};
const info = {};
for (const m of section('export const MINI_INFO').matchAll(/^\s+(\w+): \{ title: '([^']+)'(.*)$/gm)) {
  const rest = m[3];
  const num = (key) => {
    const r = new RegExp(`${key}: (\\d+)`).exec(rest);
    return r ? Number(r[1]) : undefined;
  };
  info[m[1]] = {
    title: m[2],
    icon: /icon: '([^']+)'/.exec(rest)?.[1] ?? '🎮',
    inspired: /inspiredBy: '([^']+)'/.exec(rest)?.[1] ?? '',
    orient: /orientation: '(\w+)'/.exec(rest)?.[1] ?? 'any',
    min: num('minPlayers') ?? 1,
    max: num('maxPlayers'),
  };
}
const length = {};
for (const m of section('export const MINI_LENGTH').matchAll(/^\s+(\w+): '(\w+)'/gm)) length[m[1]] = m[2];
const board = new Set(list('BOARD_KINDS'));
const finale = new Set(list('FINALE_KINDS'));
const drink = list('DRINK_KINDS');
const date = list('DATE_KINDS');
const groups = [];
const ag = games.slice(games.indexOf('export const ARCADE_GROUPS'));
for (const m of ag.matchAll(/\{ title: '([^']+)', kinds: \[([^\]]*)\] \}/g)) {
  groups.push({ title: m[1], kinds: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) });
  if (groups.length > 20) break;
}
// Date-Kapitel stehen in ARCADE_GROUPS mit drin (einzeln spielbar) – in der Übersicht nur einmal, unter Date Night
const arcade = groups.map((g) => ({ title: g.title, kinds: g.kinds.filter((k) => !date.includes(k)) })).filter((g) => g.kinds.length);
const covered = new Set([...arcade.flatMap((g) => g.kinds), ...drink, ...date]);
const rest = Object.keys(info).filter((k) => !covered.has(k));
const sections = [...arcade, { title: 'Trinkspiel', kinds: drink }, { title: 'Date Night (zu zweit)', kinds: date }];
if (rest.length) sections.push({ title: 'Weitere', kinds: rest });

// ---------------------------------------------------------------- Tabelle
const ORIENT = { landscape: '↔ quer', portrait: '↕ hochkant', any: 'egal' };
const players = (i) => (i.max ? (i.min === i.max ? `${i.min}` : `${i.min}–${i.max}`) : `ab ${i.min}`);
const where = (k) => (finale.has(k) ? 'Finale' : board.has(k) ? '✓' : '–');
const rows = [];
for (const s of sections) {
  rows.push(`| **${s.title}** | | | | | |`);
  for (const k of s.kinds) {
    const i = info[k];
    if (!i) continue;
    rows.push(`| ${i.icon} ${i.title} | ${i.inspired ? `à la ${i.inspired}` : ''} | ${players(i)} | ${ORIENT[i.orient] ?? i.orient} | ${length[k] ?? ''} | ${where(k)} |`);
  }
}
const table = [
  '<!-- games:start -->',
  `_Automatisch aus \`shared/games.ts\` erzeugt (\`node scripts/readme-games.mjs\`) – ${Object.keys(info).length} Spiele. Handy: ↔ = quer halten (Stick + Knöpfe), ↕ = hochkant (Sensor, Listen, Text). Dauer bei 8–12 Spielern: kurz ≤ 2 min, mittel ≤ 4 min, lang > 4 min (\`MINI_LENGTH\`). Brett: ✓ = kommt im Party-Modus nach einer Brett-Runde dran (lange nur mit „Lange Spiele“), Finale = Finalspiel, – = nur einzeln/Arcade._`,
  '',
  '| Spiel | Vorbild | Spieler | Handy | Dauer | Brett |',
  '|---|---|---|---|---|---|',
  ...rows,
  '<!-- games:end -->',
].join('\n');

// ---------------------------------------------------------------- Prüfung der ausführlichen Liste
const lines = readme.split('\n');
const problems = [];
const titles = new Map(Object.entries(info).map(([k, i]) => [i.title.replace(/\.\.\./g, '…'), k]));
const seen = new Map();
for (const [n, line] of lines.entries()) {
  const m = /^\s*- (\S+) \*\*([^*]+)\*\*/.exec(line);
  if (!m) continue;
  const t = m[2].replace(/\.\.\./g, '…');
  const k = titles.get(t);
  if (!k) continue; // andere Aufzählungen (Regelkarte, VIP …)
  seen.set(k, [...(seen.get(k) ?? []), n + 1]);
  if (m[1] !== info[k].icon) problems.push(`Zeile ${n + 1}: ${t} hat Icon ${m[1]}, in MINI_INFO ${info[k].icon}`);
}
for (const [k, i] of Object.entries(info)) {
  const at = seen.get(k) ?? [];
  // Trinkspiel- und Date-Kapitel stehen als Fließtext in ihren Abschnitten
  if (at.length === 0 && !drink.includes(k) && !date.includes(k)) problems.push(`${i.icon} ${i.title} (${k}) fehlt in der ausführlichen Liste`);
  if (at.length > 1) problems.push(`${i.icon} ${i.title} (${k}) steht mehrfach in der Liste: Zeilen ${at.join(', ')}`);
}
for (const p of problems) console.error(`⚠ ${p}`);

// ---------------------------------------------------------------- README schreiben
const START = '<!-- games:start -->';
const END = '<!-- games:end -->';
const a = readme.indexOf(START);
const b = readme.indexOf(END);
if (a < 0 || b < 0) {
  console.error(`Marker ${START} / ${END} fehlen im README.`);
  process.exit(1);
}
const next = readme.slice(0, a) + table + readme.slice(b + END.length);
if (check) {
  if (next !== readme) problems.push('Spieleübersicht im README ist nicht aktuell (node scripts/readme-games.mjs)');
  console.log(problems.length ? `${problems.length} Problem(e)` : 'README-Spieleliste passt zu shared/games.ts');
  process.exit(problems.length ? 1 : 0);
}
if (next !== readme) writeFileSync(readmeUrl, next);
console.log(`Spieleübersicht: ${new Set(sections.flatMap((s) => s.kinds)).size} Spiele in ${sections.length} Gruppen${problems.length ? `, ${problems.length} Hinweis(e) zur Liste` : ''}`);
