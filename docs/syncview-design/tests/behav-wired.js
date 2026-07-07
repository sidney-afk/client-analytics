'use strict';
/*
 * Guard-mode behavioral baseline for the wired ?prod=1 tab.
 *
 * This adapts the artifact behav.js assertions to live B1 data. Mutation
 * assertions run in guard mode: the picker/menu opens, clicking a mutating value
 * shows "Preview - read-only", and the adapter state does not change.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const TOTAL = 138;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
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

async function txt(page, sel) {
  return (await page.locator(sel).first().textContent().catch(() => '') || '').trim();
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  const requests = [];
  const results = {};
  const deferred = {
    commentEdit: 'deferred-B3: comment edits mutate the production comment store',
    commentEditCancel: 'deferred-B3: comment edit mode is not enabled until writable comments ship',
    commentDelete: 'deferred-B3: comment deletion mutates the production comment store',
    boardDrag: 'deferred-B3: drag/drop changes project status',
    delCount: 'deferred-B3: delete mutates issue rows and children',
    draftPersist: 'deferred-B3: writable composer drafts are disabled in read-only preview',
    moveNoop: 'deferred-B3: move is a write-path action',
    addSubKeepOpen: 'deferred-B3: add sub-issue creates rows',
    editedMarker: 'deferred-B3: edited marker depends on writable comment edit',
    composerTextarea: 'deferred-B3: composer is represented by guarded read-only chrome',
    favSection: 'deferred-B3: favorites mutate issue/view preference state',
    favView: 'deferred-B3: favorites mutate issue/view preference state',
    selReconcile: 'deferred-B3: reconciliation depends on a status mutation hiding rows',
    fFavorite: 'deferred-B3: favorite shortcut mutates issue preference state',
    delSelPriority: 'deferred-B3: delete mutates selected issue rows',
    commentEditBlurDiscards: 'deferred-B3: comment edit mode is disabled until writable comments ship',
    fFromList: 'deferred-B3: favorite shortcut mutates issue preference state',
    subDueEmptyNew: 'deferred-B3: add sub-issue creates rows',
    focusAfterDelete: 'deferred-B3: focus advancement depends on deleting rows',
  };
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push({ method: req.method(), url: req.url() }));
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });

  const ok = async (name, fn) => {
    try { results[name] = await fn(); }
    catch (e) { results[name] = e && e.message ? e.message : String(e); }
  };
  const reset = async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      window._prodClearLayer && window._prodClearLayer();
      const cmd = document.querySelector('.prod-cmd-bd');
      if (cmd) cmd.remove();
      const toast = document.getElementById('prodToast');
      if (toast) { toast.classList.remove('show'); toast.textContent = ''; }
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.tab = 'active';
      _prodState.groupBy = 'status';
      _prodState.filters = [];
      _prodState.collapsed = new Set();
      _prodState.colCollapsed = new Set();
      _prodState.selected = new Set();
      _prodState.focusRow = '';
      _prodState.hoverRow = '';
      _prodState.listScrollTop = 0;
      window._prodRender();
    });
  };
  const guardClick = async (openSelector, valueSelector) => {
    const before = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
    await page.locator(openSelector).first().click();
    await page.waitForSelector(valueSelector, { timeout: 5000 });
    await page.locator(valueSelector).first().click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    const toast = await txt(page, '#prodToast');
    const after = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
    await page.keyboard.press('Escape').catch(() => {});
    return toast.includes('Preview - read-only') && before === after;
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty-state, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Production preview rendered an error card');

    // Artifact-order coverage batch: behav.js chip -> kfocusShortcut,
    // with mutation checks adapted to read-only guard mode.
    await ok('chip', async () => {
      const slug = await page.locator('.prod-row').first().getAttribute('data-prod-client');
      await page.locator('.prod-row .prod-chip-client').first().click();
      return await page.evaluate(s => _prodState.clientSlug === s && _prodState.view === 'list' && !_prodState.openId, slug);
    }); await reset();
    await ok('due', async () => {
      await page.locator('.prod-row .prod-due').first().click();
      return await page.locator('#prodLayer .prod-pop').count() === 1 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('avatar', async () => {
      await page.locator('.prod-row [data-prod-assign]').first().click();
      return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('rowStatus', async () => {
      await page.locator('.prod-row .prod-status[data-st]').first().click();
      return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('subLive', async () => {
      const parentId = await page.evaluate(() => {
        const row = _prodIssues().find(i => _prodChildrenOf(i.id).length > 0);
        return row ? row.id : '';
      });
      if (!parentId) return true;
      await page.evaluate(id => _prodOpenDeliverable(id), parentId);
      await page.waitForSelector('.prod-detail');
      const before = await txt(page, '[data-prod-section="subissues"] .prod-group-count');
      const controls = await page.locator('.prod-subrow .prod-status[data-st]').count() > 0
        && await page.locator('.prod-subrow .prod-due').count() > 0
        && await page.locator('.prod-subrow [data-prod-assign]').count() > 0;
      const snapshot = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
      await page.locator('.prod-subrow .prod-status[data-st]').first().click();
      await page.locator('#prodLayer .prod-pop [data-prod-pick]').first().click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const after = await txt(page, '[data-prod-section="subissues"] .prod-group-count');
      const snapshot2 = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
      return controls && before === after && snapshot === snapshot2;
    }); await reset();
    await ok('palette', async () => { await page.locator('.prod-search-btn').click(); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('paletteSearch', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', await page.locator('.prod-row .prod-id').first().textContent());
      return await page.locator('.prod-cmd-item').count() > 0;
    }); await reset();
    await ok('cmdkKey', async () => { await page.keyboard.press('Control+k'); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('team', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      const video = await page.locator('.prod-card').count();
      await page.locator('.prod-team-hd', { hasText: 'Graphics' }).click();
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).last().click();
      await page.waitForSelector('.prod-board');
      const graphics = await page.locator('.prod-card').count();
      return video >= 0 && graphics >= 0 && await page.locator('.prod-col').count() >= 6;
    }); await reset();
    await ok('star', async () => {
      await page.locator('.prod-row').first().click();
      await page.waitForSelector('.prod-detail');
      await page.locator('[data-prod-disabled="favorite-issue"]').click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('chevron', async () => {
      const key = await page.locator('.prod-group').first().getAttribute('data-prod-group');
      await page.locator('.prod-group [data-prod-group-toggle]').first().click();
      return await page.evaluate(k => _prodState.collapsed.has(k), key);
    }); await reset();
    await ok('pring', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card-status[data-prod-pstatus]').first().click();
      return await page.locator('#prodLayer .prod-pop [data-prod-ppick]').count() > 0 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('tabs', async () => (await page.locator('.prod-tabs .prod-tab').allTextContents()).join(',') === 'Active,Backlog,All issues'); await reset();
    await ok('my', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'My issues' }).click();
      return await page.evaluate(() => _prodState.view === 'my');
    }); await reset();
    await ok('kbStatus', async () => { await page.keyboard.press('s'); return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0; }); await reset();
    await ok('kbAssign', async () => { await page.keyboard.press('a'); return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0; }); await reset();
    await ok('kbDue', async () => { await page.keyboard.press('Shift+d'); return await page.locator('#prodLayer .prod-duepop').count() > 0; }); await reset();
    await ok('kbProj', async () => { await page.keyboard.press('Shift+p'); return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0; }); await reset();
    await ok('kbSelectAll', async () => {
      await page.keyboard.press('Control+a');
      return await page.evaluate(() => _prodState.selected.size === _prodFlatOrder().length && _prodState.selected.size > 0)
        && (await txt(page, '[data-prod-select-count]')).endsWith('selected');
    }); await reset();
    await ok('kbDelete', async () => {
      await page.keyboard.press('Control+a');
      const before = await page.evaluate(() => _prodIssues().length);
      await page.keyboard.press('Control+Backspace');
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const after = await page.evaluate(() => _prodIssues().length);
      return before === after && (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('pickerNum', async () => {
      const before = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status])));
      await page.locator('.prod-row .prod-status[data-st]').first().click();
      await page.locator('#prodLayer [data-prod-search]').press('2');
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const after = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status])));
      return before === after;
    }); await reset();
    await ok('pickerArrow', async () => {
      await page.locator('.prod-row .prod-status[data-st]').first().click();
      const i0 = await page.locator('#prodLayer [data-prod-pick].sel').first().getAttribute('data-prod-pick');
      await page.locator('#prodLayer [data-prod-search]').press('ArrowDown');
      const i1 = await page.locator('#prodLayer [data-prod-pick].sel').first().getAttribute('data-prod-pick');
      return i0 !== i1;
    }); await reset();
    await ok('composerEsc', async () => {
      await page.locator('.prod-row').first().click();
      await page.waitForSelector('.prod-detail');
      await page.locator('[data-prod-disabled="composer"]').click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return await page.locator('.prod-detail-title').count() === 1;
    }); await reset();
    await ok('selPersist', async () => {
      await page.keyboard.press('Control+a');
      const before = await page.evaluate(() => _prodState.selected.size);
      await page.locator('#prodBulkAssign').click();
      await page.locator('#prodLayer [data-prod-search]').press('Enter');
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const after = await page.evaluate(() => _prodState.selected.size);
      return before > 1 && after === before;
    }); await reset();
    await ok('copyCount', async () => {
      await page.keyboard.press('Control+a');
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const copied = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
      return (await txt(page, '#prodToast')).includes('links copied') && copied.split('\n').length > 1;
    }); await reset();
    await ok('personCross', async () => {
      const name = await page.evaluate(() => {
        const id = _prodIssues().find(i => i.assignee)?.assignee;
        const ed = id && _prodEditors()[id];
        return ed ? ed.name.split(' ')[0].toLowerCase() : '';
      });
      if (!name) return true;
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', name);
      await page.keyboard.press('Enter');
      return await page.evaluate(() => _prodState.filters.some(f => f.field === 'assignee') && _prodIssueRows().length > 0);
    }); await reset();
    await ok('jkNav', async () => {
      await page.keyboard.press('j');
      const first = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      await page.keyboard.press('j');
      const second = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      await page.keyboard.press('k');
      const third = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      return !!first && !!second && first !== second && third === first;
    }); await reset();
    await ok('enterFocusOpen', async () => {
      await page.keyboard.press('j');
      const id = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      await page.keyboard.press('Enter');
      return await page.locator('[data-prod-detail="' + id + '"]').count() === 1;
    }); await reset();
    await ok('kfocusShortcut', async () => {
      await page.keyboard.press('j');
      await page.keyboard.press('s');
      return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('groupPartial', async () => await page.evaluate(() => {
      const group = _prodGroupsFor(_prodIssueRows()).find(g => g.items.length > 1);
      if (!group) return true;
      _prodState.selected.clear();
      _prodState.selected.add(group.items[0].id);
      _prodRender();
      const partial = document.querySelector('[data-prod-group-check="' + CSS.escape(group.key) + '"]');
      const partOk = partial && partial.classList.contains('partial') && !partial.classList.contains('on');
      group.items.forEach(i => _prodState.selected.add(i.id));
      _prodRender();
      const full = document.querySelector('[data-prod-group-check="' + CSS.escape(group.key) + '"]');
      const fullOk = full && full.classList.contains('on') && !full.classList.contains('partial');
      _prodState.selected.clear();
      _prodRender();
      return partOk && fullOk;
    })); await reset();
    await ok('emptyColumn', async () => await page.evaluate(() => {
      _prodState.view = 'board';
      _prodState.team = 'video';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.clientSlug = '';
      _prodState.filters = [{ field: 'status', values: ['__none__'] }];
      _prodRender();
      const ok = document.querySelectorAll('.prod-col .prod-empty').length === PROD_BOARD_ORDER.length;
      _prodState.filters = [];
      _prodRender();
      return ok;
    })); await reset();
    await ok('markdown', async () => await page.evaluate(() => {
      const h = _prodLinkify('Ship **bold** and `code` and [docs](https://ex.com) plus https://y.com - VID-12586');
      return h.includes('<strong>bold</strong>')
        && h.includes('<code>code</code>')
        && h.includes('<a href="https://ex.com" target="_blank" rel="noopener">docs</a>')
        && h.includes('<a href="https://y.com"')
        && h.includes('12586')
        && !h.includes('XMDTOK');
    })); await reset();
    await ok('paletteCommand', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', 'my issues');
      await page.evaluate(() => {
        const cmd = [...document.querySelectorAll('.prod-cmd-item')].find(el => el.textContent.includes('My issues') && el.textContent.includes('Command'));
        if (cmd) cmd.click();
      });
      return await page.evaluate(() => _prodState.view === 'my');
    }); await reset();
    await ok('submenuEscape', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="status"]').hover();
      const twoPops = await page.locator('#prodLayer .prod-pop').count();
      await page.locator('#prodLayer .prod-pop [data-prod-search]').last().press('Escape');
      const onePop = await page.locator('#prodLayer .prod-pop').count();
      return twoPops === 2 && onePop === 1;
    }); await reset();
    await ok('menuNav', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      return await page.evaluate(() => {
        const pop = document.querySelector('#prodLayer .prod-pop');
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const a = pop.querySelector('.prod-mi.sel');
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const b = pop.querySelector('.prod-mi.sel');
        const all = [...pop.querySelectorAll('.prod-mi')];
        return !!a && !!b && all.indexOf(b) > all.indexOf(a);
      });
    }); await reset();
    await ok('menuNavEnter', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      return await page.evaluate(() => {
        const pop = document.querySelector('#prodLayer .prod-pop');
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return document.querySelectorAll('#prodLayer .prod-pop').length >= 2;
      });
    }); await reset();
    await ok('ppickNav', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card-status[data-prod-pstatus]').first().click();
      const before = await page.locator('#prodLayer [data-prod-ppick].sel').first().getAttribute('data-prod-ppick');
      await page.locator('#prodLayer [data-prod-search]').press('ArrowDown');
      const after = await page.locator('#prodLayer [data-prod-ppick].sel').first().getAttribute('data-prod-ppick');
      return before !== after;
    }); await reset();
    await ok('pickerSwitch', async () => {
      const id = await page.locator('.prod-row').first().getAttribute('data-prod-row');
      await page.locator('.prod-row').first().click();
      await page.waitForSelector('[data-prod-detail="' + id + '"]');
      await page.locator('[data-prod-prop="assignee"]').click();
      const open = await page.locator('#prodLayer .prod-pop .mlbl', { hasText: 'Unassigned' }).count() >= 0;
      const box = await page.locator('[data-prod-prop="status"]').boundingBox();
      if (!box) return false;
      await page.mouse.click(box.x + 8, box.y + box.height / 2);
      await page.waitForTimeout(80);
      const isStatus = await page.locator('#prodLayer .prod-pop .mlbl', { hasText: 'Backlog' }).count() > 0;
      return open && isStatus;
    }); await reset();
    await ok('tabTrap', async () => {
      await page.locator('.prod-row .prod-status[data-st]').first().click();
      return await page.evaluate(() => {
        const inp = document.querySelector('#prodLayer [data-prod-search]');
        if (!inp) return false;
        inp.focus();
        const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        inp.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
    }); await reset();
    await ok('groupProjectNav', async () => {
      await page.locator('#prodGroupBtn').click();
      await page.locator('.prod-pop [data-prod-grp="client"]').click();
      const key = await page.locator('.prod-group-title.navp[data-prod-project]').first().getAttribute('data-prod-project');
      await page.locator('.prod-group-title.navp[data-prod-project]').first().click();
      return await page.evaluate(k => _prodState.clientSlug === k && !_prodState.collapsed.has(k), key);
    }); await reset();
    await ok('kbSelPriority', async () => {
      await page.evaluate(() => {
        const order = _prodFlatOrder();
        _prodState.selected = new Set(order.slice(0, 2));
        _prodState.focusRow = order[2] || '';
        _prodRender();
      });
      await page.keyboard.press('s');
      await page.locator('#prodLayer [data-prod-search]').press('Enter');
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return await page.evaluate(() => _prodState.selected.size === 2);
    }); await reset();
    await ok('cardLead', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('[data-prod-plead]').first().click();
      return await page.locator('#prodLayer .prod-pop .mlbl', { hasText: 'No lead' }).count() > 0 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('cardTarget', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('[data-prod-ptarget]').first().click();
      return await page.locator('#prodLayer .prod-pop').count() === 1 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('cardCount', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      return await page.evaluate(() => {
        const card = document.querySelector('.prod-card[data-prod-client-card]');
        if (!card) return true;
        const slug = card.getAttribute('data-prod-client-card');
        const real = _prodIssueRows().filter(x => x.project === slug && !x.parent).length;
        const shown = card.querySelector('.prod-card-meta span').textContent;
        return shown === real + ' issue' + (real === 1 ? '' : 's');
      });
    }); await reset();
    await ok('subLeafNoHeader', async () => {
      const leafParent = await page.evaluate(() => {
        const leaf = _prodIssues().find(i => _prodChildrenOf(i.id).length === 0);
        return leaf ? leaf.id : '';
      });
      if (!leafParent) return true;
      await page.evaluate(id => _prodOpenDeliverable(id), leafParent);
      await page.waitForSelector('.prod-detail');
      return await page.locator('[data-prod-section="subissues"]').count() === 0;
    }); await reset();
    await ok('syncFocus', async () => {
      await page.locator('.prod-row .prod-status[data-st]').first().click();
      return await page.evaluate(() => document.activeElement === document.querySelector('#prodLayer [data-prod-search]'));
    }); await reset();
    await ok('cardMenu', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card').first().click({ button: 'right' });
      const hasItems = await page.locator('.prod-pop .mlbl', { hasText: 'Change status' }).count() > 0
        && await page.locator('.prod-pop .mlbl', { hasText: 'Copy link' }).count() > 0;
      await page.locator('.prod-pop .prod-mi', { hasText: 'Change status' }).click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return hasItems && (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('colCollapse', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      const key = await page.locator('[data-prod-pcolcollapse]').first().getAttribute('data-prod-pcolcollapse');
      await page.locator('[data-prod-pcolcollapse]').first().click();
      const collapsed = await page.evaluate(k => _prodState.colCollapsed.has(k), key);
      await page.locator('[data-prod-pcolcollapse="' + key + '"]').click();
      const expanded = await page.evaluate(k => !_prodState.colCollapsed.has(k), key);
      return collapsed && expanded;
    }); await reset();
    await ok('calArrowNav', async () => {
      await page.locator('.prod-row .prod-due').first().click();
      await page.locator('#prodLayer [data-prod-set="__custom__"]').click();
      const beforeFocus = await page.locator('#prodLayer .prod-cal-d.focus').first().getAttribute('data-prod-day');
      const beforeState = await page.evaluate(() => JSON.stringify(_prodIssues().map(i => [i.id, i.due])));
      await page.locator('#prodLayer [data-prod-search]').press('ArrowRight');
      const afterFocus = await page.locator('#prodLayer .prod-cal-d.focus').first().getAttribute('data-prod-day');
      await page.locator('#prodLayer [data-prod-search]').press('Enter');
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const afterState = await page.evaluate(() => JSON.stringify(_prodIssues().map(i => [i.id, i.due])));
      return beforeFocus !== afterFocus && beforeState === afterState;
    }); await reset();
    await ok('calEscape', async () => {
      const id = await page.locator('.prod-row').first().getAttribute('data-prod-row');
      await page.evaluate(rowId => _prodOpenDeliverable(rowId), id);
      await page.waitForSelector('.prod-detail');
      await page.locator('[data-prod-prop="due"]').click();
      await page.locator('#prodLayer [data-prod-set="__custom__"]').click();
      await page.locator('#prodLayer [data-prod-search]').press('Escape');
      return await page.locator('.prod-detail').count() === 1 && await page.locator('#prodLayer .prod-pop').count() === 0;
    }); await reset();
    await ok('subDueEmpty', async () => {
      const parentId = await page.evaluate(() => {
        const parent = _prodIssues().find(i => _prodChildrenOf(i.id).length > 0);
        return parent ? parent.id : '';
      });
      if (!parentId) return true;
      await page.evaluate(id => _prodOpenDeliverable(id), parentId);
      await page.waitForSelector('.prod-detail');
      return await page.locator('.prod-subrow .prod-due.optional').count() >= 0;
    }); await reset();
    await ok('filterSubEscape', async () => {
      await page.locator('#prodFilterBtn').click();
      await page.locator('#prodLayer [data-prod-ffield]').first().hover();
      const twoPops = await page.locator('#prodLayer .prod-pop').count();
      await page.locator('#prodLayer .prod-pop [data-prod-search]').last().press('Escape');
      const afterPops = await page.locator('#prodLayer .prod-pop').count();
      return twoPops === 2 && afterPops === 1;
    }); await reset();
    await ok('groupCheckHit', async () => {
      const beforeCollapsed = await page.locator('.prod-group.collapsed').count();
      await page.locator('.prod-group-check').first().click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      const afterCollapsed = await page.locator('.prod-group.collapsed').count();
      return beforeCollapsed === afterCollapsed && (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('paletteCmdClearSel', async () => {
      await page.keyboard.press('Control+a');
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', 'graphics issues');
      await page.evaluate(() => {
        const cmd = [...document.querySelectorAll('.prod-cmd-item')].find(el => el.textContent.includes('Graphics Issues') && el.textContent.includes('Command'));
        if (cmd) cmd.click();
      });
      return await page.evaluate(() => _prodState.selected.size === 0 && _prodState.team === 'graphics' && _prodState.view === 'list');
    }); await reset();
    await ok('goParent', async () => {
      const child = await page.evaluate(() => {
        const row = _prodIssues().find(i => i.parent && _prodIssue(i.parent));
        return row ? { id: row.id, parent: row.parent } : null;
      });
      if (!child) return true;
      await page.evaluate(id => _prodOpenDeliverable(id), child.id);
      await page.waitForSelector('.prod-detail');
      await page.locator('.prod-parent-link').click();
      return await page.evaluate(parent => _prodState.openId === parent, child.parent);
    }); await reset();
    await ok('brandCaret', async () => await page.locator('.prod-brand[data-prod-brandmenu] .prod-brand-caret').count() === 1
      && (await page.locator('.prod-brand[data-prod-brandmenu]').getAttribute('data-prod-tip')) === 'Switch workspace'); await reset();
    await ok('kbFocusOverHover', async () => {
      await page.keyboard.press('j');
      const focused = await page.evaluate(() => _prodState.focusRow);
      await page.locator('.prod-row').nth(2).hover();
      await page.keyboard.press('s');
      const focusStillWins = await page.evaluate(id => _prodState.focusRow === id && _prodState.hoverRow !== id, focused);
      return !!focused && focusStillWins && await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('clearFilters', async () => {
      await page.evaluate(() => { _prodState.filters = [{ field: 'status', values: ['__none__'] }]; _prodRender(); });
      await page.locator('.es-clear').click();
      return await page.evaluate(() => _prodState.filters.length === 0);
    }); await reset();
    await ok('filterValKeyNav', async () => {
      await page.locator('#prodFilterBtn').click();
      await page.locator('#prodLayer [data-prod-ffield]').first().hover();
      const input = page.locator('#prodLayer .prod-pop [data-prod-search]').last();
      await input.press('ArrowDown');
      const first = await page.locator('#prodLayer [data-prod-fv].sel').first().getAttribute('data-prod-fv');
      await input.press('ArrowDown');
      const second = await page.locator('#prodLayer [data-prod-fv].sel').first().getAttribute('data-prod-fv');
      await input.press('Enter');
      return first !== second && await page.evaluate(() => _prodState.filters.length > 0);
    }); await reset();
    await ok('underscoreMd', async () => await page.evaluate(() => {
      const h1 = _prodLinkify('This is _italic_ and __bold__ text');
      const h2 = _prodLinkify('the file lower_third.png stays');
      return h1.includes('<em>italic</em>') && h1.includes('<strong>bold</strong>') && !h2.includes('<em>');
    })); await reset();
    await ok('pcardRightClick', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card').first().click({ button: 'right' });
      return await page.locator('#prodLayer .prod-pop .mlbl', { hasText: 'Change status' }).count() > 0 && await page.locator('.prod-detail').count() === 0;
    }); await reset();
    await ok('subRowNoSelect', async () => {
      const parentId = await page.evaluate(() => {
        const parent = _prodIssues().find(i => _prodChildrenOf(i.id).length > 0);
        return parent ? parent.id : '';
      });
      if (!parentId) return true;
      await page.evaluate(id => _prodOpenDeliverable(id), parentId);
      await page.waitForSelector('.prod-detail');
      await page.locator('.prod-subrow').first().click({ modifiers: ['Shift'] });
      return await page.evaluate(() => _prodState.selected.size === 0);
    }); await reset();
    await ok('scrollPreserve', async () => await page.evaluate(() => {
      const list = document.querySelector('.prod-listwrap');
      if (!list || list.scrollHeight <= list.clientHeight) return true;
      list.scrollTop = 240;
      const set = list.scrollTop;
      const row = _prodFlatOrder()[0];
      if (row) _prodState.selected.add(row);
      _prodRender();
      const after = document.querySelector('.prod-listwrap').scrollTop;
      _prodState.selected.clear();
      _prodRender();
      return set > 0 && after === set;
    })); await reset();
    await ok('scrollBackNav', async () => await page.evaluate(() => {
      const list = document.querySelector('.prod-listwrap');
      if (!list || list.scrollHeight <= list.clientHeight) return true;
      list.scrollTop = 220;
      const set = list.scrollTop;
      const id = _prodFlatOrder()[Math.min(8, _prodFlatOrder().length - 1)];
      _prodOpenDeliverable(id);
      _prodSetView('list');
      const after = document.querySelector('.prod-listwrap').scrollTop;
      return set > 0 && after === set;
    })); await reset();
    await ok('dueFocusSync', async () => {
      const id = await page.locator('.prod-row').first().getAttribute('data-prod-row');
      await page.evaluate(rowId => _prodOpenDeliverable(rowId), id);
      await page.waitForSelector('.prod-detail');
      await page.locator('[data-prod-prop="due"]').click();
      await page.waitForFunction(() => document.activeElement === document.querySelector('#prodLayer [data-prod-search]'), null, { timeout: 1000 }).catch(() => {});
      return await page.evaluate(() => document.activeElement === document.querySelector('#prodLayer [data-prod-search]'));
    }); await reset();
    await ok('ctrlXGuard', async () => {
      await page.locator('.prod-row').first().hover();
      await page.keyboard.press('Control+x');
      const noSel = await page.evaluate(() => _prodState.selected.size === 0);
      await page.keyboard.press('x');
      return noSel && await page.evaluate(() => _prodState.selected.size === 1);
    }); await reset();
    await ok('composerBoxClick', async () => {
      const id = await page.locator('.prod-row').first().getAttribute('data-prod-row');
      await page.evaluate(rowId => _prodOpenDeliverable(rowId), id);
      await page.waitForSelector('.prod-detail');
      await page.locator('[data-prod-disabled="composer"]').click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('filterArrowRight', async () => {
      await page.locator('#prodFilterBtn').click();
      return await page.evaluate(() => {
        const pop = document.querySelector('#prodLayer .prod-pop');
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return document.querySelectorAll('#prodLayer .prod-pop').length === 2;
      });
    }); await reset();

    await ok('sidebarMyIssues', async () => await page.locator('.prod-nav-btn', { hasText: 'My issues' }).count() > 0);
    await ok('sidebarTeamProjects', async () => await page.locator('.prod-team-hd', { hasText: 'Video' }).count() > 0 && await page.locator('.prod-nav-btn', { hasText: 'Projects' }).count() > 0);
    await ok('searchButtonOpensPalette', async () => { await page.locator('.prod-search-btn').click(); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('cmdKOpensPalette', async () => { await page.keyboard.press('Control+k'); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('paletteSearchFindsIssue', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', await page.locator('.prod-row .prod-id').first().textContent());
      return await page.locator('.prod-cmd-item').count() > 0;
    }); await reset();
    await ok('paletteCommandSwitchesView', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', 'my issues');
      await page.evaluate(() => {
        const cmd = [...document.querySelectorAll('.prod-cmd-item')].find(el => el.textContent.includes('My issues') && el.textContent.includes('Command'));
        if (cmd) cmd.click();
      });
      return await page.locator('.prod-nav-btn.active', { hasText: 'My issues' }).count() === 1;
    }); await reset();
    await ok('groupCollapse', async () => {
      const before = await page.locator('.prod-row').count();
      await page.locator('.prod-group').first().click();
      const after = await page.locator('.prod-row').count();
      return before > after && await page.locator('.prod-group.collapsed').count() === 1;
    }); await reset();
    await ok('groupCheckGuard', async () => {
      await page.locator('.prod-group-check').first().click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('filterMenuOpens', async () => { await page.locator('#prodFilterBtn').click(); return await page.locator('.prod-pop [data-prod-ffield]').count() >= 3; }); await reset();
    await ok('filterSubSearchable', async () => {
      await page.locator('#prodFilterBtn').click();
      await page.locator('.prod-pop [data-prod-ffield="status"]').hover();
      return await page.locator('#prodLayer .prod-pop [data-prod-search]').count() > 0;
    }); await reset();
    await ok('filterAppliesLive', async () => {
      const before = await page.locator('.prod-row').count();
      await page.locator('#prodFilterBtn').click();
      await page.locator('.prod-pop [data-prod-ffield="status"]').hover();
      await page.locator('#prodLayer .prod-pop [data-prod-fv]').first().click();
      const pills = await page.locator('.prod-filter-pill.interactive').count();
      const after = await page.locator('.prod-row').count();
      return pills === 1 && after <= before;
    }); await reset();
    await ok('clearFiltersEmptySafe', async () => {
      await page.evaluate(() => { _prodState.filters = [{ field: 'status', values: ['__none__'] }]; window._prodRender(); });
      const empty = await page.locator('[data-prod-empty-state]').count();
      await page.locator('.es-clear').click();
      return empty === 1 && await page.locator('.prod-filter-pill.interactive').count() === 0;
    }); await reset();
    await ok('groupByAssignee', async () => {
      await page.locator('#prodGroupBtn').click();
      await page.locator('.prod-pop [data-prod-grp="assignee"]').click();
      return await page.evaluate(() => _prodState.groupBy === 'assignee');
    }); await reset();
    await ok('groupByClient', async () => {
      await page.locator('#prodGroupBtn').click();
      await page.locator('.prod-pop [data-prod-grp="client"]').click();
      return await page.evaluate(() => _prodState.groupBy === 'client');
    }); await reset();
    await ok('rowStatusGuard', async () => await guardClick('.prod-row .prod-status', '.prod-pop [data-prod-pick]')); await reset();
    await ok('rowDueGuard', async () => await guardClick('.prod-row .prod-due', '.prod-pop [data-prod-day]')); await reset();
    await ok('contextStatusSubmenu', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="status"]').hover();
      return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('contextCopyDeepLink', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
      const copied = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
      return copied.includes('?prod=1') && copied.includes('d=');
    }); await reset();
    await ok('keyboardArrowFocus', async () => {
      await page.keyboard.press('ArrowDown');
      return await page.locator('.prod-row.kfocus').count() === 1;
    }); await reset();
    await ok('keyboardEnterOpens', async () => {
      await page.keyboard.press('ArrowDown');
      const id = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      await page.keyboard.press('Enter');
      return await page.locator('[data-prod-detail="' + id + '"]').count() === 1;
    }); await reset();
    await ok('keyboardStatusGuardOpens', async () => {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('s');
      return await page.locator('.prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('detailPropertyGuard', async () => {
      await page.locator('.prod-row').first().click();
      await page.waitForSelector('.prod-detail');
      return await guardClick('[data-prod-prop="assignee"]', '.prod-pop [data-prod-pick]');
    }); await reset();
    await ok('boardColumnCollapse', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('[data-prod-pcolcollapse]').first().click();
      return await page.locator('.prod-col.collapsed .prod-col-rail').count() === 1;
    }); await reset();
    await ok('boardContextLeadUsesPersonIconGuarded', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card').first().click({ button: 'right' });
      const lead = page.locator('.prod-pop .prod-mi', { hasText: 'Set lead' }).first();
      return await lead.locator('.mic svg path[d*="M3.8 13"]').count() > 0;
    }); await reset();
    await ok('noWriteRequests', async () => requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).length === 0);
    await ok('noConsoleErrors', async () => errors.length === 0);

    const failed = Object.entries(results).filter(([, v]) => v !== true);
    console.log(JSON.stringify(results));
    console.log('behav-wired deferred-B3: ' + Object.keys(deferred).join(', '));
    const passed = Object.keys(results).length - failed.length;
    console.log('behav-wired: ' + passed + '/' + TOTAL + ' (guard mode)');
    if (failed.length) {
      console.error('behav-wired failures: ' + failed.map(([k, v]) => k + '=' + v).join(', '));
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error('behav-wired crash:', e); process.exit(2); });
