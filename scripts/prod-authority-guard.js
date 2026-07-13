'use strict';

/*
 * Shared fail-closed reader for the per-team Production authority flag.
 *
 * A successful read is validated and cached on disk. A transient read failure
 * returns that last-known-good value for detect/report only with write_safe=false;
 * it can never authorize APPLY. A cold process with no valid cache throws.
 * Callers must never invent a default authority.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const FLAG_KEY = 'prod_authority';
const TEAM_KEYS = Object.freeze(['video', 'graphics']);

const clean = value => String(value == null ? '' : value).trim().toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeSide(value) {
  const side = clean(value);
  if (side === 'linear') return 'linear';
  if (side === 'syncview' || side === 'supabase') return 'syncview';
  throw new Error(`invalid production authority value: ${side || '(empty)'}`);
}

function validateAuthority(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('prod_authority must be an object');
  }
  return Object.freeze({
    video: normalizeSide(value.video),
    graphics: normalizeSide(value.graphics),
  });
}

function teamKey(value) {
  const team = clean(value);
  if (team === 'gra' || team === 'graphic' || team === 'graphics' || team === 'thumbnail') return 'graphics';
  if (team === 'vid' || team === 'video') return 'video';
  throw new Error(`unknown production team: ${team || '(empty)'}`);
}

function authorityForTeam(authority, team) {
  const checked = validateAuthority(authority);
  return checked[teamKey(team)];
}

function cachePayload(authority, fetchedAt = new Date().toISOString()) {
  return { key: FLAG_KEY, value: validateAuthority(authority), fetched_at: fetchedAt };
}

function readCache(cachePath) {
  if (!cachePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!parsed || parsed.key !== FLAG_KEY) return null;
    return {
      authority: validateAuthority(parsed.value),
      fetched_at: String(parsed.fetched_at || ''),
    };
  } catch (_) {
    return null;
  }
}

function writeCache(cachePath, authority) {
  if (!cachePath) return;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cachePayload(authority), null, 2));
  fs.renameSync(tmp, cachePath);
}

function authorityUrl(baseUrl = DEFAULT_SUPABASE_URL) {
  return `${String(baseUrl).replace(/\/+$/, '')}/rest/v1/syncview_runtime_flags?select=value&key=eq.${FLAG_KEY}&limit=1`;
}

async function fetchAuthority(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const key = String(options.key || DEFAULT_PUBLISHABLE_KEY);
  const response = await fetchImpl(authorityUrl(options.supabaseUrl), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!response || !response.ok) {
    throw new Error(`prod_authority HTTP ${response ? response.status : 'no response'}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`prod_authority expected one row, received ${Array.isArray(rows) ? rows.length : 'non-array'}`);
  }
  return validateAuthority(rows[0] && rows[0].value);
}

async function loadAuthority(options = {}) {
  const retries = Math.max(1, Number(options.retries || 3));
  const retryMs = Math.max(0, Number(options.retryMs == null ? 250 : options.retryMs));
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const authority = await fetchAuthority(options);
      writeCache(options.cachePath, authority);
      return { authority, source: 'live', write_safe: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < retries && retryMs) await sleep(retryMs * attempt);
    }
  }
  const cached = readCache(options.cachePath);
  if (cached) {
    return {
      authority: cached.authority,
      source: 'last-known-good',
      write_safe: false,
      fetched_at: cached.fetched_at,
      warning: lastError && lastError.message,
      attempts: retries,
    };
  }
  const error = new Error(`prod_authority unavailable and no valid last-known-good cache: ${lastError ? lastError.message : 'unknown read failure'}`);
  error.code = 'PROD_AUTHORITY_UNAVAILABLE';
  throw error;
}

function isWriteAllowed(authority, team) {
  return authorityForTeam(authority, team) === 'linear';
}

function legacyMutationPolicy(authority, team, options = {}) {
  if (!authority || options.writeSafe === false) return { allowed: false, http_status: 503, reason: 'authority_unavailable' };
  const key = teamKey(team);
  return authorityForTeam(authority, key) === 'linear'
    ? { allowed: true, http_status: 200, reason: 'linear_authoritative', team: key }
    : { allowed: false, http_status: 409, reason: 'syncview_authoritative', team: key };
}

module.exports = {
  DEFAULT_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
  FLAG_KEY,
  TEAM_KEYS,
  authorityForTeam,
  authorityUrl,
  cachePayload,
  fetchAuthority,
  isWriteAllowed,
  legacyMutationPolicy,
  loadAuthority,
  normalizeSide,
  readCache,
  teamKey,
  validateAuthority,
  writeCache,
};
