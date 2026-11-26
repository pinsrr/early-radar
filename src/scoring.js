// Early Trend Score (0-100) for games. Built to rank *early* games highest:
// growth relative to peers of the same genre and size, freshness, and being small all matter.
// Every score carries its factor breakdown so the dashboard can explain it.

export const SIZE_BUCKETS = [[0, 100, '<100'], [100, 1000, '100-1k'], [1000, 10000, '1k-10k'], [10000, 100000, '10k-100k'], [100000, Infinity, '100k+']];
export const sizeBucket = ccu => SIZE_BUCKETS.find(([a, b]) => ccu >= a && ccu < b)[2];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sigmoid = x => 1 / (1 + Math.exp(-x));

// Percentile rank of `v` in `arr` (0..1). Null-safe.
export function pctRank(arr, v) {
  const a = arr.filter(x => x != null && Number.isFinite(x));
  if (v == null || a.length < 3) return null;
  let below = 0, eq = 0;
  for (const x of a) { if (x < v) below++; else if (x === v) eq++; }
  return (below + eq / 2) / a.length;
}

// Growth signal for a game: prefers measured 24h growth, falls back to visits growth,
// then to a cold-start estimate (lifetime visits per day for its age).
export function growthSignal(m) {
  if (m.growth24 != null) return { v: m.growth24 + 0.5 * (m.visitsGrowth ?? 0), kind: 'measured', label: '24h avg CCU vs previous 24h' };
  if (m.visitsGrowth != null) return { v: m.visitsGrowth, kind: 'measured', label: 'visits/hour vs previous day' };
  if (m.change['6h']) return { v: Math.log((m.ccu + 5) / (m.change['6h'].from + 5)), kind: 'short', label: 'CCU vs 6h ago (time-of-day noise likely)' };
  return { v: Math.log10(m.visitsPerDayLifetime + 1) - 0.35 * Math.log10(m.ageDays + 1), kind: 'cold-start', label: 'cold start: lifetime visits/day, adjusted for age' };
}

// Peer group = same genre + same size bucket, falling back to size bucket, then everyone.
export function buildPeers(rows) {
  const by = new Map();
  const add = (k, r) => { if (!by.has(k)) by.set(k, []); by.get(k).push(r); };
  for (const r of rows) { add(`g:${r.g.genre}|${sizeBucket(r.m.ccu)}`, r); add(`s:${sizeBucket(r.m.ccu)}`, r); add('all', r); }
  return r => {
    for (const k of [`g:${r.g.genre}|${sizeBucket(r.m.ccu)}`, `s:${sizeBucket(r.m.ccu)}`, 'all']) {
      const p = by.get(k);
      if (p && p.length >= 6) return { key: k.replace(/^[gs]:/, ''), rows: p };
    }
    return { key: 'all', rows: by.get('all') || [] };
  };
}

// Pass 1: components that do not depend on mechanic momentum.
export function baseComponents(r, peersOf, now = Date.now()) {
  const { m, g } = r;
  const peers = peersOf(r);
  const gs = growthSignal(m);
  r.growth = gs;
  // Compare against peers measured the same way (measured vs measured, cold-start vs cold-start).
  const same = peers.rows.filter(p => p.growth?.kind === gs.kind || (!p.growth && growthSignal(p.m).kind === gs.kind)).map(p => (p.growth || growthSignal(p.m)).v);
  const growthPct = pctRank(same, gs.v) ?? sigmoid(gs.v * 2);
  const accel = m.accel != null ? sigmoid(m.accel * 3) : null;
  const engage = [pctRank(peers.rows.map(p => p.m.likeRatio), m.likeRatio), pctRank(peers.rows.map(p => p.m.favPer1kVisits), m.favPer1kVisits), m.sessionMinutes ? pctRank(peers.rows.map(p => p.m.sessionMinutes?.value), m.sessionMinutes.value) : null].filter(x => x != null);
  const age = m.ageDays;
  let fresh = age <= 14 ? 1 : age <= 30 ? 0.85 : age <= 60 ? 0.6 : age <= 120 ? 0.35 : 0.15;
  let revival = false;
  if (age > 120 && m.hoursSinceUpdate != null && m.hoursSinceUpdate < 72 && (m.growth24 ?? 0) > 0.3) { fresh = 0.7; revival = true; }
  const d = m.discovery;
  let disc = clamp(Math.min(1, d.upAndComingCountries / 4) * 0.6 + (d.topTrending ? 0.2 : 0) + (d.firstUpAndComing && now - Date.parse(d.firstUpAndComing) < 2 * 864e5 ? 0.2 : 0));
  // YouTube (when connected and this game was checked): ~30 recent videos = full marks.
  const social = m.social ? clamp(Math.log10(m.social.videos7d + 1) / 1.5) : null;
  if (social != null) disc = 0.65 * disc + 0.35 * social;
  const small = 1 - clamp((Math.log10(m.ccu + 1) - 2) / 3.3);
  const early = small * (growthPct >= 0.5 ? 1 : 0.3);
  r.c = { social, growthPct, accel, consistency: m.consistency ?? null, engage: engage.length ? engage.reduce((a, b) => a + b) / engage.length : null, fresh, revival, disc, early, peerKey: peers.key };
  return r;
}

