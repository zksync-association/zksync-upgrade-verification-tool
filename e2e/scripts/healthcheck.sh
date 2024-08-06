#!/bin/bash

response=$(curl -s -w "\n%{http_code}" --location 'http://localhost:8545' \
--header 'Content-Type: application/json' \
--data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "eth_chainId",
    "params": []
}')

http_code=$(echo "$response" | tail -n 1)
result=$(echo "$response" | head -n -1 | jq -r '.result')

if [ "$http_code" -eq 200 ] && [ -n "$result" ] && [ "$result" != "null" ]; then
    echo "Healthcheck passed: HTTP 200 and chain ID ($result)"
    exit 0
else
    echo "Healthcheck failed: HTTP $http_code or invalid chain ID ($result)"
    exit 1
fi