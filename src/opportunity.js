// Phase 3: opportunity detection, market gaps, competitor tracking and concept generation.
// Works on the analysed game/mechanic/combo/genre/pattern lists (the same shapes the dashboard reads),
// so it has no Node-only dependencies.
//
// Concepts are rule-based: they combine an emerging mechanic with a partner mechanic, a target genre
// and a theme, then check how many tracked games already do the same thing. They are starting points
// for original designs, not predictions.

const D = 864e5;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const median = a => { const s = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const pairKey = (a, b) => [a, b].sort().join('+');
const EARLY = ['Early Signal', 'Emerging', 'Accelerating'];

// ---------- adoption & competition over time (from game creation dates: observed) ----------
export function adoption(mech, gamesById, now) {
  const gs = mech.games.map(id => gamesById.get(id)).filter(Boolean);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, games: gs.filter(g => (g.created || '').slice(0, 7) === key).length });
  }
  const age = g => (now - Date.parse(g.created)) / D;
  const last30 = gs.filter(g => age(g) <= 30).length, prev30 = gs.filter(g => age(g) > 30 && age(g) <= 60).length;
  return { months, newEntrants30: last30, newEntrantsPrev30: prev30, entrantTrend: last30 > prev30 * 1.3 + 1 ? 'Rising' : last30 < prev30 * 0.7 ? 'Falling' : 'Steady' };
}

// ---------- market gaps ----------
export function marketGaps({ games, mechanics, combos, genres }) {
  const mm = new Map(mechanics.map(m => [m.id, m]));
  const comboN = new Map(combos.map(c => [c.id, c.n]));
  const pairCount = new Map();
  for (const g of games) for (let i = 0; i < g.tags.length; i++) for (let j = i + 1; j < g.tags.length; j++) { const k = pairKey(g.tags[i], g.tags[j]); pairCount.set(k, (pairCount.get(k) || 0) + 1); }

  // 1. Untested pairs: both mechanics have momentum, almost nobody combines them.
  const strong = mechanics.filter(m => m.momentum >= 55 && m.n >= 3);
  const untested = [];
  for (let i = 0; i < strong.length; i++) for (let j = i + 1; j < strong.length; j++) {
    const a = strong[i], b = strong[j], k = pairKey(a.id, b.id), n = pairCount.get(k) || 0;
    if (n <= 2) untested.push({ id: k, mechanics: [a.id, b.id], name: `${a.name} + ${b.name}`, existingGames: n, demand: Math.round((a.momentum + b.momentum) / 2), note: n === 0 ? 'No tracked game combines these yet' : `Only ${n} tracked game(s) combine these` });
  }
  untested.sort((x, y) => y.demand - x.demand || x.existingGames - y.existingGames);

  // 2. Unspread mechanics: growing mechanic missing from a growing genre.
  const genreRows = genres.filter(g => g.level === 'genre' && g.n >= 10);   // small genres are too noisy
  const unspread = [];
  for (const m of mechanics.filter(m => m.momentum >= 55 && m.n >= 4)) {
    for (const g of genreRows) {
      if (g.medianGrowthPct < 55) continue;
      const inGenre = games.filter(x => x.genre === g.key && x.tags.includes(m.id)).length;
      if (inGenre <= 1) unspread.push({ mechanic: m.id, mechanicName: m.name, genre: g.key, genreGrowthPct: g.medianGrowthPct, genreGames: g.n, gamesWithMechanicInGenre: inGenre, demand: Math.round(m.momentum * 0.6 + g.medianGrowthPct * 0.4) });
    }
  }
  unspread.sort((a, b) => b.demand - a.demand);
  // Variety: at most 2 rows per genre and 3 per mechanic.
  const perG = {}, perM = {};
  const unspreadVaried = unspread.filter(u => (perG[u.genre] = (perG[u.genre] || 0) + 1) <= 2 && (perM[u.mechanic] = (perM[u.mechanic] || 0) + 1) <= 3);

  // 3. Crowding: mechanics where new entrants are piling in.
  const crowding = mechanics.filter(m => m.adoption && m.adoption.newEntrants30 >= 8 && m.adoption.entrantTrend === 'Rising')
    .map(m => ({ mechanic: m.id, name: m.name, newEntrants30: m.adoption.newEntrants30, prev30: m.adoption.newEntrantsPrev30, bigGames: m.bigGames, note: 'Competition increasing: many new games adopting it this month' }))
    .sort((a, b) => b.newEntrants30 - a.newEntrants30);

  return { untestedCombos: untested.slice(0, 25), unspreadMechanics: unspreadVaried.slice(0, 25), crowding, comboN: Object.fromEntries(comboN), pairCount };
}

