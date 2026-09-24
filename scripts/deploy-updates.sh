#!/usr/bin/env bash
set -euo pipefail

updates_root="${KAITOOLS_UPDATE_ROOT:-}"
action="${1:-deploy}"
release_id="${KAITOOLS_UPDATE_RELEASE_ID:-}"
archive="${KAITOOLS_UPDATE_ARCHIVE:-}"
artifact_id="${KAITOOLS_GITHUB_ARTIFACT_ID:-}"
github_repository="${KAITOOLS_GITHUB_REPOSITORY:-}"
archive_sha256="${KAITOOLS_GITHUB_ARTIFACT_SHA256:-}"
artifact_settings_file="${KAITOOLS_GITHUB_ARTIFACT_SETTINGS_FILE:-/srv/kaitools/deploy-secrets/github-artifact.env}"
artifact_proxy_settings_file="${KAITOOLS_GITHUB_PROXY_SETTINGS_FILE:-/srv/kaitools/deploy-secrets/github-artifact-proxies.env}"
[[ "$updates_root" = /* ]] || { echo "KAITOOLS_UPDATE_ROOT must be an absolute path" >&2; exit 1; }
[[ "$action" = deploy || "$action" = cleanup || "$action" = rollback ]] || { echo "unsupported action: $action" >&2; exit 1; }
if [[ "$action" = deploy ]]; then
  [[ "$release_id" =~ ^desktop-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]] || { echo "invalid desktop release identifier" >&2; exit 1; }
fi

incoming_root="${updates_root}/.incoming"
incoming="${incoming_root}/${release_id}"
current_link="${updates_root}/current"
previous_link="${updates_root}/.previous"
active_dir="${updates_root}/.active-${release_id}"
artifact_work_dir=""
artifact_heartbeat_pid=""
transient_staging=""
downloaded_archive_path=""
candidate_active_dir=""
github_artifact_part_attempts=5
github_proxy_probe_bytes=262144
selected_github_proxy=""

fail() {
  echo "$*" >&2
  exit 1
}

resolve_managed_target() {
  local link="$1"
  local target
  [[ -L "$link" ]] || fail "managed link is missing: $link"
  target="$(readlink -f -- "$link")" || fail "cannot resolve managed link: $link"
  [[ "$target" != "$updates_root" && "$target" == "$updates_root"/* ]] || fail "managed link escapes update root: $link"
  printf '%s\n' "$target"
}

replace_managed_link() {
  local link="$1"
  local target="$2"
  local candidate="${link}.next.$$"
  [[ "$target" != "$updates_root" && "$target" == "$updates_root"/* ]] || fail "replacement target escapes update root: $target"
  [[ -d "$target" && ! -L "$target" ]] || fail "replacement target is not a directory: $target"
  [[ ! -e "$candidate" && ! -L "$candidate" ]] || fail "stale temporary link exists: $candidate"
  ln -s -- "$target" "$candidate"
  mv -Tf -- "$candidate" "$link"
}

remove_managed_directory() {
  local target="$1"
  [[ "$target" != "$updates_root" && "$target" == "$updates_root"/* ]] || fail "refusing to remove path outside update root: $target"
  [[ "$target" != "$incoming_root" && "$target" != "$incoming_root"/* ]] || fail "refusing to remove incoming path as an active directory: $target"
  [[ -d "$target" && ! -L "$target" ]] || return 0
  rm -rf -- "$target"
}

remove_transient_directory() {
  local target="$1"
  [[ -n "$target" && "$target" != "$updates_root" && "$target" == "$updates_root"/* ]] || fail "refusing to remove invalid transient path: $target"
  [[ "$target" == "$incoming_root"/* ]] || fail "refusing to remove non-incoming transient path: $target"
  [[ -d "$target" && ! -L "$target" ]] || return 0
  rm -rf -- "$target"
}

remove_legacy_layout() {
  local current_target="$1"
  local legacy resolved
  for legacy in "$updates_root/releases" "$updates_root/manifests" "$updates_root/objects"; do
    [[ -e "$legacy" || -L "$legacy" ]] || continue
    resolved="$(readlink -f -- "$legacy")" || fail "cannot resolve legacy path: $legacy"
    [[ "$resolved" != "$updates_root" && "$resolved" == "$updates_root"/* ]] || fail "legacy path escapes update root: $legacy"
    case "$current_target" in
      "$resolved"|"$resolved"/*) fail "current deployment still uses legacy path: $legacy" ;;
    esac
    rm -rf -- "$legacy"
  done
}

cleanup_artifact_download() {
  if [[ -n "$artifact_work_dir" && -d "$artifact_work_dir" ]]; then
    rm -rf -- "$artifact_work_dir"
  fi
}

stop_artifact_download_heartbeat() {
  if [[ -n "$artifact_heartbeat_pid" ]]; then
    kill "$artifact_heartbeat_pid" 2>/dev/null || true
    wait "$artifact_heartbeat_pid" 2>/dev/null || true
    artifact_heartbeat_pid=""
  fi
}

cleanup() {
  stop_artifact_download_heartbeat
  cleanup_artifact_download
  if [[ -n "$transient_staging" && -d "$transient_staging" ]]; then
    remove_transient_directory "$transient_staging"
  fi
  if [[ -n "$downloaded_archive_path" && -f "$downloaded_archive_path" ]]; then
    rm -f -- "$downloaded_archive_path"
  fi
  if [[ -n "$candidate_active_dir" && -d "$candidate_active_dir" ]]; then
    local current_target=""
    if [[ -L "$current_link" ]]; then
      current_target="$(readlink -f -- "$current_link" 2>/dev/null || true)"
    fi
    if [[ "$current_target" != "$candidate_active_dir" ]]; then
      remove_managed_directory "$candidate_active_dir"
      if [[ -L "$previous_link" ]]; then
        rm -f -- "$previous_link"
      fi
    fi
  fi
}

trap cleanup EXIT

start_artifact_download_heartbeat() {
  (
    while :; do
      sleep 30
      printf '%s\n' 'GitHub artifact download still in progress'
    done
  ) &
  artifact_heartbeat_pid=$!
}

probe_artifact_size() {
  local github_proxy="$1"
  local download_url="$2"
  local probe_headers probe_file response artifact_size

  probe_headers="${artifact_work_dir}/artifact.range.headers"
  probe_file="${artifact_work_dir}/artifact.range.probe"
  response="$(curl --silent --show-error --fail --location --proxy "$github_proxy" --connect-timeout 10 --max-time 60 --retry 4 --retry-delay 2 --retry-all-errors --range 0-0 --dump-header "$probe_headers" --output "$probe_file" --write-out '%{http_code} %{size_download}' "$download_url")" || return 1
  [[ "$response" = "206 1" ]] || return 1
  artifact_size="$(awk 'BEGIN { IGNORECASE = 1 } /^content-range:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); split($0, range, "/"); print range[2]; exit }' "$probe_headers")"
  [[ "$artifact_size" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$artifact_size"
}

request_artifact_download_url() {
  local github_proxy="$1"
  local curl_config="$2"
  local artifact_api_url="$3"
  local headers status download_url

  headers="$(mktemp "${artifact_work_dir}/artifact.url.XXXXXX")" || return 1
  if ! status="$(curl --silent --show-error --fail --request GET --config "$curl_config" --proxy "$github_proxy" --connect-timeout 10 --max-time 60 --retry 4 --retry-delay 2 --retry-all-errors --dump-header "$headers" --output /dev/null --write-out '%{http_code}' "$artifact_api_url")"; then
    rm -f -- "$headers"
    return 1
  fi
  if [[ "$status" != "302" ]]; then
    rm -f -- "$headers"
    return 1
  fi
  download_url="$(awk 'BEGIN { IGNORECASE = 1 } /^location:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$headers")"
  rm -f -- "$headers"
  [[ "$download_url" =~ ^https:// ]] || return 1
  printf '%s\n' "$download_url"
}

select_github_proxy() {
  local github_proxies="$1"
  local curl_config="$2"
  local artifact_api_url="$3"
  local candidate download_url probe_file response http_code bytes elapsed throughput
  local best_throughput=""
  local -a candidates=()

  IFS=',' read -r -a candidates <<< "$github_proxies"
  selected_github_proxy=""
  for candidate in "${candidates[@]}"; do
    [[ "$candidate" =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ ]] || continue
    download_url="$(request_artifact_download_url "$candidate" "$curl_config" "$artifact_api_url")" || continue
    probe_file="$(mktemp "${artifact_work_dir}/artifact.probe.XXXXXX")" || continue
    if response="$(curl --silent --show-error --fail --location --proxy "$candidate" --connect-timeout 10 --max-time 45 --range "0-$((github_proxy_probe_bytes - 1))" --output "$probe_file" --write-out '%{http_code} %{size_download} %{time_total}' "$download_url")"; then
      read -r http_code bytes elapsed <<< "$response"
      if [[ "$http_code" = "206" && "$bytes" = "$github_proxy_probe_bytes" && "$elapsed" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        throughput="$(awk -v bytes="$bytes" -v elapsed="$elapsed" 'BEGIN { if (elapsed > 0) printf "%.0f", bytes / elapsed }')"
        if [[ -n "$throughput" ]] && { [[ -z "$best_throughput" ]] || awk -v current="$throughput" -v best="$best_throughput" 'BEGIN { exit !(current > best) }'; }; then
          best_throughput="$throughput"
          selected_github_proxy="$candidate"
        fi
      fi
    fi
    rm -f -- "$probe_file"
  done
  [[ -n "$selected_github_proxy" ]] || return 1
  printf '%s\n' 'Selected GitHub artifact proxy after throughput probe' >&2
}

download_artifact_part() {
  local github_proxy="$1"
  local download_url="$2"
  local curl_config="$3"
  local artifact_api_url="$4"
  local start="$5"
  local end="$6"
  local part_file="$7"
  local expected_size=$((end - start + 1))
  local attempt part_candidate response retry_delay

  for ((attempt = 1; attempt <= github_artifact_part_attempts; attempt++)); do
    part_candidate="${part_file}.attempt.${attempt}.${BASHPID}"
    if response="$(curl --silent --show-error --fail --location --proxy "$github_proxy" --connect-timeout 10 --max-time 900 --range "${start}-${end}" --output "$part_candidate" --write-out '%{http_code} %{size_download}' "$download_url")" \
      && [[ "$response" = "206 ${expected_size}" ]]; then
      mv -f -- "$part_candidate" "$part_file"
      return 0
    fi
    rm -f -- "$part_candidate"
    (( attempt < github_artifact_part_attempts )) || return 1

    retry_delay=$((attempt * 2))
    printf 'GitHub artifact part retry %s/%s after %ss\n' "$attempt" "$github_artifact_part_attempts" "$retry_delay" >&2
    sleep "$retry_delay"
    download_url="$(request_artifact_download_url "$github_proxy" "$curl_config" "$artifact_api_url")" || return 1
  done
}

download_artifact_in_parts() {
  local github_proxy="$1"
  local download_url="$2"
  local curl_config="$3"
  local artifact_api_url="$4"
  local zip_file="$5"
  local parallelism="$6"
  local artifact_size chunk_size index start end part_file failed=0
  local -a part_files=()
  local -a part_pids=()

  artifact_size="$(probe_artifact_size "$github_proxy" "$download_url")" || return 1
  if (( artifact_size < parallelism * 1048576 )); then
    parallelism=$(( (artifact_size + 1048575) / 1048576 ))
  fi
  (( parallelism >= 1 )) || parallelism=1
  chunk_size=$(( (artifact_size + parallelism - 1) / parallelism ))

  for ((index = 0; index < parallelism; index++)); do
    start=$((index * chunk_size))
    end=$((start + chunk_size - 1))
    (( end < artifact_size )) || end=$((artifact_size - 1))
    part_file="${artifact_work_dir}/artifact.part.${index}"
    part_files+=("$part_file")
    download_artifact_part "$github_proxy" "$download_url" "$curl_config" "$artifact_api_url" "$start" "$end" "$part_file" &
    part_pids+=("$!")
  done

  for pid in "${part_pids[@]}"; do
    wait "$pid" || failed=1
  done
  (( failed == 0 )) || return 1

  : > "$zip_file"
  for part_file in "${part_files[@]}"; do
    cat "$part_file" >> "$zip_file"
  done
  [[ "$(stat -c %s "$zip_file")" = "$artifact_size" ]]
}

download_artifact_archive() {
  [[ -z "$archive" ]] || fail "cannot combine an uploaded archive with a GitHub artifact"
  [[ "$artifact_id" =~ ^[0-9]+$ ]] || fail "GitHub artifact identifier must be numeric"
  [[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "GitHub repository is invalid"
  [[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "GitHub artifact archive SHA-256 is invalid"
  [[ -r "$artifact_settings_file" ]] || fail "GitHub artifact settings are unavailable"

  # The settings file is server-local and only supplies a local proxy endpoint and token path.
  # shellcheck disable=SC1090
  source "$artifact_settings_file"
  if [[ -r "$artifact_proxy_settings_file" ]]; then
    # This optional file contains loopback proxy candidates only, never GitHub credentials.
    # shellcheck disable=SC1090
    source "$artifact_proxy_settings_file"
  fi
  local token_file="${KAITOOLS_GITHUB_TOKEN_FILE:-}"
  local github_proxy="${KAITOOLS_GITHUB_PROXY:-}"
  local github_proxies="${KAITOOLS_GITHUB_PROXIES:-}"
  local parallelism="${KAITOOLS_GITHUB_ARTIFACT_PARALLELISM:-10}"
  [[ -n "$github_proxies" ]] || github_proxies="$github_proxy"
  [[ "$token_file" = /* && -r "$token_file" ]] || fail "GitHub artifact token is unavailable"
  [[ "$github_proxy" =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ ]] || fail "GitHub artifact proxy must be a local HTTP endpoint"
  [[ "$parallelism" =~ ^([1-9]|10)$ ]] || fail "GitHub artifact parallelism must be between 1 and 10"
  command -v curl >/dev/null || fail "curl is required to download a GitHub artifact"
  command -v unzip >/dev/null || fail "unzip is required to unpack a GitHub artifact"
  command -v sha256sum >/dev/null || fail "sha256sum is required to verify a GitHub artifact"

  local token curl_config artifact_api_url download_url zip_file archive_part computed
  artifact_work_dir="$(mktemp -d "${incoming_root}/.${release_id}.artifact.XXXXXX")"
  umask 077
  token="$(tr -d '\r\n' < "$token_file")"
  [[ -n "$token" ]] || fail "GitHub artifact token is empty"
  curl_config="${artifact_work_dir}/curl.conf"
  printf 'header = "Authorization: Bearer %s"\n' "$token" > "$curl_config"
  unset token

  artifact_api_url="https://api.github.com/repos/${github_repository}/actions/artifacts/${artifact_id}/zip"
  select_github_proxy "$github_proxies" "$curl_config" "$artifact_api_url" || fail "no GitHub artifact proxy passed throughput probe"
  github_proxy="$selected_github_proxy"
  download_url="$(request_artifact_download_url "$github_proxy" "$curl_config" "$artifact_api_url")" || fail "GitHub artifact download URL request failed"

  zip_file="${artifact_work_dir}/artifact.zip"
  start_artifact_download_heartbeat
  # The signed object URL authenticates through its query string, not the GitHub API token.
  download_artifact_in_parts "$github_proxy" "$download_url" "$curl_config" "$artifact_api_url" "$zip_file" "$parallelism" || fail "GitHub artifact ranged download failed"
  stop_artifact_download_heartbeat
  [[ -s "$zip_file" ]] || fail "GitHub artifact archive is empty"

  local -a entries
  mapfile -t entries < <(unzip -Z1 "$zip_file")
  [[ ${#entries[@]} -eq 1 && "${entries[0]}" = "kaitools-desktop-updates-${release_id}.tar.gz" ]] || fail "GitHub artifact has an unexpected layout"
  archive_part="${incoming_root}/.${release_id}.tar.gz.part.$$"
  unzip -p "$zip_file" "${entries[0]}" > "$archive_part" || fail "GitHub artifact extraction failed"
  computed="$(sha256sum "$archive_part" | awk '{print $1}')"
  [[ "$computed" = "$archive_sha256" ]] || fail "GitHub artifact archive checksum mismatch"
  archive="${incoming_root}/${release_id}.tar.gz"
  downloaded_archive_path="$archive"
  mv -f -- "$archive_part" "$archive"
}

deploy() {
  local previous_target=""
  local staging

  install -d -m 0755 "$incoming_root"
  if [[ -L "$current_link" && -d "$active_dir" && "$(readlink -f -- "$current_link")" = "$(readlink -f -- "$active_dir")" && ! -e "$previous_link" && ! -L "$previous_link" ]]; then
    echo "Desktop update release $release_id is already active"
    return 0
  fi
  [[ ! -e "$previous_link" && ! -L "$previous_link" ]] || fail "previous deployment cleanup is pending"
  [[ ! -e "$active_dir" && ! -L "$active_dir" ]] || fail "active directory already exists: $active_dir"

  if [[ -n "$artifact_id" ]]; then
    download_artifact_archive
  fi

  umask 022
  if [[ -n "$archive" ]]; then
    [[ -f "$archive" ]] || fail "missing uploaded update archive: $archive"
    staging="${incoming_root}/.${release_id}.staging.$$"
    [[ ! -e "$staging" && ! -L "$staging" ]] || fail "stale update staging directory: $staging"
    install -d -m 0755 "$staging"
    transient_staging="$staging"
    tar -xzf "$archive" -C "$staging" --no-same-owner --no-same-permissions
    incoming="$staging"
  fi
  [[ -d "$incoming" ]] || fail "missing incoming update directory: $incoming"
  [[ -f "$incoming/latest.json" && -f "$incoming/latest.json.sig" ]] || fail "latest update files are incomplete"
  [[ -d "$incoming/manifests" && -d "$incoming/objects" ]] || fail "update artifact directories are incomplete"

  candidate_active_dir="$active_dir"
  mv -- "$incoming" "$active_dir"
  transient_staging=""
  if [[ -L "$current_link" ]]; then
    previous_target="$(resolve_managed_target "$current_link")"
    replace_managed_link "$previous_link" "$previous_target"
  elif [[ -e "$current_link" ]]; then
    fail "current path exists but is not a symlink: $current_link"
  fi
  replace_managed_link "$current_link" "$active_dir"
  candidate_active_dir=""
  if [[ -n "$archive" && -f "$archive" ]]; then
    rm -f -- "$archive"
  fi
  echo "Activated desktop update release $release_id; run cleanup after public verification"
}

cleanup_deployment() {
  local current_target previous_target
  current_target="$(resolve_managed_target "$current_link")"
  if [[ -L "$previous_link" ]]; then
    previous_target="$(resolve_managed_target "$previous_link")"
    [[ "$previous_target" != "$current_target" ]] || fail "previous deployment points to current deployment"
    remove_managed_directory "$previous_target"
    rm -f -- "$previous_link"
  elif [[ -e "$previous_link" ]]; then
    fail "previous deployment marker is not a symlink: $previous_link"
  fi
  remove_legacy_layout "$current_target"
  echo "Cleaned previous desktop update data"
}

rollback_deployment() {
  local current_target previous_target
  current_target="$(resolve_managed_target "$current_link")"
  if [[ -L "$previous_link" ]]; then
    previous_target="$(resolve_managed_target "$previous_link")"
    [[ "$previous_target" != "$current_target" ]] || fail "previous deployment points to current deployment"
    replace_managed_link "$current_link" "$previous_target"
    remove_managed_directory "$current_target"
    rm -f -- "$previous_link"
  elif [[ ! -e "$previous_link" ]]; then
    rm -f -- "$current_link"
    remove_managed_directory "$current_target"
  else
    fail "previous deployment marker is not a symlink: $previous_link"
  fi
  echo "Rolled back desktop update deployment"
}

case "${1:-deploy}" in
  deploy) deploy ;;
  cleanup) cleanup_deployment ;;
  rollback) rollback_deployment ;;
  *) fail "usage: $0 {deploy|cleanup|rollback}" ;;
esac
