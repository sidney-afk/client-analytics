'use strict';

const fs = require('fs');
const path = require('path');
const { root, formatFailures } = require('./prod-test-utils');

const packetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.codex-tmp', 'prod-review-packet');

const requiredNames = [
  'desktop-list',
  'selected-actions-menu',
  'combined-filters',
  'project-board',
  'project-detail',
  'parent-detail',
  'subissue-detail',
  'dark-list',
  'mobile-list',
  'mobile-detail',
];

function readText(dir, file, failures) {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf8');
  } catch (err) {
    failures.push(`Missing ${file}: ${err.message}`);
    return '';
  }
}

function readJson(dir, file, failures) {
  const text = readText(dir, file, failures);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    failures.push(`${file} is not valid JSON: ${err.message}`);
    return null;
  }
}

function readPngSize(dir, file, failures) {
  const full = path.join(dir, file);
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch (err) {
    failures.push(`Missing screenshot ${file}: ${err.message}`);
    return null;
  }
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.slice(0, 8).toString('hex') !== signature) {
    failures.push(`${file} is not a PNG screenshot`);
    return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function validatePacket(dir = packetDir) {
  const failures = [];
  if (!fs.existsSync(dir)) {
    return [`Review packet directory does not exist: ${dir}`];
  }

  const manifest = readJson(dir, 'review-manifest.json', failures);
  const markdown = readText(dir, 'manifest.md', failures);
  const checklist = readText(dir, 'review-checklist.md', failures);
  const gallery = readText(dir, 'index.html', failures);
  if (!manifest) return failures;

  if (manifest.schema !== 'syncview.productionReviewPacket.v1') {
    failures.push(`Unexpected review-manifest schema: ${manifest.schema || '(missing)'}`);
  }
  if (manifest.queryGate !== '?prod=1') {
    failures.push(`Unexpected query gate: ${manifest.queryGate || '(missing)'}`);
  }
  if (!manifest.readOnlyInvariant || manifest.readOnlyInvariant.passed !== true) {
    failures.push('Read-only invariant did not pass in review-manifest.json');
  }
  if (manifest.readOnlyInvariant && manifest.readOnlyInvariant.writeLikeRequests !== 0) {
    failures.push(`Expected 0 write-like requests, saw ${manifest.readOnlyInvariant.writeLikeRequests}`);
  }
  if (manifest.readOnlyInvariant && manifest.readOnlyInvariant.pageOrConsoleErrors !== 0) {
    failures.push(`Expected 0 page/console errors, saw ${manifest.readOnlyInvariant.pageOrConsoleErrors}`);
  }
  if (!manifest.files || manifest.files.gallery !== 'index.html' || manifest.files.markdown !== 'manifest.md' || manifest.files.checklist !== 'review-checklist.md') {
    failures.push('review-manifest.json must point to index.html, manifest.md, and review-checklist.md');
  }

  const shots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (shots.length !== requiredNames.length) {
    failures.push(`Expected ${requiredNames.length} screenshots, found ${shots.length}`);
  }

  const names = new Set(shots.map(shot => shot && shot.name));
  requiredNames.forEach(name => {
    if (!names.has(name)) failures.push(`Missing required screenshot metadata: ${name}`);
  });
  const byName = name => shots.find(shot => shot && shot.name === name);

  shots.forEach((shot, index) => {
    const label = shot && (shot.file || shot.name || `screenshot-${index + 1}`);
    if (!shot || typeof shot !== 'object') {
      failures.push(`Screenshot ${index + 1} metadata is missing`);
      return;
    }
    ['file', 'name', 'label', 'note', 'surface', 'route', 'theme'].forEach(field => {
      if (!shot[field]) failures.push(`${label} missing ${field}`);
    });
    if (!shot.route || !shot.route.startsWith('production')) {
      failures.push(`${label} route must start with production`);
    }
    if (!shot.viewport || !Number.isFinite(shot.viewport.width) || !Number.isFinite(shot.viewport.height)) {
      failures.push(`${label} missing numeric viewport metadata`);
    }
    if (!Array.isArray(shot.checks) || shot.checks.length === 0) {
      failures.push(`${label} missing inspection checks`);
    }
    if (shot.file) {
      const size = readPngSize(dir, shot.file, failures);
      if (size && shot.viewport) {
        if (size.width <= 0 || size.height <= 0) {
          failures.push(`${shot.file} has invalid PNG dimensions ${size.width}x${size.height}`);
        }
        if (Number.isFinite(shot.viewport.width) && Math.abs(size.width - shot.viewport.width) > 2) {
          failures.push(`${shot.file} width ${size.width} does not match viewport ${shot.viewport.width}`);
        }
        if (Number.isFinite(shot.viewport.height) && Math.abs(size.height - shot.viewport.height) > 2) {
          failures.push(`${shot.file} height ${size.height} does not match viewport ${shot.viewport.height}`);
        }
      }
      if (markdown && !markdown.includes(shot.file)) failures.push(`manifest.md does not reference ${shot.file}`);
      if (checklist && !checklist.includes(shot.file)) failures.push(`review-checklist.md does not reference ${shot.file}`);
      if (gallery && !gallery.includes(shot.file)) failures.push(`index.html does not reference ${shot.file}`);
    }
  });

  const mobileShots = shots.filter(shot => shot.viewport && shot.viewport.isMobile);
  const darkShots = shots.filter(shot => shot.theme === 'dark');
  if (mobileShots.length < 2) failures.push('Expected at least two mobile screenshots');
  if (darkShots.length < 1) failures.push('Expected at least one dark theme screenshot');
  const selectedActions = byName('selected-actions-menu');
  const expectedBulkLabels = ['Assign to...', 'Change status...', 'Move to project...', 'Copy issue IDs', 'Change due date...', 'Delete issues'];
  const desktopList = byName('desktop-list');
  if (!desktopList || !desktopList.evidence || desktopList.evidence.visibleGroups < 1 || desktopList.evidence.groupAddControls !== 0) {
    failures.push('desktop-list screenshot must record grouped rows with no fake group-header add controls in review-manifest.json');
  }
  if (!desktopList || !desktopList.evidence || desktopList.evidence.topbarFakeControls !== 0) {
    failures.push('desktop-list screenshot must record zero fake favorite/notification topbar controls in review-manifest.json');
  }
  if (!selectedActions || !selectedActions.evidence || !selectedActions.evidence.actionBarVisible || !selectedActions.evidence.menuVisible || !selectedActions.evidence.searchVisible || selectedActions.evidence.selectedRows < 2) {
    failures.push('selected-actions-menu screenshot must record visible action bar, searchable menu, and selected-row evidence in review-manifest.json');
  } else if (selectedActions.evidence.actionBarReceded === true) {
    failures.push('selected-actions-menu screenshot must keep the action bar visible instead of receding it');
  } else if (selectedActions.evidence.menuCentered !== true || selectedActions.evidence.menuWidth < 640 || selectedActions.evidence.menuAboveActionBar !== true) {
    failures.push('selected-actions-menu screenshot must record a centered Linear-style command panel above the action bar');
  } else if (selectedActions.evidence.submenuOpenOnHover) {
    failures.push('selected-actions-menu screenshot must prove hover does not open a blocking picker submenu');
  } else {
    const labels = Array.isArray(selectedActions.evidence.commandLabels) ? selectedActions.evidence.commandLabels : [];
    if (labels.join('|') !== expectedBulkLabels.join('|')) {
      failures.push(`selected-actions-menu command labels changed: ${labels.join('|') || '(none)'}`);
    }
  }
  const combinedFilters = byName('combined-filters');
  if (!combinedFilters || !combinedFilters.state || combinedFilters.state.filters < 2) {
    failures.push('combined-filters screenshot must record active status/client filters in review-manifest.json');
  }
  if (!combinedFilters || !combinedFilters.evidence || combinedFilters.evidence.pillCount < 2 || !combinedFilters.evidence.hasStatusPill || !combinedFilters.evidence.hasClientPill || combinedFilters.evidence.visibleRows !== combinedFilters.evidence.uniqueVisibleRows) {
    failures.push('combined-filters screenshot must record status/client filter pills and deduped visible-row evidence in review-manifest.json');
  }
  const projectBoard = byName('project-board');
  if (!projectBoard || !projectBoard.state || projectBoard.state.view !== 'board' || projectBoard.state.filters !== 0) {
    failures.push('project-board screenshot must be an unfiltered board baseline in review-manifest.json');
  }
  if (!projectBoard || !projectBoard.evidence || projectBoard.evidence.emptyColumns < 1 || projectBoard.evidence.populatedColumns < 1 || projectBoard.evidence.totalColumnsWithActionControls !== 0) {
    failures.push('project-board screenshot must record board-column evidence with zero fake add/options controls in review-manifest.json');
  } else {
    if (projectBoard.evidence.staticScopeLabel !== 'All projects' || projectBoard.evidence.staticScopeInteractive || projectBoard.evidence.staticScopeCursor !== 'default' || projectBoard.evidence.staticScopePointerEvents !== 'none' || projectBoard.evidence.staticScopeBackground !== 'rgba(0, 0, 0, 0)') {
      failures.push('project-board screenshot must record All projects as a quiet non-interactive scope label, not a fake button');
    }
    const minWidth = Number(projectBoard.evidence.minColumnWidth || 0);
    const maxWidth = Number(projectBoard.evidence.maxColumnWidth || 0);
    if (minWidth < 250 || maxWidth - minWidth > 8) {
      failures.push(`project-board columns must use equal readable lane widths, saw ${minWidth}-${maxWidth}px`);
    }
    const emptyTargetControls = Number(projectBoard.evidence.emptyTargetControls || 0);
    const emptyTargetIconOnly = Number(projectBoard.evidence.emptyTargetIconOnly || 0);
    const emptyTargetLabels = Array.isArray(projectBoard.evidence.emptyTargetLabels) ? projectBoard.evidence.emptyTargetLabels : [];
    if (emptyTargetControls < 1 || emptyTargetIconOnly !== emptyTargetControls || emptyTargetLabels.length) {
      failures.push('project-board empty target controls must stay compact and icon-only instead of repeating "No target" labels');
    }
  }
  const projectDetail = byName('project-detail');
  if (!projectDetail || !projectDetail.state || projectDetail.state.view !== 'project' || projectDetail.state.team !== 'video' || projectDetail.state.filters !== 0) {
    failures.push('project-detail screenshot must be an unfiltered Video project-detail baseline in review-manifest.json');
  }
  if (!projectDetail || !projectDetail.evidence || projectDetail.evidence.stateTeam !== 'video' || projectDetail.evidence.crumbTeam !== 'Video' || projectDetail.evidence.detailScope !== 'Video project') {
    failures.push('project-detail screenshot must record Video crumb/detail-scope evidence in review-manifest.json');
  } else {
    const rowTeams = Array.isArray(projectDetail.evidence.rowTeams) ? projectDetail.evidence.rowTeams : [];
    const visibleRows = Number(projectDetail.evidence.visibleRows);
    if (rowTeams.some(team => team !== 'video')) {
      failures.push(`project-detail screenshot includes rows outside the Video scope: ${rowTeams.join(', ')}`);
    }
    if (String(visibleRows) !== String(projectDetail.evidence.groupCountText || '')) {
      failures.push(`project-detail group count does not match visible rows: ${projectDetail.evidence.groupCountText || '(missing)'} vs ${visibleRows}`);
    }
    const expectedSideText = String(visibleRows) + ' issue' + (visibleRows === 1 ? '' : 's');
    if (projectDetail.evidence.sideIssuesText !== expectedSideText) {
      failures.push(`project-detail side issue count does not match visible rows: ${projectDetail.evidence.sideIssuesText || '(missing)'} vs ${expectedSideText}`);
    }
    if (projectDetail.evidence.groupAddControls !== 0) {
      failures.push(`project-detail still exposes ${projectDetail.evidence.groupAddControls} fake group-header add control(s)`);
    }
    if (projectDetail.evidence.topbarFakeControls !== 0) {
      failures.push(`project-detail still exposes ${projectDetail.evidence.topbarFakeControls} fake favorite/notification topbar control(s)`);
    }
    if (projectDetail.evidence.emptyDueIconOnly !== 0) {
      failures.push(`project-detail still exposes ${projectDetail.evidence.emptyDueIconOnly} icon-only empty due control(s)`);
    }
    if (projectDetail.evidence.hasScaffoldCopy) {
      failures.push('project-detail screenshot must not expose internal "migrated row" scaffold copy');
    }
    const emptyDueLabels = Array.isArray(projectDetail.evidence.emptyDueLabels) ? projectDetail.evidence.emptyDueLabels : [];
    if (emptyDueLabels.some(label => label !== 'Add date')) {
      failures.push(`project-detail empty due labels changed: ${emptyDueLabels.join('|') || '(missing)'}`);
    }
  }
  const parentDetail = byName('parent-detail');
  if (!parentDetail || !parentDetail.evidence || parentDetail.evidence.subIssueRows < 1 || !parentDetail.evidence.hasGuardedAddSubIssue || !parentDetail.evidence.subIssueSectionVisible || !parentDetail.evidence.activityVisible) {
    failures.push('parent-detail screenshot must record visible sub-issue rows, guarded add-sub-issue affordance, and activity evidence in review-manifest.json');
  }
  if (!parentDetail || !parentDetail.evidence || parentDetail.evidence.addSubIssueText !== 'Add sub-issue') {
    failures.push('parent-detail screenshot must record a visible Add sub-issue affordance in review-manifest.json');
  }
  if (!parentDetail || !parentDetail.evidence || parentDetail.evidence.topbarFakeControls !== 0) {
    failures.push('parent-detail screenshot must record zero fake favorite/notification topbar controls in review-manifest.json');
  }
  if (!parentDetail || !parentDetail.evidence || parentDetail.evidence.hasScaffoldCopy || !/No activity yet|Activity|Comments/i.test(parentDetail.evidence.activityText || '')) {
    failures.push('parent-detail screenshot must use polished empty activity/description copy, not internal migrated-row wording');
  }
  const subIssueDetail = byName('subissue-detail');
  if (!subIssueDetail || !subIssueDetail.evidence || subIssueDetail.evidence.hasScaffoldCopy || !/No activity yet|Activity|Comments/i.test(subIssueDetail.evidence.activityText || '')) {
    failures.push('subissue-detail screenshot must use polished empty activity/description copy, not internal migrated-row wording');
  }
  if (!gallery.includes('Production Review Packet')) failures.push('index.html missing gallery heading');
  if (!markdown.includes('Production Review Packet')) failures.push('manifest.md missing heading');
  if (!checklist.includes('Production Review Checklist')) failures.push('review-checklist.md missing heading');
  if ((checklist.match(/- \[ \]/g) || []).length < shots.length + 5) {
    failures.push('review-checklist.md does not include enough checklist items');
  }

  return failures;
}

if (require.main === module) {
  const failures = validatePacket();
  if (failures.length) {
    console.error(formatFailures('prod-review-packet-validate failures', failures));
    process.exit(1);
  }
  console.log(`prod-review-packet-validate: ${requiredNames.length} screenshots, JSON manifest, gallery, Markdown manifest, and checklist passed`);
}

module.exports = { validatePacket };
