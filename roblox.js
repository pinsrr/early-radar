// Roblox public web API client.
// Uses only unauthenticated public endpoints that the Roblox website itself calls.
// Verified working on 2026-11-26:
//   GET https://apis.roblox.com/explore-api/v1/get-sorts
//   GET https://apis.roblox.com/explore-api/v1/get-sort-content
//   GET https://apis.roblox.com/search-api/omni-search
//   GET https://games.roblox.com/v1/games?universeIds=   (max 50 ids)
//   GET https://games.roblox.com/v1/games/votes?universeIds=   (max 50 ids)
// These are not a formally supported "Open Cloud" API, so the client is defensive:
// rate limited, retries with backoff, and records every failure so the dashboard can show data quality.

import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Time budgets keep every run short even when Roblox throttles:
//   discovery (sorts + search) stops after DISCOVERY_BUDGET_MS,
//   all requests stop after TOTAL_BUDGET_MS, and each request times out after REQUEST_TIMEOUT_MS.
const DISCOVERY_BUDGET_MS = 4 * 60e3;
const TOTAL_BUDGET_MS = 10 * 60e3;
const REQUEST_TIMEOUT_MS = 15e3;

export class RobloxClient {
  constructor({ gapMs = 250, maxRetries = 3, fetchImpl = globalThis.fetch, log = console } = {}) {
    this.gapMs = gapMs;
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
    this.log = log;
    this.sessionId = randomUUID();
    this.last = 0;
    this.started = Date.now();
    this.stats = { requests: 0, failures: 0, retries: 0, rateLimited: 0, skippedForTime: 0, errors: [] };
  }

  discoveryOpen() { return Date.now() - this.started < DISCOVERY_BUDGET_MS; }
  timeLeft() { return TOTAL_BUDGET_MS - (Date.now() - this.started); }

  async get(url) {
    for (let attempt = 0; ; attempt++) {
      if (this.timeLeft() <= 0) { this.stats.skippedForTime++; return null; }
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.stats.requests++;
      if (this.stats.requests % 25 === 0) this.log.log(`[roblox] ${this.stats.requests} requests, ${this.stats.failures} failed, ${this.stats.rateLimited} rate-limited, ${Math.round((Date.now() - this.started) / 1000)}s`);
      let res;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS);
      try {
        res = await this.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'rotrend-early-radar/0.2 (+github actions)' }, signal: ac.signal });
        if (res.ok) res = { ok: true, body: await res.json() };   // body read is covered by the same timeout
      } catch (e) {
        res = { ok: false, status: 0, statusText: String(e?.message || e) };
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return res.body;
      const retryable = res.status <= 0 || res.status === 429 || res.status >= 500;
      if (res.status === 429) this.stats.rateLimited++;
      if (!retryable || attempt >= this.maxRetries) {
        this.stats.failures++;
        this.log.log(`[roblox] failed ${res.status} ${res.statusText || ''} ${url.split('?')[0]}`);
        if (this.stats.errors.length < 30) this.stats.errors.push({ url: url.split('?')[0], status: res.status, at: new Date().toISOString() });
        return null;
      }
      this.stats.retries++;
      const backoff = Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 500;
      await sleep(Math.min(res.status === 429 ? backoff * 2 : backoff, Math.max(0, this.timeLeft())));
    }
  }

  // All explore sorts (Top Trending, Up-and-Coming, Top Playing Now, Top Rated, ...), following page tokens.
  async getSorts(country = 'all', device = 'computer', maxPages = 6) {
    const sorts = [];
    if (!this.discoveryOpen()) return sorts;
    let token = null;
    for (let p = 0; p < maxPages; p++) {
      const q = `sessionId=${this.sessionId}&device=${device}&country=${country}` + (token ? `&sortsPageToken=${encodeURIComponent(token)}` : '');
      const j = await this.get(`https://apis.roblox.com/explore-api/v1/get-sorts?${q}`);
      if (!j) break;
      for (const s of j.sorts || []) if (s.contentType === 'Games' && s.games?.length) sorts.push({ sortId: s.sortId, name: s.sortDisplayName, games: s.games });
      token = j.nextSortsPageToken;
      if (!token) break;
    }
    return sorts;
  }

  // One sort for one country, e.g. up-and-coming in Brazil.
  async getSortContent(sortId, country = 'all', device = 'computer') {
    if (!this.discoveryOpen()) return [];
    const j = await this.get(`https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${this.sessionId}&sortId=${encodeURIComponent(sortId)}&device=${device}&country=${country}`);
    return j?.games || [];
  }

  // Keyword search. Deeper pages reach games with only a handful of players.
  async search(keyword, pages = 2) {
    const out = [];
    if (!this.discoveryOpen()) return out;
    let token = null;
    for (let p = 0; p < pages; p++) {
      const q = `searchQuery=${encodeURIComponent(keyword)}&sessionId=${this.sessionId}&pageType=all` + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
      const j = await this.get(`https://apis.roblox.com/search-api/omni-search?${q}`);
      if (!j) break;
      for (const grp of j.searchResults || []) if (grp.contentGroupType === 'Game') out.push(...(grp.contents || []));
      token = j.nextPageToken;
      if (!token) break;
    }
    return out;
  }

  // Full details + live CCU for up to 50 universes per call.
  async getGames(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const j = await this.get(`https://games.roblox.com/v1/games?universeIds=${ids.slice(i, i + 50).join(',')}`);
      if (j?.data) out.push(...j.data);
    }
    return out;
  }

  async getVotes(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const j = await this.get(`https://games.roblox.com/v1/games/votes?universeIds=${ids.slice(i, i + 50).join(',')}`);
      if (j?.data) out.push(...j.data);
    }
    return out;
  }
}
