# 1Password 7 Chrome Extension (Manifest V3)

A working Chrome extension for **1Password 7 standalone** (lifetime/one-time license), updated to Manifest V3.

Google Chrome dropped support for Manifest V2 extensions, which broke the original 1Password 7 browser extension. 1Password (AgileBits) officially retired the classic extension and only supports 1Password 8 (subscription-based). This project brings it back for users with standalone licenses.

## Features

- Full autofill support via native messaging to the 1Password 7 desktop app
- **Go & Fill** for two-step login flows — fills username, submits, then automatically fills the password when it appears (works on sites like Google, Microsoft, etc.)
- Inline 1Password icon in password and login fields (click to fill)
- Toolbar button, keyboard shortcut (Cmd+\ / Ctrl+\), and right-click context menu
- Works with vaults stored locally or synced via Dropbox/iCloud
- Manifest V3 compatible (works with current Chrome versions)

## Requirements

- **1Password 7** desktop app installed and running (macOS)
- A standalone/lifetime license (not subscription)
- Google Chrome (or Chromium-based browser)

## Installation

### 1. Clone this repository

```bash
git clone https://github.com/ferreirafabio/1password7-chrome-extension.git
```

### 2. Add your extension ID to the native messaging host

After loading the extension (step 3), Chrome assigns it an extension ID. You need to add this ID to 1Password's native messaging host configuration.

Edit the file:
```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.1password.1password7.json
```

Add your extension ID to the `allowed_origins` array:
```json
{
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID_HERE/",
    "chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/",
    ...
  ]
}
```

> **Note:** If you use the included `manifest.json` with the original `key` field, your extension ID will be `aomjjhallfgjeglblehebfpbcfeobpgk`. Add that to the `allowed_origins`.

### 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the cloned repository folder
5. Verify the extension loads without errors

### 4. Restart Chrome

Quit Chrome completely (Cmd+Q) and reopen it. Native messaging host changes require a full restart.

### 5. Unlock 1Password

Open the 1Password 7 desktop app and unlock your vault. The extension communicates with the desktop app — it must be running and unlocked.

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Native messaging host not found" | Check that `com.1password.1password7.json` exists in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| "Access to native messaging host is forbidden" | Your extension ID is not in `allowed_origins` — see step 2 above |
| "Receiving end does not exist" | Harmless — happens on pages where content scripts can't run (e.g., `chrome://` pages) |
| Extension icon doesn't respond | Make sure 1Password 7 is running and unlocked |
| "1Password Extension Helper" not running | Open 1Password 7 → Preferences → Browsers → check "Always Keep 1Password Extension Helper Running" |

## How it works

The extension communicates with the 1Password 7 desktop app through Chrome's [native messaging API](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). The data flow is:

```
Chrome Extension <-> Native Messaging Host <-> 1Password 7 App <-> Vault (local/Dropbox/iCloud)
```

The extension never accesses your vault directly. All credential operations go through the 1Password desktop app.

### MV2 to MV3 changes

The `background.js` service worker provides compatibility shims for the original 1Password background code:

- `chrome.browserAction` -> `chrome.action`
- `chrome.contextMenus.create` with inline `onclick` -> `id` + `onClicked` listener
- `webRequest` blocking mode -> `declarativeNetRequest` rules
- `window` -> `self` (service worker context)
- Native messaging host redirected from subscription to standalone (SLS) host

## Disclaimer

This project includes `global.min.js` and `injected.min.js` which are original works by [AgileBits Inc.](https://1password.com) (1Password), distributed as part of their free Chrome extension. These files are included here solely to restore functionality for licensed 1Password 7 users after Chrome deprecated Manifest V2. This project is not affiliated with or endorsed by AgileBits. All trademarks belong to their respective owners.

The `background.js` service worker, `inline-icon.js`, and all other modifications are original work.

## License

The original work in this repository (background.js, inline-icon.js, README, etc.) is licensed under GPL-3.0 — see [LICENSE](LICENSE). The AgileBits files (global.min.js, injected.min.js, locales, assets) remain the property of AgileBits Inc.
