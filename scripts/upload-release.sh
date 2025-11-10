#!/bin/bash
# Upload built release files to Supabase Storage
# Usage: ./scripts/upload-release.sh

set -e

# Configuration - UPDATE THESE
SUPABASE_PROJECT_REF="YOUR_PROJECT_REF"  # Your Supabase project reference
SUPABASE_ACCESS_TOKEN=""  # Optional: if bucket requires auth
BUCKET_NAME="desktop-releases"
DIST_DIR="dist"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Uploading release files to Supabase Storage...${NC}"

# Check if dist directory exists
if [ ! -d "$DIST_DIR" ]; then
  echo "Error: $DIST_DIR directory not found. Run 'npm run build' first."
  exit 1
fi

# Files to upload (all release artifacts)
FILES=(
  "latest-mac.yml"
  "latest.yml"
  "The EzGBP-*.dmg"
  "The EzGBP Setup *.exe"
  "*.blockmap"
)

# Upload each file
for pattern in "${FILES[@]}"; do
  for file in $DIST_DIR/$pattern; do
    if [ -f "$file" ]; then
      filename=$(basename "$file")
      echo -e "${GREEN}Uploading: $filename${NC}"
      
      if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
        # Public bucket - use curl
        curl -X POST \
          "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET_NAME}/${filename}" \
          -H "Content-Type: application/octet-stream" \
          --data-binary "@$file" \
          || echo "Warning: Failed to upload $filename (bucket may need to be public or require auth)"
      else
        # Authenticated upload
        curl -X POST \
          "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET_NAME}/${filename}" \
          -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
          -H "Content-Type: application/octet-stream" \
          --data-binary "@$file"
      fi
    fi
  done
done

echo -e "${GREEN}✓ Upload complete!${NC}"
echo ""
echo "Update your electron-builder.yml with:"
echo "  url: https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/public/${BUCKET_NAME}"

