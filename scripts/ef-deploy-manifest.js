'use strict';

/*
 * Generate the Edge Function deploy-ownership manifest from repository truth.
 *
 * Usage:
 *   node scripts/ef-deploy-manifest.js
 *   node scripts/ef-deploy-manifest.js --check
 *   node scripts/ef-deploy-manifest.js --stdout
 *
 * The generator reads function entrypoints and the workflows that can deploy
 * them. It never contacts Supabase or any other external service. Its only
 * write is docs/ops/EF_DEPLOY_MANIFEST.md in the default mode.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_ROOT = path.join(ROOT, 'supabase', 'functions');
const WORKFLOWS_ROOT = path.join(ROOT, '.github', 'workflows');
const OUTPUT_FILE = path.join(ROOT, 'docs', 'ops', 'EF_DEPLOY_MANIFEST.md');

const WORKFLOWS = Object.freeze([
  Object.freeze({
    id: 'deploy-onboarding',
    file: '.github/workflows/deploy-onboarding-edge-functions.yml',
  }),
  Object.freeze({
    id: 'deploy-pto',
    file: '.github/workflows/deploy-pto-edge-functions.yml',
  }),
  Object.freeze({
    id: 'deploy-thumbnail',
    file: '.github/workflows/deploy-thumbnail-edge-functions.yml',
  }),
]);

const DELIBERATE_MANUAL = Object.freeze({
  'client-review-link': 'Live v2 deployed by operator on 2026-07-15.',
  'client-token-verify': 'Strict client-entry v1 is deliberate-manual: deploy and read back the exact reviewed function source before serving its matching browser caller; no runtime-flag change is part of this release.',
  'production-archive': 'Source-only F34 protected archive reader; first deploy requires the exact merged SHA, explicit owner approval, `--no-verify-jwt`, fingerprint readback, and a TEST-only role/team/audience retrieval drill.',
  'workload-linear': 'Source-only Workload Linear metadata/deadline gateway; first deploy requires an exact-SHA operator release, `--no-verify-jwt`, fingerprint readback, and a TEST-client drill.',
  'workload-plan': 'Live v2 deployed by operator from `fd3e0eaa` on 2026-07-20; future redeploys require `--no-verify-jwt` and exact-SHA fingerprint readback.',
});

function slash(value) {
  return value.split(path.sep).join('/');
}

function repoRelative(file) {
  return slash(path.relative(ROOT, file));
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function listFunctionSlugs() {
  const slugs = fs.readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (!slugs.length) throw new Error('found no deployable Edge Function directories');
  for (const slug of slugs) {
    if (!isFile(path.join(FUNCTIONS_ROOT, slug, 'index.ts'))) {
      throw new Error(`function directory is missing index.ts: supabase/functions/${slug}`);
    }
  }
  return slugs;
}

function localImportSpecifiers(file) {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers = [];
  const pattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier.startsWith('.')) specifiers.push(specifier);
  }
  return Array.from(new Set(specifiers)).sort((a, b) => a.localeCompare(b));
}

function resolveLocalImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const functionsRelative = path.relative(FUNCTIONS_ROOT, base);
  if (functionsRelative === '..' || functionsRelative.startsWith(`..${path.sep}`)) {
    throw new Error(`${repoRelative(fromFile)} imports outside supabase/functions: ${specifier}`);
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
  ];
  const resolved = candidates.find(isFile);
  if (!resolved) {
    throw new Error(`cannot resolve ${specifier} imported by ${repoRelative(fromFile)}`);
  }
  return resolved;
}

function functionDependencies(slug) {
  const entrypoint = path.join(FUNCTIONS_ROOT, slug, 'index.ts');
  const visited = new Set([entrypoint]);
  const pending = [entrypoint];

  while (pending.length) {
    const current = pending.pop();
    for (const specifier of localImportSpecifiers(current)) {
      const dependency = resolveLocalImport(current, specifier);
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      pending.push(dependency);
    }
  }

  const shared = [];
  const local = [];
  for (const dependency of visited) {
    if (dependency === entrypoint) continue;
    const relative = slash(path.relative(FUNCTIONS_ROOT, dependency));
    if (relative.startsWith('_shared/')) shared.push(relative);
    else local.push(relative);
  }
  shared.sort((a, b) => a.localeCompare(b));
  local.sort((a, b) => a.localeCompare(b));
  return { shared, local };
}

function workflowStepBlocks(source) {
  const lines = source.split(/\r?\n/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {6}- (?:name|uses):/.test(lines[index])) starts.push(index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    return lines.slice(start, end).join('\n');
  });
}

function deployedSlugsFromStep(step) {
  if (!/\bsupabase\s+functions\s+deploy\b/.test(step)) return [];

  const found = [];
  const loopPattern = /for\s+fn\s+in\s+([^;\r\n]+);\s*do/g;
  let loop;
  while ((loop = loopPattern.exec(step)) !== null) {
    found.push(...loop[1].trim().split(/\s+/).filter(Boolean));
  }

  const literalPattern = /\bsupabase\s+functions\s+deploy\s+["']?([a-z0-9][a-z0-9-]*)["']?/g;
  let literal;
  while ((literal = literalPattern.exec(step)) !== null) found.push(literal[1]);

  if (!found.length) {
    throw new Error('found an unrecognized `supabase functions deploy` command in a deploy workflow');
  }
  return Array.from(new Set(found));
}

function inspectDeployWorkflows(slugs) {
  const knownWorkflowFiles = new Set(WORKFLOWS.map((workflow) => workflow.file));
  for (const entry of fs.readdirSync(WORKFLOWS_ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const file = path.join(WORKFLOWS_ROOT, entry.name);
    const source = fs.readFileSync(file, 'utf8');
    if (!/\bsupabase\s+functions\s+deploy\b/.test(source)) continue;
    const relative = repoRelative(file);
    if (!knownWorkflowFiles.has(relative)) {
      throw new Error(`unmapped Edge Function deploy workflow: ${relative}`);
    }
  }

  const owners = new Map();
  const slugSet = new Set(slugs);
  for (const workflow of WORKFLOWS) {
    const file = path.join(ROOT, workflow.file);
    const source = fs.readFileSync(file, 'utf8');
    const hasPush = /^  push:/m.test(source);
    const hasDispatch = /^  workflow_dispatch:/m.test(source);
    let deployStepCount = 0;

    for (const step of workflowStepBlocks(source)) {
      const deployedSlugs = deployedSlugsFromStep(step);
      if (!deployedSlugs.length) continue;
      deployStepCount += 1;
      const dispatchOnly = /^ {8}if:\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]\s*$/m.test(step);
      if (dispatchOnly && !hasDispatch) {
        throw new Error(`${workflow.file} has a dispatch-only deploy step without workflow_dispatch`);
      }
      const deployPath = dispatchOnly
        ? 'workflow_dispatch only (pinned SHA guard)'
        : hasPush && hasDispatch
          ? 'main push + workflow_dispatch'
          : hasPush
            ? 'main push'
            : hasDispatch
              ? 'workflow_dispatch'
              : 'unreachable';

      for (const slug of deployedSlugs) {
        if (!slugSet.has(slug)) {
          throw new Error(`${workflow.file} deploys unknown function slug: ${slug}`);
        }
        if (owners.has(slug)) {
          throw new Error(`${slug} is deployed by more than one workflow step`);
        }
        if (hasPush && !dispatchOnly) {
          const sourcePath = `supabase/functions/${slug}/**`;
          if (!source.includes(sourcePath)) {
            throw new Error(`${workflow.file} auto-deploys ${slug} without push path ${sourcePath}`);
          }
        }
        owners.set(slug, { workflow: workflow.id, deployPath });
      }
    }

    if (!deployStepCount) {
      throw new Error(`${workflow.file} contains no recognized Edge Function deploy step`);
    }
  }
  return owners;
}

function markdownCodeList(values) {
  if (!values.length) return '-';
  return values.map((value) => `\`${value}\``).join('<br>');
}

function workflowLink(id) {
  const workflow = WORKFLOWS.find((candidate) => candidate.id === id);
  if (!workflow) return 'NONE';
  return `[${id}](../../${workflow.file})`;
}

function generateManifest() {
  const slugs = listFunctionSlugs();
  const owners = inspectDeployWorkflows(slugs);
  const rows = slugs.map((slug) => {
    const dependencies = functionDependencies(slug);
    const owner = owners.get(slug);
    let deployPath;
    if (owner) {
      deployPath = owner.deployPath;
    } else if (DELIBERATE_MANUAL[slug]) {
      deployPath = `**NO CI DEPLOY PATH - DELIBERATE-MANUAL.** ${DELIBERATE_MANUAL[slug]}`;
    } else {
      deployPath = '**NO CI DEPLOY PATH.**';
    }
    return {
      slug,
      workflow: owner ? workflowLink(owner.workflow) : 'NONE',
      deployPath,
      deliberateManual: Boolean(DELIBERATE_MANUAL[slug]),
      shared: dependencies.shared,
      local: dependencies.local,
    };
  });

  const pushCount = rows.filter((row) => row.deployPath.startsWith('main push')).length;
  const dispatchOnlyCount = rows.filter((row) => row.deployPath.startsWith('workflow_dispatch only')).length;
  const noCiCount = rows.filter((row) => row.workflow === 'NONE').length;
  const deliberateManualCount = rows.filter((row) => row.deliberateManual).length;

  const lines = [
    '# Edge Function Deploy Manifest',
    '',
    '> Generated by `node scripts/ef-deploy-manifest.js`. Do not hand-edit; rerun the generator after changing an Edge Function, its relative imports, or a deploy workflow.',
    '',
    'This inventory treats each `supabase/functions/<slug>/index.ts` directory as one deployable Edge Function. Workflow ownership comes from actual `supabase functions deploy` commands in the repository. Dependency columns are the transitive static relative imports reachable from each `index.ts`; external `npm:` and HTTP imports are excluded.',
    '',
    'A workflow-dispatch-only entry has a CI deploy path but never deploys from a merge/push. `NO CI DEPLOY PATH` means no GitHub Actions workflow in this repository invokes a deploy for that slug; it does not by itself assert the live deployment state.',
    '',
    '## Coverage summary',
    '',
    '| Coverage | Count |',
    '| --- | ---: |',
    `| Deployable function slugs | ${rows.length} |`,
    `| Main-push plus manual-dispatch paths | ${pushCount} |`,
    `| Manual-dispatch-only paths | ${dispatchOnlyCount} |`,
    `| No CI deploy path | ${noCiCount} |`,
    `| Deliberate-manual subset of no-CI paths | ${deliberateManualCount} |`,
    '',
    '## Per-function ownership and dependencies',
    '',
    '| Function slug | Owning deploy workflow | Deploy path | `_shared` dependencies | Slug-local dependencies |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    lines.push(
      `| \`${row.slug}\` | ${row.workflow} | ${row.deployPath} | ${markdownCodeList(row.shared)} | ${markdownCodeList(row.local)} |`,
    );
  }

  lines.push(
    '',
    '## Regeneration',
    '',
    'Run `node scripts/ef-deploy-manifest.js` to regenerate this file, or `node scripts/ef-deploy-manifest.js --check` to fail when the committed manifest is stale. The generator is repository-local: it does not call Supabase, deploy functions, or modify live state.',
    '',
  );

  return {
    markdown: `${lines.join('\n')}`,
    counts: {
      slugs: rows.length,
      push: pushCount,
      dispatchOnly: dispatchOnlyCount,
      noCi: noCiCount,
      deliberateManual: deliberateManualCount,
    },
  };
}

function parseMode(argv) {
  const allowed = new Set(['--check', '--stdout']);
  for (const arg of argv) {
    if (!allowed.has(arg)) throw new Error(`unexpected argument: ${arg}`);
  }
  if (argv.includes('--check') && argv.includes('--stdout')) {
    throw new Error('--check and --stdout are mutually exclusive');
  }
  if (argv.includes('--check')) return 'check';
  if (argv.includes('--stdout')) return 'stdout';
  return 'write';
}

function printCounts(prefix, counts) {
  process.stderr.write(`${prefix}\n`);
  process.stderr.write(`Deployable slugs: ${counts.slugs}\n`);
  process.stderr.write(`Main-push plus manual paths: ${counts.push}\n`);
  process.stderr.write(`Manual-dispatch-only paths: ${counts.dispatchOnly}\n`);
  process.stderr.write(`No CI deploy path: ${counts.noCi}\n`);
  process.stderr.write(`Deliberate-manual exceptions: ${counts.deliberateManual}\n`);
}

function main() {
  const mode = parseMode(process.argv.slice(2));
  const generated = generateManifest();

  if (mode === 'stdout') {
    process.stdout.write(generated.markdown);
    printCounts('Generated manifest on stdout.', generated.counts);
    return;
  }

  if (mode === 'check') {
    const current = isFile(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, 'utf8') : '';
    if (current !== generated.markdown) {
      throw new Error(`${repoRelative(OUTPUT_FILE)} is stale; run node scripts/ef-deploy-manifest.js`);
    }
    printCounts(`Verified ${repoRelative(OUTPUT_FILE)}.`, generated.counts);
    return;
  }

  fs.writeFileSync(OUTPUT_FILE, generated.markdown, 'utf8');
  printCounts(`Wrote ${repoRelative(OUTPUT_FILE)}.`, generated.counts);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ef-deploy-manifest: ${error.message}\n`);
  process.exitCode = 1;
}
