#!/usr/bin/env node
// Tiny static server for previewing the dashboard locally: node scripts/serve.js site 8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'site');
const port = +(process.argv[3] || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(dir) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
