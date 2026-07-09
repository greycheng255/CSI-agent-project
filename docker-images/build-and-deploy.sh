#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
TAR_DIR="docker-images"
TAR_NAME="genesis-all_${TIMESTAMP}.tar"

log_info() { echo "[INFO] $1"; }
log_ok() { echo "[OK] $1"; }
log_warn() { echo "[WARN] $1"; }
log_error() { echo "[ERROR] $1"; }

build_images() {
  log_info "Building genesis-backend:${TIMESTAMP}"
  docker build -t "genesis-backend:${TIMESTAMP}" -t "genesis-backend:latest" -f backend/Dockerfile backend

  log_info "Building genesis-frontend:${TIMESTAMP}"
  docker build -t "genesis-frontend:${TIMESTAMP}" -t "genesis-frontend:latest" -f frontend/Dockerfile frontend

  log_ok "Built backend/frontend images for MCP/HiClaw flow"
}

export_images() {
  mkdir -p "$TAR_DIR"

  log_info "Exporting images to ${TAR_DIR}/${TAR_NAME}"
  docker save \
    "genesis-backend:${TIMESTAMP}" \
    "genesis-frontend:${TIMESTAMP}" \
    -o "${TAR_DIR}/${TAR_NAME}"

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TAR_DIR" && sha256sum "$TAR_NAME" > "${TAR_NAME}.sha256")
  fi

  log_ok "Image archive ready: ${TAR_DIR}/${TAR_NAME}"
}

cleanup_old_archives() {
  [ -d "$TAR_DIR" ] || return 0

  for file in "$TAR_DIR"/genesis-all_*.tar "$TAR_DIR"/genesis-all_*.tar.sha256; do
    [ -e "$file" ] || continue
    case "$file" in
      *"${TIMESTAMP}"*) ;;
      *) log_warn "Removing old archive: $file"; rm -f "$file" ;;
    esac
  done
}

update_compose_files() {
  local compose_file="docker-images/docker-compose.yml"
  local panel_file="docker-images/1panel-compose.yml"
  local build_time
  build_time=$(date "+%Y-%m-%d %H:%M:%S")

  if [ -f "$compose_file" ]; then
    sed -i -E "s|genesis-backend:\$\{TAG:-[0-9]{8}-[0-9]{6}\}|genesis-backend:\${TAG:-${TIMESTAMP}}|g" "$compose_file"
    sed -i -E "s|genesis-frontend:\$\{TAG:-[0-9]{8}-[0-9]{6}\}|genesis-frontend:\${TAG:-${TIMESTAMP}}|g" "$compose_file"
    sed -i -E "s|^# Build time:.*|# Build time: ${build_time}|g" "$compose_file"
    sed -i -E "s|^# Image archive:.*|# Image archive: ${TAR_NAME}|g" "$compose_file"
  fi

  if [ -f "$panel_file" ]; then
    sed -i -E "s|image: genesis-backend:[0-9]{8}-[0-9]{6}|image: genesis-backend:${TIMESTAMP}|g" "$panel_file"
    sed -i -E "s|image: genesis-frontend:[0-9]{8}-[0-9]{6}|image: genesis-frontend:${TIMESTAMP}|g" "$panel_file"
  fi

  log_ok "Compose files updated"
}

do_build() {
  if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker is not installed or not in PATH"
    exit 1
  fi

  build_images
  export_images
  cleanup_old_archives
  update_compose_files

  echo ""
  log_ok "Build complete"
  echo "Archive: ${TAR_DIR}/${TAR_NAME}"
  echo "Upload these files to the 1Panel host:"
  echo "- ${TAR_DIR}/${TAR_NAME}"
  echo "- ${TAR_DIR}/1panel-compose.yml"
}

case "${1:-build}" in
  build) do_build ;;
  all) do_build ;;
  *)
    echo "Usage: sh docker-images/build-and-deploy.sh {build|all}"
    exit 1
    ;;
esac
