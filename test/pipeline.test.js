// Tests for history-dependent logic. These use SYNTHETIC series (clearly fake numbers)
// only to check the maths; real-data checks run through `npm run fixture`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gameMetrics } from '../src/metrics.js';
import { growthSignal, pctRank, classifyGame } from '../src/scoring.js';
import { tagGame, compileRules, mineNamePatterns } from '../src/mechanics.js';
import fs from 'node:fs';

const H = 36e5;
const now = Date.parse('2026-11-26T00:00:00Z');
const game = { id: '1', created: '2026-11-10T00:00:00Z', firstSeen: '2026-11-12T00:00:00Z' };

// 4 days of half-hourly points with a daily sine cycle; growth factor per day.
function synth(base, dailyGrowth, { spikeAt } = {}) {
  const s = [];
  let visits = 1e6;
  for (let t = now - 96 * H; t <= now; t += H / 2) {
    const day = (t - (now - 96 * H)) / (24 * H);
    let ccu = Math.round(base * dailyGrowth ** day * (1 + 0.3 * Math.sin(t / (24 * H) * 2 * Math.PI)));
    if (spikeAt && Math.abs(t - spikeAt) < H / 4) ccu *= 8;
    visits += ccu * 2;
    s.push([t, ccu, visits, 1000, 100, 10]);
  }
  return s;
}

test('growing game shows positive 24h growth and consistency', () => {
  const m = gameMetrics(game, synth(1000, 1.5), [], now);
  assert.ok(m.growth24 > 0.3, `growth24=${m.growth24}`);
  assert.ok(m.consistency >= 0.99);
  assert.ok(m.visitsGrowth > 0.2);
  assert.equal(growthSignal(m).kind, 'measured');
  assert.ok(m.sessionMinutes.value > 0);
});

test('declining game is classified Saturated or Declining', () => {
  const m = gameMetrics(game, synth(5000, 0.6), [], now);
  assert.ok(m.growth24 < -0.3);
  assert.equal(classifyGame({ m, score: 40 }), 'Saturated or Declining');
});

test('short promo spike is flagged', () => {
  const m = gameMetrics(game, synth(300, 1.0, { spikeAt: now - 30 * H }), [], now);
  assert.ok(m.flags.some(f => f.type === 'spike'), JSON.stringify(m.flags));
});

test('no history falls back to cold-start estimate', () => {
  const m = gameMetrics(game, [[now, 500, 2e6, 3000, 200, 20]], [], now);
  assert.equal(growthSignal(m).kind, 'cold-start');
  assert.equal(m.growth24, null);
});

test('percentile rank', () => {
  assert.equal(pctRank([1, 2, 3, 4], 4), 0.875);
  assert.equal(pctRank([1, 2], 2), null);
});

test('mechanic tagger finds stealing + creature collection', () => {
  const rules = compileRules(JSON.parse(fs.readFileSync(new URL('../config/mechanics.json', import.meta.url))));
  const tags = tagGame({ name: 'Steal An Egg', desc: 'Steal eggs from pets. Hatch eggs to collect rare pets. Upgrade your base.', subgenre: 'Tycoon' }, rules).map(t => t.id);
  for (const id of ['stealing', 'creature_collect', 'base_building']) assert.ok(tags.includes(id), `${id} missing from ${tags}`);
});

test('name patterns need several creators', () => {
  const g = (id, name, creator) => ({ id, name, creator });
  const p = mineNamePatterns([g(1, 'Throw Food For Animals', 'a'), g(2, 'Shoot Arrows For Animals', 'b'), g(3, '[NEW] Kick Balls For Animals!', 'c'), g(4, 'Throw Food For Animals 2', 'a')]);
  assert.ok(p.some(x => x.phrase === 'for animals' && x.games.length === 4), JSON.stringify(p));
});

test('opportunity engine builds three distinct build-next concepts', async () => {
  const { buildOpportunities } = await import('../src/opportunity.js');
  const kb = JSON.parse(fs.readFileSync(new URL('../config/mechanic-kb.json', import.meta.url)));
  const now = Date.parse('2026-11-26T00:00:00Z');
  const mk = (id, tags, genre, creator, ccu, growthPct, ageDays) => ({ id, name: `Game ${id}`, tags, genre, subgenre: '', creator, ccu, growthPct, ageDays, score: growthPct, stage: 'Emerging', created: new Date(now - ageDays * 864e5).toISOString() });
  const games = [
    mk('1', ['stealing', 'creature_collect'], 'Simulation', 'a', 5000, 80, 20), mk('2', ['stealing', 'base_building'], 'Simulation', 'b', 3000, 75, 15),
    mk('3', ['stealing'], 'Action', 'c', 800, 70, 10), mk('4', ['physics'], 'Simulation', 'd', 9000, 85, 25), mk('5', ['physics', 'pvp'], 'Action', 'e', 4000, 80, 12),
    mk('6', ['physics'], 'Sports', 'f', 2000, 78, 30), mk('7', ['creature_collect', 'base_building'], 'Simulation', 'g', 1500, 60, 40),
  ];
  const m = (id, ids, momentum) => ({ id, name: id, games: ids, n: ids.length, creators: ids.length, momentum, stage: 'Emerging', evidence: 'plausible driver', competition: 'Low', bigGames: 0, genreList: ['Simulation', 'Action'], growingGames: ids.length, liftVsWithout: 0.2, opportunity: { strongestPartners: [], untriedPartners: [], risk: '' } });
  const mechanics = [m('stealing', ['1', '2', '3'], 70), m('physics', ['4', '5', '6'], 75), m('creature_collect', ['1', '7', '2'], 60), m('base_building', ['2', '7', '1'], 58)];
  const genres = [{ key: 'Simulation', level: 'genre', n: 5, medianGrowthPct: 70 }, { key: 'Action', level: 'genre', n: 5, medianGrowthPct: 60 }];
  const o = buildOpportunities({ games, mechanics, combos: [], genres, patterns: [], kbConfig: kb, now });
  assert.equal(o.buildNext.length, 3);
  assert.ok(o.cards.every(c => c.concepts.length >= 1));
  assert.ok(o.gaps.untestedCombos.some(u => u.mechanics.includes('physics') && u.mechanics.includes('stealing')));
  for (let i = 1; i < o.buildNext.length; i++) assert.ok(o.buildNext[i - 1].opportunityScore >= o.buildNext[i].opportunityScore);
});
