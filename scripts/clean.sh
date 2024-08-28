#!/bin/bash

# Function to delete specified directories
delete_directories() {
    local dir="$1"
    find "$dir" -type d \( \
        -name ".turbo" -o \
        -name ".cache" -o \
        -name "node_modules" -o \
        -name "dist" -o \
        -name "build" -o \
        -name "server-build" \
    \) -print -exec rm -rf {} +
}

# Get the root directory of the repository
root_dir=$(git rev-parse --show-toplevel)

# Check if we're in a git repository
if [ $? -ne 0 ]; then
    echo "Error: Not in a git repository"
    exit 1
fi

echo "Cleaning repository..."

# Delete directories
delete_directories "$root_dir"

echo "Clean-up complete!"