export const DEFAULT_WEIGHTS = { growth: 25, accel: 10, consistency: 10, engage: 15, fresh: 10, early: 10, mechanic: 10, disc: 10 };
export const COMPONENT_KEYS = Object.keys(DEFAULT_WEIGHTS);

// Component values (0..1, null = not measurable yet) used for scoring and for learning weights.
export function componentVector(r, mechMomentum) {
  const c = r.c;
  const mech = r.tags.length ? Math.max(...r.tags.map(t => (mechMomentum.get(t.id) ?? 0) * (t.confidence === 'low' ? 0.5 : 1))) / 100 : 0;
  return { growth: c.growthPct, accel: c.accel, consistency: c.consistency, engage: c.engage, fresh: c.fresh, early: c.early, mechanic: mech, disc: c.disc };
}

// Pass 2: final score with mechanic momentum, penalties and explanation.
export function finalScore(r, mechMomentum, weights = DEFAULT_WEIGHTS) {
  const W = weights;
  const c = r.c, m = r.m;
  const vec = componentVector(r, mechMomentum);
  r.vec = vec;
  const mech = vec.mechanic;
  const parts = [
    ['Growth vs peers', 'growth', c.growthPct, `${r.growth.label}; ${Math.round(c.growthPct * 100)}th pct in ${c.peerKey}` + (r.growth.kind === 'cold-start' ? ' (estimate until 48h of history)' : '')],
    ['Acceleration', 'accel', c.accel, c.accel == null ? 'needs 72h of history — neutral' : 'growth rate today vs yesterday'],
    ['Consistency', 'consistency', c.consistency, c.consistency == null ? 'needs 3 days — neutral' : `${Math.round(c.consistency * 100)}% of days up`],
    ['Engagement', 'engage', c.engage, 'like ratio, favourites per 1k visits, est. session length vs peers'],
    ['Freshness', 'fresh', c.fresh, c.revival ? 'older game reviving after a recent update' : `${Math.round(m.ageDays)} days old`],
    ['Earliness (small + growing)', 'early', c.early, `${m.ccu.toLocaleString('en')} CCU`],
    ['Mechanic momentum', 'mechanic', mech, r.tags.length ? 'best momentum among its mechanics' : 'no mechanics tagged'],
    ['Discovery lists & social', 'disc', c.disc, `Up-and-Coming in ${m.discovery.upAndComingCountries} countries` + (m.discovery.topTrending ? ', Top Trending' : '') + (m.social ? `; ${m.social.videos7d} YouTube videos in 7 days (${m.social.channels} channels)` : '; YouTube not checked yet')],
  ].map(([name, k, v, note]) => ({ name, max: W[k], points: Math.round(W[k] * (v ?? 0.5) * 10) / 10, neutral: v == null, note }));
  let score = parts.reduce((s, p) => s + p.points, 0);
  const penalties = [];
  for (const f of m.flags) {
    const p = f.type === 'spike' ? 20 : f.type === 'ccu_without_visits' ? 15 : 8;
    penalties.push({ name: f.type, points: -p, note: f.note });
    score -= p;
  }
  r.score = Math.round(clamp(score, 0, 100));
  r.breakdown = { parts, penalties };
  r.stage = classifyGame(r);
  return r;
}

// A game must be this young to count as Early Signal or Emerging: the point is to catch games early.
export const EARLY_MAX_AGE_DAYS = 15;

export function classifyGame(r, maxAge = EARLY_MAX_AGE_DAYS) {
  const { m, score } = r;
  const young = m.ageDays <= maxAge;
  const g = m.growth7d ?? m.growth24;
  if (g != null && g < -0.3 && m.daysOfHistory >= 2) return 'Saturated or Declining';
  if (m.ccu >= 100000 || (m.discovery.topPlaying && m.ccu >= 50000)) return 'Mainstream';
  if (m.ccu >= 20000 && (score >= 55 || (m.growth24 ?? 0) > 0.15)) return 'Accelerating';
  if (young && m.ccu >= 1500 && score >= 50) return 'Emerging';
  if (young && score >= 48) return 'Early Signal';
  return 'Not trending';
}

export const STAGES = ['Early Signal', 'Emerging', 'Accelerating', 'Mainstream', 'Saturated or Declining', 'Not trending'];
