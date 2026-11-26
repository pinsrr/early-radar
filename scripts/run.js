#!/usr/bin/env node
// One collection + analysis run.
//   node scripts/run.js --store store --out site              live Roblox data
//   node scripts/run.js --store tmp/store --out tmp/site --fixture fixtures/snapshot-A.json
// The fixture mode replays a real captured snapshot so the pipeline can be tested offline.

import fs from 'node:fs';
import path from 'node:path';
import { RobloxClient } from '../src/roblox.js';
import { FixtureClient } from '../src/fixture-client.js';
import { Store } from '../src/store.js';
import { discover, refresh, prune } from '../src/collect.js';
import { compileRules } from '../src/mechanics.js';
import { analyze } from '../src/analyze.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? a.push([x.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] == null ? true : arr[i + 1]]) : 0, a), []));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/discovery.json'), 'utf8'));
const rules = compileRules(JSON.parse(fs.readFileSync(path.join(root, 'config/mechanics.json'), 'utf8')));
const watch = JSON.parse(fs.readFileSync(path.join(root, 'config/watchlist.json'), 'utf8'));
const kb = JSON.parse(fs.readFileSync(path.join(root, 'config/mechanic-kb.json'), 'utf8'));
const store = new Store(args.store || 'store');
const outDir = args.out || 'site';
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });

const client = args.fixture ? new FixtureClient(args.fixture) : new RobloxClient({ gapMs: cfg.requestGapMs });
const nowIso = args.now || client.capturedAt || new Date().toISOString();
const now = Date.parse(nowIso);

const t0 = Date.now();
const reg = store.loadRegistry();
const d = await discover(client, reg, cfg, nowIso);
store.appendCsv('discovery', nowIso, d.listings.map(l => [nowIso, l.id, l.source, l.country, l.rank].join(',')));
const recheckInactive = reg.runs % 48 === 0;
const r = await refresh(client, reg, cfg, nowIso, { recheckInactive });
store.appendCsv('snapshots', nowIso, r.lines);
reg.runs++;
const dropped = prune(reg, store.loadSeries(now - 8 * 864e5), cfg, now);
store.saveRegistry(reg);
store.rollupOld(now);

const runInfo = {
  lastRun: nowIso, mode: args.fixture ? 'fixture replay (real captured data)' : 'live',
  durationSec: Math.round((Date.now() - t0) / 1000),
  listingsSeen: d.listings.length, newGamesFound: d.newGames, gamesPolled: r.polled, gamesRequested: r.requested, droppedInactive: dropped,
  countriesThisRun: d.countries, keywordsThisRun: d.keywords,
  requests: client.stats.requests, failedRequests: client.stats.failures, rateLimited: client.stats.rateLimited, errors: client.stats.errors,
};
const res = analyze({ store, reg, rules, watch, now, outDir, runInfo, kb });
for (const f of fs.readdirSync(path.join(root, 'dashboard'))) fs.copyFileSync(path.join(root, 'dashboard', f), path.join(outDir, f));
console.log(JSON.stringify({ ...runInfo, errors: runInfo.errors.length, analysed: res.games, mechanics: res.mechanics, newAlerts: res.newAlerts }));
if (r.polled === 0 && !args.fixture) { console.error('No games polled: Roblox API unreachable or blocked.'); process.exit(1); }
