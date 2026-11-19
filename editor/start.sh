#!/usr/bin/env bash
# Jekyll Markdown 编辑器启动脚本（macOS / Linux）
set -e
cd "$(dirname "$0")"
echo "===================================================="
echo "  Jekyll Markdown Editor"
echo "  URL: http://127.0.0.1:5173/"
echo "  Press Ctrl+C to stop."
echo "===================================================="
exec node server.js
