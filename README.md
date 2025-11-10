# The EzGBP — Desktop (Electron)

A secure desktop wrapper for https://app.theezgbp.com

## Dev

```bash
npm install
npm run dev
```

## Build (local)

```bash
npm run build
# Outputs installers in dist/
```

## Auto-updates (Supabase Storage)

This project uses Supabase Storage for auto-updates via the generic provider.

### Setup

1. **Create a public bucket in Supabase:**
   - Go to Supabase Dashboard → Storage
   - Create a bucket named `desktop-releases`
   - Make it **public** (or configure CORS if needed)

2. **Update electron-builder.yml:**
   - Replace `YOUR_PROJECT_REF` with your actual Supabase project reference
   - Example: `https://abcdefghijklmnop.supabase.co/storage/v1/object/public/desktop-releases`

3. **Build and upload:**
   ```bash
   npm run build
   # Then upload files manually via Supabase dashboard, or use the upload script
   ```

### Manual Upload (Easiest)

After building, upload these files to your Supabase Storage bucket:
- `latest-mac.yml` (or `latest.yml` for Windows)
- `The EzGBP-*.dmg` (macOS installer)
- `*.blockmap` files

**Important:** The `latest*.yml` files must be updated with each release for auto-updates to work.

### Alternative: Skip Auto-updates

If you don't need auto-updates, you can:
1. Remove `initAutoUpdater()` call from `src/main.js`
2. Remove `electron-updater` dependency
3. Just rebuild and reinstall when you want updates

## Code signing (when distributing)

- **macOS**: Apple Developer ID certificate; set ENV in CI:
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`
- **Windows**: Authenticode (PFX); set `CSC_LINK`, `CSC_KEY_PASSWORD`.

## Icons

The app uses the favicon from the web app. Icons are located in `src/icons/`:
- `icon.png` (1024x1024) - source
- `mac/icon.icns` - macOS icon (generated)
- `win/icon.ico` - Windows icon (needs to be generated)

## Deep links

The app registers the `ezgbp://` protocol.

Example: `ezgbp://open/locations/123`

Handle it in the web app (renderer) by reading `window.ezgbp.onDeepLink`.

## Security

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Navigation is restricted to `app.theezgbp.com` and OAuth providers
- Sensitive keys should not be bundled here; use your existing backend auth.

---
