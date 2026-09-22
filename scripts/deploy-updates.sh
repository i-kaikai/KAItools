#!/usr/bin/env bash
set -euo pipefail

updates_root="${KAITOOLS_UPDATE_ROOT:-}"
release_id="${KAITOOLS_UPDATE_RELEASE_ID:-}"
archive="${KAITOOLS_UPDATE_ARCHIVE:-}"
artifact_id="${KAITOOLS_GITHUB_ARTIFACT_ID:-}"
github_repository="${KAITOOLS_GITHUB_REPOSITORY:-}"
archive_sha256="${KAITOOLS_GITHUB_ARTIFACT_SHA256:-}"
artifact_settings_file="${KAITOOLS_GITHUB_ARTIFACT_SETTINGS_FILE:-/srv/kaitools/deploy-secrets/github-artifact.env}"
[[ "$updates_root" = /* ]] || { echo "KAITOOLS_UPDATE_ROOT must be an absolute path" >&2; exit 1; }
[[ "$release_id" =~ ^desktop-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]] || { echo "invalid desktop release identifier" >&2; exit 1; }

incoming_root="${updates_root}/.incoming"
incoming="${incoming_root}/${release_id}"
release_dir="${updates_root}/releases/${release_id}"
artifact_work_dir=""

fail() {
  echo "$*" >&2
  exit 1
}

cleanup_artifact_download() {
  if [[ -n "$artifact_work_dir" && -d "$artifact_work_dir" ]]; then
    rm -rf -- "$artifact_work_dir"
  fi
}

trap cleanup_artifact_download EXIT

download_artifact_archive() {
  [[ -z "$archive" ]] || fail "cannot combine an uploaded archive with a GitHub artifact"
  [[ "$artifact_id" =~ ^[0-9]+$ ]] || fail "GitHub artifact identifier must be numeric"
  [[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "GitHub repository is invalid"
  [[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "GitHub artifact archive SHA-256 is invalid"
  [[ -r "$artifact_settings_file" ]] || fail "GitHub artifact settings are unavailable"

  # The settings file is server-local and only supplies a local proxy endpoint and token path.
  # shellcheck disable=SC1090
  source "$artifact_settings_file"
  local token_file="${KAITOOLS_GITHUB_TOKEN_FILE:-}"
  local github_proxy="${KAITOOLS_GITHUB_PROXY:-}"
  [[ "$token_file" = /* && -r "$token_file" ]] || fail "GitHub artifact token is unavailable"
  [[ "$github_proxy" =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ ]] || fail "GitHub artifact proxy must be a local HTTP endpoint"
  command -v curl >/dev/null || fail "curl is required to download a GitHub artifact"
  command -v unzip >/dev/null || fail "unzip is required to unpack a GitHub artifact"
  command -v sha256sum >/dev/null || fail "sha256sum is required to verify a GitHub artifact"

  local token curl_config headers download_url zip_file archive_part status computed
  artifact_work_dir="$(mktemp -d "${incoming_root}/.${release_id}.artifact.XXXXXX")"
  umask 077
  token="$(tr -d '\r\n' < "$token_file")"
  [[ -n "$token" ]] || fail "GitHub artifact token is empty"
  curl_config="${artifact_work_dir}/curl.conf"
  printf 'header = "Authorization: Bearer %s"\n' "$token" > "$curl_config"
  unset token

  headers="${artifact_work_dir}/artifact.headers"
  status="$(curl --silent --show-error --fail --request GET --config "$curl_config" --proxy "$github_proxy" --connect-timeout 10 --max-time 60 --retry 4 --retry-delay 2 --retry-all-errors --dump-header "$headers" --output /dev/null --write-out '%{http_code}' "https://api.github.com/repos/${github_repository}/actions/artifacts/${artifact_id}/zip")" || fail "GitHub artifact download URL request failed"
  [[ "$status" = "302" ]] || fail "GitHub artifact download URL was not issued"
  download_url="$(awk 'BEGIN { IGNORECASE = 1 } /^location:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$headers")"
  [[ "$download_url" =~ ^https:// ]] || fail "GitHub artifact download URL is invalid"

  zip_file="${artifact_work_dir}/artifact.zip"
  curl --silent --show-error --fail --location --proxy "$github_proxy" --connect-timeout 10 --max-time 900 --retry 4 --retry-delay 2 --retry-all-errors --output "$zip_file" "$download_url" || fail "GitHub artifact download failed"
  [[ -s "$zip_file" ]] || fail "GitHub artifact archive is empty"

  local -a entries
  mapfile -t entries < <(unzip -Z1 "$zip_file")
  [[ ${#entries[@]} -eq 1 && "${entries[0]}" = "kaitools-desktop-updates-${release_id}.tar.gz" ]] || fail "GitHub artifact has an unexpected layout"
  archive_part="${incoming_root}/.${release_id}.tar.gz.part.$$"
  unzip -p "$zip_file" "${entries[0]}" > "$archive_part" || fail "GitHub artifact extraction failed"
  computed="$(sha256sum "$archive_part" | awk '{print $1}')"
  [[ "$computed" = "$archive_sha256" ]] || fail "GitHub artifact archive checksum mismatch"
  archive="${incoming_root}/${release_id}.tar.gz"
  mv -f -- "$archive_part" "$archive"
}

if [[ -e "$release_dir" || -L "$release_dir" ]]; then
  [[ -L "${updates_root}/current" && "$(readlink -f -- "${updates_root}/current")" = "$release_dir" ]] || fail "release directory already exists but is not current"
  echo "Desktop update release ${release_id} is already active"
  exit 0
fi

if [[ -n "$artifact_id" ]]; then
  install -d -m 0755 "$incoming_root"
  download_artifact_archive
fi

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
