// Storage layer. Everything lives in plain files under the store directory so it can be
// committed to a git branch by GitHub Actions (or kept on disk when run locally).
//
//   registry.json                  game metadata + discovery bookkeeping
//   snapshots/YYYY-MM-DD.csv.gz    one row per game per run: ts,id,playing,visits,favorites,up,down
//   discovery/YYYY-MM-DD.csv.gz    one row per listing: ts,id,source,country,rank
//   rollup/daily.csv.gz            daily aggregates for days older than RAW_DAYS
//   state.json                     previous analysis, used to raise "what changed" alerts
//
// Gzip files are appended as extra gzip members, which zlib reads back as one stream.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const RAW_DAYS = 35;

export class Store {
  constructor(dir) {
    this.dir = dir;
    for (const d of ['', 'snapshots', 'discovery', 'rollup']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  p(...a) { return path.join(this.dir, ...a); }

  readJson(name, fallback) {
    try { return JSON.parse(fs.readFileSync(this.p(name), 'utf8')); } catch { return fallback; }
  }
  writeJson(name, obj) {
    const tmp = this.p(name + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, this.p(name));
  }

  loadRegistry() {
    return this.readJson('registry.json', { version: 1, runs: 0, keywordCursor: 0, countryCursor: 0, games: {} });
  }
  saveRegistry(reg) { this.writeJson('registry.json', reg); }

  appendCsv(sub, ts, lines) {
    if (!lines.length) return;
    const day = ts.slice(0, 10);
    fs.appendFileSync(this.p(sub, `${day}.csv.gz`), zlib.gzipSync(lines.join('\n') + '\n'));
  }

  readCsvDays(sub, sinceMs) {
    const rows = [];
    let files = [];
    try { files = fs.readdirSync(this.p(sub)).filter(f => f.endsWith('.csv.gz')).sort(); } catch { return rows; }
    const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);
    for (const f of files) {
      if (f.slice(0, 10) < sinceDay) continue;
      const text = zlib.gunzipSync(fs.readFileSync(this.p(sub, f))).toString('utf8');
      for (const line of text.split('\n')) if (line) rows.push(line.split(','));
    }
    return rows;
  }

  // Returns Map<id, [[tMs, playing, visits, favorites, up, down], ...]> sorted by time.
  loadSeries(sinceMs) {
    const m = new Map();
    for (const r of this.readCsvDays('snapshots', sinceMs)) {
      const t = Date.parse(r[0]);
      if (t < sinceMs) continue;
      const id = r[1];
      if (!m.has(id)) m.set(id, []);
      m.get(id).push([t, +r[2], +r[3], +r[4], r[5] === '' ? null : +r[5], r[6] === '' ? null : +r[6]]);
    }
    for (const s of m.values()) s.sort((a, b) => a[0] - b[0]);
    return m;
  }

  // Map<id, [{t, source, country, rank}]>
  loadDiscovery(sinceMs) {
    const m = new Map();
    for (const r of this.readCsvDays('discovery', sinceMs)) {
      const t = Date.parse(r[0]);
      if (t < sinceMs) continue;
      if (!m.has(r[1])) m.set(r[1], []);
      m.get(r[1]).push({ t, source: r[2], country: r[3], rank: +r[4] });
    }
    return m;
  }

  // Keeps the git branch small: raw files older than RAW_DAYS become one daily row per game.
  rollupOld(nowMs) {
    const cutoff = new Date(nowMs - RAW_DAYS * 864e5).toISOString().slice(0, 10);
    for (const sub of ['snapshots', 'discovery']) {
      for (const f of fs.readdirSync(this.p(sub))) {
        if (!f.endsWith('.csv.gz') || f.slice(0, 10) >= cutoff) continue;
        if (sub === 'snapshots') {
          const text = zlib.gunzipSync(fs.readFileSync(this.p(sub, f))).toString('utf8');
          const agg = new Map();
          for (const line of text.split('\n')) {
            if (!line) continue;
            const r = line.split(',');
            const a = agg.get(r[1]) || { n: 0, sum: 0, peak: 0, visits: 0, fav: 0 };
            a.n++; a.sum += +r[2]; a.peak = Math.max(a.peak, +r[2]); a.visits = Math.max(a.visits, +r[3]); a.fav = Math.max(a.fav, +r[4]);
            agg.set(r[1], a);
          }
          const day = f.slice(0, 10);
          const lines = [...agg].map(([id, a]) => `${day},${id},${Math.round(a.sum / a.n)},${a.peak},${a.visits},${a.fav}`);
          fs.appendFileSync(this.p('rollup', 'daily.csv.gz'), zlib.gzipSync(lines.join('\n') + '\n'));
        }
        fs.unlinkSync(this.p(sub, f));
      }
    }
  }
}
