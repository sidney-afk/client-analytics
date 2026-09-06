import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const fixturePath = process.env.CARD_MATERIALIZATION_FIXTURE;
const reportPath = process.env.CARD_MATERIALIZATION_PHASE_REPORT;
if (!fixturePath || !reportPath) throw new Error('local_phase_configuration_required');
const fixture = await import(pathToFileURL(fixturePath).href);
const { accepted, call, sql, rows, gw } = fixture;
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const result = { cases: [], provider_attempts: 0 };

if (process.env.CARD_MATERIALIZATION_PHASE === 'seed') {
  await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"native\",\"epoch\":\"synthetic-restore-coverage\"}'::jsonb where key='native_card_materialization';");
  for (const [mode, surface] of [['both', 'calendar'], ['both', 'samples'], ['video', 'calendar'], ['thumbnail', 'samples']]) {
    const candidate = await accepted(mode, surface);
    const reply = await call(candidate.body, candidate.surface, candidate.source);
    assert.equal(reply.ok, true, 'accepted materialization');
    const key = surface === 'calendar' ? 'post' : 'sample';
    const table = surface === 'calendar' ? 'calendar_posts' : 'sample_reviews';
    const card = candidate.body[key];
    if (mode === 'video') {
      assert.ok(card.video_deliverable_id); assert.ok(!card.graphic_deliverable_id);
      assert.equal(reply[key].graphic_deliverable_id, null);
    }
    if (mode === 'thumbnail') {
      assert.ok(card.graphic_deliverable_id); assert.ok(!card.video_deliverable_id);
      assert.equal(reply[key].video_deliverable_id, null);
    }
    await sql(`update public.${table} set name='Later human title',status='Approved',order_index=773 where client=${quote(candidate.body.client)} and id=${quote(card.id)};`);
    result.cases.push({ body: candidate.body, raw_body: JSON.stringify(candidate.body), surface: candidate.surface, source: candidate.source,
      current: (await rows(`select * from public.${table} where client=${quote(candidate.body.client)} and id=${quote(card.id)}`))[0] });
  }
  const raw = ' {\n "unaccepted":"synthetic retained attempt"\n} ';
  const held = await call(null, 'calendar', 'submission-native', raw);
  assert.equal(held.ok, false); assert.equal(held.conserved, true);
  assert.equal((await rows(`select raw_body from public.production_card_materialization_ingress where id=${quote(held.ingress_id)}`))[0].raw_body, raw);
  result.held = { ingress_id: held.ingress_id };
  await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"hold\"}'::jsonb where key='native_card_materialization';");
} else if (process.env.CARD_MATERIALIZATION_PHASE === 'replay') {
  const saved = JSON.parse(fs.readFileSync(process.env.CARD_MATERIALIZATION_PHASE_SEED, 'utf8'));
  for (const candidate of saved.cases) {
    const reply = JSON.parse(await sql(`set time zone 'America/Guatemala'; set role service_role; select public.production_card_materialize(${quote(candidate.surface)},${quote(candidate.source)},${quote(candidate.raw_body)})::text;`));
    assert.equal(reply.ok, true, 'accepted receipt replay in hold');
    assert.deepEqual(reply[candidate.surface === 'calendar' ? 'post' : 'sample'], candidate.current);
    result.ingress_ids = [...(result.ingress_ids || []), reply.ingress_id];
  }
  result.replayed = saved.cases.length;
} else throw new Error('local_phase_unknown');

result.provider_attempts = gw.net.requests.filter(row => /api\.linear\.app|linear-outbound/.test(row.url)).length;
assert.equal(result.provider_attempts, 0);
fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
