'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { MEMBERS, CLIENTS } = require('./mock-backend');
const ROOT = path.resolve(__dirname, '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (source, args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
function provenance(source) {
  const files = git(source, ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const digest = crypto.createHash('sha256');
  for (const file of files) digest.update(file).update('\0').update(fs.readFileSync(path.join(source, file)));
  return { head: git(source, ['rev-parse', 'HEAD']), tracked_bytes_sha256: digest.digest('hex'),
    index_sha256: hash(fs.readFileSync(path.join(source, 'index.html'))),
    dirty_diff_sha256: hash(git(source, ['diff', 'HEAD', '--binary'])),
    clean: git(source, ['status', '--porcelain', '--untracked-files=no']) === '',
    observed_at: new Date().toISOString() };
}
function toolingProvenance() {
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).sort();
  return { head: git(ROOT, ['rev-parse', 'HEAD']), files: Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(__dirname, f)))])) };
}
function transportInit({ persona }) {
  // Fixture identity bootstrap follows PTO; no review state or handlers replaced.
  if (persona) {
    localStorage.setItem('syncview_auth_v1', 'ok');
    localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({
      key: 'fictional-lifecycle-key', role: persona.role, member: persona, verified_at: new Date().toISOString(),
    }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
    sessionStorage.setItem('syncview_staff_prompted_v1', '1');
  }
  window.__lifecycleWorkerBlocks = 0;
  for (const name of ['Worker', 'SharedWorker', 'RTCPeerConnection', 'webkitRTCPeerConnection']) {
    Object.defineProperty(window, name, { configurable: false, value: class {
      constructor() { window.__lifecycleWorkerBlocks++; throw new DOMException('Isolated lane', 'SecurityError'); }
    } });
  }
  if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, 'register', {
    value: async () => { window.__lifecycleWorkerBlocks++; throw new DOMException('Isolated lane', 'SecurityError'); },
  });
  class Chart { destroy() {} } Chart.defaults = {}; window.Chart = Chart;
  // Transport-only Supabase subscription stub, reused from boot's pattern.
  // The real app registers and invokes its own callback. No app handler injected.
  const channels = new Set();
  window.__lifecycleDeliverEvent = event => channels.forEach(c => c.listeners.forEach(l => {
    if (l.filter.table === event.table) l.callback(event);
  }));
  window.supabase = { createClient: () => ({
    channel: () => {
      const c = { listeners: [], on(type, filter, callback) { c.listeners.push({ filter, callback }); return c; },
        subscribe(callback) { channels.add(c); if (callback) queueMicrotask(() => callback('SUBSCRIBED')); return c; },
        unsubscribe() { channels.delete(c); return Promise.resolve('ok'); } };
      return c;
    }, removeChannel: c => { channels.delete(c); return Promise.resolve('ok'); },
  }) };
}
class Harness {
  constructor(source, output) { this.source = source; this.output = output; this.sessions = []; }
  async start() {
    // Existing server, loaded from the pinned candidate so its root is exact.
    const { serveStatic } = require(path.join(this.source, 'docs/syncview-design/tests/prod-test-utils.js'));
    this.server = await serveStatic(); this.origin = `http://127.0.0.1:${this.server.address().port}`;
    this.browser = await chromium.launch({ headless: true, args: [
      '--disable-background-networking', '--disable-component-update', '--no-pings',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ] });
    this.index = fs.readFileSync(path.join(this.source, 'index.html'), 'utf8');
    this.staticFiles = new Set(git(this.source, ['ls-files', '-z']).split('\0')
      .filter(f => /\.(html|css|js|json|svg|png|jpg|jpeg|ico|woff2?|mp[34])$/i.test(f)));
    this.documentHashes = [];
    this.apiHost = new URL(this.index.match(/https:\/\/[a-z0-9-]+\.supabase\.co/)[0]).hostname;
    this.webhookHost = new URL(this.index.match(/https:\/\/[a-z0-9.-]+\.n8n\.cloud/)[0]).hostname;
    return this;
  }
  async session(backend, role = 'smm', options = {}) {
    backend.apiHost = this.apiHost; backend.webhookHost = this.webhookHost;
    const context = await this.browser.newContext({ serviceWorkers: 'block',
      viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: !!options.mobile, hasTouch: !!options.mobile, timezoneId: 'America/Guatemala',
      storageState: options.storageState,
    });
    const s = { context, role, errors: [], sockets: [], pages: [], consoleErrors: [] }; this.sessions.push(s);
    await context.routeWebSocket('**/*', socket => { s.sockets.push('blocked'); socket.close(); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === this.origin) {
        if (this.documentOverride && ['/', '/index.html'].includes(url.pathname)) {
          return route.fulfill({ status: 200, contentType: 'text/html', body: this.documentOverride() });
        }
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const target = path.resolve(this.source, '.' + relative);
        if (!target.startsWith(this.source + path.sep) || !this.staticFiles.has(path.relative(this.source, target).split(path.sep).join('/'))
          || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          backend.blocked.push({ session: role, method: route.request().method(), path: 'local-unexpected' });
          return route.abort('blockedbyclient');
        }
      }
      return backend.handle(route, role, this.origin);
    });
    await context.addInitScript(transportInit, { persona: MEMBERS.find(m => m.role === role) || null });
    const page = await context.newPage(); s.page = page; s.pages.push(page);
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => s.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') s.consoleErrors.push(message.text()); });
    return s;
  }
  url(role, view = 'calendar', client = CLIENTS[0]) {
    if (view === 'production') return `${this.origin}/?prod=1`;
    if (role === 'client') return `${this.origin}/?c=${encodeURIComponent(client.display_name)}&t=fictional-client-token&v=calendar`;
    if (view === 'kasper') return `${this.origin}/?Kasper=1#kasper`;
    return `${this.origin}/#calendar/${client.slug}`;
  }
  async open(s, view = 'calendar', client) {
    const response = await s.page.goto(this.url(s.role, view, client), { waitUntil: 'domcontentloaded' });
    const servedHash = hash(await response.body()); this.documentHashes.push(servedHash);
    if (servedHash !== hash(this.index)) throw new Error('served_document_differs_from_pinned_source');
    return s.page;
  }
  async shot(page, name) {
    const file = name + '.png';
    await page.screenshot({ path: path.join(this.output, file), fullPage: false });
    return { file, sha256: hash(fs.readFileSync(path.join(this.output, file))) };
  }
  async closeSessions() { for (const s of this.sessions.splice(0)) await s.context.close(); }
  async close() { await this.closeSessions(); await this.browser?.close(); if (this.server) await new Promise(r => this.server.close(r)); }
}
module.exports = { Harness, ROOT, hash, provenance, toolingProvenance, transportInit };
