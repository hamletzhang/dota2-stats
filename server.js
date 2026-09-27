// 个人 Dota2 战绩查询网站 - 后端
// 纯 Node.js（无外部依赖）：静态文件服务 + OpenDota 代理（内存缓存）+ 聚合接口 + 图片代理
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = 7778;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPENDOTA_BASE = 'https://api.opendota.com/api';
const IMG_CACHE_DIR = '/tmp/dota2-img-cache';
const HERO_IMG_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/';
const CACHE_MAX = 500;

// ---------- 内存缓存（条数上限，按插入顺序淘汰最旧） ----------
const cache = new Map(); // key -> { data, status, expires }
function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) return null; // 过期不删，留给 stale 兜底
  return item;
}
function cacheGetStale(key) {
  return cache.get(key) || null;
}
function cacheSet(key, data, status, ttlMs) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, status, expires: Date.now() + ttlMs });
}
function cacheDelPrefix(prefix) {
  for (const k of cache.keys()) if (k.includes(prefix)) cache.delete(k);
}
// TTL 策略（路径为 OpenDota 侧路径，不含 /api/od/ 前缀）
const MIN = 60 * 1000, HOUR = 3600 * 1000, DAY = 24 * HOUR;
function ttlFor(p) {
  if (p.startsWith('heroes') || p.startsWith('constants')) return 7 * DAY;
  if (/^matches\/\d+$/.test(p)) return 30 * DAY;          // 比赛详情不可变
  if (/^players\/\d+\/matches/.test(p)) return 10 * MIN;  // 玩家比赛列表
  if (/^players\/\d+\/wl/.test(p)) return 10 * MIN;
  if (/^players\/\d+\/peers/.test(p)) return HOUR;
  if (/^players\/\d+/.test(p)) return HOUR;               // 玩家资料
  return 60 * 1000;
}

// ---------- 上游请求 ----------
const odAgent = new https.Agent({ keepAlive: true });
function odFetch(odPath, method) {
  return new Promise((resolve, reject) => {
    const req = https.request(OPENDOTA_BASE + '/' + odPath, {
      method: method || 'GET',
      agent: odAgent,
      headers: { 'User-Agent': 'personal-dota2-stats/2.0' },
      timeout: 15000,
    }, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(new Error('OpenDota 请求超时')); });
    req.on('error', reject);
    req.end();
  });
}
// 带缓存的 GET；上游失败时回退过期缓存（stale）
async function odCached(odPath) {
  const key = 'GET ' + odPath;
  const hit = cacheGet(key);
  if (hit) return { status: hit.status, body: hit.data, cache: 'HIT' };
  try {
    const r = await odFetch(odPath);
    if (r.status >= 200 && r.status < 300) cacheSet(key, r.body, r.status, ttlFor(odPath));
    return { status: r.status, body: r.body, cache: 'MISS' };
  } catch (e) {
    const stale = cacheGetStale(key);
    if (stale) return { status: stale.status, body: stale.data, cache: 'STALE' };
    throw e;
  }
}

// ---------- 响应辅助 ----------
function sendJson(req, res, status, data, cacheFlag) {
  const accept = String(req.headers['accept-encoding'] || '');
  const head = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cacheFlag) head['X-Cache'] = cacheFlag;
  if (accept.includes('gzip')) {
    zlib.gzip(data, (err, out) => {
      if (err) { res.writeHead(status, head); res.end(data); return; }
      head['Content-Encoding'] = 'gzip';
      res.writeHead(status, head);
      res.end(out);
    });
  } else {
    res.writeHead(status, head);
    res.end(data);
  }
}

// ---------- 聚合接口：GET /api/player/{id}/summary ----------
async function handleSummary(req, res, id) {
  try {
    const [profile, wl, matches, peers] = await Promise.all([
      odCached(`players/${id}`),
      odCached(`players/${id}/wl`),
      odCached(`players/${id}/matches?limit=100`),
      odCached(`players/${id}/peers`),
    ]);
    if (profile.status !== 200) {
      sendJson(req, res, profile.status === 404 ? 404 : 502,
        JSON.stringify({ error: '找不到该玩家，请检查 ID（若玩家未公开比赛数据则无法查询）' }));
      return;
    }
    const stale = [profile, wl, matches, peers].some((r) => r.cache === 'STALE');
    sendJson(req, res, 200, JSON.stringify({
      profile: JSON.parse(profile.body.toString()),
      wl: JSON.parse(wl.body.toString()),
      matches: JSON.parse(matches.body.toString()),
      peers: JSON.parse(peers.body.toString()),
    }), stale ? 'STALE' : 'OK');
  } catch (e) {
    sendJson(req, res, 502, JSON.stringify({ error: 'OpenDota 请求失败: ' + e.message }));
  }
}

// ---------- OpenDota 代理（保留原语义） ----------
async function proxyOpenDota(req, res, odPath, method) {
  if (method === 'POST') {
    // refresh：请求重新解析，成功后清掉该玩家的服务端缓存
    try {
      const r = await odFetch(odPath, 'POST');
      const m = odPath.match(/^players\/(\d+)\/refresh/);
      if (m && r.status >= 200 && r.status < 300) cacheDelPrefix(`players/${m[1]}`);
      sendJson(req, res, r.status, r.body);
    } catch (e) {
      sendJson(req, res, 502, JSON.stringify({ error: 'OpenDota 请求失败: ' + e.message }));
    }
    return;
  }
  try {
    const r = await odCached(odPath);
    sendJson(req, res, r.status, r.body, r.cache);
  } catch (e) {
    sendJson(req, res, 502, JSON.stringify({ error: 'OpenDota 请求失败: ' + e.message }));
  }
}

// ---------- 英雄图标代理：GET /img/hero/{key}.png（磁盘缓存 + immutable） ----------
function handleHeroImage(res, key) {
  if (!/^[a-z_]+$/.test(key)) { res.writeHead(400); res.end(); return; }
  const file = path.join(IMG_CACHE_DIR, key + '.png');
  fs.readFile(file, (err, data) => {
    if (!err) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(data);
      return;
    }
    https.get(HERO_IMG_BASE + key + '.png', { timeout: 15000 }, (up) => {
      if (up.statusCode !== 200) { res.writeHead(up.statusCode); res.end(); up.resume(); return; }
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.mkdir(IMG_CACHE_DIR, { recursive: true }, () => fs.writeFile(file, buf, () => {}));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
        res.end(buf);
      });
    }).on('error', () => { res.writeHead(502); res.end(); });
  });
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底：非文件路径回退到 index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath);
    const cc = ext === '.html' ? 'no-cache' : 'public, max-age=604800';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc });
    res.end(data);
  });
}

// ---------- 路由 ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  const sum = p.match(/^\/api\/player\/(\d{1,12})\/summary$/);
  if (sum && req.method === 'GET') { handleSummary(req, res, sum[1]); return; }

  const img = p.match(/^\/img\/hero\/([a-z_]+)\.png$/);
  if (img && req.method === 'GET') { handleHeroImage(res, img[1]); return; }

  if (p.startsWith('/api/od/')) {
    const odPath = p.slice('/api/od/'.length) + (u.search || '');
    if (req.method === 'GET' || req.method === 'POST') {
      proxyOpenDota(req, res, odPath, req.method);
      return;
    }
  }
  if (req.method === 'GET') { serveStatic(req, res, p); return; }
  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`Dota2 Stats 已启动: http://0.0.0.0:${PORT}`);
});
