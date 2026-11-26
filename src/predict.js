// Phase 5: predictions, backtesting and score tuning.
//
// Once per UTC day:
//   - snapshot every tracked game's score components (the learning dataset)
//   - store explicit predictions: early games expected to grow, plus a random CONTROL sample
//     of other games, so hit rates can be compared against a base rate
//   - store mechanic predictions
// Every run:
//   - evaluate predictions whose horizon (7 / 14 / 30 days) has passed, using our own CCU history
//   - record missed trends and detection lead time
// Weight tuning (learnWeights) uses the snapshots + outcomes; see the guardrails there.

import { DEFAULT_WEIGHTS, COMPONENT_KEYS } from './scoring.js';

const H = 36e5, D = 864e5;
export const HORIZONS = [7, 14, 30];
export const GAME_TARGET = 1.5;      // "average CCU at least 1.5x the baseline"
const day = t => new Date(t).toISOString().slice(0, 10);
const r2 = x => x == null ? null : Math.round(x * 100) / 100;

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }
const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// Average CCU in the 24h window ending at t (needs 3+ snapshots), else nearest point within 6h.
export function avgAround(series, t) {
  const w = (series || []).filter(r => r[0] > t - D && r[0] <= t);
  if (w.length >= 3) return w.reduce((s, r) => s + r[1], 0) / w.length;
  let best = null, bd = 6 * H;
  for (const r of series || []) { const d = Math.abs(r[0] - t); if (d < bd) { bd = d; best = r; } }
  return best ? best[1] : null;
}

export function makeDailyPredictions(store, { now, rows, games, mechanics }) {
  const P = store.readJson('predictions.json', { lastDay: null, games: [], mechanics: [], firstFlag: {}, leads: [], missed: [] });
  const today = day(now);
  if (P.lastDay === today) return { P, created: 0 };
  P.lastDay = today;

  // Learning dataset: today's components for every tracked game (kept 45 days).
  const snaps = store.readJson('score-snapshots.json', { days: {} });
  snaps.days[today] = Object.fromEntries(rows.map(r => [r.g.id, [r.score, ...COMPONENT_KEYS.map(k => r.vec?.[k] == null ? null : Math.round(r.vec[k] * 1000) / 1000), Math.round(r.m.avg24 ?? r.m.ccu)]]));
  for (const k of Object.keys(snaps.days)) if (Date.parse(k) < now - 45 * D) delete snaps.days[k];
  store.writeJson('score-snapshots.json', snaps);

  const byId = new Map(rows.map(r => [r.g.id, r]));
  const flagged = games.filter(g => ['Early Signal', 'Emerging'].includes(g.stage) && g.score >= 55 && g.ccu >= 20).slice(0, 60);
  const flaggedIds = new Set(flagged.map(g => g.id));
  const pool = games.filter(g => !flaggedIds.has(g.id) && g.ccu >= 20 && g.stage !== 'Mainstream');
  const rand = rng(hash(today));
  const control = [];
  while (control.length < Math.min(30, pool.length)) { const g = pool[Math.floor(rand() * pool.length)]; if (!control.includes(g)) control.push(g); }

  let created = 0;
  for (const [g, group] of [...flagged.map(g => [g, 'predicted']), ...control.map(g => [g, 'control'])]) {
    const r = byId.get(g.id);
    const baseline = Math.round(r?.m.avg24 ?? g.ccu);
    P.games.push({ id: g.id, name: g.name, group, madeAt: new Date(now).toISOString(), score: g.score, stage: g.stage, baseline,
      claim: group === 'predicted' ? `Average CCU reaches at least ${Math.round(baseline * GAME_TARGET).toLocaleString('en')} (${GAME_TARGET}x)` : 'Control sample (no claim)',
      outcomes: {} });
    created++;
    if (group === 'predicted' && !P.firstFlag[g.id]) P.firstFlag[g.id] = { at: new Date(now).toISOString(), stage: g.stage, score: g.score };
  }
  for (const m of mechanics.filter(m => ['Early Signal', 'Emerging'].includes(m.stage) && m.momentum >= 60)) {
    P.mechanics.push({ id: m.id, name: m.name, madeAt: new Date(now).toISOString(), momentum: m.momentum, n: m.n, stage: m.stage,
      claim: `Within 30 days: momentum rises 5+ points or the mechanic reaches Accelerating/Mainstream`, outcomes: {} });
    created++;
  }
  // Keep 120 days of predictions.
  P.games = P.games.filter(p => now - Date.parse(p.madeAt) < 120 * D);
  P.mechanics = P.mechanics.filter(p => now - Date.parse(p.madeAt) < 120 * D);
  return { P, created };
}

