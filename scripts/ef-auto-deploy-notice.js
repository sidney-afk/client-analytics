'use strict';
/*
 * ef-auto-deploy-notice.js -- the failure notice of
 * .github/workflows/deploy-edge-functions-on-merge.yml.
 *
 * Sent the same way the other repository monitors page (the backup, the
 * watchdog): one typed message through the owner alert relay
 * (scripts/monitoring-alert-relay.js, SLACK_ALERT_WEBHOOK). It says which
 * functions failed or are held and the run id; the run summary says why and how
 * to release each. Public-safe by construction: function names, counts and the
 * run id only (the relay's own screen refuses links, emails and tokens).
 *
 *   node scripts/ef-auto-deploy-notice.js --plan=final.json [--results=results.json] [--job-status=failure]
 */
const fs = require('fs');
const { sendAlert } = require('./monitoring-alert-relay');

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

function noticeSpec(plan, results = {}, jobStatus = '') {
  const failed = Object.entries(results).filter(([, v]) => v !== 'deployed' && v !== 'released').map(([k]) => k);
  const held = plan.functions.filter(r => r.decision === 'held').map(r => r.slug);
  const parts = [];
  if (failed.length) parts.push(`failed_${failed.join('_')}`);
  if (held.length) parts.push(`held_${held.join('_')}`);
  if (!parts.length) parts.push(`run_${jobStatus || 'red'}`);
  parts.push(`commit_${String(plan.head).slice(0, 12)}`);
  return {
    type: 'ef_auto_deploy',
    team: 'edge',
    summaryParts: parts,
    count: failed.length + held.length,
    runId: `${process.env.GITHUB_RUN_ID || 'local'}:ef_auto_deploy`,
    details: { failed: failed.length, held: held.length },
  };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(arg('plan'), 'utf8'));
  const results = arg('results') && fs.existsSync(arg('results')) ? JSON.parse(fs.readFileSync(arg('results'), 'utf8')) : {};
  const webhook = String(process.env.SLACK_ALERT_WEBHOOK || '');
  if (!webhook) {
    console.log('::warning::SLACK_ALERT_WEBHOOK is not set; the red run is the only notice.');
    return;
  }
  const receipt = await sendAlert(noticeSpec(plan, results, arg('job-status')), { webhook });
  console.log(`owner relay: accepted=${receipt.accepted} delivery_confirmed=${receipt.delivery_confirmed}`);
}

if (require.main === module) main().catch(e => { console.error('ef-auto-deploy-notice: ' + e.message); process.exit(1); });
module.exports = { noticeSpec };
