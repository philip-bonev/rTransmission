#!/usr/bin/env bash
set -euo pipefail

URL="${TRANSMISSION_URL:-http://localhost:9091/transmission/rpc}"
USER="${TRANSMISSION_USER:?Set TRANSMISSION_USER}"
PASS="${TRANSMISSION_PASSWORD:?Set TRANSMISSION_PASSWORD}"
ID=$RANDOM

SESSION_ID=$(curl -u "$USER:$PASS" -H "Accept: application/json" -si "$URL" | grep -E '^X-Transmission-Session-Id:' | tr -d '\r')

VERSION=$(jq -n --argjson tag "$ID" '{method: "session-get", arguments: {}, tag: $tag}')
echo "$VERSION" | jq
curl -u "$USER:$PASS" -H "$SESSION_ID" -H "Accept: application/json" -d "$VERSION" -s "$URL" | jq

DATA=$(jq -n --argjson tag "$ID" '{
  method: "torrent-get",
  arguments: {
    fields: ["id", "queue-position", "activity-date", "added-date", "done-date", "name", "percentDone"]
  },
  tag: $tag
}')
echo "$DATA" | jq
curl -u "$USER:$PASS" -H "$SESSION_ID" -H "Accept: application/json" -d "$DATA" -s "$URL" | jq