export function evaluate(P, { now, series, reg, games, mechanics }) {
  const gm = new Map(games.map(g => [g.id, g]));
  const mm = new Map(mechanics.map(m => [m.id, m]));
  for (const p of P.games) {
    for (const h of HORIZONS) {
      if (p.outcomes[h] || now < Date.parse(p.madeAt) + h * D) continue;
      const t = Date.parse(p.madeAt) + h * D;
      const s = series.get(p.id);
      let actual = s ? avgAround(s, t) : null;
      // A game we stopped tracking because it fell under 5 CCU counts as a fail, not missing data.
      if (actual == null && reg.games[p.id] && reg.games[p.id].active === false) actual = 0;
      if (actual == null) { if (now > t + 2 * D) p.outcomes[h] = { result: 'no data' }; continue; }
      const ratio = actual / Math.max(p.baseline, 1);
      p.outcomes[h] = { actual: Math.round(actual), ratio: r2(ratio), result: ratio >= GAME_TARGET ? 'hit' : 'miss', at: new Date(now).toISOString() };
    }
  }
  for (const p of P.mechanics) {
    for (const h of [14, 30]) {
      if (p.outcomes[h] || now < Date.parse(p.madeAt) + h * D) continue;
      const m = mm.get(p.id);
      if (!m) { p.outcomes[h] = { result: 'no data' }; continue; }
      const hit = m.momentum - p.momentum >= 5 || ['Accelerating', 'Mainstream'].includes(m.stage);
      p.outcomes[h] = { momentum: m.momentum, stage: m.stage, result: hit ? 'hit' : 'miss' };
    }
  }
  // Lead time: when a flagged game becomes Accelerating/Mainstream, how many days ahead did we flag it?
  const leadIds = new Set(P.leads.map(l => l.id));
  for (const g of games) {
    if (!['Accelerating', 'Mainstream'].includes(g.stage) || leadIds.has(g.id) || !P.firstFlag[g.id]) continue;
    P.leads.push({ id: g.id, name: g.name, flaggedAt: P.firstFlag[g.id].at, reached: g.stage, reachedAt: new Date(now).toISOString(), leadDays: Math.round((now - Date.parse(P.firstFlag[g.id].at)) / D * 10) / 10 });
  }
  // Missed trends: tracked games that grew 2x+ over 14 days but were never flagged in that window.
  const missedIds = new Set(P.missed.map(m => m.id));
  for (const [id, s] of series) {
    if (missedIds.has(id) || P.firstFlag[id]) continue;
    const base = avgAround(s, now - 14 * D), cur = avgAround(s, now);
    if (base == null || cur == null || base < 20) continue;
    if (cur / base >= 2) P.missed.push({ id, name: gm.get(id)?.name || reg.games[id]?.name, from: Math.round(base), to: Math.round(cur), noticedAt: new Date(now).toISOString() });
  }
  P.missed = P.missed.slice(-200);
  P.leads = P.leads.slice(-200);
  return P;
}

// Hit rates, lift over control, calibration by score bucket, false positives.
export function accuracy(P) {
  const out = { horizons: {}, calibration: [], mechanics: {}, falsePositives: [], leadTime: null, missedCount: P.missed.length };
  for (const h of HORIZONS) {
    const done = g => P.games.filter(p => p.group === g && p.outcomes[h] && p.outcomes[h].result !== 'no data');
    const pr = done('predicted'), co = done('control');
    const rate = a => a.length ? a.filter(p => p.outcomes[h].result === 'hit').length / a.length : null;
    out.horizons[h] = { predicted: pr.length, predictedHitRate: r2(rate(pr)), control: co.length, controlHitRate: r2(rate(co)), lift: rate(pr) != null && rate(co) ? r2(rate(pr) / rate(co)) : null, pending: P.games.filter(p => p.group === 'predicted' && !p.outcomes[h]).length };
  }
  const all7 = P.games.filter(p => p.outcomes[7] && p.outcomes[7].result !== 'no data');
  for (const [lo, hi, label] of [[0, 40, '0–39'], [40, 55, '40–54'], [55, 70, '55–69'], [70, 101, '70+']]) {
    const b = all7.filter(p => p.score >= lo && p.score < hi);
    out.calibration.push({ bucket: label, n: b.length, hitRate: b.length ? r2(b.filter(p => p.outcomes[7].result === 'hit').length / b.length) : null });
  }
  for (const h of [14, 30]) {
    const d = P.mechanics.filter(p => p.outcomes[h] && p.outcomes[h].result !== 'no data');
    out.mechanics[h] = { n: d.length, hitRate: d.length ? r2(d.filter(p => p.outcomes[h].result === 'hit').length / d.length) : null, pending: P.mechanics.filter(p => !p.outcomes[h]).length };
  }
  out.falsePositives = P.games.filter(p => p.group === 'predicted' && p.outcomes[14]?.result === 'miss').sort((a, b) => b.score - a.score).slice(0, 15)
    .map(p => ({ id: p.id, name: p.name, score: p.score, madeAt: p.madeAt, baseline: p.baseline, actual: p.outcomes[14].actual, ratio: p.outcomes[14].ratio }));
  const leads = P.leads.map(l => l.leadDays).sort((a, b) => a - b);
  out.leadTime = leads.length ? { n: leads.length, medianDays: leads[leads.length >> 1], maxDays: leads.at(-1) } : null;
  return out;
}

