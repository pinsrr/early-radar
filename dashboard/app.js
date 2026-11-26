// Early Radar dashboard. Static: reads JSON written by the collector into ./data/.
'use strict';

const S = { cache: {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const pct = x => x == null ? '<span class="muted">—</span>' : `<span style="color:${x >= 0 ? 'var(--accent)' : 'var(--bad)'}">${x >= 0 ? '+' : ''}${Math.round(x * 100)}%</span>`;
const ago = iso => { if (!iso) return '—'; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
const stCls = s => ({ 'Early Signal': 'st-early', 'Emerging': 'st-emerging', 'Accelerating': 'st-accel', 'Mainstream': 'st-main', 'Saturated or Declining': 'st-decl' }[s] || '');
const stage = s => `<span class="pill ${stCls(s)}">${esc(s)}</span>`;
const bar = (v, max = 100, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%;${color ? 'background:' + color : ''}"></i></div>`;
const robloxUrl = g => `https://www.roblox.com/games/${g.placeId}`;

async function load(name) {
  if (!S.cache[name]) S.cache[name] = fetch(`data/${name}`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(name); return r.json(); });
  return S.cache[name];
}

// Watchlist lives in this browser only (localStorage can be unavailable: fall back to memory).
const WL = (() => {
  let mem = { games: [], mechanics: [] };
  try { mem = JSON.parse(localStorage.getItem('radar-watch')) || mem; } catch {}
  const save = () => { try { localStorage.setItem('radar-watch', JSON.stringify(mem)); } catch {} };
  return {
    has: (k, id) => mem[k].includes(String(id)),
    toggle: (k, id) => { id = String(id); mem[k] = mem[k].includes(id) ? mem[k].filter(x => x !== id) : [...mem[k], id]; save(); },
    all: k => mem[k],
  };
})();
const star = (k, id) => `<button class="star ${WL.has(k, id) ? 'on' : ''}" data-star="${k}:${esc(id)}" title="Watch">★</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-star]');
  if (b) { const [k, id] = b.dataset.star.split(':'); WL.toggle(k, id); b.classList.toggle('on'); }
  const th = e.target.closest('th[data-sort]');
  if (th) { const t = th.closest('table'); sortTable(t, th.dataset.sort, th); }
});

function sortTable(t, key, th) {
  const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
  t.querySelectorAll('th').forEach(x => delete x.dataset.dir);
  th.dataset.dir = dir;
  const rows = [...t.tBodies[0].rows];
  rows.sort((a, b) => { const x = a.dataset[key], y = b.dataset[key]; const nx = +x, ny = +y; const c = (isNaN(nx) || isNaN(ny)) ? String(x).localeCompare(y) : nx - ny; return dir === 'desc' ? -c : c; });
  rows.forEach(r => t.tBodies[0].appendChild(r));
}

function gameTable(games, names, { limit = 200 } = {}) {
  if (!games.length) return '<p class="muted">No games match.</p>';
  return `<table><thead><tr><th></th><th data-sort="score" class="num">Score</th><th data-sort="name">Game</th><th data-sort="stage">Stage</th><th data-sort="ccu" class="num">CCU</th><th data-sort="c6" class="num">6h</th><th data-sort="c24" class="num">24h</th><th data-sort="age" class="num">Age (d)</th><th data-sort="gp" class="num">Growth pct</th><th>Mechanics</th><th data-sort="uac" class="num">U&amp;C countries</th></tr></thead><tbody>
  ${games.slice(0, limit).map(g => `<tr data-score="${g.score}" data-name="${esc(g.name)}" data-stage="${esc(g.stage)}" data-ccu="${g.ccu}" data-c6="${g.change6h ?? -9}" data-c24="${g.change24 ?? -9}" data-age="${g.ageDays}" data-gp="${g.growthPct}" data-uac="${g.uacCountries}">
    <td>${star('games', g.id)}</td>
    <td class="num"><span class="score">${g.score}</span>${bar(g.score)}</td>
    <td><a href="#/game/${g.id}">${esc(g.name)}</a><div class="muted" style="font-size:12px">${esc(g.genre)}${g.subgenre ? ' › ' + esc(g.subgenre) : ''} · ${esc(g.creator)}</div>${g.flags.map(f => `<span class="pill flag">${esc(f)}</span>`).join('')}</td>
    <td>${stage(g.stage)}</td><td class="num">${fmt(g.ccu)}</td><td class="num">${pct(g.change6h)}</td><td class="num">${pct(g.change24)}</td>
    <td class="num">${g.ageDays}</td><td class="num">${g.growthPct}${g.growthKind === 'cold-start' ? '<span class="label-inf" title="cold-start estimate"> *</span>' : ''}</td>
    <td>${g.tags.slice(0, 4).map(t => `<a class="pill tag" href="#/mechanic/${t}">${esc(names[t] || t)}</a>`).join('')}</td>
    <td class="num">${g.uacCountries || ''}</td></tr>`).join('')}
  </tbody></table>${games.length > limit ? `<p class="muted">Showing ${limit} of ${games.length}.</p>` : ''}`;
}

function lineChart(points, { y = 1, label = 'CCU' } = {}) {
  if (!points || points.length < 2) return `<div class="note">Not enough history for a chart yet. Each run adds a point; charts fill in after a few hours.</div>`;
  const W = 900, Hh = 220, P = 36;
  const xs = points.map(p => p[0]), ys = points.map(p => p[y]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys) * 1.1 || 1;
  const X = t => P + (t - x0) / (x1 - x0 || 1) * (W - P - 10), Y = v => Hh - 24 - v / y1 * (Hh - 40);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[y]).toFixed(1)}`).join('');
  const ticks = [0, 0.5, 1].map(f => `<text x="4" y="${Y(y1 * f / 1.1) + 4}" fill="#8a96aa" font-size="11">${fmt(y1 * f / 1.1)}</text><line x1="${P}" x2="${W}" y1="${Y(y1 * f / 1.1)}" y2="${Y(y1 * f / 1.1)}" stroke="#263043"/>`).join('');
  const dl = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${ticks}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="${P}" y="${Hh - 6}" fill="#8a96aa" font-size="11">${dl(x0)}</text><text x="${W - 10}" y="${Hh - 6}" fill="#8a96aa" font-size="11" text-anchor="end">${dl(x1)} · ${label}</text></svg>`;
}

// ---------- pages ----------
const pages = {
  async '/'() {
    const [games, names, sum] = await Promise.all([load('games.json'), load('mechanic-names.json'), load('summary.json')]);
    const genres = [...new Set(games.map(g => g.genre))].sort();
    const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const maxCcu = +(q.max || 20000), maxAge = +(q.age || 60), st = q.stage || 'early', gen = q.genre || '', mech = q.mech || '';
    let list = games.filter(g => g.ccu <= maxCcu && g.ageDays <= maxAge && (!gen || g.genre === gen) && (!mech || g.tags.includes(mech)));
    if (st === 'early') list = list.filter(g => ['Early Signal', 'Emerging'].includes(g.stage)); else if (st) list = list.filter(g => g.stage === st);
    const fresh = games.filter(g => Date.now() - Date.parse(g.firstSeen) < 864e5 && ['Early Signal', 'Emerging'].includes(g.stage)).slice(0, 8);
    const opt = (v, cur, l) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l ?? v)}</option>`;
    return `<h1>Early Discoveries</h1>
    <p class="sub">Small and new games growing faster than their peers. Ranked by Early Trend Score (growth vs same-genre, same-size games, freshness, earliness, engagement, mechanic momentum, discovery-list signals). <span class="label-inf">*</span> = cold-start estimate until 48h of history.</p>
    ${sum.historyHoursMedian < 48 ? `<div class="note">History so far: ~${sum.historyHoursMedian}h median per game. Growth scores sharpen after 48h and acceleration/consistency after 3 days.</div>` : ''}
    ${fresh.length ? `<h2>Found in the last 24h</h2><div class="grid">${fresh.map(g => `<a class="card" href="#/game/${g.id}"><div class="score">${g.score}</div><div>${esc(g.name)}</div><div class="muted">${fmt(g.ccu)} CCU · ${g.ageDays}d old</div>${stage(g.stage)}</a>`).join('')}</div>` : ''}
    <h2>Ranked</h2>
    <form class="filters" id="f">
      <label>Max CCU<select name="max">${[500, 2000, 5000, 20000, 50000, 1e9].map(v => opt(v, maxCcu, v === 1e9 ? 'any' : fmt(v))).join('')}</select></label>
      <label>Max age (days)<select name="age">${[7, 14, 30, 60, 120, 100000].map(v => opt(v, maxAge, v === 100000 ? 'any' : v)).join('')}</select></label>
      <label>Stage<select name="stage">${opt('early', st, 'Early Signal + Emerging')}${opt('', st, 'All')}${['Early Signal', 'Emerging', 'Accelerating', 'Not trending'].map(s => opt(s, st)).join('')}</select></label>
      <label>Genre<select name="genre">${opt('', gen, 'All')}${genres.map(g => opt(g, gen)).join('')}</select></label>
      <label>Mechanic<select name="mech">${opt('', mech, 'All')}${Object.entries(names).map(([k, v]) => opt(k, mech, v)).join('')}</select></label>
    </form>
    ${gameTable(list, names)}`;
  },

  async '/overview'() {
    const [sum, games, mechs, genres, alerts, names] = await Promise.all(['summary.json', 'games.json', 'mechanics.json', 'genres.json', 'alerts.json', 'mechanic-names.json'].map(load));
    const k = (l, v) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    return `<h1>Overview</h1><p class="sub">Emerging Roblox market trends from ${sum.trackedGames.toLocaleString()} tracked games. Updated ${ago(sum.generatedAt)}.</p>
    <div class="grid">${k('Early Signal', sum.stageCounts['Early Signal'])}${k('Emerging', sum.stageCounts['Emerging'])}${k('Accelerating', sum.stageCounts['Accelerating'])}${k('Mainstream', sum.stageCounts['Mainstream'])}${k('Declining', sum.stageCounts['Saturated or Declining'])}${k('Runs so far', sum.runs)}</div>
    <div class="two"><div><h2>Top rising mechanics</h2>${mechTable(mechs.filter(m => m.stage !== 'Insufficient data').slice(0, 8))}</div>
    <div><h2>Genres gaining momentum</h2>${genreTable(genres.filter(g => g.level === 'genre').slice(0, 8))}</div></div>
    <h2>Top early games</h2>${gameTable(games.filter(g => ['Early Signal', 'Emerging'].includes(g.stage)), names, { limit: 10 })}
    <h2>Latest alerts</h2>${alertList(alerts.slice(0, 6))}`;
  },

  async '/mechanics'() {
    const m = await load('mechanics.json');
    return `<h1>Mechanic Trends</h1><p class="sub">Individual gameplay mechanics, scored 0–100 for momentum across every tracked game that uses them — regardless of genre. "Plausible driver" means games with the mechanic out-grow same-genre games without it, across several creators and genres. Anything else is labelled correlation only.</p>${mechTable(m)}`;
  },

  async '/mechanic/:id'(id) {
    const [mechs, games, combos, names, opp] = await Promise.all(['mechanics.json', 'games.json', 'combos.json', 'mechanic-names.json', load('opportunities.json').catch(() => ({}))].map(x => typeof x === 'string' ? load(x) : x));
    const card = (opp.cards || []).find(c => c.mechanic === id);
    const m = mechs.find(x => x.id === id);
    if (!m) return `<h1>${esc(names[id] || id)}</h1><p class="muted">No tracked games use this mechanic yet.</p>`;
    const gm = new Map(games.map(g => [g.id, g]));
    const fl = { adoption: 'Number of games', growth: 'Growth of those games', independent: 'Independent creators', recency: 'How recently it spread', acceleration: 'Acceleration', lift: 'Lift vs same-genre games without it', retention: 'Engagement after exposure', crossGenre: 'Works across genres', unsaturated: 'Low saturation', social: 'Social media attention', sampleSize: 'Sample-size adjustment' };
    const cs = combos.filter(c => c.mechanics.includes(id)).slice(0, 10);
    return `<h1>${star('mechanics', id)} ${esc(m.name)}</h1>
    <p class="sub">${stage(m.stage)} <span class="pill">Momentum ${m.momentum}/100</span> <span class="pill">Evidence: ${esc(m.evidence)}</span> <span class="pill">Confidence: ${esc(m.confidence)}</span> <span class="pill">Competition: ${esc(m.competition)}</span> <span class="pill">${esc(m.direction)}</span></p>
    <div class="grid">${[['Games', m.n], ['Creators', m.creators], ['Genres', m.genres], ['Growing games', m.growingGames], ['Large games (50k+)', m.bigGames], ['Lift vs without', m.liftVsWithout == null ? '—' : (m.liftVsWithout > 0 ? '+' : '') + m.liftVsWithout]].map(([l, v]) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
    <div class="two"><div><h2>Score breakdown</h2><div class="card">${m.factors.map(f => `<div class="factor"><div>${esc(fl[f.key] || f.key)}</div>${f.max ? bar(f.points, f.max) : '<div class="muted">not scored</div>'}<div class="num">${f.max ? f.points + '/' + f.max : ''}</div>${f.note ? `<div class="n">${esc(f.note)}</div>` : ''}</div>`).join('')}</div></div>
    <div><h2>How it spread (first game per genre)</h2><div class="card timeline">${m.spread.map(s => `<div><b>${esc(s.genre)}</b> — <a href="#/game/${s.game}">${esc(s.name)}</a> <span class="muted">${(s.created || '').slice(0, 10)}</span></div>`).join('')}</div>
    <h2>Opportunity</h2><div class="card"><p><b>Strongest partner mechanics:</b> ${m.opportunity.strongestPartners.map(esc).join(', ') || '—'}</p><p><b>Untried combinations to explore:</b> ${m.opportunity.untriedPartners.map(esc).join(', ') || '—'}</p><p class="muted">${esc(m.opportunity.risk)}</p></div></div></div>
    ${m.adoption ? `<h2>Adoption (games created per month)</h2><div class="card">${monthsBars(m.adoption)}</div>` : ''}
    ${card ? `<h2>Opportunity card</h2><div class="card"><p>${esc(card.description)}</p><dl class="concept" style="display:grid;grid-template-columns:200px 1fr;gap:6px 12px">
      <dt class="muted">Player growth evidence</dt><dd>${esc(card.playerGrowthEvidence)}</dd>
      <dt class="muted">Genre growth</dt><dd>${card.associatedGenreGrowth.map(g => `${esc(g.genre)} ${g.medianGrowthPct}th pct`).join(' · ') || '—'}</dd>
      <dt class="muted">Saturation</dt><dd>${esc(card.saturation)}</dd>
      <dt class="muted">Difficulty to build</dt><dd>${card.difficulty ?? '—'}/5</dd>
      <dt class="muted">Multiplayer potential</dt><dd>${card.multiplayer ?? '—'}/5</dd>
      <dt class="muted">Combine with</dt><dd>${card.combineWith.map(esc).join(', ') || '—'}</dd>
      <dt class="muted">Untried pairings</dt><dd>${card.untried.map(esc).join(', ') || '—'}</dd>
      <dt class="muted">Risks</dt><dd>${esc(card.risks)}</dd></dl></div>
      <h2>Three original concepts</h2>${card.concepts.map(c => conceptCard(c, names)).join('')}` : ''}
    <h2>Combinations with this mechanic</h2>${comboTable(cs)}
    <h2>Games using it</h2>${gameTable(m.games.map(i => gm.get(i)).filter(Boolean), names)}`;
  },

  async '/combos'() {
    const c = await load('combos.json');
    return `<h1>Mechanic Combinations</h1><p class="sub">Pairs of mechanics used together in at least 3 tracked games. <span class="pill st-early">white space</span> = strong momentum, few games, no large competitors.</p>${comboTable(c)}`;
  },

  async '/patterns'() {
    const [p, games] = await Promise.all([load('patterns.json'), load('games.json')]);
    const gm = new Map(games.map(g => [g.id, g]));
    return `<h1>Title Patterns</h1><p class="sub">Repeated title templates used by different creators (e.g. "Steal a …", "… For Animals"). On Roblox a copied title template is often the first visible sign of a spreading core loop — before any mechanic or genre label exists. Use these to spot <b>new mechanics</b> the keyword rules don't cover yet.</p>
    <table><thead><tr><th>Pattern</th><th class="num">Games</th><th class="num">Creators</th><th class="num">Median growth pct</th><th class="num">New (≤60d)</th><th class="num">Total CCU</th><th>Examples</th></tr></thead><tbody>
    ${p.map(x => `<tr><td><b>${esc(x.phrase)}</b></td><td class="num">${x.n}</td><td class="num">${x.creators}</td><td class="num">${x.medianGrowthPct}</td><td class="num">${Math.round(x.newShare * 100)}%</td><td class="num">${fmt(x.totalCcu)}</td><td>${x.games.slice(0, 4).map(i => gm.get(i)).filter(Boolean).map(g => `<a href="#/game/${g.id}">${esc(g.name)}</a>`).join(' · ')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No repeated patterns yet.</td></tr>'}</tbody></table>`;
  },


  async '/opportunities'() {
    const [o, names] = await Promise.all([load('opportunities.json'), load('mechanic-names.json')]);
    if (o.error) return `<h1>Opportunity Finder</h1>${opError(o)}`;
    const g = o.gaps;
    return `<h1>Opportunity Finder</h1>
    <p class="sub">Where promising gameplay systems are still uncommon. Concepts are rule-based starting points built from the tracker's evidence — original combinations, not copies of existing games. Opportunity score = demand (mechanic momentum + genre growth) + gap (how few games already do it) + feasibility for a small team + multiplayer potential.</p>
    <h2>What I would build next</h2>
    ${o.buildNext.map((c, i) => conceptCard(c, names, i + 1)).join('') || '<p class="muted">Not enough data yet.</p>'}
    <h2>Market gaps</h2>
    <div class="two"><div><h3>Untested combinations</h3><p class="muted">Both mechanics have momentum; almost no tracked game combines them.</p>
    <table><thead><tr><th>Combination</th><th class="num">Demand</th><th class="num">Existing</th></tr></thead><tbody>${g.untestedCombos.map(u => `<tr><td>${u.mechanics.map(id => `<a href="#/mechanic/${id}">${esc(names[id])}</a>`).join(' + ')}</td><td class="num">${u.demand}</td><td class="num">${u.existingGames}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">None yet</td></tr>'}</tbody></table></div>
    <div><h3>Mechanics missing from growing genres</h3><p class="muted">A rising mechanic that has barely reached a genre whose games are growing.</p>
    <table><thead><tr><th>Mechanic</th><th>Into genre</th><th class="num">Genre growth</th><th class="num">Already there</th></tr></thead><tbody>${g.unspreadMechanics.map(u => `<tr><td><a href="#/mechanic/${u.mechanic}">${esc(u.mechanicName)}</a></td><td>${esc(u.genre)}</td><td class="num">${u.genreGrowthPct}</td><td class="num">${u.gamesWithMechanicInGenre}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">None yet</td></tr>'}</tbody></table></div></div>
    ${g.crowding.length ? `<h3>Getting crowded</h3><table><thead><tr><th>Mechanic</th><th class="num">New games (30d)</th><th class="num">Previous 30d</th><th class="num">Large games</th></tr></thead><tbody>${g.crowding.map(c => `<tr><td><a href="#/mechanic/${c.mechanic}">${esc(c.name)}</a></td><td class="num">${c.newEntrants30}</td><td class="num">${c.prev30}</td><td class="num">${c.bigGames}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>All concepts</h2>
    ${o.allConcepts.map(c => `<details class="card" style="margin-bottom:8px"><summary>${c.opportunityScore} · ${esc(c.title)} <span class="muted">(${c.mechanics.map(id => esc(names[id])).join(' + ')})</span></summary>${conceptCard(c, names)}</details>`).join('')}`;
  },

  async '/competitors'() {
    const o = await load('opportunities.json');
    if (o.error) return `<h1>Competitor Tracker</h1>${opError(o)}`;
    const gl = g => g ? `<a href="#/game/${g.id}">${esc(g.name)}</a><div class="muted" style="font-size:12px">${fmt(g.ccu)} CCU · growth ${g.growthPct} · ${g.ageDays}d</div>` : '—';
    return `<h1>Competitor Tracker</h1><p class="sub">Groups of similar games (same subgenre, or same mechanic combination). <b>Outgrowers</b> are small games growing much faster than the group's leader — the clearest early signals. Competition = how many new games joined in the last 30 days.</p>
    <table><thead><tr><th>Group</th><th class="num">Games</th><th>Competition</th><th>Leader</th><th>Fastest grower</th><th>Newest</th><th>Outgrowers</th></tr></thead><tbody>
    ${o.clusters.map(c => `<tr><td><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.kind)} · ${fmt(c.totalCcu)} CCU</div></td><td class="num">${c.n}</td><td>${esc(c.competition)} <span class="muted">(${c.entrants30} new)</span></td><td>${gl(c.leader)}</td><td>${gl(c.fastest)}</td><td>${gl(c.newest)}</td><td>${c.outgrowers.map(g => `<a class="pill st-early" href="#/game/${g.id}">${esc(g.name)}</a>`).join('') || '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`;
  },

  async '/genres'() {
    const g = await load('genres.json');
    return `<h1>Genre Trends</h1><p class="sub">Roblox's own genre and subgenre labels, ranked by the median growth percentile of their games.</p><h2>Genres</h2>${genreTable(g.filter(x => x.level === 'genre'))}<h2>Subgenres</h2>${genreTable(g.filter(x => x.level === 'subgenre'))}`;
  },

  async '/explorer'() {
    const [games, names] = await Promise.all([load('games.json'), load('mechanic-names.json')]);
    const q = decodeURIComponent((location.hash.split('?q=')[1] || '')).toLowerCase();
    const list = q ? games.filter(g => (g.name + ' ' + g.creator + ' ' + g.genre + ' ' + g.subgenre).toLowerCase().includes(q)) : games;
    return `<h1>Game Explorer</h1><form class="filters" id="s"><label>Search name, creator or genre<input name="q" value="${esc(q)}" placeholder="e.g. ragdoll" size="40"></label></form>${gameTable(list, names, { limit: 500 })}`;
  },

  async '/watchlist'() {
    const [games, mechs, names] = await Promise.all([load('games.json'), load('mechanics.json'), load('mechanic-names.json')]);
    const gs = games.filter(g => WL.has('games', g.id)), ms = mechs.filter(m => WL.has('mechanics', m.id));
    return `<h1>Watchlist</h1><p class="sub">Click ★ on any game or mechanic. Saved in this browser only. To get alerts for a game, add its ID to <code>config/watchlist.json</code> in the repo.</p><h2>Games</h2>${gameTable(gs, names)}<h2>Mechanics</h2>${ms.length ? mechTable(ms) : '<p class="muted">None yet.</p>'}`;
  },


  async '/reports'() {
    const idx = await load('reports/index.json').catch(() => null);
    if (!idx) return '<h1>Reports</h1><p class="muted">No reports yet. They appear after the next run.</p>';
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const dFile = q.get('d') || idx.daily[0], wFile = q.get('w') || idx.weekly[0];
    const [d, w, names] = await Promise.all([dFile ? load('reports/' + dFile) : null, wFile ? load('reports/' + wFile) : null, load('mechanic-names.json')]);
    const sel = (list, cur, key) => `<select onchange="location.hash='#/reports?${key}='+this.value">${list.map(f => `<option ${f === cur ? 'selected' : ''} value="${esc(f)}">${esc(f.replace(/^(daily|weekly)-|\.json$/g, ''))}</option>`).join('')}</select>`;
    const gl = g => `<a href="#/game/${g.id}">${esc(g.name)}</a>`;
    const delta = x => x == null ? '' : ` <span style="color:${x >= 0 ? 'var(--accent)' : 'var(--bad)'}">${x >= 0 ? '+' : ''}${x}</span>`;
    const li = arr => arr?.length ? `<ul>${arr.join('')}</ul>` : '<p class="muted">Nothing this time.</p>';
    const daily = d ? `<div class="card"><div class="filters"><label>Daily report ${sel(idx.daily, dFile, 'd')}</label><span class="muted">${d.comparedWith ? 'compared with ' + esc(d.comparedWith) : 'first day: no comparison yet'} · ${d.newGamesToday} new games discovered</span></div>
      <div class="two"><div><h3>Five emerging games</h3>${li(d.emergingGames.map(g => `<li>${gl(g)} — score ${g.score}, ${fmt(g.ccu)} CCU, ${g.ageDays}d old ${stage(g.stage)}</li>`))}
      <h3>Unusual growth</h3>${li([...d.unusualGrowth.map(g => `<li>${gl(g)} ${pct(g.change24)} in 24h${g.flags?.length ? ' <span class="pill flag">' + esc(g.flags.join(', ')) + '</span>' : ''}</li>`), ...d.outgrowers.map(o => `<li>${gl(o)} out-growing ${esc(o.leader)} in ${esc(o.group)}</li>`)])}</div>
      <div><h3>Five trending mechanics</h3>${li(d.trendingMechanics.map(m => `<li><a href="#/mechanic/${m.id}">${esc(m.name)}</a> — ${m.momentum}${delta(m.change)} ${stage(m.stage)}</li>`))}
      <h3>New combinations</h3>${d.newCombinations == null ? '<p class="muted">Needs yesterday\'s snapshot.</p>' : li(d.newCombinations.map(c => `<li>${esc(c.name)} — ${c.n} games, ${c.growing} growing</li>`))}
      <h3>Changes since yesterday</h3>${d.comparedWith ? li(d.changes.map(c => c.kind === 'game' ? `<li>${gl(c)}: ${esc(c.from)} → ${esc(c.to)}</li>` : `<li><a href="#/mechanic/${c.id}">${esc(c.name)}</a>: momentum ${c.from} → ${c.to}</li>`)) : '<p class="muted">Needs yesterday\'s snapshot.</p>'}</div></div>
      <h3>Three development opportunities</h3>${li(d.opportunities.map(o => `<li><b>${esc(o.title)}</b> (${o.score}) — ${esc(o.pitch)}</li>`))}
      <h3>Social vs player growth</h3><p>${d.social.games ? `Of ${d.social.games} games with enough data: YouTube came first for ${d.social.socialFirst}, players came first for ${d.social.playersFirst}, both together for ${d.social.together}. Small sample — treat as early evidence.` : '<span class="muted">Needs several days of YouTube checks and player history.</span>'}</p></div>` : '';
    const weekly = w ? `<div class="card" style="margin-top:16px"><div class="filters"><label>Weekly report ${sel(idx.weekly, wFile, 'w')}</label><span class="muted">week of ${esc(w.weekOf || w.date)}${w.note ? ' · ' + esc(w.note) : ''}</span></div>
      <h3>What I would build next</h3>${w.whatIWouldBuildNext.map(b => `<div class="card concept"><div class="rank">#${b.rank}</div><h3>${esc(b.title)}</h3><p>${esc(b.pitch)}</p><p class="muted">Evidence ${esc(b.ranking.evidence)} · Competition ${esc(b.ranking.competition)} · Feasibility ${esc(b.ranking.feasibility)} · Potential ${esc(b.ranking.potential)} · <a href="#/opportunities">full concept</a></p></div>`).join('') || '<p class="muted">Not enough data yet.</p>'}
      <div class="two"><div><h3>Fastest-growing genres</h3>${li(w.fastestGenres.map(g => `<li>${esc(g.key)} — ${g.medianGrowthPct}th pct${delta(g.change)}</li>`))}
      <h3>Fastest-growing mechanics</h3>${li(w.fastestMechanics.map(m => `<li><a href="#/mechanic/${m.id}">${esc(m.name)}</a> — ${m.momentum}${delta(m.change)}</li>`))}
      <h3>Mechanics spreading across genres</h3>${li(w.spreadingMechanics.map(m => `<li><a href="#/mechanic/${m.id}">${esc(m.name)}</a> — ${m.genres} genres${m.genresBefore != null ? ` (was ${m.genresBefore})` : ''}</li>`))}
      <h3>Trends becoming saturated</h3>${li(w.saturating.map(x => `<li><a href="#/mechanic/${x.id}">${esc(x.name)}</a> — ${esc(x.why)}</li>`))}</div>
      <div><h3>Underserved concepts</h3>${li([...w.underserved.untestedCombos.map(u => `<li>${esc(u.name)} — ${esc(u.note)}</li>`), ...w.underserved.unspread.map(u => `<li>${esc(u.mechanicName)} → ${esc(u.genre)} (only ${u.gamesWithMechanicInGenre} there)</li>`)])}
      <h3>Significant competitor activity</h3>${li(w.competitorActivity.map(c => `<li>${esc(c.name)} — ${c.entrants30} new games, ${esc(c.competition)}${c.outgrowers.length ? '; outgrowers: ' + c.outgrowers.map(esc).join(', ') : ''}</li>`))}
      <h3>Predictions worth testing</h3>${li(w.predictionsToTest.map(p => `<li>${gl(p)}: ${esc(p.claim)} <span class="muted">(${esc(p.basis)})</span></li>`))}<p class="muted">Phase 5 will store and score these automatically.</p></div></div></div>` : '';
    return `<h1>Reports</h1><p class="sub">Daily and weekly intelligence summaries. A new daily report is written every day, and the weekly one covers Monday to Sunday. The last 30 daily reports are kept.</p>${daily}${weekly}`;
  },

  async '/alerts'() {
    return `<h1>Alerts</h1><p class="sub">What changed, why it matters, and how confident the system is. Each links to its supporting games.</p>${alertList(await load('alerts.json'))}`;
  },

  async '/game/:id'(id) {
    const [d, names] = await Promise.all([load(`game/${id}.json`).catch(() => null), load('mechanic-names.json')]);
    if (!d) return '<h1>Game not found</h1><p class="muted">It may have been dropped for having no players.</p>';
    const g = d.meta, m = d.metrics;
    const row = (l, v, kind) => `<tr><td>${l}</td><td class="num">${v}</td><td class="${{ observed: 'label-obs', derived: 'label-der', inferred: 'label-inf', unavailable: 'label-na' }[kind]}">${kind}</td></tr>`;
    return `<h1>${star('games', id)} ${esc(g.name)}</h1>
    <p class="sub">${stage(d.stage)} <span class="pill">Score ${d.score}</span> ${esc(g.genre)}${g.subgenre ? ' › ' + esc(g.subgenre) : ''} · by ${esc(g.creator)} · created ${(g.created || '').slice(0, 10)} · first seen by radar ${ago(g.firstSeen)} via ${esc(g.discoveredVia)} · <a href="https://www.roblox.com/games/${g.placeId}" target="_blank" rel="noopener">Open on Roblox ↗</a></p>
    ${m.flags.map(f => `<div class="note" style="color:var(--warn)">⚠ ${esc(f.note)}</div>`).join('')}
    <div class="card"><h2 style="margin-top:0">Concurrent players (hourly average)</h2>${lineChart(d.chart)}</div>
    <div class="two"><div><h2>Why this score</h2><div class="card">${d.breakdown.parts.map(p => `<div class="factor"><div>${esc(p.name)}</div>${bar(p.points, p.max)}<div class="num">${p.points}/${p.max}</div><div class="n">${esc(p.note)}${p.neutral ? ' (neutral value used)' : ''}</div></div>`).join('')}${d.breakdown.penalties.map(p => `<div class="factor"><div style="color:var(--bad)">${esc(p.name)}</div><div class="muted">${esc(p.note)}</div><div class="num" style="color:var(--bad)">${p.points}</div></div>`).join('')}</div>
    <h2>Mechanics detected</h2><div class="card">${d.tags.length ? d.tags.map(t => `<div style="padding:4px 0"><a class="pill tag" href="#/mechanic/${t.id}">${esc(names[t.id])}</a> <span class="muted">${t.confidence} · matched: ${t.evidence.map(esc).join(', ')}</span></div>`).join('') : '<span class="muted">None matched. Edit config/mechanics.json to add rules.</span>'}</div></div>
    <div><h2>Metrics</h2><table><tbody>
      ${row('Concurrent players', fmt(m.ccu), 'observed')}${row('Total visits', fmt(m.visits), 'observed')}${row('Favourites', fmt(m.favorites), 'observed')}
      ${row('Like ratio', m.likeRatio == null ? '—' : Math.round(m.likeRatio * 100) + '%', 'observed')}
      ${row('Change 1h / 6h / 24h', ['1h', '6h', '24h'].map(k => m.change[k] ? pct(m.change[k].pct) : '—').join(' / '), 'derived')}
      ${row('Change 7d / 30d', ['7d', '30d'].map(k => m.change[k] ? pct(m.change[k].pct) : '—').join(' / '), 'derived')}
      ${row('Avg CCU 24h (prev 24h)', `${fmt(m.avg24)} (${fmt(m.prevAvg24)})`, 'derived')}
      ${row('Peak CCU 24h', fmt(m.peak24), 'derived')}
      ${row('Visits per hour', fmt(m.visitsPerHour), 'derived')}
      ${row('Favourites per 1k visits', m.favPer1kVisits == null ? '—' : m.favPer1kVisits.toFixed(1), 'derived')}
      ${row('Lifetime visits per day', fmt(m.visitsPerDayLifetime), 'derived')}
      ${row('Est. session length', m.sessionMinutes ? Math.round(m.sessionMinutes.value) + ' min' : '—', 'inferred')}
      ${row('Updates in last 7d (seen)', m.updates7d, 'derived')}
      ${row('Up-and-Coming countries (24h)', m.discovery.upAndComingCountries + (m.discovery.bestUpAndComingRank ? ` (best #${m.discovery.bestUpAndComingRank})` : ''), 'observed')}
      ${row('History collected', Math.round(m.historyHours) + 'h · ' + m.snapshots + ' snapshots', 'derived')}
      ${row('Retention / revenue', 'not public', 'unavailable')}
    </tbody></table><p class="muted">Peer group: ${esc(d.peerKey)}</p></div></div>
    <h2>Social (YouTube)</h2>${m.social ? `<div class="card"><p><b>${m.social.videos7d}</b> videos naming this game in the last 7 days (${m.social.videos48h} in 48h) from <b>${m.social.channels}</b> channels, ${fmt(m.social.views7d)} views total${m.social.hitLimit ? ' — hit the search limit, real number is higher' : ''}. <span class="label-obs">observed</span> · checked ${ago(m.social.t)}, ${m.social.checks} check(s) so far.</p>${m.social.top ? `<p>Top video: <a href="${esc(m.social.top.url)}" target="_blank" rel="noopener">${esc(m.social.top.title)}</a> by ${esc(m.social.top.channel)} (${fmt(m.social.top.views)} views)</p>` : ''}${m.social.history.length >= 2 ? lineChart(m.social.history.map(h => [Date.parse(h[0]), h[1]]), { label: 'videos in last 7 days' }) : ''}</div>` : '<p class="muted">Not checked on YouTube yet. Early games are checked first, about 96 per day.</p>'}
    <h2>Competitors</h2>${d.competitors?.length ? `<table><thead><tr><th>Game</th><th>Stage</th><th class="num">CCU</th><th class="num">Growth pct</th><th class="num">Age (d)</th><th class="num">Similarity</th></tr></thead><tbody>${d.competitors.map(c => `<tr><td><a href="#/game/${c.id}">${esc(c.name)}</a></td><td>${stage(c.stage)}</td><td class="num">${fmt(c.ccu)}</td><td class="num">${c.growthPct}</td><td class="num">${c.ageDays}</td><td class="num">${c.similarity}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No close competitors among tracked games.</p>'}
    <h2>Description</h2><div class="card" style="white-space:pre-wrap">${esc(g.desc)}</div>`;
  },

  async '/about'() {
    const sum = await load('summary.json');
    const q = sum.dataQuality;
    return `<h1>Data &amp; method</h1>
    <div class="card"><p><b>Last run:</b> ${esc(q.lastRun)} (${esc(q.mode)}), ${q.durationSec}s · ${q.requests} requests · ${q.failedRequests} failed · ${q.rateLimited} rate-limited</p>
    <p><b>This run:</b> ${q.listingsSeen} list entries, ${q.newGamesFound} new games, ${q.gamesPolled}/${q.gamesRequested} polled, ${q.droppedInactive} dropped as inactive. Countries: ${(q.countriesThisRun || []).join(', ')}. Keywords: ${(q.keywordsThisRun || []).join(', ')}.</p>
    ${q.errors?.length ? `<p style="color:var(--warn)">Errors: ${q.errors.map(e => esc(e.url + ' ' + e.status)).join('; ')}</p>` : ''}</div>
    <div class="card"><p><b>YouTube:</b> ${esc(sum.social?.youtube?.status || 'not connected')}${sum.social?.youtube?.checkedThisRun != null ? ` · ${sum.social.youtube.checkedThisRun} games checked this run, ${sum.social.youtube.waiting} waiting, ${sum.social.youtube.unitsUsedThisRun} quota units used` : ''} · ${sum.social?.youtubeGamesTracked || 0} games with YouTube data${sum.social?.youtube?.note ? `<br><span class="muted">${esc(sum.social.youtube.note)}</span>` : ''}${(sum.social?.youtube?.errors || []).length ? `<br><span style="color:var(--warn)">${sum.social.youtube.errors.map(e => esc((e.path || '') + ' ' + (e.status || '') + ' ' + (e.reason || ''))).join('; ')}</span>` : ''}</p><p><b>TikTok:</b> ${esc(sum.social?.tiktok || 'unavailable')}</p></div>
    <div class="note">${esc(q.note)}<br><br>${esc(q.baselineNote)}</div>
    <h2>Labels</h2><p><span class="label-obs">observed</span> read from Roblox · <span class="label-der">derived</span> computed from our snapshots · <span class="label-inf">inferred</span> estimate with a stated assumption · <span class="label-na">unavailable</span> not public</p>
    <h2>Sources</h2><ul class="muted"><li>apis.roblox.com/explore-api — Up-and-Coming, Top Trending and other explore lists, per country</li><li>apis.roblox.com/search-api/omni-search — rotating keyword search, 3 pages deep</li><li>games.roblox.com/v1/games — CCU, visits, favourites, genre, created/updated</li><li>games.roblox.com/v1/games/votes — likes/dislikes</li><li>www.googleapis.com/youtube/v3 — search + video statistics (needs YOUTUBE_API_KEY; data deleted after 30 days per YouTube terms)</li><li>TikTok — no public API; not used</li></ul>`;
  },
};


function conceptCard(c, names, rank) {
  const mlinks = c.mechanics.map(id => `<a class="pill tag" href="#/mechanic/${id}">${esc(names[id] || id)}</a>`).join('');
  return `<div class="card concept">${rank ? `<div class="rank">#${rank}</div>` : ''}
    <div class="meta">${esc(c.strategy)} · opportunity ${c.opportunityScore}/100 (demand ${c.scoreParts.demand}/40, gap ${c.scoreParts.gap}/30, feasibility ${c.scoreParts.feasibility}/20, multiplayer ${c.scoreParts.multiplayer}/10)</div>
    <h3>${esc(c.title)} <span class="muted" style="font-size:12px;font-weight:400">working title</span></h3>
    <div>${mlinks}${c.genre ? `<span class="pill">${esc(c.genre)}</span>` : ''}<span class="pill">difficulty ${c.difficulty}/5</span><span class="pill">multiplayer ${c.multiplayer}/5</span></div>
    <p>${esc(c.pitch)}</p>
    <dl>
      <dt>Core loop</dt><dd><ol>${c.coreLoop.map(x => `<li>${esc(x)}</li>`).join('')}</ol></dd>
      ${c.twist ? `<dt>Twist</dt><dd>${esc(c.twist)}</dd>` : ''}
      <dt>Game feel</dt><dd>${esc(c.feel)}</dd>
      <dt>Why now</dt><dd>${c.evidence.map(esc).join('<br>')}</dd>
      <dt>Competition</dt><dd>${c.existingPair} tracked game(s) combine these mechanics${c.genre ? `, ${c.existingSame} in ${esc(c.genre)}` : ''}</dd>
      <dt>Risks</dt><dd>${c.risks.length ? c.risks.map(esc).join('<br>') : '<span class="muted">None flagged</span>'}</dd>
      <dt>First prototype</dt><dd>${esc(c.firstPrototype)}</dd>
    </dl></div>`;
}
function monthsBars(a) {
  const max = Math.max(1, ...a.months.map(m => m.games));
  return `<div class="months">${a.months.map(m => `<div style="height:${m.games / max * 100}%" title="${m.games} games"><span>${m.month.slice(2)}</span></div>`).join('')}</div><p class="muted" style="margin-top:24px">New games using it: ${a.newEntrants30} in the last 30 days vs ${a.newEntrantsPrev30} the 30 days before (${a.entrantTrend}). Based on game creation dates.</p>`;
}
function opError(o) { return o?.error ? `<div class="note" style="color:var(--warn)">Opportunity analysis failed on the last run: ${esc(o.error.split('\n')[0])}</div>` : ''; }

function mechTable(ms) {
  return `<table><thead><tr><th></th><th data-sort="m" class="num">Momentum</th><th data-sort="name">Mechanic</th><th>Stage</th><th class="num" data-sort="n">Games</th><th class="num" data-sort="cr">Creators</th><th class="num" data-sort="ge">Genres</th><th>Evidence</th><th>Competition</th></tr></thead><tbody>
  ${ms.map(m => `<tr data-m="${m.momentum}" data-name="${esc(m.name)}" data-n="${m.n}" data-cr="${m.creators}" data-ge="${m.genres}"><td>${star('mechanics', m.id)}</td><td class="num"><span class="score">${m.momentum}</span>${bar(m.momentum)}</td><td><a href="#/mechanic/${m.id}">${esc(m.name)}</a></td><td>${stage(m.stage)}</td><td class="num">${m.n}</td><td class="num">${m.creators}</td><td class="num">${m.genres}</td><td>${esc(m.evidence)} <span class="muted">(${esc(m.confidence)})</span></td><td>${esc(m.competition)}</td></tr>`).join('')}</tbody></table>`;
}
function comboTable(cs) {
  if (!cs.length) return '<p class="muted">No combinations with 3+ games yet.</p>';
  return `<table><thead><tr><th data-sort="m" class="num">Momentum</th><th>Combination</th><th>Stage</th><th class="num" data-sort="n">Games</th><th class="num" data-sort="g">Growing</th><th class="num" data-sort="b">Large</th><th>Evidence</th></tr></thead><tbody>
  ${cs.map(c => `<tr data-m="${c.momentum}" data-n="${c.n}" data-g="${c.growingGames}" data-b="${c.bigGames}"><td class="num"><span class="score">${c.momentum}</span>${bar(c.momentum)}</td><td>${c.mechanics.map(id => `<a href="#/mechanic/${id}">${esc(c.name.split(' + ')[c.mechanics.indexOf(id)])}</a>`).join(' + ')} ${c.whiteSpace ? '<span class="pill st-early">white space</span>' : ''}</td><td>${stage(c.stage)}</td><td class="num">${c.n}</td><td class="num">${c.growingGames}</td><td class="num">${c.bigGames}</td><td>${esc(c.evidence)}</td></tr>`).join('')}</tbody></table>`;
}
function genreTable(gs) {
  return `<table><thead><tr><th data-sort="name">Genre</th><th class="num" data-sort="g">Median growth pct</th><th class="num" data-sort="n">Games</th><th class="num" data-sort="e">Early games</th><th class="num" data-sort="nw">New (≤60d)</th><th class="num" data-sort="c">Total CCU</th></tr></thead><tbody>
  ${gs.map(g => `<tr data-name="${esc(g.key)}" data-g="${g.medianGrowthPct}" data-n="${g.n}" data-e="${g.earlyGames}" data-nw="${g.newShare}" data-c="${g.totalCcu}"><td><a href="#/explorer?q=${encodeURIComponent(g.key.split(' › ').pop())}">${esc(g.key)}</a></td><td class="num">${g.medianGrowthPct}${bar(g.medianGrowthPct)}</td><td class="num">${g.n}</td><td class="num">${g.earlyGames}</td><td class="num">${Math.round(g.newShare * 100)}%</td><td class="num">${fmt(g.totalCcu)}</td></tr>`).join('')}</tbody></table>`;
}
function alertList(as) {
  if (!as.length) return '<p class="muted">No alerts yet.</p>';
  return as.map(a => `<div class="card alert" style="margin-bottom:10px"><div class="muted" style="font-size:12px">${esc(a.type)} · ${ago(a.at)} · confidence ${esc(a.confidence)}</div><div class="t">${esc(a.title)}</div><div class="w">${esc(a.why)}</div>
    <div>${(a.links.games || []).slice(0, 6).map(id => `<a class="pill" href="#/game/${id}">game ${esc(id)}</a>`).join('')}${(a.links.mechanics || []).map(id => `<a class="pill tag" href="#/mechanic/${id}">${esc(id)}</a>`).join('')}${(a.links.combos || []).map(id => `<a class="pill tag" href="#/combos">${esc(id)}</a>`).join('')}</div></div>`).join('');
}

async function route() {
  const h = (location.hash.slice(1) || '/').split('?')[0];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + h || (h.startsWith('/mechanic/') && a.getAttribute('href') === '#/mechanics')));
  let html;
  try {
    const [, base, arg] = h.match(/^(\/[^/]*)(?:\/(.+))?$/) || [];
    const fn = arg ? pages[base + '/:id'] : pages[base];
    html = fn ? await fn(decodeURIComponent(arg || '')) : '<h1>Not found</h1>';
  } catch (e) {
    html = `<h1>No data yet</h1><p class="sub">The collector has not produced data files (${esc(e.message)}). Run the GitHub Action once, or <code>npm run fixture</code> locally.</p>`;
  }
  document.getElementById('app').innerHTML = html;
  window.scrollTo(0, 0);
  const f = document.getElementById('f');
  if (f) f.addEventListener('change', () => { location.hash = '#/?' + new URLSearchParams(new FormData(f)).toString(); });
  const s = document.getElementById('s');
  if (s) s.addEventListener('submit', e => { e.preventDefault(); location.hash = '#/explorer?q=' + encodeURIComponent(new FormData(s).get('q')); });
}
window.addEventListener('hashchange', route);
load('summary.json').then(s => { document.getElementById('freshness').innerHTML = `Updated ${ago(s.generatedAt)}<br>${s.trackedGames} games tracked`; }).catch(() => {});
route();
