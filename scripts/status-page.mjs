// Baut die Status-Seite (Claude-Artefakt) aus docs/status.json + shared/games.ts.
// Aufruf: node scripts/status-page.mjs  → schreibt docs/status.html
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const data = JSON.parse(readFileSync(new URL('docs/status.json', root), 'utf8'));
const games = readFileSync(new URL('shared/games.ts', root), 'utf8');

// MINI_INFO-Einträge (Titel, Icon, Vorbild) und Arcade-Gruppen aus dem Code lesen
const info = {};
const start = games.indexOf('MINI_INFO');
const block = games.slice(start, games.indexOf('\n};', start));
for (const m of block.matchAll(/^\s+(\w+): \{ title: '([^']+)'(.*)$/gm)) {
  const rest = m[3];
  info[m[1]] = {
    title: m[2],
    icon: /icon: '([^']+)'/.exec(rest)?.[1] ?? '🎮',
    inspired: /inspiredBy: '([^']+)'/.exec(rest)?.[1] ?? '',
  };
}
const groups = [];
const ag = games.slice(games.indexOf('ARCADE_GROUPS'));
for (const m of ag.matchAll(/\{ title: '([^']+)', kinds: \[([^\]]*)\] \}/g)) {
  groups.push({ title: m[1], kinds: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) });
  if (groups.length > 20) break;
}
const grouped = new Set(groups.flatMap((g) => g.kinds));
const rest = Object.keys(info).filter((k) => !grouped.has(k));
if (rest.length) groups.push({ title: 'Weitere', kinds: rest });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const REPO = 'https://github.com/MarlonM-Org/LAN-Abfahrt';
const fbClass = { umgesetzt: 'ok', positiv: 'ok', 'in Arbeit': 'wip', offen: 'open' };
const total = Object.keys(info).length;
const withFb = Object.keys(info).filter((k) => data.feedback[k]).length;

const card = (t) => `<div class="card wip-card"><div class="row"><span class="tag">${esc(t.type)}</span>${t.kind && info[t.kind] ? `<span class="ic">${info[t.kind].icon}</span>` : ''}</div>
<h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><code>${esc(t.branch)}</code></div>`;

const gameRow = (k) => {
  const g = info[k]; const fb = data.feedback[k];
  return `<tr><td class="ic">${g.icon}</td><td><b>${esc(g.title)}</b>${g.inspired ? `<div class="sub">à la ${esc(g.inspired)}</div>` : ''}</td>
<td><span class="pill ${fb ? fbClass[fb.status] ?? 'open' : 'none'}">${fb ? esc(fb.status) : 'noch kein Feedback'}</span></td><td class="notes">${fb ? esc(fb.notes) : ''}</td></tr>`;
};

