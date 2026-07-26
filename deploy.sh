#!/bin/bash
set -e

# Default prefix is 's'
prefix="s"

# Check for --prod flag
for arg in "$@"; do
  if [ "$arg" = "--prod" ]; then
    prefix="v"
  fi
done

echo "Switching to branch staging-new..."
git checkout staging-new

# Find latest tag matching prefix across all tags (sorted by version)
latest_tag=$(git tag -l "${prefix}[0-9]*" | sort -V | tail -n 1)

if [ -z "$latest_tag" ]; then
  echo "No existing tag found with prefix '${prefix}'. Starting with ${prefix}0.0.0"
  latest_tag="${prefix}0.0.0"
fi

echo "Latest tag found: $latest_tag"

# Strip prefix
version_part="${latest_tag#$prefix}"

# Split version into parts
IFS='.' read -r major minor patch <<< "$version_part"

# Validate and fallback if parsed parts are not numbers
if [ -z "$major" ] || [ -z "$minor" ] || [ -z "$patch" ]; then
  echo "Error: Tag '$latest_tag' is not in expected major.minor.patch format."
  exit 1
fi

new_patch=$((patch + 1))
new_tag="${prefix}${major}.${minor}.${new_patch}"

echo "New tag to create: $new_tag"

# Create the tag locally
echo "Creating tag $new_tag locally..."
git tag "$new_tag"

# Push the tag to remote
echo "Pushing tag $new_tag to origin..."
git push origin "$new_tag"

echo "Tag $new_tag created and pushed successfully!"
