// Daily and weekly intelligence reports.
// A compact trend snapshot is saved once per day (overwritten by later runs that day) so reports can
// say what changed since yesterday and since last week.

import fs from 'node:fs';
import path from 'node:path';

const D = 864e5;
const day = t => new Date(t).toISOString().slice(0, 10);

export function updateTrendHistory(store, now, { games, mechanics, combos, genres }) {
  const h = store.readJson('trend-history.json', { days: {} });
  h.days[day(now)] = {
    mechanics: Object.fromEntries(mechanics.map(m => [m.id, [m.momentum, m.genres, m.n, m.stage]])),
    games: Object.fromEntries(games.slice(0, 400).map(g => [g.id, [g.score, g.stage, g.ccu]])),
    combos: Object.fromEntries(combos.map(c => [c.id, [c.n, c.growingGames]])),
    genres: Object.fromEntries(genres.filter(g => g.level === 'genre').map(g => [g.key, [g.medianGrowthPct, g.n]])),
  };
  for (const k of Object.keys(h.days)) if (Date.parse(k) < now - 60 * D) delete h.days[k];
  store.writeJson('trend-history.json', h);
  return h;
}

function pastDay(h, now, daysBack) {
  // Closest stored day at least `daysBack` days ago (within 2 extra days).
  for (let i = daysBack; i <= daysBack + 2; i++) { const k = day(now - i * D); if (h.days[k]) return { date: k, ...h.days[k] }; }
  return null;
}

const g5 = g => ({ id: g.id, name: g.name, ccu: g.ccu, score: g.score, stage: g.stage, change24: g.change24, genre: g.genre, ageDays: g.ageDays });

export function dailyReport({ now, h, games, mechanics, combos, opportunities, clusters, timing, newGamesToday }) {
  const y = pastDay(h, now, 1);
  const early = games.filter(g => ['Early Signal', 'Emerging'].includes(g.stage)).slice(0, 5).map(g5);
  const mechs = mechanics.filter(m => m.stage !== 'Insufficient data').slice(0, 5).map(m => ({ id: m.id, name: m.name, momentum: m.momentum, stage: m.stage, change: y?.mechanics[m.id] ? m.momentum - y.mechanics[m.id][0] : null, n: m.n, evidence: m.evidence }));
  const unusual = games.filter(g => g.change24 != null && g.change24 >= 0.5 && g.ccu >= 200).sort((a, b) => b.change24 - a.change24).slice(0, 8).map(g => ({ ...g5(g), flags: g.flags }));
  const outgrowers = (clusters || []).flatMap(c => c.outgrowers.map(o => ({ ...o, group: c.name, leader: c.leader?.name }))).slice(0, 6);
  const newCombos = y ? combos.filter(c => c.n >= 3 && (!y.combos[c.id] || y.combos[c.id][0] < 3)).slice(0, 6).map(c => ({ id: c.id, name: c.name, n: c.n, growing: c.growingGames, momentum: c.momentum })) : null;
  const changes = [];
  if (y) {
    for (const g of games.slice(0, 400)) { const p = y.games[g.id]; if (p && p[1] !== g.stage && g.stage !== 'Not trending') changes.push({ kind: 'game', id: g.id, name: g.name, from: p[1], to: g.stage }); }
    for (const m of mechanics) { const p = y.mechanics[m.id]; if (p && Math.abs(m.momentum - p[0]) >= 8) changes.push({ kind: 'mechanic', id: m.id, name: m.name, from: p[0], to: m.momentum }); }
  }
  return {
    type: 'daily', date: day(now), generatedAt: new Date(now).toISOString(), comparedWith: y?.date || null,
    emergingGames: early, trendingMechanics: mechs, unusualGrowth: unusual, outgrowers,
    newCombinations: newCombos, changes: changes.slice(0, 15), newGamesToday,
    opportunities: (opportunities?.buildNext || []).map(c => ({ id: c.id, title: c.title, score: c.opportunityScore, pitch: c.pitch, mechanics: c.mechanics })),
    social: timing,
  };
}

