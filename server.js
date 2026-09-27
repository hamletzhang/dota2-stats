// 个人 Dota2 战绩查询网站 - 后端
// 纯 Node.js（无外部依赖）：静态文件服务 + OpenDota API 代理（带内存缓存）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7778;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPENDOTA_BASE = 'https://api.opendota.com/api';

// ---------- 简单内存缓存 ----------
const cache = new Map(); // key -> { data, status, expires }
function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { cache.delete(key); return null; }
  return item;
}
function cacheSet(key, data, status, ttlMs) {
  cache.set(key, { data, status, expires: Date.now() + ttlMs });
}
// 缓存 TTL 策略：常量类 24h，玩家数据 60s，比赛详情 1h（不可变）
function ttlFor(p) {
  if (p.startsWith('heroes') || p.startsWith('constants')) return 24 * 3600 * 1000;
  if (p.startsWith('matches/')) return 3600 * 1000;
  return 60 * 1000;
}

// ---------- OpenDota 代理 ----------
async function proxyOpenDota(req, res, odPath, method) {
  const cacheKey = method + ' ' + odPath;
  if (method === 'GET') {
    const hit = cacheGet(cacheKey);
    if (hit) {
      res.writeHead(hit.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT' });
      res.end(hit.data);
      return;
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(OPENDOTA_BASE + '/' + odPath, {
      method,
      signal: controller.signal,
      headers: { 'User-Agent': 'personal-dota2-stats/1.0' },
    });
    clearTimeout(timer);
    const body = await resp.text();
    if (method === 'GET' && resp.ok) cacheSet(cacheKey, body, resp.status, ttlFor(odPath));
    res.writeHead(resp.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'OpenDota 请求失败: ' + e.message }));
  }
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
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- 路由 ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p.startsWith('/api/od/')) {
    // 代理到 OpenDota：/api/od/players/123 -> https://api.opendota.com/api/players/123
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
