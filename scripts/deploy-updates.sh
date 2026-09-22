#!/usr/bin/env bash
set -euo pipefail

updates_root="${KAITOOLS_UPDATE_ROOT:-}"
release_id="${KAITOOLS_UPDATE_RELEASE_ID:-}"
archive="${KAITOOLS_UPDATE_ARCHIVE:-}"
[[ "$updates_root" = /* ]] || { echo "KAITOOLS_UPDATE_ROOT must be an absolute path" >&2; exit 1; }
[[ "$release_id" =~ ^desktop-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]] || { echo "invalid desktop release identifier" >&2; exit 1; }

incoming_root="${updates_root}/.incoming"
incoming="${incoming_root}/${release_id}"
release_dir="${updates_root}/releases/${release_id}"
if [[ -n "$archive" ]]; then
  [[ -f "$archive" ]] || { echo "missing uploaded update archive: $archive" >&2; exit 1; }
  staging="${incoming_root}/.${release_id}.staging.$$"
  [[ ! -e "$staging" && ! -L "$staging" ]] || { echo "stale update staging directory: $staging" >&2; exit 1; }
  install -d -m 0755 "$staging"
  tar -xzf "$archive" -C "$staging" --no-same-owner --no-same-permissions
  incoming="$staging"
fi
[[ -d "$incoming" ]] || { echo "missing incoming update directory: $incoming" >&2; exit 1; }
[[ -f "$incoming/latest.json" && -f "$incoming/latest.json.sig" ]] || { echo "latest update files are incomplete" >&2; exit 1; }
[[ -d "$incoming/manifests" && -d "$incoming/objects" ]] || { echo "update artifact directories are incomplete" >&2; exit 1; }
[[ ! -e "$release_dir" && ! -L "$release_dir" ]] || { echo "release already exists: $release_dir" >&2; exit 1; }

install -d -m 0755 "$updates_root/releases" "$updates_root/manifests" "$updates_root/objects"
mv -- "$incoming" "$release_dir"
cp -R -- "$release_dir/manifests/." "$updates_root/manifests/"
cp -R -- "$release_dir/objects/." "$updates_root/objects/"

candidate="${updates_root}/current.next.$$"
[[ ! -e "$candidate" && ! -L "$candidate" ]] || { echo "stale current link candidate exists" >&2; exit 1; }
ln -s -- "$release_dir" "$candidate"
mv -Tf -- "$candidate" "${updates_root}/current"
if [[ -n "$archive" ]]; then
  rm -f -- "$archive"
fi
echo "Activated desktop update release $release_id"
