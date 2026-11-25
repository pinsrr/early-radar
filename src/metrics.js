// Turns a game's raw snapshot series into growth metrics.
// Every metric is labelled by where it comes from:
//   observed  = read directly from Roblox at a point in time
//   derived   = computed from our own snapshots (needs history)
//   inferred  = estimate built on an assumption (named in `basis`)

const H = 36e5, D = 864e5;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const lr = (a, b) => (a == null || b == null) ? null : Math.log((a + 5) / (b + 5));

function at(series, t, tol) {
  let best = null, bd = Infinity;
  for (const r of series) { const d = Math.abs(r[0] - t); if (d < bd) { bd = d; best = r; } }
  return best && bd <= tol ? best : null;
}
function windowRows(series, from, to) { return series.filter(r => r[0] > from && r[0] <= to); }
// A window only counts when the snapshots inside it cover at least `minSpan` of it.
function covered(rows, minSpan) { return rows.length >= 3 && rows.at(-1)[0] - rows[0][0] >= minSpan; }

export function gameMetrics(g, series = [], listings = [], now) {
  const last = series.at(-1);
  const ccu = last ? last[1] : 0;
  const visits = last ? last[2] : 0;
  const fav = last ? last[3] : 0;
  const up = last?.[4], down = last?.[5];
  const ageDays = Math.max(0.5, (now - Date.parse(g.created || g.firstSeen)) / D);

  const m = {
    ccu, visits, favorites: fav, ageDays,
    likeRatio: up != null && up + down > 20 ? up / (up + down) : null,
    favPer1kVisits: visits > 500 ? fav / visits * 1000 : null,
    visitsPerDayLifetime: visits / ageDays,
    hoursSinceUpdate: g.updated ? (now - Date.parse(g.updated)) / H : null,
    updates7d: (g.updateLog || []).filter(u => now - Date.parse(u) < 7 * D).length,
    snapshots: series.length,
    historyHours: series.length ? (now - series[0][0]) / H : 0,
    change: {},
  };

  // Point-to-point CCU change over standard windows (observed vs observed).
  for (const [k, span] of [['1h', H], ['6h', 6 * H], ['24h', D], ['7d', 7 * D], ['30d', 30 * D]]) {
    const prev = at(series, now - span, Math.max(20 * 60e3, span * 0.15));
    m.change[k] = prev ? { from: prev[1], pct: (ccu - prev[1]) / Math.max(prev[1], 10) } : null;
  }

  // 24h averages remove the daily time-of-day cycle.
  const w0 = windowRows(series, now - D, now), w1 = windowRows(series, now - 2 * D, now - D), w2 = windowRows(series, now - 3 * D, now - 2 * D);
  const ok0 = covered(w0, 12 * H), ok1 = covered(w1, 12 * H), ok2 = covered(w2, 12 * H);
  m.avg24 = ok0 ? mean(w0.map(r => r[1])) : null;
  m.peak24 = w0.length ? Math.max(...w0.map(r => r[1])) : null;
  m.prevAvg24 = ok1 ? mean(w1.map(r => r[1])) : null;
  m.growth24 = ok0 && ok1 ? lr(m.avg24, m.prevAvg24) : null;
  const g24prev = ok1 && ok2 ? lr(m.prevAvg24, mean(w2.map(r => r[1]))) : null;
  m.accel = m.growth24 != null && g24prev != null ? m.growth24 - g24prev : null;

  // Visits per hour from cumulative visit counters: steadier than CCU.
  const v24 = at(series, now - D, 3 * H), v48 = at(series, now - 2 * D, 3 * H);
  const vShort = at(series, now - 6 * H, 1.5 * H);
  m.visitsPerHour = v24 ? (visits - v24[2]) / ((now - v24[0]) / H) : vShort ? (visits - vShort[2]) / ((now - vShort[0]) / H) : null;
  m.visitsPerHourPrev = v24 && v48 ? (v24[2] - v48[2]) / ((v24[0] - v48[0]) / H) : null;
  m.visitsGrowth = m.visitsPerHour != null && m.visitsPerHourPrev != null ? lr(m.visitsPerHour, m.visitsPerHourPrev) : null;
  m.favPerHour = v24 ? (fav - v24[3]) / ((now - v24[0]) / H) : null;

  // Little's law: players in game = arrivals per minute x minutes per visit.
  if (m.visitsPerHour > 20 && (m.avg24 ?? ccu) > 0) {
    m.sessionMinutes = { value: (m.avg24 ?? ccu) / (m.visitsPerHour / 60), kind: 'inferred', basis: "Little's law: avg CCU / visits per minute. Rough; visit counters update with delay." };
  }

  // Day-over-day consistency across the last 7 days.
  const days = [];
  for (let i = 0; i < 8; i++) { const rows = windowRows(series, now - (i + 1) * D, now - i * D); if (covered(rows, 10 * H)) days.push(mean(rows.map(r => r[1]))); else break; }
  m.daysOfHistory = days.length;
  if (days.length >= 3) {
    let upDays = 0;
    for (let i = 0; i < days.length - 1; i++) if (days[i] > days[i + 1]) upDays++;
    m.consistency = upDays / (days.length - 1);
    m.growth7d = lr(days[0], days.at(-1));
  }

  // Suspicious traffic: a sudden jump that collapses, or CCU growth without new visits.
  m.flags = [];
  for (let i = 1; i < series.length; i++) {
    const [t, c] = series[i], p = series[i - 1][1];
    if (c >= 200 && c > 4 * Math.max(p, 20)) {
      const after = series.filter(r => r[0] > t && r[0] <= t + 6 * H);
      if (after.length >= 2 && after.at(-1)[1] < c * 0.4) m.flags.push({ type: 'spike', note: `CCU jumped ${p}→${c} then fell back within 6h (likely promo/sponsor burst or bots)`, at: new Date(t).toISOString() });
    }
  }
  if (m.growth24 > 0.7 && m.visitsGrowth != null && m.visitsGrowth < 0.05) m.flags.push({ type: 'ccu_without_visits', note: 'CCU rose sharply but visit rate did not: players are not arriving, check for idle/bot servers' });
  if (m.likeRatio != null && m.likeRatio < 0.5 && ccu > 1000) m.flags.push({ type: 'low_rating', note: `Only ${(m.likeRatio * 100).toFixed(0)}% likes: growth may not stick` });

  // Discovery-list signals (observed from explore lists).
  const recent = listings.filter(l => now - l.t < D);
  const uac = recent.filter(l => l.source === 'sort:up-and-coming');
  m.discovery = {
    upAndComingCountries: new Set(uac.map(l => l.country)).size,
    bestUpAndComingRank: uac.length ? Math.min(...uac.map(l => l.rank)) : null,
    topTrending: recent.some(l => l.source === 'sort:top-trending'),
    topPlaying: recent.some(l => l.source === 'sort:top-playing-now'),
    firstUpAndComing: (() => { const all = listings.filter(l => l.source === 'sort:up-and-coming'); return all.length ? new Date(Math.min(...all.map(l => l.t))).toISOString() : null; })(),
    sources: [...new Set(recent.map(l => l.source))],
  };
  return m;
}

// Hourly-downsampled series for charts.
export function chartSeries(series, now, days = 30) {
  const out = new Map();
  for (const r of series) {
    if (r[0] < now - days * D) continue;
    const h = Math.floor(r[0] / H) * H;
    const e = out.get(h) || [h, 0, 0, r[2], r[3]];
    e[1] += r[1]; e[2]++; e[3] = r[2]; e[4] = r[3];
    out.set(h, e);
  }
  return [...out.values()].map(e => [e[0], Math.round(e[1] / e[2]), e[3], e[4]]);
}
