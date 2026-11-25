// Offline stand-in for RobloxClient that replays a captured snapshot file (fixtures/*.json).
// Same method names and response shapes as the live client.

import fs from 'node:fs';

export class FixtureClient {
  constructor(file) {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.capturedAt = fx.capturedAt;
    this.rows = fx.rows.map(r => ({
      id: r[0], rootPlaceId: r[1], name: r[2], description: r[3], genre_l1: r[4], genre_l2: r[5],
      created: r[6] + 'T00:00:00Z', updated: r[7] + ':00Z', playing: r[8], visits: r[9], favoritedCount: r[10],
      upVotes: r[11], downVotes: r[12], maxPlayers: r[13], creator: { name: r[14], type: r[15] === 'G' ? 'Group' : 'User' },
      sources: r[16].split('|'),
    }));
    this.stats = { requests: 0, failures: 0, retries: 0, rateLimited: 0, errors: [] };
  }
  lite(r) { return { universeId: r.id, name: r.name, playerCount: r.playing, totalUpVotes: r.upVotes, totalDownVotes: r.downVotes, rootPlaceId: r.rootPlaceId, genreL1: r.genre_l1 }; }
  async getSortContent(sortId, country) {
    this.stats.requests++;
    if (country !== 'all') return [];
    return this.rows.filter(r => r.sources.includes('sort:' + sortId)).map(r => this.lite(r));
  }
  async getSorts() {
    this.stats.requests++;
    const ids = [...new Set(this.rows.flatMap(r => r.sources).filter(s => s.startsWith('sort:')).map(s => s.slice(5)))];
    return ids.map(sortId => ({ sortId, name: sortId, games: this.rows.filter(r => r.sources.includes('sort:' + sortId)).map(r => this.lite(r)) }));
  }
  async search(kw) {
    this.stats.requests++;
    return this.rows.filter(r => r.sources.includes('search:' + kw)).map(r => this.lite(r));
  }
  async getGames(ids) {
    this.stats.requests += Math.ceil(ids.length / 50);
    const set = new Set(ids.map(String));
    return this.rows.filter(r => set.has(String(r.id)));
  }
  async getVotes(ids) {
    const set = new Set(ids.map(String));
    return this.rows.filter(r => set.has(String(r.id))).map(r => ({ id: r.id, upVotes: r.upVotes, downVotes: r.downVotes }));
  }
}
