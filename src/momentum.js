// Mechanic Momentum Score (0-100), mechanic combinations, genre trends and name patterns.
//
// Correlation vs cause: a mechanic is only labelled a "plausible driver" when games using it
// out-grow games WITHOUT it in the same genres, across several independent creators and
// several genres. Otherwise the label is "correlation only" or "insufficient data".

const median = a => { const s = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const D = 864e5;

// Growth on a common 0..1 scale: percentile vs peers from scoring pass 1.
const gp = r => r.c.growthPct;
const isGrowing = r => gp(r) >= 0.65;
const isBig = r => r.m.ccu >= 50000;

function genreBaselines(rows, has) {
  const by = new Map();
  for (const r of rows) if (!has(r)) { if (!by.has(r.g.genre)) by.set(r.g.genre, []); by.get(r.g.genre).push(gp(r)); }
  const all = median(rows.filter(r => !has(r)).map(gp));
  return genre => median(by.get(genre) || []) ?? all ?? 0.5;
}

export function scoreGroup(rows, members, has, now, opts = {}) {
  const n = members.length;
  const base = genreBaselines(rows, has);
  const lift = median(members.map(r => gp(r) - base(r.g.genre)));
  const creators = new Set(members.map(r => r.g.creator)).size;
  const recentShare = n ? members.filter(r => r.m.ageDays <= 60).length / n : 0;
  const growing = members.filter(isGrowing);
  const genresGrowing = new Set(growing.map(r => r.g.genre)).size;
  const genresAll = new Set(members.map(r => r.g.genre)).size;
  const big = members.filter(isBig).length;
  const saturation = clamp(big / 6 + (n > 40 ? (n - 40) / 80 : 0));
  const f = {
    adoption: clamp(Math.log(n + 1) / Math.log(41)),
    growth: median(members.map(gp)) ?? 0,
    independent: n ? clamp(creators / n) * clamp(creators / 5) : 0,
    recency: recentShare,
    acceleration: median(members.map(r => r.c.accel)) ?? 0.5,
    lift: lift == null ? 0.5 : sigmoid(lift * 6),
    retention: median(members.map(r => r.c.engage)) ?? 0.5,
    crossGenre: clamp(genresGrowing / 4),
    unsaturated: 1 - saturation,
  };
  const W = { adoption: 8, growth: 18, independent: 8, recency: 10, acceleration: 8, lift: 16, retention: 10, crossGenre: 12, unsaturated: 10 };
  const factors = Object.entries(W).map(([k, w]) => ({ key: k, max: w, points: Math.round(w * f[k] * 10) / 10 }));
  factors.push({ key: 'social', max: 0, points: 0, note: 'YouTube/TikTok signals not connected yet (Phase 4)' });
  // Small-sample shrinkage: one or two games cannot make a trend.
  const shrink = Math.sqrt(clamp(n / 4));
  if (shrink < 1) factors.push({ key: 'sampleSize', max: 0, points: 0, note: `only ${n} game(s): score scaled by ${shrink.toFixed(2)}` });
  const momentum = Math.round(factors.reduce((s, x) => s + x.points, 0) * shrink);
  const history = median(members.map(r => r.m.daysOfHistory)) ?? 0;
  const evidence = n < 3 ? 'insufficient data'
    : n >= 4 && creators >= 3 && genresAll >= 2 && lift > 0.1 && growing.length / n >= 0.4 ? 'plausible driver'
    : 'correlation only';
  // Confidence also depends on how much measured history exists (cold-start data is weak).
  const confidence = evidence === 'plausible driver' ? (history >= 3 ? 'High' : history >= 1 ? 'Medium' : 'Low') : n >= 5 && history >= 3 ? 'Medium' : 'Low';
  const stage = n < 3 ? 'Insufficient data'
    : big >= 3 && f.growth < 0.45 ? 'Saturated or Declining'
    : big >= 3 ? 'Mainstream'
    : momentum >= 60 && recentShare >= 0.5 ? (n <= 6 ? 'Early Signal' : 'Emerging')
    : momentum >= 68 ? 'Accelerating'
    : momentum >= 50 ? 'Emerging' : 'Quiet';
  const competition = n <= 5 && big === 0 ? 'Low' : n <= 12 && big <= 1 ? 'Low to moderate' : big <= 3 ? 'Moderate' : 'High';
  const direction = f.acceleration > 0.58 ? 'Accelerating' : f.acceleration < 0.42 ? 'Slowing' : f.growth > 0.6 ? 'Growing' : 'Flat';
  return {
    momentum, factors, evidence, confidence, stage, competition, direction,
    n, creators, genres: genresAll, genresGrowing, growingGames: growing.length, bigGames: big,
    liftVsWithout: lift == null ? null : Math.round(lift * 100) / 100,
    games: members.sort((a, b) => b.score - a.score).map(r => r.g.id),
    medianCcu: median(members.map(r => r.m.ccu)),
    totalCcu: members.reduce((s, r) => s + r.m.ccu, 0),
    newestCreated: members.map(r => r.g.created).sort().at(-1),
  };
}

export function mechanicStats(rows, rules, now) {
  const out = [];
  for (const mech of rules.mechanics) {
    const has = r => r.tags.some(t => t.id === mech.id && t.confidence !== 'low');
    const members = rows.filter(has);
    if (!members.length) continue;
    const s = scoreGroup(rows, members, has, now);
    // Spread timeline: when did the mechanic first appear in each genre (by game creation date)?
    const first = new Map();
    for (const r of [...members].sort((a, b) => (a.g.created || '').localeCompare(b.g.created || ''))) if (!first.has(r.g.genre)) first.set(r.g.genre, { genre: r.g.genre, game: r.g.id, name: r.g.name, created: r.g.created });
    out.push({ id: mech.id, name: mech.name, ...s, spread: [...first.values()], genreList: [...new Set(members.map(r => r.g.genre))] });
  }
  return out.sort((a, b) => b.momentum - a.momentum);
}

export function comboStats(rows, mechNames, now) {
  const pairs = new Map();
  for (const r of rows) {
    const ids = r.tags.filter(t => t.confidence !== 'low').map(t => t.id).sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] + '+' + ids[j];
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(r);
    }
  }
  const out = [];
  for (const [k, members] of pairs) {
    if (members.length < 3) continue;
    const [a, b] = k.split('+');
    const has = r => { const ids = r.tags.filter(t => t.confidence !== 'low').map(t => t.id); return ids.includes(a) && ids.includes(b); };
    const s = scoreGroup(rows, members, has, now);
    out.push({ id: k, mechanics: [a, b], name: `${mechNames[a]} + ${mechNames[b]}`, ...s, whiteSpace: s.momentum >= 58 && s.n <= 8 && s.bigGames === 0 });
  }
  return out.sort((x, y) => y.momentum - x.momentum).slice(0, 80);
}

