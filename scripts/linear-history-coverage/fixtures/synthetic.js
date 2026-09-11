'use strict';
const { CONTRACT, REQUIRED, hash } = require('../scan');
const AT = '2026-09-05T00:00:00.000Z';
const url = name => 'https://uploads.linear.app/fictional/' + name;
function makeFixture() {
  const base = (table, values) => Object.assign(Object.fromEntries(REQUIRED[table].map(k => [k, null])), values);
  const message = (id, extras = {}) => ({ id, body: url(id), audience: 'client', role: 'client', parent_id: null, ...extras });
  const fixture = {
    contract: CONTRACT,
    metadata: { source: { kind: 'synthetic', description: 'Fictional history coverage cases', artifact_sha256: hash('fictional') },
      captured_at: AT, known_omissions: [], tables: {} },
    data: {
      calendar_posts: [base('calendar_posts', { id: 'card-a', client: 'fictional-a', status: 'Approved',
        asset_url: url('video'), thumbnail_url: 'https://images.example.test/thumbnail',
        caption: '[source](' + url('caption') + ')',
        video_tweaks: JSON.stringify([
          message('root', { done: true, body: '![inline](' + url('inline') + ') ' + url('inline') }),
          message('reply', { parent_id: 'root', audience: 'internal' }),
          message('internal', { audience: 'internal' }),
          message('internal-reply', { parent_id: 'internal' }),
          message('deleted', { deleted: true }),
          message('hidden', { hidden: true }),
          message('reviewer', { role: 'kasper' }),
          message('attachment-root', { body: '', attachments: [{ url: url('attachment'), name: 'Fictional file' }] }),
        ]), graphic_tweaks: JSON.stringify([message('graphic')]), caption_tweaks: JSON.stringify([message('caption-thread')]), title_tweaks: JSON.stringify([message('title-thread')]) })],
      sample_reviews: [base('sample_reviews', { id: 'card-b', client: 'fictional-b', status: 'Approved',
        asset_url: 'https://media.example.test/signed?Expires=1', thumbnail_url: url('sample-thumb'),
        creative_direction: 'Reference ' + url('creative-direction'), hide_creative_direction: 'FALSE',
        video_tweaks: JSON.stringify([message('sample-thread')]), graphic_tweaks: '' })],
      production_comments: [
        base('production_comments', { id: 'canonical-root', deliverable_id: 'deliverable-b', audience: 'client', role: 'client', body: url('canonical'), body_format: 'markdown', attachments: [{ href: url('canonical-attachment') }], resolved_at: AT }),
        base('production_comments', { id: 'canonical-reply', deliverable_id: 'deliverable-b', parent_id: 'canonical-root', audience: 'client', role: 'smm', body: url('canonical-reply'), body_format: 'markdown', attachments: [] }),
        base('production_comments', { id: 'canonical-internal', deliverable_id: 'deliverable-b', audience: 'internal', role: 'smm', body: url('canonical-internal'), body_format: 'markdown', attachments: [] }),
        base('production_comments', { id: 'canonical-deleted', deliverable_id: 'deliverable-b', audience: 'client', role: 'client', body: url('canonical-deleted'), body_format: 'markdown', attachments: [{ url: url('deleted-attachment') }], deleted_at: AT }),
      ],
      deliverables: [base('deliverables', { id: 'deliverable-b', card_id: 'card-b', client_slug: 'fictional-b', origin: 'samples', team: 'video', brief: url('brief') })],
      thumbnail_media_revisions: [base('thumbnail_media_revisions', { id: 'revision-a', surface: 'calendar', source_id: 'card-a', client: 'fictional-a', status: 'changed', baseline_storage_path: 'fictional/baseline', latest_storage_path: 'fictional/latest' })],
      linear_archive: [base('linear_archive', { linear_uuid: 'archive-a', raw: { description: '![archive](' + url('archive-image') + ')' }, comments: [{ body: url('archive-comment') }] })],
      linear_archive_asset_refs: [],
    }, mappings: [], observations: [],
  };
  fixture.data.production_comments.forEach(row => { row.client_slug = 'fictional-b'; });
  for (const [table, fields] of Object.entries(REQUIRED)) fixture.metadata.tables[table] = {
    fields, pagination: { complete: true, expected_rows: fixture.data[table].length, returned_rows: fixture.data[table].length, next_cursor: null },
  };
  return fixture;
}
if (require.main === module) process.stdout.write(JSON.stringify(makeFixture(), null, 2) + '\n');
module.exports = { makeFixture, AT, url };
