// Runs the full analysis over stored history and writes the dashboard's JSON files.

import fs from 'node:fs';
import path from 'node:path';
import { gameMetrics, chartSeries } from './metrics.js';
import { buildPeers, baseComponents, finalScore, STAGES } from './scoring.js';
import { tagGame, mineNamePatterns } from './mechanics.js';
import { mechanicStats, comboStats, genreStats, patternStats, opportunityNotes } from './momentum.js';
import { makeAlerts } from './alerts.js';
import { buildOpportunities, competitorsFor } from './opportunity.js';

const D = 864e5;
const r2 = x => x == null ? null : Math.round(x * 100) / 100;

export function analyze({ store, reg, rules, watch, now, outDir, runInfo, kb }) {
  const series = store.loadSeries(now - 31 * D);
  const listings = store.loadDiscovery(now - 31 * D);
  const rows = [];
  for (const g of Object.values(reg.games)) {
    const s = series.get(g.id);
    if (!g.active || !s?.length || !g.created) continue;
    rows.push({ g, m: gameMetrics(g, s, listings.get(g.id) || [], now), tags: tagGame(g, rules) });
  }
  const peersOf = buildPeers(rows);
  for (const r of rows) baseComponents(r, peersOf, now);
  const momentum = new Map(mechanicStats(rows, rules, now).map(m => [m.id, m.momentum]));
  for (const r of rows) finalScore(r, momentum);
  const mechanics = mechanicStats(rows, rules, now);
  const mechNames = Object.fromEntries(rules.mechanics.map(m => [m.id, m.name]));
  const combos = comboStats(rows, mechNames, now);
  for (const m of mechanics) m.opportunity = opportunityNotes(m, combos, mechNames);
  const genres = genreStats(rows, now);
  const patterns = patternStats(rows, mineNamePatterns(rows.map(r => r.g)));

  const games = rows.map(r => ({
    id: r.g.id, placeId: r.g.placeId, name: r.g.name, creator: r.g.creator, genre: r.g.genre, subgenre: r.g.subgenre,
    created: r.g.created, updated: r.g.updated, firstSeen: r.g.firstSeen, discoveredVia: r.g.discoveredVia,
    ccu: r.m.ccu, visits: r.m.visits, favorites: r.m.favorites, likeRatio: r2(r.m.likeRatio), ageDays: Math.round(r.m.ageDays * 10) / 10,
    change1h: r2(r.m.change['1h']?.pct), change6h: r2(r.m.change['6h']?.pct), change24: r2(r.m.change['24h']?.pct), change7d: r2(r.m.change['7d']?.pct),
    growth24: r2(r.m.growth24), visitsPerHour: r.m.visitsPerHour == null ? null : Math.round(r.m.visitsPerHour),
    growthKind: r.growth.kind, growthPct: Math.round(r.c.growthPct * 100), peerKey: r.c.peerKey,
    score: r.score, stage: r.stage, tags: r.tags.map(t => t.id), flags: r.m.flags.map(f => f.type),
    uacCountries: r.m.discovery.upAndComingCountries, uacRank: r.m.discovery.bestUpAndComingRank, history: Math.round(r.m.historyHours),
  })).sort((a, b) => b.score - a.score);

  // Phase 3: gaps, concepts, competitor clusters. Also attaches adoption timelines to mechanics.
  // Wrapped: a bug here must never stop collection or the rest of the dashboard.
  let opportunities = null;
  try { if (kb) opportunities = buildOpportunities({ games, mechanics, combos, genres, patterns, kbConfig: kb, now }); }
  catch (e) { console.error('[opportunities] failed:', e); opportunities = { error: String(e?.stack || e), generatedAt: new Date(now).toISOString() }; }
  const safeCompetitors = id => { try { return competitorsFor(games.find(x => x.id === id), games); } catch { return []; } };

  const prev = store.readJson('state.json', {});
  const newAlerts = makeAlerts({ games, mechanics, combos, prev, watch, nowIso: new Date(now).toISOString() });
  const alerts = [...newAlerts, ...(prev.alerts || [])].slice(0, 400);

  // Per-game detail files for the Game Analysis page.
  const gdir = path.join(outDir, 'data', 'game');
  fs.mkdirSync(gdir, { recursive: true });
  for (const r of rows) {
    fs.writeFileSync(path.join(gdir, `${r.g.id}.json`), JSON.stringify({
      meta: { ...r.g, sources: undefined, sourceCounts: r.g.sources },
      metrics: { ...r.m, discovery: r.m.discovery },
      tags: r.tags, breakdown: r.breakdown, score: r.score, stage: r.stage, peerKey: r.c.peerKey,
      competitors: safeCompetitors(r.g.id),
      chart: chartSeries(series.get(r.g.id), now),
      listings: (listings.get(r.g.id) || []).slice(-200),
    }));
  }

  const stageCounts = Object.fromEntries(STAGES.map(s => [s, games.filter(g => g.stage === s).length]));
  const hist = games.map(g => g.history).sort((a, b) => a - b);
  const summary = {
    generatedAt: new Date(now).toISOString(),
    trackedGames: games.length, registryGames: Object.keys(reg.games).length, runs: reg.runs,
    stageCounts,
    historyHoursMedian: hist.length ? hist[hist.length >> 1] : 0,
    dataQuality: {
      ...runInfo,
      note: 'All player, visit, favourite and vote numbers are observed from public Roblox endpoints at collection time. Growth needs our own history: anything marked cold-start is an estimate until 48h of snapshots exist. Session length is inferred. Retention and revenue are not available from public sources and are not shown.',
      baselineNote: 'Peer and "without mechanic" baselines use games this tracker has discovered, which leans toward listed and searchable games — not all of Roblox.',
    },
  };

  const dataDir = path.join(outDir, 'data');
  const w = (n, o) => fs.writeFileSync(path.join(dataDir, n), JSON.stringify(o));
  w('summary.json', summary);
  w('games.json', games);
  w('mechanics.json', mechanics);
  w('combos.json', combos);
  w('genres.json', genres);
  w('patterns.json', patterns);
  w('alerts.json', alerts);
  w('mechanic-names.json', mechNames);
  if (opportunities) w('opportunities.json', opportunities);

  store.writeJson('state.json', {
    at: summary.generatedAt,
    games: games.map(g => ({ id: g.id, stage: g.stage, score: g.score })),
    mechanics: mechanics.map(m => ({ id: m.id, momentum: m.momentum, genreList: m.genreList })),
    combos: combos.map(c => ({ id: c.id, growingGames: c.growingGames })),
    alerts,
  });
  return { summary, newAlerts: newAlerts.length, games: games.length, mechanics: mechanics.length };
}