export function genreStats(rows, now) {
  const groups = new Map();
  for (const r of rows) for (const [key, level] of [[r.g.genre || 'Unknown', 'genre'], [r.g.subgenre ? `${r.g.genre} › ${r.g.subgenre}` : null, 'subgenre']]) {
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, level, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()].filter(x => x.rows.length >= 3).map(x => ({
    key: x.key, level: x.level, n: x.rows.length,
    totalCcu: x.rows.reduce((s, r) => s + r.m.ccu, 0),
    medianGrowthPct: Math.round((median(x.rows.map(gp)) ?? 0) * 100),
    growingShare: x.rows.filter(isGrowing).length / x.rows.length,
    newShare: x.rows.filter(r => r.m.ageDays <= 60).length / x.rows.length,
    earlyGames: x.rows.filter(r => ['Early Signal', 'Emerging'].includes(r.stage)).length,
    topGames: [...x.rows].sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.g.id),
  })).sort((a, b) => b.medianGrowthPct - a.medianGrowthPct);
}

export function patternStats(rows, patterns) {
  const byId = new Map(rows.map(r => [r.g.id, r]));
  return patterns.map(p => {
    const ms = p.games.map(id => byId.get(id)).filter(Boolean);
    return {
      phrase: p.phrase, n: ms.length, creators: p.creators,
      medianGrowthPct: Math.round((median(ms.map(gp)) ?? 0) * 100),
      newShare: ms.filter(r => r.m.ageDays <= 60).length / Math.max(1, ms.length),
      totalCcu: ms.reduce((s, r) => s + r.m.ccu, 0),
      games: ms.sort((a, b) => b.score - a.score).map(r => r.g.id),
    };
  }).filter(p => p.n >= 3).sort((a, b) => (b.medianGrowthPct * (0.5 + b.newShare)) - (a.medianGrowthPct * (0.5 + a.newShare)));
}

// Plain-language opportunity notes for an emerging mechanic (template, not AI).
export function opportunityNotes(mech, combos, mechNames) {
  const partners = combos.filter(c => c.mechanics.includes(mech.id)).sort((a, b) => b.momentum - a.momentum);
  const untried = Object.keys(mechNames).filter(id => id !== mech.id && !partners.some(c => c.mechanics.includes(id)));
  const best = partners.slice(0, 3).map(c => mechNames[c.mechanics.find(x => x !== mech.id)]);
  return {
    strongestPartners: best,
    untriedPartners: untried.slice(0, 6).map(id => mechNames[id]),
    risk: mech.competition === 'High' ? 'Crowded: many large games already use this; differentiate hard.' : mech.evidence !== 'plausible driver' ? 'Evidence is still thin: growth may come from other factors (theme, creator promotion).' : 'Signal is real but young: prototype small and watch whether it keeps growing.',
  };
}
