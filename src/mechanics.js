// Mechanic identification.
// 1. Rule-based tagger (config/mechanics.json): transparent, free, editable.
// 2. Name-pattern miner: finds repeated title templates across different creators
//    ("Throw X For Animals", "Steal a X", "Fish for X"). On Roblox, a copied title template
//    is often the first visible sign of a spreading core loop, before any genre label exists.

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'with', 'my', 'your', 'you', 'is', 'it', 'be', 'new', 'upd', 'update', 'beta', 'alpha', 'event', 'roblox', 'game', 'simulator', 'x2', 'free', 'sale', 'release']);

export function compileRules(cfg) {
  return {
    minWeight: cfg.minWeight ?? 2,
    genreHints: cfg.genreHints || {},
    mechanics: cfg.mechanics.map(m => ({ ...m, re: m.patterns.map(p => new RegExp(p, 'i')) })),
  };
}

export function tagGame(g, rules) {
  const name = (g.name || '').toLowerCase();
  const desc = (g.desc || '').toLowerCase();
  const tags = [];
  for (const m of rules.mechanics) {
    let w = 0;
    const evidence = [];
    let nameHit = false;
    for (const re of m.re) {
      const n = name.match(re);
      if (n) { nameHit = true; evidence.push(n[0].trim()); }
      const d = desc.match(re);
      if (d) { w += 1; if (!n) evidence.push(d[0].trim()); }
    }
    if (nameHit) w += 2;
    w = Math.min(w, 6);
    if ((rules.genreHints[g.subgenre] || []).includes(m.id)) { w += 2; evidence.push(`subgenre: ${g.subgenre}`); }
    if (w >= rules.minWeight) tags.push({ id: m.id, weight: w, confidence: w >= 4 || nameHit ? 'high' : w >= 3 ? 'medium' : 'low', evidence: [...new Set(evidence)].slice(0, 4) });
  }
  return tags.sort((a, b) => b.weight - a.weight);
}

export function normaliseTitle(name) {
  return (name || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'+]/gu, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Returns candidate title templates with their member games.
export function mineNamePatterns(games, { minGames = 3, minCreators = 2 } = {}) {
  const grams = new Map();
  for (const g of games) {
    const toks = normaliseTitle(g.name).split(' ').filter(Boolean);
    const seen = new Set();
    for (const w of toks) if (!STOP.has(w) && w.length > 3 && !seen.has(w)) { seen.add(w); if (!grams.has(w)) grams.set(w, []); grams.get(w).push(g); }
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const t = toks.slice(i, i + n);
        if (t.every(w => STOP.has(w)) || STOP.has(t[n - 1]) && n === 2 && STOP.has(t[0])) continue;
        if (t.filter(w => !STOP.has(w)).length === 0) continue;
        const key = t.join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grams.has(key)) grams.set(key, []);
        grams.get(key).push(g);
      }
    }
  }
  const out = [];
  for (const [phrase, gs] of grams) {
    const creators = new Set(gs.map(g => g.creator));
    const single = !phrase.includes(' ');
    if (gs.length < (single ? minGames + 1 : minGames) || creators.size < minCreators) continue;
    out.push({ phrase, games: gs.map(g => g.id), creators: creators.size });
  }
  // Drop 2-word phrases fully covered by a 3-word phrase with the same games.
  return out.filter(p => !out.some(q => q !== p && q.phrase.includes(p.phrase) && q.games.length === p.games.length))
    .sort((a, b) => b.games.length - a.games.length).slice(0, 60);
}
