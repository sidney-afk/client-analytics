#!/usr/bin/env bash
# The system-library half of `playwright install --with-deps`, without the
# mirror on the common path. See action.yml beside this file for why.
#
#   system-deps.sh plan     works out which of playwright's libraries for
#                           $PW_BROWSERS the runner lacks, and the cache keys
#   system-deps.sh install  installs those from the restored .deb cache, or from
#                           the mirror when there is no cache (or it fails), and
#                           checks every one of them ended up installed
set -euo pipefail

PW="$RUNNER_TEMP/pw/node_modules/.bin/playwright"
DEBS="$HOME/.cache/syncview-pw-debs"
APT=(sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 -y --no-install-recommends)

installed() { dpkg-query -W -f='${db:Status-Abbrev}' "$1" 2>/dev/null | grep -q '^ii'; }

plan() {
  local browsers wanted missing=() p
  browsers=$(tr ' ' '\n' <<<"$PW_BROWSERS" | sed '/^$/d' | sort -u | paste -sd- -)
  # playwright's own list for this image, from the command --with-deps would run.
  # shellcheck disable=SC2086
  wanted=$("$PW" install-deps --dry-run $PW_BROWSERS | sed -n 's/.*--no-install-recommends \([^"]*\)".*/\1/p' | tr ' ' '\n' | sed '/^$/d' | sort -u)
  if [ -z "$wanted" ]; then
    echo "::error::Could not read the system library list from 'playwright install-deps --dry-run $PW_BROWSERS'"
    exit 1
  fi
  for p in $wanted; do installed "$p" || missing+=("$p"); done
  echo "Playwright names $(wc -w <<<"$wanted") system packages for $browsers; the runner image lacks ${#missing[@]}."
  {
    echo "PW_BROWSERS_KEY=${ImageOS:-unknown}-$browsers"
    echo "PW_DEPS_MISSING=${missing[*]}"
    echo "PW_DEPS_KEY=pw-debs-${ImageOS:-unknown}-$(printf '%s\n' "${missing[@]}" | sha256sum | cut -c1-16)"
  } >>"$GITHUB_ENV"
}

from_cache() {
  local debs=() d pkg
  shopt -s nullglob
  for d in "$DEBS"/*.deb; do
    pkg=$(dpkg-deb -f "$d" Package)
    installed "$pkg" || debs+=("$d")
  done
  [ ${#debs[@]} -gt 0 ] || return 1
  echo "Installing ${#debs[@]} cached .deb files, offline."
  # No package source at all, so apt resolves only against what is installed and
  # these files: it cannot reach the mirror, and a gap fails instead of fetching.
  # (--no-download would refuse the local files themselves.)
  local none
  none=$(mktemp -d)
  touch "$none/sources.list"
  "${APT[@]}" -o Dir::Etc::SourceList="$none/sources.list" -o Dir::Etc::SourceParts="$none" install "${debs[@]}"
}

from_mirror() {
  local tmp
  tmp=$(mktemp -d)
  sudo mkdir -p "$tmp/partial"
  "${APT[@]}" update
  # shellcheck disable=SC2086
  "${APT[@]}" -o Dir::Cache::archives="$tmp" --download-only install $PW_DEPS_MISSING
  # shellcheck disable=SC2086
  "${APT[@]}" -o Dir::Cache::archives="$tmp" install $PW_DEPS_MISSING
  rm -rf "$DEBS"
  mkdir -p "$DEBS"
  cp "$tmp"/*.deb "$DEBS"/
  sudo rm -rf "$tmp"
  echo "PW_DEPS_FETCHED=true" >>"$GITHUB_ENV"
  echo "Kept $(ls "$DEBS" | wc -l) .deb files ($(du -sh "$DEBS" | cut -f1)) for the next run."
}

install() {
  local start=$SECONDS p left=()
  if [ "${PW_DEBS_HIT:-}" = "true" ] && from_cache; then
    echo "System libraries installed from the cache in $((SECONDS - start)) s."
  else
    [ "${PW_DEBS_HIT:-}" = "true" ] && echo "::warning::The cached system libraries did not install; fetching from the mirror instead."
    from_mirror
    echo "System libraries installed from the mirror in $((SECONDS - start)) s."
  fi
  for p in $PW_DEPS_MISSING; do installed "$p" || left+=("$p"); done
  if [ ${#left[@]} -gt 0 ]; then
    echo "::error::Still not installed: ${left[*]}"
    exit 1
  fi
}

"$1"
