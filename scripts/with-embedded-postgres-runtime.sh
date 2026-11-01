#!/usr/bin/env sh
# Run a command with the exact ICU 60 runtime required by embedded-postgres.
# This mirrors .github/workflows/ci.yml without changing system libraries or
# creating ABI-unsafe symlinks.
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

ICU_VERSION="60.2-3ubuntu3.2"
ICU_SHA256="f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209"
ICU_URL="https://security.ubuntu.com/ubuntu/pool/main/i/icu/libicu60_${ICU_VERSION}_amd64.deb"
CACHE_ROOT="${KAYYAL_ICU_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/kayyal/libicu60-${ICU_VERSION}}"
DEB="$CACHE_ROOT/libicu60.deb"
EXTRACTED="$CACHE_ROOT/root"
LIB_DIR="$EXTRACTED/usr/lib/x86_64-linux-gnu"

mkdir -p "$CACHE_ROOT"
if [ ! -f "$LIB_DIR/libicuuc.so.60.2" ]; then
  if [ ! -f "$DEB" ]; then
    curl -fsSL --retry 3 -o "$DEB" "$ICU_URL"
  fi
  printf '%s  %s\n' "$ICU_SHA256" "$DEB" | sha256sum -c -
  rm -rf "$EXTRACTED.tmp"
  mkdir -p "$EXTRACTED.tmp"
  dpkg-deb -x "$DEB" "$EXTRACTED.tmp"
  rm -rf "$EXTRACTED"
  mv "$EXTRACTED.tmp" "$EXTRACTED"
fi

export LD_LIBRARY_PATH="$LIB_DIR:${LD_LIBRARY_PATH:-}"
exec "$@"
