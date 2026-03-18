#!/bin/bash
# Restart local-semantic-router
# Usage: bash restart.sh [--bg]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8402

# Find and kill existing process on port
PID=$(/usr/sbin/lsof -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$PID" ]; then
  echo "⏹  Killing router (PID $PID)..."
  kill "$PID" 2>/dev/null
  sleep 1
  # Force kill if still alive
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
else
  echo "⏹  No router running on port $PORT"
fi

# Start
if [ "$1" = "--bg" ]; then
  echo "▶  Starting router (background)..."
  nohup node "$SCRIPT_DIR/dist/cli.js" start > /tmp/lsr.log 2>&1 &
  sleep 2
  NEW_PID=$(/usr/sbin/lsof -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$NEW_PID" ]; then
    echo "✅ Router running (PID $NEW_PID) — http://127.0.0.1:$PORT/v1"
  else
    echo "❌ Failed to start. Check /tmp/lsr.log"
  fi
else
  echo "▶  Starting router (foreground, Ctrl+C to stop)..."
  exec node "$SCRIPT_DIR/dist/cli.js" start
fi