// ---------- concepts ----------
function scoreConcept({ mechs, genreGrowth, existingSame, existingPair, kb }) {
  const demand = clamp((mechs.reduce((s, m) => s + m.momentum, 0) / mechs.length / 100) * 0.7 + (genreGrowth ?? 50) / 100 * 0.3);
  const gap = clamp(1 - existingSame / 3) * 0.6 + clamp(1 - existingPair / 8) * 0.4;
  const difficulty = Math.max(...mechs.map(m => kb[m.id]?.difficulty ?? 3));
  const multiplayer = Math.max(...mechs.map(m => kb[m.id]?.multiplayer ?? 2));
  const feas = (6 - difficulty) / 5, mp = multiplayer / 5;
  const parts = { demand: Math.round(40 * demand), gap: Math.round(30 * gap), feasibility: Math.round(20 * feas), multiplayer: Math.round(10 * mp) };
  return { score: parts.demand + parts.gap + parts.feasibility + parts.multiplayer, parts, difficulty, multiplayer };
}

function makeConcept({ strategy, main, partner, genre, theme, patternPhrase, games, mm, kb, genreGrowth, pairCount }) {
  const A = kb[main.id] || {}, B = kb[partner.id] || {};
  const existingPair = pairCount.get(pairKey(main.id, partner.id)) || 0;
  const existingSame = games.filter(g => g.tags.includes(main.id) && g.tags.includes(partner.id) && (!genre || g.genre === genre)).length;
  const s = scoreConcept({ mechs: [main, partner], genreGrowth, existingSame, existingPair, kb });
  const twist = (B.twists || [])[hash(main.id + partner.id + theme) % Math.max(1, (B.twists || []).length)] || '';
  const cap = w => w.replace(/\b\w/g, c => c.toUpperCase());
  const sentence = w => w ? w[0].toUpperCase() + w.slice(1) : w;
  const title = `${cap(theme)} ${A.short || main.name} & ${B.short || partner.name}`.replace(/\s+/g, ' ').trim();
  const evidence = [
    `${main.name}: momentum ${main.momentum}/100, ${main.n} games by ${main.creators} creators (${main.evidence})`,
    `${partner.name}: momentum ${partner.momentum}/100`,
    genre ? `${genre} median growth: ${genreGrowth ?? '—'}th percentile` : null,
    patternPhrase ? `Title pattern "${patternPhrase}" is spreading across creators` : null,
  ].filter(Boolean);
  const risks = [
    existingPair === 0 ? 'Untested pairing: the two loops may not mesh — prototype the core before art.' : null,
    main.competition === 'High' ? `${main.name} is crowded: the twist must be obvious from the thumbnail.` : null,
    s.difficulty >= 4 ? 'Technically demanding (physics/combat/netcode): budget for performance testing on mobile.' : null,
    main.evidence !== 'plausible driver' ? 'Evidence for the main mechanic is still correlation-level.' : null,
  ].filter(Boolean);
  return {
    id: `${strategy}:${main.id}:${partner.id}:${genre || ''}:${theme}`.replace(/\s+/g, '-'),
    strategy: { A: 'Proven pair, new genre', B: 'Untested pair', C: 'Pattern transplant' }[strategy],
    title, mechanics: [main.id, partner.id], genre: genre || null, theme,
    pitch: patternPhrase
      ? `A "${patternPhrase}"-style game set in a ${theme} world, where you ${A.verb} and ${B.verb}.`
      : `A ${genre ? genre.toLowerCase() + ' ' : ''}game set in a ${theme} world where you ${A.verb}, then ${B.verb}.`,
    coreLoop: [sentence(A.verb || main.name), sentence(B.verb || partner.name), 'Spend rewards on upgrades that power up the next round'],
    twist: twist ? sentence(twist) : null,
    feel: [A.feel, B.feel].filter(Boolean).join('; '),
    firstPrototype: `Week 1: grey-box the ${A.short || main.name} loop and make it feel great on its own. Day 4: add ${B.short || partner.name}. Day 6: playtest with 4 players; keep it only if sessions run past 10 minutes.`,
    evidence, risks, existingPair, existingSame,
    opportunityScore: s.score, scoreParts: s.parts, difficulty: s.difficulty, multiplayer: s.multiplayer,
  };
}