// ---------- weight tuning ----------
// Dataset: daily component snapshots, labelled by whether avg CCU 7 days later was >= 1.5x.
export function buildDataset(snaps, series, now, horizonDays = 7) {
  const X = [], y = [];
  for (const [d, rows] of Object.entries(snaps.days)) {
    const t0 = Date.parse(d + 'T12:00:00Z');
    if (now < t0 + horizonDays * D + 12 * H) continue;
    for (const [id, row] of Object.entries(rows)) {
      const base = row[row.length - 1];
      if (!base || base < 20) continue;
      const later = avgAround(series.get(id), t0 + horizonDays * D);
      if (later == null) continue;
      X.push(COMPONENT_KEYS.map((_, i) => row[1 + i] ?? 0.5));
      y.push(later / base >= GAME_TARGET ? 1 : 0);
    }
  }
  return { X, y };
}

export function auc(scores, y) {
  const pos = [], neg = [];
  scores.forEach((s, i) => (y[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function fitLogistic(X, y, { iters = 800, lr = 0.5, l2 = 0.01 } = {}) {
  const k = X[0].length;
  const w = new Array(k).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(k).fill(0); let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const z = b + X[i].reduce((s, x, j) => s + x * w[j], 0);
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < k; j++) gw[j] += e * X[i][j];
      gb += e;
    }
    for (let j = 0; j < k; j++) w[j] -= lr * (gw[j] / X.length + l2 * w[j]);
    b -= lr * gb / X.length;
  }
  return w;
}

// Guardrails: needs 300+ labelled samples and 25+ hits; holdout check must beat current weights;
// each weight moves at most 3 points per update and stays within 3..35; weights always sum to 100.
export function learnWeights(store, { now, series, minSamples = 300, minHits = 25 }) {
  const state = store.readJson('weights.json', { weights: { ...DEFAULT_WEIGHTS }, history: [], lastTuned: null });
  if (state.lastTuned === day(now)) return state;
  const snaps = store.readJson('score-snapshots.json', { days: {} });
  const { X, y } = buildDataset(snaps, series, now);
  const hits = y.reduce((a, b) => a + b, 0);
  state.lastTuned = day(now);
  state.dataset = { samples: X.length, hits, needSamples: minSamples, needHits: minHits };
  if (X.length < minSamples || hits < minHits) { state.status = 'collecting outcomes'; store.writeJson('weights.json', state); return state; }

  // Deterministic 70/30 split.
  const idx = X.map((_, i) => i).sort((a, b) => hash(String(a) + day(now)) - hash(String(b) + day(now)));
  const cut = Math.floor(idx.length * 0.7);
  const tr = idx.slice(0, cut), te = idx.slice(cut);
  const coef = fitLogistic(tr.map(i => X[i]), tr.map(i => y[i]));
  const pos = coef.map(c => Math.max(0, c));
  const sumPos = pos.reduce((a, b) => a + b, 0) || 1;
  const suggested = Object.fromEntries(COMPONENT_KEYS.map((k, j) => [k, pos[j] / sumPos * 100]));
  const cur = state.weights;
  // Move 15% toward the suggestion, then scale the whole change so no weight moves more than 3 points.
  // (Both vectors sum to 100, so the change sums to 0 and the total stays 100.)
  const delta = Object.fromEntries(COMPONENT_KEYS.map(k => [k, 0.15 * (suggested[k] - cur[k])]));
  const f = Math.min(1, 3 / Math.max(1e-9, ...Object.values(delta).map(Math.abs)));
  const step = {};
  for (const k of COMPONENT_KEYS) step[k] = Math.min(35, Math.max(3, cur[k] + f * delta[k]));
  const s = Object.values(step).reduce((a, b) => a + b, 0);
  for (const k of COMPONENT_KEYS) step[k] = Math.round(step[k] / s * 1000) / 10;
  const scoreWith = (W, i) => COMPONENT_KEYS.reduce((t, k, j) => t + W[k] * X[i][j], 0);
  const aucCur = auc(te.map(i => scoreWith(cur, i)), te.map(i => y[i]));
  const aucNew = auc(te.map(i => scoreWith(step, i)), te.map(i => y[i]));
  const accepted = aucNew != null && aucCur != null && aucNew > aucCur + 0.005;
  state.history.push({ at: new Date(now).toISOString(), samples: X.length, hits, aucBefore: r2(aucCur), aucAfter: r2(aucNew), accepted, weights: accepted ? step : cur });
  state.history = state.history.slice(-60);
  if (accepted) state.weights = step;
  state.status = accepted ? 'updated from outcomes' : 'checked: current weights still best';
  state.suggested = Object.fromEntries(Object.entries(suggested).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  store.writeJson('weights.json', state);
  return state;
}