export function weeklyReport({ now, h, games, mechanics, genres, opportunities, clusters }) {
  const w = pastDay(h, now, 7);
  const gen = genres.filter(g => g.level === 'genre' && g.n >= 5).map(g => ({ key: g.key, n: g.n, medianGrowthPct: g.medianGrowthPct, change: w?.genres[g.key] ? g.medianGrowthPct - w.genres[g.key][0] : null }))
    .sort((a, b) => (b.change ?? b.medianGrowthPct / 10) - (a.change ?? a.medianGrowthPct / 10)).slice(0, 6);
  const mech = mechanics.filter(m => m.n >= 3).map(m => ({ id: m.id, name: m.name, momentum: m.momentum, stage: m.stage, change: w?.mechanics[m.id] ? m.momentum - w.mechanics[m.id][0] : null, genres: m.genres, genresBefore: w?.mechanics[m.id]?.[1] ?? null }));
  const fastest = [...mech].sort((a, b) => (b.change ?? b.momentum / 10) - (a.change ?? a.momentum / 10)).slice(0, 6);
  const spreading = mech.filter(m => m.genresBefore != null ? m.genres > m.genresBefore : m.genres >= 3).sort((a, b) => (b.genres - (b.genresBefore ?? 0)) - (a.genres - (a.genresBefore ?? 0))).slice(0, 6);
  const saturating = [
    ...mechanics.filter(m => ['Mainstream', 'Saturated or Declining'].includes(m.stage)).map(m => ({ id: m.id, name: m.name, why: `${m.stage}: ${m.bigGames} games over 50k CCU` })),
    ...(opportunities?.gaps?.crowding || []).map(c => ({ id: c.mechanic, name: c.name, why: `${c.newEntrants30} new games in 30 days (vs ${c.prev30})` })),
  ].slice(0, 8);
  const competitor = [...(clusters || [])].sort((a, b) => b.entrants30 - a.entrants30 || b.outgrowers.length - a.outgrowers.length).slice(0, 6)
    .map(c => ({ name: c.name, entrants30: c.entrants30, competition: c.competition, leader: c.leader?.name, outgrowers: c.outgrowers.map(o => o.name) }));
  const predictions = games.filter(g => ['Early Signal', 'Emerging'].includes(g.stage) && g.score >= 60).slice(0, 5)
    .map(g => ({ id: g.id, name: g.name, claim: `Average CCU grows at least 50% within 7 days (now ${g.ccu.toLocaleString('en')})`, basis: `Early Trend Score ${g.score}, ${g.stage}` }));
  const buildNext = (opportunities?.buildNext || []).map((c, i) => ({
    rank: i + 1, id: c.id, title: c.title, pitch: c.pitch, mechanics: c.mechanics, score: c.opportunityScore,
    ranking: { evidence: c.scoreParts.demand + '/40', competition: c.scoreParts.gap + '/30 (higher = less competition)', feasibility: c.scoreParts.feasibility + '/20', potential: c.scoreParts.multiplayer + '/10 multiplayer' },
  }));
  return {
    type: 'weekly', date: day(now), generatedAt: new Date(now).toISOString(), comparedWith: w?.date || null,
    note: w ? null : 'First week: no snapshot from 7 days ago yet, so changes are shown as current rankings.',
    fastestGenres: gen, fastestMechanics: fastest, spreadingMechanics: spreading,
    underserved: { untestedCombos: (opportunities?.gaps?.untestedCombos || []).slice(0, 5), unspread: (opportunities?.gaps?.unspreadMechanics || []).slice(0, 5) },
    competitorActivity: competitor, saturating, predictionsToTest: predictions, whatIWouldBuildNext: buildNext,
  };
}

// Saves today's reports into the store and publishes the archive to the site.
export function publishReports(store, outDir, daily, weekly) {
  const rdir = store.p('reports');
  fs.mkdirSync(rdir, { recursive: true });
  fs.writeFileSync(path.join(rdir, `daily-${daily.date}.json`), JSON.stringify(daily));
  const monday = new Date(Date.parse(weekly.date) - ((new Date(weekly.date).getUTCDay() + 6) % 7) * D).toISOString().slice(0, 10);
  weekly.weekOf = monday;
  fs.writeFileSync(path.join(rdir, `weekly-${monday}.json`), JSON.stringify(weekly));
  const files = fs.readdirSync(rdir).filter(f => f.endsWith('.json')).sort().reverse();
  for (const f of files.filter(f => f.startsWith('daily-')).slice(30)) fs.unlinkSync(path.join(rdir, f));
  const keep = fs.readdirSync(rdir).filter(f => f.endsWith('.json')).sort().reverse();
  const odir = path.join(outDir, 'data', 'reports');
  fs.mkdirSync(odir, { recursive: true });
  for (const f of keep) fs.copyFileSync(path.join(rdir, f), path.join(odir, f));
  fs.writeFileSync(path.join(odir, 'index.json'), JSON.stringify({ daily: keep.filter(f => f.startsWith('daily-')), weekly: keep.filter(f => f.startsWith('weekly-')) }));
}