export function conceptsFor(main, { games, mechanics, combos, genres, patterns, kb, pairCount, themeWords }) {
  const mm = new Map(mechanics.map(m => [m.id, m]));
  const genreGrowth = new Map(genres.filter(g => g.level === 'genre').map(g => [g.key, g.medianGrowthPct]));
  const usedThemes = new Set();
  const themeFor = seed => {
    const names = games.filter(g => g.tags.includes(main.id)).map(g => g.name.toLowerCase()).join(' ');
    const opts = themeWords.filter(t => !names.includes(t) && !usedThemes.has(t));
    const t = (opts.length ? opts : themeWords)[hash(seed) % (opts.length || themeWords.length)];
    usedThemes.add(t);
    return t;
  };
  const out = [];
  const partnersByMomentum = mechanics.filter(m => m.id !== main.id && m.n >= 3).sort((a, b) => b.momentum - a.momentum);

  // A. Proven pair, new genre: best combo with this mechanic, placed in a growing genre where it barely exists.
  const best = combos.filter(c => c.mechanics.includes(main.id)).sort((a, b) => b.momentum - a.momentum)[0];
  if (best) {
    const partner = mm.get(best.mechanics.find(x => x !== main.id));
    const target = [...genreGrowth].filter(([g]) => games.filter(x => x.genre === g && x.tags.includes(main.id) && x.tags.includes(partner.id)).length <= 1)
      .sort((a, b) => b[1] - a[1])[0];
    if (partner && target) out.push(makeConcept({ strategy: 'A', main, partner, genre: target[0], theme: themeFor('A' + main.id), games, mm, kb, genreGrowth: target[1], pairCount }));
  }
  // B. Untested pair: strong partner almost nobody combines with this mechanic.
  const untried = partnersByMomentum.find(p => (pairCount.get(pairKey(main.id, p.id)) || 0) <= 1 && !out.some(c => c.mechanics.includes(p.id)) && (kb[p.id]?.multiplayer ?? 0) + (kb[main.id]?.multiplayer ?? 0) >= 5);
  if (untried) out.push(makeConcept({ strategy: 'B', main, partner: untried, genre: null, theme: themeFor('B' + main.id), games, mm, kb, genreGrowth: null, pairCount }));
  // C. Pattern transplant: a spreading title pattern whose games don't use this mechanic.
  const gm = new Map(games.map(g => [g.id, g]));
  const pat = patterns.find(p => p.phrase.includes(' ') && p.n >= 3 && p.medianGrowthPct >= 50 && !p.games.some(id => gm.get(id)?.tags.includes(main.id)));
  if (pat) {
    const patTags = {};
    for (const id of pat.games) for (const t of gm.get(id)?.tags || []) patTags[t] = (patTags[t] || 0) + 1;
    const partnerId = Object.entries(patTags).sort((a, b) => b[1] - a[1]).map(([t]) => t).find(t => t !== main.id && mm.has(t) && !out.some(c => c.mechanics.includes(t)));
    const partner = mm.get(partnerId) || partnersByMomentum.find(p => !out.some(c => c.mechanics.includes(p.id)));
    if (partner) out.push(makeConcept({ strategy: 'C', main, partner, genre: null, theme: themeFor('C' + main.id), patternPhrase: pat.phrase, games, mm, kb, genreGrowth: null, pairCount }));
  }
  // Fill to three with the next-best partners.
  for (const p of partnersByMomentum) {
    if (out.length >= 3) break;
    if (out.some(c => c.mechanics.includes(p.id))) continue;
    out.push(makeConcept({ strategy: 'B', main, partner: p, genre: null, theme: themeFor('F' + main.id + p.id), games, mm, kb, genreGrowth: null, pairCount }));
  }
  return out.slice(0, 3);
}

// ---------- competitors ----------
export function competitorsFor(g, games, n = 8) {
  const tg = new Set(g.tags);
  return games.filter(x => x.id !== g.id).map(x => {
    const inter = x.tags.filter(t => tg.has(t)).length;
    const union = new Set([...x.tags, ...g.tags]).size || 1;
    const sim = inter / union + (x.subgenre && x.subgenre === g.subgenre ? 0.3 : 0) + (x.genre === g.genre ? 0.1 : 0);
    return { x, sim, inter };
  }).filter(r => r.inter >= 1 && r.sim >= 0.35).sort((a, b) => b.sim - a.sim).slice(0, n)
    .map(({ x, sim }) => ({ id: x.id, name: x.name, ccu: x.ccu, growthPct: x.growthPct, ageDays: x.ageDays, score: x.score, stage: x.stage, similarity: Math.round(sim * 100) / 100 }));
}

