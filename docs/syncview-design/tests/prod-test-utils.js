'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

function serveStatic() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    p = path.normalize(p).replace(/^([.][\\/])+/, '');
    const full = path.join(root, p);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function isWriteLikeRequest(req) {
  const method = typeof req.method === 'function' ? req.method() : req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = typeof req.url === 'function' ? req.url() : req.url;
  return /supabase|n8n|webhook|syncview|rest\/v1|functions\/v1/i.test(url || '');
}

async function installProductionInit(page) {
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    window.__prodBootMarks = [];
    const record = () => {
      try {
        window.__prodBootMarks.push({
          t: Math.round(performance.now()),
          boot: document.documentElement.getAttribute('data-boot-nav') || '',
          theme: document.documentElement.getAttribute('data-theme') || '',
        });
      } catch (_) {}
    };
    record();
    try {
      new MutationObserver(record).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-boot-nav', 'data-theme'],
      });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });
}

async function openProduction(page, port, pathSuffix = '/?prod=1') {
  await page.goto(`http://127.0.0.1:${port}${pathSuffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.prod-view, .prod-error', { timeout: 30000 });
  if (await page.locator('.prod-error').count()) {
    const msg = (await page.locator('.prod-error').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error('Production preview rendered an error card: ' + msg);
  }
  await page.waitForSelector('.prod-row, .prod-empty-state, .prod-board, .prod-detail, .prod-loading', { timeout: 30000 });
}

function formatFailures(title, failures) {
  return `${title}:\n` + failures.map(f => `  - ${f}`).join('\n');
}

module.exports = {
  root,
  serveStatic,
  isWriteLikeRequest,
  installProductionInit,
  openProduction,
  formatFailures,
};
