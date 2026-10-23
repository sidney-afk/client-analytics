'use strict';

/*
 * THE CLIENT-ROW DEADLINE DOT ON THE CALM WORKLOAD CALENDAR KEEPS ITS COLOUR (fictional data, all backend mocked).
 *
 * Owner, 2026-10-23: the circles on the Workload calendar were grey where they should be green. The dot on a
 * client row is the deadline-buffer dot (wlGroupDeadlineHtml): red when the work day is on or after the due date,
 * orange for 1 to 2 working days of buffer, green for 3 or more. A rule from the first calm pass painted the green
 * one grey, so a row with plenty of buffer looked the same as a mixed one. Only a mixed or no-deadline row is grey.
 * The shared calm fixture has no row with 3+ days of buffer, which is how this slipped through.
 *
 *   node docs/syncview-design/tests/workload-calm-buffer-dot-browser.js
 */

const F = require('./workload-calm-fixture.js');
const { issueRow, parentRow, MON, TUE, THU, FRI, NEXT_MON, EDITOR_1 } = F;

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM_BUFFER_DOT ' + message);
  checks++;
}

const ed1 = { assignee_id: EDITOR_1.id, assignee_name: EDITOR_1.name };
function card(id, client, due) {
  return issueRow({
    id, identifier: 'VID-' + id.toUpperCase(), title: 'Video ' + id, client_name: client,
    parent_id: 'parent-' + client.slice(-1).toLowerCase(), parent_identifier: 'VID-P' + client.slice(-1),
    url: '', ...ed1, due_date: due,
  });
}

// All on Tuesday for one editor: Client A has 4+ days of buffer, Client B 1 to 2, Client C is due that day,
// and Client A's Monday row mixes a green and a red video.
const issues = () => [
  parentRow({ id: 'parent-a', identifier: 'VID-PA', title: 'Client A batch', client_name: 'Client A' }),
  parentRow({ id: 'parent-b', identifier: 'VID-PB', title: 'Client B batch', client_name: 'Client B' }),
  parentRow({ id: 'parent-c', identifier: 'VID-PC', title: 'Client C batch', client_name: 'Client C' }),
  card('g1', 'Client A', NEXT_MON), card('g2', 'Client A', NEXT_MON),
  card('o1', 'Client B', THU),
  card('r1', 'Client C', TUE),
  card('m1', 'Client A', NEXT_MON), card('m2', 'Client A', MON),
];
const plans = () => ['g1', 'g2', 'o1', 'r1'].map(id => ({ issue_id: id, plan_date: TUE }))
  .concat([{ issue_id: 'm1', plan_date: MON }, { issue_id: 'm2', plan_date: MON }]);

async function readDots(page) {
  return page.evaluate(() => {
    const out = {};
    for (const s of document.querySelectorAll('.workload-grid.week summary[data-wl-client]')) {
      const wrap = s.querySelector('.wl-deadline-summary');
      const dot = wrap && wrap.querySelector('.wl-deadline-dot');
      const key = s.getAttribute('data-wl-date') + '|' + s.getAttribute('data-wl-client');
      out[key] = dot ? { cls: wrap.className, bg: getComputedStyle(dot).backgroundColor } : null;
    }
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const tone = {};
    for (const [k, v] of Object.entries({ green: '--wl-proximity-green', orange: '--wl-proximity-orange', red: '--wl-proximity-red', muted: '--text-muted', tweaks: '--wl-tweaks-accent' })) {
      probe.style.color = 'var(' + v + ')';
      tone[k] = getComputedStyle(probe).color;
    }
    probe.remove();
    return { rows: out, tone };
  });
}

async function check(label, options, shot) {
  const h = await F.launchCalmBoard({ issues: issues(), plans: plans(), ...options });
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    const { rows, tone } = await readDots(p);
    if (shot) {
      await p.locator('.workload-grid.week').first().screenshot({ path: shot });
      console.log('    screenshot ' + shot);
    }
    const row = (day, client) => rows[day + '|' + client];
    const green = row(TUE, 'Client A');
    const orange = row(TUE, 'Client B');
    const red = row(TUE, 'Client C');
    const mixed = row(MON, 'Client A');
    expect(green && /\bis-green\b/.test(green.cls), label + ': the 3+ day row is marked green (saw ' + JSON.stringify(green) + ')');
    expect(green.bg === tone.green, label + ': the 3+ day row draws a GREEN dot, not grey (saw ' + green.bg + ', green is ' + tone.green + ', grey is ' + tone.muted + ')');
    // Calm paints orange with the shared tweaks orange on purpose (same hue in light, lighter in dark).
    expect(orange && orange.bg === (options.calm ? tone.tweaks : tone.orange), label + ': the 1-2 day row draws an orange dot (saw ' + JSON.stringify(orange) + ')');
    expect(red && red.bg === tone.red, label + ': the same-day row draws a red dot (saw ' + JSON.stringify(red) + ')');
    if (options.calm) {
      expect(mixed && /\bis-neutral\b/.test(mixed.cls) && mixed.bg === tone.muted, label + ': a mixed row keeps its grey dot (saw ' + JSON.stringify(mixed) + ')');
    } else {
      expect(!mixed, label + ': the old view still draws no dot on a mixed row');
    }
    expect(h.state.pageErrors.length === 0, label + ': no page errors: ' + h.state.pageErrors[0]);
    console.log('--- ' + label + ': green, orange, red and mixed dots as expected');
  } finally { await h.close(); }
}

(async () => {
  const shotDir = process.env.WL_BUFFER_DOT_SHOTS || '';
  const shot = name => (shotDir ? require('path').join(shotDir, name) : '');
  await check('old view (switch off)', {}, shot('old-view.png'));
  await check('calm view', { calm: true }, shot('calm-light.png'));
  await check('calm view, dark', { calm: true, theme: 'dark' }, shot('calm-dark.png'));
  console.log('workload-calm-buffer-dot-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e.message || e); process.exit(1); });