export function competitorClusters({ games, combos }) {
  const clusters = [];
  const bySub = new Map();
  for (const g of games) if (g.subgenre) { const k = `${g.genre} › ${g.subgenre}`; if (!bySub.has(k)) bySub.set(k, []); bySub.get(k).push(g); }
  for (const [k, gs] of bySub) if (gs.length >= 5) clusters.push({ id: 'sub:' + k, kind: 'Subgenre', name: k, games: gs });
  const gm = new Map(games.map(g => [g.id, g]));
  for (const c of combos.slice(0, 20)) clusters.push({ id: 'combo:' + c.id, kind: 'Mechanic combination', name: c.name, games: c.games.map(id => gm.get(id)).filter(Boolean) });
  return clusters.map(c => {
    const gs = c.games;
    const leader = [...gs].sort((a, b) => b.ccu - a.ccu)[0];
    const fastest = [...gs].filter(g => g.ccu >= 50).sort((a, b) => b.growthPct - a.growthPct)[0];
    const newest = [...gs].sort((a, b) => a.ageDays - b.ageDays)[0];
    const outgrowers = gs.filter(g => g.id !== leader.id && g.growthPct >= leader.growthPct + 20 && g.ccu <= leader.ccu / 5).sort((a, b) => b.growthPct - a.growthPct).slice(0, 5);
    const entrants30 = gs.filter(g => g.ageDays <= 30).length;
    const lite = g => g && { id: g.id, name: g.name, ccu: g.ccu, growthPct: g.growthPct, ageDays: g.ageDays, stage: g.stage };
    return {
      id: c.id, kind: c.kind, name: c.name, n: gs.length, totalCcu: gs.reduce((s, g) => s + g.ccu, 0),
      medianGrowthPct: median(gs.map(g => g.growthPct)), entrants30,
      competition: entrants30 >= 6 ? 'Increasing' : entrants30 >= 2 ? 'Steady' : 'Quiet',
      leader: lite(leader), fastest: lite(fastest), newest: lite(newest), outgrowers: outgrowers.map(lite),
    };
  }).sort((a, b) => b.outgrowers.length - a.outgrowers.length || b.medianGrowthPct - a.medianGrowthPct);
}

// ---------- full opportunity build ----------
export function buildOpportunities({ games, mechanics, combos, genres, patterns, kbConfig, now }) {
  const kb = kbConfig.mechanics, themeWords = kbConfig.themeWords;
  const gamesById = new Map(games.map(g => [g.id, g]));
  for (const m of mechanics) m.adoption = adoption(m, gamesById, now);
  const gaps = marketGaps({ games, mechanics, combos, genres });
  const ctx = { games, mechanics, combos, genres, patterns, kb, pairCount: gaps.pairCount, themeWords };

  const emerging = mechanics.filter(m => EARLY.includes(m.stage) && m.n >= 3);
  const cards = emerging.map(m => {
    const k = kb[m.id] || {};
    const genreGrowth = m.genreList.map(g => genres.find(x => x.level === 'genre' && x.key === g)).filter(Boolean).map(g => ({ genre: g.key, medianGrowthPct: g.medianGrowthPct }));
    return {
      mechanic: m.id, name: m.name, description: k.desc || '', momentum: m.momentum, stage: m.stage, evidence: m.evidence, confidence: m.confidence,
      gamesUsing: m.games.slice(0, 10), n: m.n, creators: m.creators,
      adoption: m.adoption, associatedGenreGrowth: genreGrowth,
      playerGrowthEvidence: `${m.growingGames} of ${m.n} games growing faster than peers; lift vs same-genre games without it: ${m.liftVsWithout ?? '—'}`,
      saturation: `${m.competition} (${m.bigGames} games over 50k CCU)`,
      difficulty: k.difficulty ?? null, multiplayer: k.multiplayer ?? null,
      combineWith: m.opportunity?.strongestPartners || [], untried: m.opportunity?.untriedPartners || [],
      risks: m.opportunity?.risk || '',
      concepts: conceptsFor(m, ctx),
    };
  }).sort((a, b) => b.momentum - a.momentum);

  // Rank every concept; de-duplicate by mechanic pair; top 3 = "What I Would Build Next".
  const seen = new Set();
  const ranked = cards.flatMap(c => c.concepts).sort((a, b) => b.opportunityScore - a.opportunityScore)
    .filter(c => { const k = pairKey(...c.mechanics); if (seen.has(k)) return false; seen.add(k); return true; });
  // Build-next shortlist must be three genuinely different ideas: no shared mechanic, max two per strategy.
  const buildNext = [];
  for (const c of ranked) {
    if (buildNext.length >= 3) break;
    if (buildNext.some(b => b.mechanics.some(m => c.mechanics.includes(m)))) continue;
    if (buildNext.filter(b => b.strategy === c.strategy).length >= 2) continue;
    buildNext.push(c);
  }
  // Small datasets: relax the rules rather than show fewer than three.
  for (const c of ranked) { if (buildNext.length >= 3) break; if (!buildNext.includes(c) && !buildNext.some(b => b.mechanics.some(m => c.mechanics.includes(m)))) buildNext.push(c); }
  for (const c of ranked) { if (buildNext.length >= 3) break; if (!buildNext.includes(c)) buildNext.push(c); }
  buildNext.sort((a, b) => b.opportunityScore - a.opportunityScore);
  delete gaps.pairCount;
  return { generatedAt: new Date(now).toISOString(), buildNext, allConcepts: ranked.slice(0, 40), cards, gaps, clusters: competitorClusters({ games, combos }) };
}
