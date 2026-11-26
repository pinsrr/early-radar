// YouTube Data API v3 signals (authorised source; needs the YOUTUBE_API_KEY secret).
//
// Each run checks a few candidate games: the highest-scoring early games not checked recently,
// plus watchlist games. For each it searches recent videos mentioning the game, keeps only videos
// whose title/description really names it, then fetches their view counts.
//
// Quota: search.list = 100 units, videos.list = 1 unit. Free quota = 10,000 units/day.
// Data older than retentionDays is deleted (YouTube API terms require refreshing or deleting stored data within 30 days).

import { normaliseTitle } from './mechanics.js';

const H = 36e5, D = 864e5;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'with', 'roblox', 'game', 'new', 'upd', 'update', 'beta', 'alpha', 'event', 'simulator']);

export function nameTokens(name) {
  return normaliseTitle(name).split(' ').filter(w => w.length > 2 && !STOP.has(w));
}

// A video counts only if it clearly names the game: the full cleaned name, or most of its distinctive words.
export function mentionsGame(text, tokens, fullName) {
  const t = (text || '').toLowerCase();
  if (fullName && fullName.length >= 6 && t.includes(fullName)) return true;
  if (!tokens.length) return false;
  const hits = tokens.filter(w => t.includes(w)).length;
  return tokens.length === 1 ? hits === 1 && t.includes('roblox') : hits / tokens.length >= 0.6;
}

export class YouTubeClient {
  constructor({ key, fetchImpl = globalThis.fetch, log = console } = {}) {
    this.key = key; this.fetch = fetchImpl; this.log = log;
    this.stats = { requests: 0, unitsUsed: 0, failures: 0, quotaExceeded: false, errors: [] };
  }
  async get(path, params, units) {
    if (this.stats.quotaExceeded) return null;
    const qs = new URLSearchParams({ ...params, key: this.key }).toString();
    this.stats.requests++; this.stats.unitsUsed += units;
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 15e3);
    try {
      const res = await this.fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, { signal: ac.signal });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body;
      const reason = body?.error?.errors?.[0]?.reason || '';
      if (res.status === 403 && /quota/i.test(reason)) this.stats.quotaExceeded = true;
      this.stats.failures++;
      // Never log the URL query: it contains the API key.
      this.stats.errors.push({ path, status: res.status, reason });
      this.log.log(`[youtube] ${path} failed ${res.status} ${reason}`);
      return null;
    } catch (e) {
      this.stats.failures++; this.stats.errors.push({ path, status: 0, reason: String(e?.message || e) });
      return null;
    } finally { clearTimeout(timer); }
  }

  async checkGame(game, { lookbackDays = 7, maxResults = 25, now = Date.now() } = {}) {
    const tokens = nameTokens(game.name);
    const fullName = normaliseTitle(game.name);
    const q = `${fullName} roblox`;
    const s = await this.get('search', { part: 'snippet', type: 'video', q, order: 'date', maxResults: String(maxResults), publishedAfter: new Date(now - lookbackDays * D).toISOString() }, 100);
    if (!s) return null;
    const items = (s.items || []).filter(i => mentionsGame(`${i.snippet?.title} ${i.snippet?.description}`, tokens, fullName));
    const ids = items.map(i => i.id?.videoId).filter(Boolean);
    const v = ids.length ? await this.get('videos', { part: 'statistics,snippet', id: ids.join(',') }, 1) : { items: [] };
    const vids = (v?.items || []).map(x => ({ id: x.id, title: x.snippet?.title, channel: x.snippet?.channelTitle, channelId: x.snippet?.channelId, published: x.snippet?.publishedAt, views: +(x.statistics?.viewCount || 0) }));
    const recent = vids.filter(x => now - Date.parse(x.published) <= 2 * D);
    const top = [...vids].sort((a, b) => b.views - a.views)[0];
    return {
      t: new Date(now).toISOString(), query: q,
      videos7d: vids.length, videos48h: recent.length,
      views7d: vids.reduce((a, x) => a + x.views, 0),
      channels: new Set(vids.map(x => x.channelId)).size,
      hitLimit: (s.items || []).length >= maxResults,
      top: top ? { title: top.title, channel: top.channel, views: top.views, url: `https://www.youtube.com/watch?v=${top.id}` } : null,
    };
  }
}

// Picks which games to check this run and records results in the social store.
export async function collectYouTube({ client, social, reg, prevState, watch, cfg, now }) {
  const hist = social.youtube || (social.youtube = {});
  const lastCheck = id => { const h = hist[id]; return h?.length ? Date.parse(h.at(-1).t) : 0; };
  const due = id => now - lastCheck(id) >= cfg.recheckHours * H;
  const early = (prevState.games || []).filter(g => ['Early Signal', 'Emerging', 'Accelerating'].includes(g.stage)).sort((a, b) => b.score - a.score).map(g => g.id);
  const queue = [...new Set([...(watch.games || []).map(String), ...early])].filter(id => reg.games[id]?.name && due(id));
  const checked = [];
  for (const id of queue.slice(0, cfg.searchesPerRun)) {
    const r = await client.checkGame(reg.games[id], { lookbackDays: cfg.lookbackDays, maxResults: cfg.maxResults, now });
    if (!r) break;
    (hist[id] ||= []).push(r);
    checked.push(id);
  }
  // Retention: delete anything older than retentionDays.
  for (const [id, arr] of Object.entries(hist)) {
    const kept = arr.filter(x => now - Date.parse(x.t) <= cfg.retentionDays * D);
    if (kept.length) hist[id] = kept; else delete hist[id];
  }
  return { checked, queueLength: queue.length };
}

// Does social interest come before or after player growth? Per game, compares the first check with
// 3+ new videos in 48h against the first day average CCU reached 1.5x its first observed day.
export function socialTiming(ytHist, dailyCcu) {
  const rows = [];
  for (const [id, checks] of Object.entries(ytHist)) {
    const days = dailyCcu.get(id);
    if (!days || days.length < 3 || checks.length < 2) continue;
    const socialOnset = checks.find(c => c.videos48h >= 3);
    const base = days[0][1];
    const growthOnset = days.find(([, avg]) => avg >= Math.max(base * 1.5, base + 50));
    if (!socialOnset || !growthOnset) continue;
    const diffH = (Date.parse(socialOnset.t) - growthOnset[0]) / H;
    rows.push({ id, relation: diffH < -12 ? 'social first' : diffH > 12 ? 'players first' : 'together', hoursApart: Math.round(diffH) });
  }
  const count = k => rows.filter(r => r.relation === k).length;
  return { games: rows.length, socialFirst: count('social first'), playersFirst: count('players first'), together: count('together'), examples: rows.slice(0, 20) };
}
