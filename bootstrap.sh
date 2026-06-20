#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

: "${TUTTI_APP_HOST:?}"
: "${TUTTI_APP_PORT:?}"
: "${TUTTI_APP_DATA_DIR:?}"
: "${TUTTI_APP_RUNTIME_DIR:?}"
: "${TUTTI_APP_LOG_DIR:?}"
: "${TUTTI_APP_NODE:?}"

export TUTTI_APP_PACKAGE_DIR="${TUTTI_APP_PACKAGE_DIR:-$script_dir}"

mkdir -p "$TUTTI_APP_DATA_DIR" "$TUTTI_APP_RUNTIME_DIR" "$TUTTI_APP_LOG_DIR"

exec "$TUTTI_APP_NODE" "$TUTTI_APP_PACKAGE_DIR/server/server.js"
