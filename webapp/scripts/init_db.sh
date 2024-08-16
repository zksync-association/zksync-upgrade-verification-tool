#!/usr/bin/env bash
set -eo pipefail

# Check if custom values set, otherwise use defaults
DB_USER=${POSTGRES_USER:=user}
DB_PASS=${POSTGRES_PASSWORD:=password}
DB_NAME=${POSTGRES_DB:=webapp}
DB_PORT=${POSTGRES_PORT:=5432}

# Container name
CONTAINER_NAME=zksync-upgrade-tool-db

# Check container status
CONTAINER_RUNNING=false
CONTAINER_EXISTS_STOPPED=false
if [[ "$(docker ps -q -f name=$CONTAINER_NAME)" ]]; then
    CONTAINER_RUNNING=true
elif [[ "$(docker ps -aq -f status=exited -f name=$CONTAINER_NAME)" ]]; then
    CONTAINER_EXISTS_STOPPED=true
fi

# Check if --reset flag is provided
RESET_FLAG=false
for arg in "$@"
do
    if [ "$arg" == "--reset" ]
    then
        RESET_FLAG=true
    fi
done

# If --reset flag is set, stop and remove the container if it exists
if [ "$RESET_FLAG" = true ] && ( $CONTAINER_RUNNING || $CONTAINER_EXISTS_STOPPED )
then
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
    CONTAINER_RUNNING=false
    CONTAINER_EXISTS_STOPPED=false
fi

# Handle container status
if $CONTAINER_RUNNING; then
    echo "$CONTAINER_NAME container is already running"
    exit 0
elif $CONTAINER_EXISTS_STOPPED; then
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

# Run migrations
export DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}
pnpm db:migrate

>&2 echo "Database has been migrated, ready to go!"
