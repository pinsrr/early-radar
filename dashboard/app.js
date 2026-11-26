// Early Radar dashboard. Static: reads JSON written by the collector into ./data/.
'use strict';

const S = { cache: {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const pct = x => x == null ? '<span class="muted">—</span>' : `<span style="color:${x >= 0 ? 'var(--accent)' : 'var(--bad)'}">${x >= 0 ? '+' : ''}${Math.round(x * 100)}%</span>`;
const ago = iso => { if (!iso) return '—'; const h = Math.max(0, (Date.now() - Date.parse(iso)) / 36e5); return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
const stCls = s => ({ 'Early Signal': 'st-early', 'Emerging': 'st-emerging', 'Accelerating': 'st-accel', 'Mainstream': 'st-main', 'Saturated or Declining': 'st-decl' }[s] || '');
const stage = s => `<span class="pill ${stCls(s)}">${esc(s)}</span>`;
const bar = (v, max = 100, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%;${color ? 'background:' + color : ''}"></i></div>`;
const robloxUrl = g => `https://www.roblox.com/games/${g.placeId}`;

const STAGE_COLOR = { 'Early Signal': '#9CC8FF', 'Emerging': '#5EE6D0', 'Accelerating': '#FFC266', 'Mainstream': '#FF7A6B', 'Saturated or Declining': '#8A6F9E' };
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
const ordinal = n => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };
const hashN = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };

// Stroke icons for the navigation rail.
const ICONS = {
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  orbit: '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-25 12 12)"/>',
  link: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
  text: '<path d="M5 6h14M5 12h10M5 18h7"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  users: '<circle cx="9" cy="9" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3.5 3.5 0 010 7M18 14.3c1.8.9 3 2.9 3 5.7"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
document.querySelectorAll('#nav i[data-i]').forEach(i => { i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[i.dataset.i] || ''}</svg>`; });

// Orbit radar: stages as orbits (outer = earliest), games as glowing bodies sized by players.
function observatory(games) {
  const W = 1000, H = 560, cx = 500, cy = 318, TILT = -13;
  const rings = [['Mainstream', 118, 70], ['Accelerating', 210, 110], ['Emerging', 305, 160], ['Early Signal', 400, 230]];
  const pick = { 'Early Signal': 70, 'Emerging': 55, 'Accelerating': 30, 'Mainstream': 30 };
  let bodies = '';
  for (const [st, rx, period] of rings) {
    const ry = rx * 0.4;
    const list = games.filter(g => g.stage === st).slice(0, pick[st]);
    for (const g of list) {
      const a = hashN(g.id) * Math.PI * 2;
      const wob = 1 + (hashN(g.id + 'r') - 0.5) * 0.14;
      const r = Math.min(13, 2.2 + Math.sqrt(g.ccu) / 20);
      const c = STAGE_COLOR[st];
      const px = (rx * wob * Math.cos(a)).toFixed(1), py = (ry * wob * Math.sin(a)).toFixed(1);
      const path = `M ${cx + rx * wob} ${cy} A ${rx * wob} ${ry * wob} 0 1 1 ${cx - rx * wob} ${cy} A ${rx * wob} ${ry * wob} 0 1 1 ${cx + rx * wob} ${cy}`;
      const dur = period * (0.9 + hashN(g.id + 'p') * 0.2);
      const motion = REDUCED ? '' : `<animateMotion dur="${dur.toFixed(1)}s" repeatCount="indefinite" begin="-${(a / (Math.PI * 2) * dur).toFixed(1)}s" path="${path}"/>`;
      const pos = REDUCED ? `transform="translate(${cx + +px} ${cy + +py})"` : '';
      bodies += `<g class="body" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(g.name)}, ${esc(st)}, score ${g.score}" ${pos}>
        <circle r="${(r * 2.6).toFixed(1)}" fill="${c}" opacity=".16" filter="url(#soft)"/>
        <circle class="core" r="${r.toFixed(1)}" fill="${c}"/>${motion}<title>${esc(g.name)} — ${fmt(g.ccu)} players, score ${g.score}</title></g>`;
    }
  }
  const ringSvg = rings.map(([st, rx]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.4}" fill="none" stroke="${STAGE_COLOR[st]}" stroke-opacity=".28" stroke-width="1" stroke-dasharray="${st === 'Early Signal' ? '2 5' : 'none'}"/>
    <text x="${cx + rx * Math.cos(-0.5) + 6}" y="${cy + rx * 0.4 * Math.sin(-0.5) - 6}" fill="${STAGE_COLOR[st]}" fill-opacity=".75" font-size="12" font-family="IBM Plex Sans, sans-serif">${st}</text>`).join('');
  const shown = games.filter(g => ['Early Signal', 'Emerging'].includes(g.stage)).length;
  return `<section class="observatory" aria-label="Orbit radar">
    <div class="obs-stage">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" id="orbits" role="img" aria-label="Games arranged on orbits by stage">
        <defs>
          <filter id="soft" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
          <radialGradient id="sun"><stop offset="0" stop-color="#FFF4D6"/><stop offset=".35" stop-color="#FFC266"/><stop offset="1" stop-color="#FF7A6B" stop-opacity="0"/></radialGradient>
        </defs>
        <g transform="rotate(${TILT} ${cx} ${cy})">
          <circle cx="${cx}" cy="${cy}" r="56" fill="url(#sun)" opacity=".55"/>
          <circle cx="${cx}" cy="${cy}" r="9" fill="#FFF4D6"/>
          ${ringSvg}
          ${bodies}
        </g>
      </svg>
      <div class="obs-head"><div><h1>Early discoveries</h1><p>Every rising game on one sky. New signals circle the outer orbit; the closer to the core, the more mainstream. Size shows players right now. Pick a body to inspect it.</p></div></div>
      <div class="obs-legend">${rings.slice().reverse().map(([st]) => `<span style="--c:${STAGE_COLOR[st]}">${st}</span>`).join('')}</div>
      <div class="obs-count"><div class="v">${shown.toLocaleString('en')}</div><div class="l">early games in view</div></div>
    </div>
    <aside class="inspector" id="inspector" aria-live="polite"></aside>
  </section>`;
}

function inspectorHtml(g, names) {
  if (!g) return '<p class="hint">Select a body on the radar to inspect it.</p>';
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  return `<div>${stage(g.stage)}</div>
    <h2>${esc(g.name)}</h2>
    <div class="by">${esc(g.creator)}<br>${esc(g.genre)}${g.subgenre ? ' › ' + esc(g.subgenre) : ''}</div>
    <div class="insp-big"><span class="v">${g.score}</span><span class="muted">Early Trend Score</span></div>
    <dl class="insp-rows">
      ${row('Players now', fmt(g.ccu))}
      ${row('Change, 24 hours', g.change24 == null ? '—' : pct(g.change24))}
      ${row('Growth vs peers', ordinal(g.growthPct) + ' percentile' + (g.growthKind === 'cold-start' ? ' (estimate)' : ''))}
      ${row('Age', g.ageDays + ' days')}
      ${row('Up-and-Coming in', (g.uacCountries || 0) + ' countries')}
      ${row('YouTube, 7 days', g.yt7d == null ? 'not checked' : g.yt7d + ' videos')}
    </dl>
    <div>${g.tags.slice(0, 5).map(t => `<a class="pill tag" href="#/mechanic/${t}">${esc(names[t] || t)}</a>`).join('')}</div>
    <div class="insp-actions"><a class="btn primary" href="#/game/${g.id}">Open analysis</a><a class="btn" href="https://www.roblox.com/games/${g.placeId}" target="_blank" rel="noopener">Play on Roblox</a></div>`;
}

function wireObservatory(games, names) {
  const svg = document.getElementById('orbits'), insp = document.getElementById('inspector');
  if (!svg || !insp) return;
  const byId = new Map(games.map(g => [g.id, g]));
  const select = id => {
    svg.querySelectorAll('.body.sel').forEach(b => b.classList.remove('sel'));
    const el = svg.querySelector(`.body[data-id="${CSS.escape(id)}"]`);
    if (el) el.classList.add('sel');
    insp.innerHTML = inspectorHtml(byId.get(id), names);
  };
  svg.addEventListener('click', e => { const b = e.target.closest('.body'); if (b) select(b.dataset.id); });
  svg.addEventListener('keydown', e => { const b = e.target.closest('.body'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(b.dataset.id); } });
  // Hold still while the pointer is over the sky, so bodies are easy to click.
  if (!REDUCED && svg.pauseAnimations) { svg.addEventListener('mouseenter', () => svg.pauseAnimations()); svg.addEventListener('mouseleave', () => svg.unpauseAnimations()); svg.addEventListener('focusin', () => svg.pauseAnimations()); }
  const first = games.find(g => ['Early Signal', 'Emerging'].includes(g.stage));
  insp.innerHTML = inspectorHtml(first, names);
  if (first) svg.querySelector(`.body[data-id="${CSS.escape(first.id)}"]`)?.classList.add('sel');
}


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

function lineChart(points, { y = 1, label = 'CCU', color = '#9CC8FF' } = {}) {
  if (!points || points.length < 2) return `<div class="note">Not enough history for a chart yet. Each run adds a point; the chart fills in over a few hours.</div>`;
  const W = 900, Hh = 240, L = 44, R = 12, T = 26, B = 26;
  const xs = points.map(p => p[0]), ys = points.map(p => p[y]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMax = Math.max(...ys) * 1.15 || 1;
  const X = t => L + (t - x0) / (x1 - x0 || 1) * (W - L - R), Y = v => Hh - B - v / yMax * (Hh - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[y]).toFixed(1)}`).join('');
  const area = `${line}L${X(x1).toFixed(1)},${Hh - B}L${X(x0).toFixed(1)},${Hh - B}Z`;
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const peak = points.reduce((m, p) => p[y] > m[y] ? p : m, points[0]);
  const grid = [0.25, 0.5, 0.75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(yMax / 1.15 * f)}" y2="${Y(yMax / 1.15 * f)}" stroke="#222C5C" stroke-dasharray="2 4"/><text x="${L - 8}" y="${Y(yMax / 1.15 * f) + 4}" text-anchor="end">${fmt(yMax / 1.15 * f)}</text>`).join('');
  const dl = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  const px = X(peak[0]), py = Y(peak[y]);
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="${esc(label)} over time, peak ${fmt(peak[y])}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>
    <filter id="${id}b" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>
    ${grid}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="5" opacity=".35" filter="url(#${id}b)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8"/>
    <line x1="${px}" x2="${px}" y1="${py}" y2="${Hh - B}" stroke="${color}" stroke-opacity=".5" stroke-dasharray="2 3"/>
    <circle cx="${px}" cy="${py}" r="4" fill="${color}"/><circle cx="${px}" cy="${py}" r="9" fill="${color}" opacity=".25"/>
    <text x="${Math.min(px, W - 90)}" y="${py - 12}" fill="${color}" style="fill:${color}" font-size="12">peak ${fmt(peak[y])}</text>
    <text x="${L}" y="${Hh - 6}">${dl(x0)}</text><text x="${W - R}" y="${Hh - 6}" text-anchor="end">${dl(x1)} · ${esc(label)}</text></svg>`;
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
    setTimeout(() => wireObservatory(games, names), 0);
    return `${observatory(games)}
    ${sum.historyHoursMedian < 48 ? `<div class="note">History so far: about ${sum.historyHoursMedian} hours per game. Growth scores sharpen after 48 hours, and acceleration and consistency after 3 days. Scores marked <span class="label-inf">*</span> are estimates until then.</div>` : ''}
    ${fresh.length ? `<h2>Found in the last 24 hours</h2><div class="fresh">${fresh.map(g => `<a href="#/game/${g.id}">${stage(g.stage)}<div class="nm">${esc(g.name)}</div><div class="mt"><span class="num">${fmt(g.ccu)}</span> players, ${g.ageDays} days old, score <span class="num">${g.score}</span></div></a>`).join('')}</div>` : ''}
    <h2>Ranked by Early Trend Score</h2>
    <p class="sub" style="margin-bottom:14px">Growth against games of the same genre and size, freshness, earliness, engagement, mechanic momentum and discovery-list signals.</p>
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
      <h3>Predictions worth testing</h3>${li(w.predictionsToTest.map(p => `<li>${gl(p)}: ${esc(p.claim)} <span class="muted">(${esc(p.basis)})</span></li>`))}<p class="muted">Tracked automatically on the <a href="#/predictions">Predictions</a> page.</p></div></div></div>` : '';
    return `<h1>Reports</h1><p class="sub">Daily and weekly intelligence summaries. A new daily report is written every day, and the weekly one covers Monday to Sunday. The last 30 daily reports are kept.</p>${daily}${weekly}`;
  },


  async '/predictions'() {
    const p = await load('predictions.json').catch(() => null);
    if (!p) return '<h1>Predictions</h1><p class="muted">No predictions yet. They are made once a day.</p>';
    if (p.error) return `<h1>Predictions</h1><div class="note" style="color:var(--warn)">Prediction tracking failed on the last run: ${esc(p.error.split('\n')[0])}</div>`;
    const a = p.accuracy, wts = p.weights;
    const pc = x => x == null ? '—' : Math.round(x * 100) + '%';
    const res = o => !o ? '<span class="muted">pending</span>' : o.result === 'hit' ? `<span style="color:var(--accent)">hit ×${o.ratio}</span>` : o.result === 'miss' ? `<span style="color:var(--bad)">miss ×${o.ratio}</span>` : '<span class="muted">no data</span>';
    const card = (h, x) => `<div class="card kpi"><div class="l">${h}-day hit rate</div><div class="v">${pc(x.predictedHitRate)}</div><div class="muted" style="font-size:12px">${x.predicted} checked · control ${pc(x.controlHitRate)} (${x.control}) · lift ${x.lift ?? '—'}× · ${x.pending} pending</div></div>`;
    const labels = { growth: 'Growth vs peers', accel: 'Acceleration', consistency: 'Consistency', engage: 'Engagement', fresh: 'Freshness', early: 'Earliness', mechanic: 'Mechanic momentum', disc: 'Discovery & social' };
    return `<h1>Predictions</h1>
    <p class="sub">Every day the radar predicts that its top early games will reach <b>1.5× their average players</b> and checks after 7, 14 and 30 days. A random <b>control</b> group of other games is checked the same way, so a hit rate can be compared with the base rate: <b>lift</b> above 1× means the scores beat chance. Forecasts are evidence, not guarantees.</p>
    <div class="grid">${[7, 14, 30].map(h => card(h, a.horizons[h])).join('')}
      <div class="card kpi"><div class="l">Mechanic predictions (30d)</div><div class="v">${pc(a.mechanics[30].hitRate)}</div><div class="muted" style="font-size:12px">${a.mechanics[30].n} checked · ${a.mechanics[30].pending} pending</div></div>
      <div class="card kpi"><div class="l">Detected early by</div><div class="v">${a.leadTime ? a.leadTime.medianDays + 'd' : '—'}</div><div class="muted" style="font-size:12px">${a.leadTime ? `median over ${a.leadTime.n} games that later went Accelerating/Mainstream (max ${a.leadTime.maxDays}d)` : 'no flagged game has gone mainstream yet'}</div></div>
      <div class="card kpi"><div class="l">Missed trends</div><div class="v">${a.missedCount}</div><div class="muted" style="font-size:12px">grew 2×+ in 14 days without being flagged</div></div></div>
    <div class="two"><div><h2>Calibration (7-day)</h2><p class="muted">Higher score bands should hit more often. If they don't, the weights need work.</p>
      <table><thead><tr><th>Score</th><th class="num">Checked</th><th class="num">Hit rate</th></tr></thead><tbody>${a.calibration.map(c => `<tr><td>${c.bucket}</td><td class="num">${c.n}</td><td class="num">${pc(c.hitRate)}${c.hitRate != null ? bar(c.hitRate * 100) : ''}</td></tr>`).join('')}</tbody></table></div>
    <div><h2>Score weights</h2><p class="muted">Status: <b>${esc(wts.status)}</b>${wts.dataset ? ` · ${wts.dataset.samples}/${wts.dataset.needSamples} labelled samples, ${wts.dataset.hits}/${wts.dataset.needHits} hits` : ''}. Weights only change when the change scores better on held-back data, by at most 3 points a day.</p>
      <table><thead><tr><th>Component</th><th class="num">Default</th><th class="num">Current</th><th class="num">Evidence suggests</th></tr></thead><tbody>${Object.keys(wts.defaults).map(k => `<tr><td>${labels[k] || k}</td><td class="num">${wts.defaults[k]}</td><td class="num">${wts.current[k]}</td><td class="num">${wts.suggested ? wts.suggested[k] : '—'}</td></tr>`).join('')}</tbody></table>
      ${wts.history.length ? `<p class="muted">Last check: ranking quality (AUC) ${wts.history.at(-1).aucBefore} → ${wts.history.at(-1).aucAfter}, ${wts.history.at(-1).accepted ? 'accepted' : 'kept current weights'}.</p>` : ''}</div></div>
    <h2>Today's predictions</h2>${p.open.length ? `<table><thead><tr><th>Game</th><th class="num">Score</th><th>Stage</th><th class="num">Baseline CCU</th><th>Claim</th></tr></thead><tbody>${p.open.map(x => `<tr><td><a href="#/game/${x.id}">${esc(x.name)}</a></td><td class="num">${x.score}</td><td>${stage(x.stage)}</td><td class="num">${fmt(x.baseline)}</td><td>${esc(x.claim)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None today.</p>'}
    <h2>Results</h2>${p.evaluated.length ? `<table><thead><tr><th>Game</th><th>Made</th><th class="num">Score</th><th class="num">Baseline</th><th>7d</th><th>14d</th><th>30d</th></tr></thead><tbody>${p.evaluated.map(x => `<tr><td><a href="#/game/${x.id}">${esc(x.name)}</a></td><td>${x.madeAt.slice(0, 10)}</td><td class="num">${x.score}</td><td class="num">${fmt(x.baseline)}</td><td>${res(x.outcomes[7])}</td><td>${res(x.outcomes[14])}</td><td>${res(x.outcomes[30])}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">First results arrive 7 days after the first predictions.</p>'}
    <div class="two"><div><h2>False positives (14d)</h2>${a.falsePositives.length ? `<table><tbody>${a.falsePositives.map(x => `<tr><td><a href="#/game/${x.id}">${esc(x.name)}</a></td><td class="num">score ${x.score}</td><td class="num">${fmt(x.baseline)} → ${fmt(x.actual)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}</div>
    <div><h2>Missed trends</h2>${p.missed.length ? `<table><tbody>${p.missed.map(x => `<tr><td><a href="#/game/${x.id}">${esc(x.name)}</a></td><td class="num">${fmt(x.from)} → ${fmt(x.to)}</td><td>${x.noticedAt.slice(0, 10)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}</div></div>
    <h2>Mechanic predictions</h2>${p.mechanics.length ? `<table><thead><tr><th>Mechanic</th><th>Made</th><th class="num">Momentum then</th><th>14d</th><th>30d</th></tr></thead><tbody>${p.mechanics.map(x => `<tr><td><a href="#/mechanic/${x.id}">${esc(x.name)}</a></td><td>${x.madeAt.slice(0, 10)}</td><td class="num">${x.momentum}</td><td>${x.outcomes[14] ? (x.outcomes[14].result === 'hit' ? '<span style="color:var(--accent)">hit</span>' : x.outcomes[14].result) : '<span class="muted">pending</span>'}</td><td>${x.outcomes[30] ? (x.outcomes[30].result === 'hit' ? '<span style="color:var(--accent)">hit</span>' : x.outcomes[30].result) : '<span class="muted">pending</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}`;
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
load('summary.json').then(s => { document.getElementById('freshness').innerHTML = `Last scan <b>${ago(s.generatedAt)}</b><br><b>${s.trackedGames.toLocaleString('en')}</b> games tracked`; }).catch(() => {});
route();
