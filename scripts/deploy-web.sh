#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
releases_dir="${KAITOOLS_RELEASES_DIR:-}"
release_id="${KAITOOLS_RELEASE_ID:-}"
archive="${KAITOOLS_ARCHIVE:-}"
current_link="${releases_dir}/current"
previous_link="${releases_dir}/previous"

fail() {
  echo "Deployment failed: $*" >&2
  exit 1
}

require_release_root() {
  [[ -n "$releases_dir" ]] || fail "KAITOOLS_RELEASES_DIR is required"
  [[ "$releases_dir" = /* ]] || fail "KAITOOLS_RELEASES_DIR must be an absolute path"
  install -d -m 0755 -- "$releases_dir"
}

require_release_id() {
  [[ "$release_id" =~ ^web-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid release identifier"
}

resolve_managed_release() {
  local link="$1"
  [[ -L "$link" ]] || fail "missing release link: $link"
  local target
  target="$(readlink -f -- "$link")"
  [[ "$target" == "$releases_dir"/* ]] || fail "release link escapes managed releases directory: $link"
  [[ -d "$target" ]] || fail "release target does not exist: $target"
  printf '%s\n' "$target"
}

replace_link() {
  local link="$1"
  local target="$2"
  local candidate="${link}.next.$$"
  [[ ! -e "$candidate" && ! -L "$candidate" ]] || fail "stale temporary link exists: $candidate"
  ln -s -- "$target" "$candidate"
  mv -Tf -- "$candidate" "$link"
}

deploy() {
  require_release_root
  require_release_id
  [[ -n "$archive" && -f "$archive" ]] || fail "KAITOOLS_ARCHIVE must reference an uploaded archive"

  local active_release release_dir staging_dir
  active_release="$(resolve_managed_release "$current_link")"
  release_dir="${releases_dir}/${release_id}"
  staging_dir="${releases_dir}/.${release_id}.staging.$$"
  [[ ! -e "$release_dir" && ! -L "$release_dir" ]] || fail "release directory already exists: $release_dir"
  [[ ! -e "$staging_dir" && ! -L "$staging_dir" ]] || fail "staging directory already exists: $staging_dir"

  mkdir -m 0755 -- "$staging_dir"
  tar -xzf "$archive" -C "$staging_dir" --no-same-owner --no-same-permissions
  [[ -f "$staging_dir/index.html" ]] || fail "browser artifact does not contain index.html"
  [[ -d "$staging_dir/assets" ]] || fail "browser artifact does not contain assets"
  mv -- "$staging_dir" "$release_dir"
  replace_link "$previous_link" "$active_release"
  replace_link "$current_link" "$release_dir"
  echo "Activated web release $release_id"
}

rollback() {
  require_release_root
  local previous_release
  previous_release="$(resolve_managed_release "$previous_link")"
  replace_link "$current_link" "$previous_release"
  echo "Rolled back web release to $(basename -- "$previous_release")"
}

case "$action" in
  deploy) deploy ;;
  rollback) rollback ;;
  *) fail "usage: $0 {deploy|rollback}" ;;
esac
