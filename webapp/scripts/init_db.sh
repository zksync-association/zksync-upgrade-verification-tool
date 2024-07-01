#!/usr/bin/env bash
set -eo pipefail

# Check if custom values set, otherwise use defaults
DB_USER=${POSTGRES_USER:=user}
DB_PASS=${POSTGRES_PASSWORD:=password}
DB_NAME=${POSTGRES_DB:=postgres}
DB_PORT=${POSTGRES_PORT:=5432}

# Container name
CONTAINER_NAME=zksync-upgrade-tool-db

# Check if reliance-db container is not running
if [[ "$(docker ps -q -f name=$CONTAINER_NAME)" ]]; then
    echo "$CONTAINER_NAME container is already running"
    exit 0
fi

# Check if container exists
if [[ "$(docker ps -aq -f status=exited -f name=$CONTAINER_NAME)" ]]; then
    echo "$CONTAINER_NAME container exists but is not running"
    echo "Removing container"
    docker rm $CONTAINER_NAME
fi

# Launch postgres using Docker if it's not already running
docker run \
    -e POSTGRES_USER=${DB_USER} \
    -e POSTGRES_PASSWORD=${DB_PASS} \
    -e POSTGRES_DB=${DB_NAME} \
    -p ${DB_PORT}:5432 \
    --name $CONTAINER_NAME \
    -d postgres \
    postgres -N 1000

# Wait for postgres to be ready
until docker exec $CONTAINER_NAME pg_isready; do
    echo >&2 "$CONTAINER_NAME is unavailable - sleeping"
    sleep 1
done

>&2 echo "$CONTAINER_NAME is up and running on port ${DB_PORT}!"
