#!/usr/bin/env bash
# Start a local MongoDB without Docker, using the Community Server archive.
#
# Downloads the server on first run into ~/.local/mongodb and stores data in
# ~/.local/mongodb-data. Needs no administrator rights and installs no service.
#
#   ./scripts/mongo-local.sh          # start
#   ./scripts/mongo-local.sh --stop   # stop
set -euo pipefail

VERSION="${MONGO_VERSION:-8.0.29}"
ROOT="${MONGO_HOME:-$HOME/.local/mongodb}"
DATA="${MONGO_DATA:-$HOME/.local/mongodb-data}"
LOG="$DATA/mongod.log"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows"; EXT="zip"; BIN="$ROOT/bin/mongod.exe" ;;
  Darwin)               PLATFORM="macos";   EXT="tgz"; BIN="$ROOT/bin/mongod" ;;
  *)                    PLATFORM="linux";   EXT="tgz"; BIN="$ROOT/bin/mongod" ;;
esac

if [ "${1:-}" = "--stop" ]; then
  pkill -f "mongod .*--dbpath $DATA" && echo "mongod stopped" || echo "mongod was not running"
  exit 0
fi

if [ ! -x "$BIN" ]; then
  echo "Downloading MongoDB $VERSION for $PLATFORM…"
  mkdir -p "$ROOT" "$DATA"
  tmp="$(mktemp -d)"
  case "$PLATFORM" in
    windows) url="https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${VERSION}.zip" ;;
    macos)   url="https://fastdl.mongodb.org/osx/mongodb-macos-arm64-${VERSION}.tgz" ;;
    linux)   url="https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-${VERSION}.tgz" ;;
  esac
  curl -fsSL "$url" -o "$tmp/mongo.$EXT"
  if [ "$EXT" = "zip" ]; then unzip -q "$tmp/mongo.zip" -d "$tmp/x"; else tar -xzf "$tmp/mongo.tgz" -C "$tmp/x" --strip-components=0; fi
  cp -r "$tmp"/x/*/* "$ROOT"/
  rm -rf "$tmp"
fi

mkdir -p "$DATA"
echo "Starting mongod on 127.0.0.1:27017 (data: $DATA)"
"$BIN" --dbpath "$DATA" --port 27017 --bind_ip 127.0.0.1 --logpath "$LOG" &
sleep 3
echo "mongod running. Logs: $LOG"
