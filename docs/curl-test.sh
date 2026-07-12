#!/usr/bin/env bash
URL=http://192.168.1.5:9091/transmission/rpc
USER=fi4o
PASS=fi4opassword
ID=$RANDOM
VERSION=$(cat <<EOF
    {
        "method": "session_get", 
        "params": {
            "fields": ["version"]}, 
        "id": ${ID}
    }
EOF
)

echo $VERSION | jq
SESSION_ID=$(curl -u "$USER:$PASS" -H "Accept: application/json" -si "$URL" | grep -E '^X-Transmission-Session-Id.*' | tr -d '\r')
curl -u "$USER:$PASS" -H "$SESSION_ID" -d "$VERSION" -s "$URL" | jq

DATA=$(cat <<EOF
    {
        "method": "torrent-get",
        "arguments": {
            "fields": ["id", "queue_position", "acitivity_date", "added_date", "done_date", "name", "percentDone"]
        }
    }
EOF
)

echo $DATA | jq
curl -u "$USER:$PASS" -H "$SESSION_ID" -H "Accept: application/json" -d "$DATA" -s "$URL" | jq