const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LAN-Abfahrt – Status</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#14121f;--panel:#1f1c30;--line:#332e4d;--txt:#ece9f7;--mut:#9a94b8;--acc:#ffcc4d;--ok:#5bd68a;--wip:#ffb347;--open:#ff6b8a;--none:#4a4566}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 Inter,system-ui,sans-serif;padding:24px}
.wrap{max-width:1100px;margin:0 auto}
h1{font:20px 'Press Start 2P',monospace;color:var(--acc);margin:0 0 6px;letter-spacing:1px}
h2{font:12px 'Press Start 2P',monospace;color:var(--acc);margin:34px 0 14px;letter-spacing:1px}
.meta{color:var(--mut);font-size:13px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:140px}
.stat b{display:block;font:18px 'Press Start 2P',monospace;color:var(--txt);margin-bottom:6px}.stat span{color:var(--mut);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.wip-card{border-left:4px solid var(--wip)}
.card h3{margin:6px 0 4px;font-size:16px}.card p{margin:0 0 8px;color:var(--mut);font-size:13.5px}
.card code{font-size:11.5px;color:#b9a8ff}
.row{display:flex;justify-content:space-between;align-items:center}
.tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--wip);font-weight:700}
.ic{font-size:20px;width:34px;text-align:center}
.queue{display:flex;gap:8px;flex-wrap:wrap}.queue span{background:var(--panel);border:1px dashed var(--line);border-radius:999px;padding:6px 12px;font-size:13.5px;color:var(--mut)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:none}
.gh td{background:#2a2541;font:10px 'Press Start 2P',monospace;color:var(--acc);padding:10px}
.sub{color:var(--mut);font-size:12px}.notes{color:var(--mut);font-size:13px}
.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.ok{background:rgba(91,214,138,.15);color:var(--ok)}.pill.wip{background:rgba(255,179,71,.15);color:var(--wip)}
.pill.open{background:rgba(255,107,138,.15);color:var(--open)}.pill.none{background:transparent;color:var(--none);border:1px solid var(--line)}
ul.done{list-style:none;padding:0;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px}
ul.done li{padding:8px 14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px}ul.done li:first-child{border-top:none}
ul.done a{color:#b9a8ff;text-decoration:none;font-size:13px}.d{color:var(--mut);font-size:12.5px;white-space:nowrap}
.filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}.filters button{background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer;font:inherit;font-size:13px}
.filters button.on{border-color:var(--acc);color:var(--acc)}
@media (max-width:640px){body{padding:14px}.notes{display:none}}
</style></head><body><div class="wrap">
<h1>LAN-ABFAHRT · STATUS</h1>
<div class="meta">Stand: ${esc(data.updated)} · <a href="${REPO}" style="color:#b9a8ff">Repo</a></div>
<div class="stats">
<div class="stat"><b>${total}</b><span>Spiele in main</span></div>
<div class="stat"><b>${data.inProgress.length}</b><span>gerade in Arbeit</span></div>
<div class="stat"><b>${data.queue.length}</b><span>Spiele in der Warteschlange</span></div>
<div class="stat"><b>${withFb}/${total}</b><span>Spiele mit Feedback</span></div>
</div>
<h2>▶ GERADE IN ARBEIT</h2><div class="grid">${data.inProgress.map(card).join('')}</div>
<h2>⏳ ALS NÄCHSTES</h2><div class="queue">${data.queue.map((q) => `<span>${esc(q)}</span>`).join('')}</div>
<h2>🎮 SPIELE & FEEDBACK</h2>
<div class="filters"><button class="on" data-f="all">Alle</button><button data-f="fb">Mit Feedback</button><button data-f="nofb">Noch kein Feedback</button></div>
<table id="games">${groups.map((g) => `<tr class="gh"><td colspan="4">${esc(g.title)}</td></tr>${g.kinds.filter((k) => info[k]).map(gameRow).join('')}`).join('')}</table>
<h2>🛠 ALLGEMEINES FEEDBACK</h2><ul class="done">${data.general.map((g) => `<li><span>${esc(g.title)}</span><span class="pill ${fbClass[g.status] ?? 'open'}">${esc(g.status)}</span></li>`).join('')}</ul>
<h2>✅ ABGESCHLOSSEN</h2><ul class="done">${data.done.map((d) => `<li><span>${esc(d.title)}</span><span class="d">${d.pr ? `<a href="${REPO}/pull/${d.pr}">#${d.pr}</a> · ` : ''}${esc(d.date)}</span></li>`).join('')}</ul>
</div>
<script>
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));
  const f=b.dataset.f;
  document.querySelectorAll('#games tr:not(.gh)').forEach(tr=>{
    const has=!tr.querySelector('.pill.none');
    tr.style.display=f==='all'||(f==='fb'&&has)||(f==='nofb'&&!has)?'':'none';
  });
}));
</script></body></html>`;
writeFileSync(new URL('docs/status.html', root), html);
console.log('docs/status.html geschrieben –', total, 'Spiele,', data.inProgress.length, 'in Arbeit');
