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

## Auto-updates (GitHub Releases)

This project uses GitHub Releases for automatic updates.

### How it works

- The app automatically checks for updates on startup and every 4 hours
- When an update is available, users receive a notification
- Updates download automatically in the background
- The app will restart to install updates (with a 5-second delay for user interaction)

### Publishing a new release

1. **Update the version** in `package.json`:
   ```bash
   npm version patch  # for bug fixes (1.0.0 → 1.0.1)
   npm version minor  # for new features (1.0.0 → 1.1.0)
   npm version major  # for breaking changes (1.0.0 → 2.0.0)
   ```

2. **Set up GitHub token** (one-time setup):
   - Create a GitHub Personal Access Token with `repo` scope
   - Set it as an environment variable:
     ```bash
     export GH_TOKEN=your_github_token_here
     ```
   - Or add it to your CI/CD secrets

3. **Build and publish**:
   ```bash
   npm run release
   ```
   This will:
   - Build the app for all platforms
   - Create a GitHub Release
   - Upload the installers and update metadata
   - Tag the release with the version number

### Testing updates

1. Build and publish version 1.0.0
2. Install that version on a test machine
3. Update version to 1.0.1 and publish
4. Launch the installed app - it should detect and download the update

### Manual build (without publishing)

If you just want to build locally without publishing:
```bash
npm run build
# Outputs installers in dist/
```

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
