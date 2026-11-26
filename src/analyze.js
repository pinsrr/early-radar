// Runs the full analysis over stored history and writes the dashboard's JSON files.

import fs from 'node:fs';
import path from 'node:path';
import { gameMetrics, chartSeries } from './metrics.js';
import { buildPeers, baseComponents, finalScore, STAGES, DEFAULT_WEIGHTS } from './scoring.js';
import { makeDailyPredictions, evaluate, accuracy, learnWeights } from './predict.js';
import { tagGame, mineNamePatterns } from './mechanics.js';
import { mechanicStats, comboStats, genreStats, patternStats, opportunityNotes } from './momentum.js';
import { makeAlerts } from './alerts.js';
import { buildOpportunities, competitorsFor } from './opportunity.js';
import { updateTrendHistory, dailyReport, weeklyReport, publishReports } from './reports.js';
import { socialTiming } from './youtube.js';

const D = 864e5;
const r2 = x => x == null ? null : Math.round(x * 100) / 100;

export function analyze({ store, reg, rules, watch, now, outDir, runInfo, kb, socialInfo }) {
  const series = store.loadSeries(now - 31 * D);
  const listings = store.loadDiscovery(now - 31 * D);
  const rows = [];
  for (const g of Object.values(reg.games)) {
    const s = series.get(g.id);
    if (!g.active || !s?.length || !g.created) continue;
    rows.push({ g, m: gameMetrics(g, s, listings.get(g.id) || [], now), tags: tagGame(g, rules) });
  }
  const social = store.readJson('social.json', {});
  const yt = social.youtube || {};
  for (const r of rows) {
    const h = yt[r.g.id];
    if (h?.length) { const last = h.at(-1); r.m.social = { ...last, checks: h.length, prevVideos48h: h.length > 1 ? h.at(-2).videos48h : null, history: h.map(x => [x.t, x.videos7d, x.videos48h, x.views7d]) }; }
  }
  const peersOf = buildPeers(rows);
  for (const r of rows) baseComponents(r, peersOf, now);
  const momentum = new Map(mechanicStats(rows, rules, now).map(m => [m.id, m.momentum]));
  // Phase 5: score weights learned from real outcomes (defaults until enough evidence exists).
  const weightState = store.readJson('weights.json', null);
  const W = weightState?.weights || DEFAULT_WEIGHTS;
  for (const r of rows) finalScore(r, momentum, W);
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
    yt7d: r.m.social?.videos7d ?? null, yt48h: r.m.social?.videos48h ?? null, ytChannels: r.m.social?.channels ?? null,
  })).sort((a, b) => b.score - a.score);

  // Phase 3: gaps, concepts, competitor clusters. Also attaches adoption timelines to mechanics.
  // Wrapped: a bug here must never stop collection or the rest of the dashboard.
  let opportunities = null;
  try { if (kb) opportunities = buildOpportunities({ games, mechanics, combos, genres, patterns, kbConfig: kb, now }); }
  catch (e) { console.error('[opportunities] failed:', e); opportunities = { error: String(e?.stack || e), generatedAt: new Date(now).toISOString() }; }
  const safeCompetitors = id => { try { return competitorsFor(games.find(x => x.id === id), games); } catch { return []; } };

  // Phase 4: does social interest lead or follow player growth? (daily average CCU per YouTube-checked game)
  const dailyCcu = new Map();
  for (const id of Object.keys(yt)) {
    const by = new Map();
    for (const r of series.get(id) || []) { const d = Math.floor(r[0] / D) * D; const e = by.get(d) || [0, 0]; e[0] += r[1]; e[1]++; by.set(d, e); }
    dailyCcu.set(id, [...by].sort((a, b) => a[0] - b[0]).map(([d, [sum, n]]) => [d, sum / n]));
  }
  const timing = socialTiming(yt, dailyCcu);

  // Phase 4: daily + weekly reports (wrapped so a report bug never breaks collection).
  try {
    const h = updateTrendHistory(store, now, { games, mechanics, combos, genres });
    const today = new Date(now).toISOString().slice(0, 10);
    const ctx = { now, h, games, mechanics, combos, genres, opportunities: opportunities?.error ? null : opportunities, clusters: opportunities?.clusters, timing, newGamesToday: games.filter(g => (g.firstSeen || '').slice(0, 10) === today).length };
    publishReports(store, outDir, dailyReport(ctx), weeklyReport(ctx));
  } catch (e) { console.error('[reports] failed:', e); }

  // Phase 5: predictions + backtesting + weight tuning (wrapped: never breaks collection).
  let predictionsOut = null;
  try {
    const { P, created } = makeDailyPredictions(store, { now, rows, games, mechanics });
    evaluate(P, { now, series, reg, games, mechanics });
    store.writeJson('predictions.json', P);
    const ws = learnWeights(store, { now, series });
    const latestDay = P.games.length ? P.games.at(-1).madeAt.slice(0, 10) : null;
    predictionsOut = {
      generatedAt: new Date(now).toISOString(), createdThisRun: created, accuracy: accuracy(P),
      open: P.games.filter(p => p.group === 'predicted' && p.madeAt.slice(0, 10) === latestDay),
      evaluated: P.games.filter(p => p.group === 'predicted' && Object.keys(p.outcomes).length).slice(-150).reverse(),
      mechanics: P.mechanics.slice(-60).reverse(), leads: P.leads.slice(-50).reverse(), missed: P.missed.slice(-50).reverse(),
      weights: { current: ws.weights, defaults: DEFAULT_WEIGHTS, status: ws.status || 'collecting outcomes', dataset: ws.dataset, suggested: ws.suggested || null, history: ws.history || [] },
    };
  } catch (e) { console.error('[predictions] failed:', e); predictionsOut = { error: String(e?.stack || e) }; }

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
    social: { youtube: socialInfo || { status: 'not connected' }, youtubeGamesTracked: Object.keys(yt).length, tiktok: 'unavailable: no public API', timing },
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
  if (predictionsOut) w('predictions.json', predictionsOut);

  store.writeJson('state.json', {
    at: summary.generatedAt,
    games: games.map(g => ({ id: g.id, stage: g.stage, score: g.score })),
    mechanics: mechanics.map(m => ({ id: m.id, momentum: m.momentum, genreList: m.genreList })),
    combos: combos.map(c => ({ id: c.id, growingGames: c.growingGames })),
    alerts,
  });
  return { summary, newAlerts: newAlerts.length, games: games.length, mechanics: mechanics.length };
}
