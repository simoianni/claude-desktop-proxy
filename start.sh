#!/usr/bin/env bash
# Start the Claude DeepSeek proxy (Linux / macOS)
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo " Claude DeepSeek Proxy"
echo " ====================="
echo ""

node "$DIR/proxy/server.js" "$@"
