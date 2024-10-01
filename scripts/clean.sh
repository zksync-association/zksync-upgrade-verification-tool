#!/bin/bash

# Function to delete node_modules directories
delete_node_modules() {
    local dir="$1"
    find "$dir" -maxdepth 1 -type d -name "node_modules" -print -exec rm -rf '{}' +
}

# Function to delete other specified directories
delete_other_directories() {
    local dir="$1"
    find "$dir" -type d \( \
        -name ".turbo" -o \
        -name ".cache" -o \
        -name "dist" -o \
        -name "build" -o \
        -name "server-build" \
    \) -print -exec rm -rf '{}' +
}

# Get the root directory of the repository
root_dir=$(git rev-parse --show-toplevel)

# Check if we're in a git repository
if [ $? -ne 0 ]; then
    echo "Error: Not in a git repository"
    exit 1
fi

echo "Cleaning repository..."

# Delete node_modules in the root directory
echo "Deleting node_modules in the root directory..."
delete_node_modules "$root_dir"

# Delete node_modules in apps and packages directories
echo "Deleting node_modules in apps and packages directories..."
for dir in "$root_dir"/apps/* "$root_dir"/packages/*; do
    if [ -d "$dir" ]; then
        delete_node_modules "$dir"
    fi
done

# Delete other directories
echo "Deleting other build and cache directories..."
delete_other_directories "$root_dir"

echo "Clean-up complete!"
