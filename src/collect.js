// Discovery + stats collection for one run.

const take = (arr, start, n) => Array.from({ length: Math.min(n, arr.length) }, (_, i) => arr[(start + i) % arr.length]);

export async function discover(client, reg, cfg, nowIso) {
  const listings = [];
  const push = (games, source, country) => games.forEach((g, i) => g?.universeId && listings.push({ id: String(g.universeId), source, country, rank: i + 1, g }));

  // 1. Early-signal lists per country. Rotating countries keeps each run short
  //    while still covering every country several times a day.
  const others = cfg.countries.filter(c => c !== 'all');
  const countries = ['all', ...take(others, reg.countryCursor, cfg.countriesPerRun - 1)];
  reg.countryCursor = (reg.countryCursor + cfg.countriesPerRun - 1) % Math.max(1, others.length);
  for (const country of countries)
    for (const sortId of cfg.earlySorts)
      push(await client.getSortContent(sortId, country), `sort:${sortId}`, country);

  // 2. Every sort on the explore page (Top Rated, Top Revisited, genre trending lists...).
  if (reg.runs % cfg.scanAllSortsEveryRuns === 0)
    for (const s of await client.getSorts('all')) push(s.games, `sort:${s.sortId}`, 'all');

  // 3. Rotating deep keyword search: the main way to find games with tiny player counts.
  const kws = take(cfg.searchKeywords, reg.keywordCursor, cfg.keywordsPerRun);
  reg.keywordCursor = (reg.keywordCursor + cfg.keywordsPerRun) % cfg.searchKeywords.length;
  for (const kw of kws) push(await client.search(kw, cfg.searchPagesPerKeyword), `search:${kw}`, 'all');

  // Register new games.
  let newGames = 0;
  for (const l of listings) {
    let e = reg.games[l.id];
    if (!e) {
      e = reg.games[l.id] = { id: l.id, name: l.g.name, firstSeen: nowIso, discoveredVia: l.source, active: true, sources: {} };
      newGames++;
    }
    e.active = true;
    e.lastListed = nowIso;
    e.sources[l.source] = (e.sources[l.source] || 0) + 1;
  }
  return { listings, newGames, countries, keywords: kws };
}

// Refresh live stats for every tracked game. Inactive (dead) games are re-checked once a day
// so a revived game (big update, creator video) is noticed.
export async function refresh(client, reg, cfg, nowIso, { recheckInactive }) {
  let ids = Object.values(reg.games).filter(g => g.active || recheckInactive).map(g => g.id);
  if (ids.length > cfg.maxTrackedGames) {
    // Keep the newest discoveries first: the app is about finding games early.
    ids = ids.map(id => reg.games[id]).sort((a, b) => (b.firstSeen > a.firstSeen) - (b.firstSeen < a.firstSeen)).slice(0, cfg.maxTrackedGames).map(g => g.id);
  }
  const details = await client.getGames(ids);
  const votes = new Map((await client.getVotes(ids)).map(v => [String(v.id), v]));
  const lines = [];
  for (const d of details) {
    const id = String(d.id);
    const e = reg.games[id] || (reg.games[id] = { id, firstSeen: nowIso, sources: {}, active: true });
    const prevUpdated = e.updated;
    Object.assign(e, {
      placeId: d.rootPlaceId, name: d.name, desc: (d.description || '').slice(0, 600),
      genre: d.genre_l1 || d.genre || '', subgenre: d.genre_l2 || '',
      created: d.created, updated: d.updated, maxPlayers: d.maxPlayers, price: d.price ?? null,
      creator: d.creator?.name || '', creatorId: d.creator?.id, creatorType: d.creator?.type || '',
      lastPolled: nowIso,
    });
    if (prevUpdated && prevUpdated !== d.updated) (e.updateLog ||= []).push(d.updated), e.updateLog = e.updateLog.slice(-30);
    const v = votes.get(id);
    lines.push([nowIso, id, d.playing ?? 0, d.visits ?? 0, d.favoritedCount ?? 0, v?.upVotes ?? '', v?.downVotes ?? ''].join(','));
  }
  return { lines, polled: details.length, requested: ids.length };
}

// Stop polling games that never got players, after a grace period.
export function prune(reg, series, cfg, nowMs) {
  let dropped = 0;
  for (const g of Object.values(reg.games)) {
    if (!g.active) continue;
    if (nowMs - Date.parse(g.firstSeen) < cfg.dropRules.graceDaysAfterFirstSeen * 864e5) continue;
    const s = series.get(g.id) || [];
    const peak = s.filter(r => r[0] > nowMs - 7 * 864e5).reduce((m, r) => Math.max(m, r[1]), 0);
    if (peak < cfg.dropRules.minPeakCcu7d) { g.active = false; dropped++; }
  }
  return dropped;
}
