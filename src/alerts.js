// Compares this run's analysis with the previous one and raises alerts.
// Each alert says what changed, why it matters, confidence, and links to its evidence.

const D = 864e5;

export function makeAlerts({ games, mechanics, combos, prev, watch, nowIso }) {
  const out = [];
  const now = Date.parse(nowIso);
  const recentlyAlerted = new Set((prev.alerts || []).filter(a => now - Date.parse(a.at) < 3 * D).map(a => a.key));
  const add = a => { if (!recentlyAlerted.has(a.key)) out.push({ at: nowIso, ...a }); };
  const pg = new Map((prev.games || []).map(g => [g.id, g]));
  const pm = new Map((prev.mechanics || []).map(m => [m.id, m]));
  const pc = new Map((prev.combos || []).map(c => [c.id, c]));

  for (const g of games) {
    const before = pg.get(g.id);
    if (['Early Signal', 'Emerging'].includes(g.stage) && g.score >= 70)
      add({ key: `early:${g.id}`, type: 'Early game', title: `${g.name} — ${g.stage}, score ${g.score}`, why: `${g.ccu.toLocaleString('en')} CCU, ${Math.round(g.ageDays)} days old, growth ${g.growthPct}th pct vs ${g.peerKey}.`, confidence: g.growthKind === 'measured' ? 'Medium' : 'Low', links: { games: [g.id] } });
    if (before && before.stage !== g.stage && g.stage === 'Mainstream')
      add({ key: `main:${g.id}`, type: 'Went mainstream', title: `${g.name} reached Mainstream`, why: `Was ${before.stage}. It is no longer early; competition will rise.`, confidence: 'High', links: { games: [g.id] } });
    if (watch.games.includes(g.id) && g.change24 != null && Math.abs(g.change24) >= 0.5)
      add({ key: `watch:${g.id}:${nowIso.slice(0, 10)}`, type: 'Watchlist', title: `${g.name} ${g.change24 > 0 ? 'up' : 'down'} ${Math.round(Math.abs(g.change24) * 100)}% in 24h`, why: 'Game on your watchlist moved sharply.', confidence: 'High', links: { games: [g.id] } });
  }

  for (const m of mechanics) {
    const b = pm.get(m.id);
    const base = { links: { mechanics: [m.id], games: m.games.slice(0, 8) } };
    if (['Early Signal', 'Emerging', 'Accelerating'].includes(m.stage) && m.momentum >= 65 && (!b || b.momentum < 65))
      add({ key: `mech:${m.id}`, type: 'Emerging mechanic', title: `${m.name}: momentum ${m.momentum}/100`, why: `${m.n} games, ${m.creators} creators, ${m.genresGrowing} genres growing. Evidence: ${m.evidence}. Competition: ${m.competition}.`, confidence: m.confidence, ...base });
    if (b && m.momentum - b.momentum >= 10)
      add({ key: `mechup:${m.id}`, type: 'Mechanic momentum jump', title: `${m.name} +${m.momentum - b.momentum} (now ${m.momentum})`, why: 'Momentum rose sharply since the last run.', confidence: m.confidence, ...base });
    if (b) {
      const newGenres = m.genreList.filter(x => !(b.genreList || []).includes(x));
      if (newGenres.length && m.momentum >= 50)
        add({ key: `spread:${m.id}:${newGenres.join('|')}`, type: 'Mechanic spreading', title: `${m.name} appeared in ${newGenres.join(', ')}`, why: `Now used across ${m.genres} genres. Cross-genre spread is an early sign of a transferable core loop.`, confidence: 'Medium', ...base });
    }
  }

  for (const c of combos) {
    const b = pc.get(c.id);
    if (c.growingGames >= 3 && (!b || b.growingGames < 3))
      add({ key: `combo:${c.id}`, type: 'New combination', title: `${c.name} in ${c.growingGames} growing games`, why: `${c.n} games use this pair; ${c.bigGames} are large.${c.whiteSpace ? ' Few competitors: possible white space.' : ''}`, confidence: c.confidence, links: { combos: [c.id], games: c.games.slice(0, 8) } });
  }
  return out;
}
