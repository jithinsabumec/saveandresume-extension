# Save & Resume (Chrome Extension)

Save & Resume helps you save exact moments (timestamps) in YouTube videos so you can come back later from the same second.

## What This App Does

1. Adds a **SAVE TIMESTAMP** button on YouTube video pages.
2. Lets you save the current video time into a category (for example: `Work`, `Learning`, `Ideas`).
3. Shows all saved timestamps in the extension popup.
4. Opens any saved item directly at the saved time.
5. Supports Google sign-in so your data can sync to your Firebase/Firestore cloud database.
6. Keeps data safe locally when offline and syncs when internet is back.

## Quick Feature List

- Save timestamp from YouTube with button or keyboard shortcut (`Alt+S`)
- Create and delete categories
- Move timestamps between categories
- Delete timestamps with Undo option
- Signed-out mode (local storage)
- Signed-in mode (cloud sync through Firestore)
- Offline-friendly behavior with sync queue
- Local-to-cloud migration when user signs in

## How It Works (Simple Version)

- **Content script (`content.js`)**: Runs on YouTube pages and adds the save button + category dialog.
- **Popup (`popup.html`, `popup.js`)**: Shows your saved list, categories, and sign-in UI.
- **Background worker (`background.js`)**: Handles sign-in, token refresh, and cloud requests.
- **Data layer (`data-layer.js`)**: Handles storage logic (local, cloud, offline queue, migration).

Think of it like this:

1. You click save on YouTube.
2. The extension stores that video time.
3. If signed in and online, it saves to Firestore.
4. If offline, it stores locally and syncs later.

## Tech Stack

- Chrome Extension Manifest V3
- Plain JavaScript (no framework)
- Firebase Auth (Google sign-in)
- Firestore REST API for cloud data
- Webpack (only for bundling `auth.js` into `auth_bundle.js`)

## Project Structure

```text
save-and-resume-extension/
  manifest.json
  background.js
  content.js
  data-layer.js
  popup.html
  popup.js
  popup.css
  auth.js
  auth_bundle.js
  firebase-config.example.js
  firebase-config.js (generated, ignored by git)
  firestore.rules
  scripts/
    generate-config.js
  .env.example
```

## Prerequisites

- Google Chrome
- Node.js 18+ (recommended)
- npm
- A Firebase project (for sign-in + cloud sync)

## Setup Guide (Step by Step)

### 1) Install dependencies

```bash
npm install
```

### 2) Create your environment file

Copy `.env.example` to `.env` and fill these values:

```env
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
FIREBASE_MEASUREMENT_ID=
```

These values come from your Firebase Web App settings.

### 3) Build runtime config + auth bundle

```bash
npm run build
```

This does two things:

1. Generates `firebase-config.js` from your `.env` file
2. Rebuilds `auth_bundle.js` from `auth.js`

### 4) Configure Firebase Auth (Google sign-in)

1. In Firebase Console, enable **Authentication > Sign-in method > Google**.
2. In Google Cloud Console, create or use an OAuth client.
3. Get your extension ID from `chrome://extensions` (after loading unpacked once).
4. Add this redirect URL in your OAuth client:

```text
https://<YOUR_EXTENSION_ID>.chromiumapp.org/oauth2
```

5. Put the OAuth client ID into `manifest.json` under:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

### 5) Configure Firestore

Use rules from `firestore.rules` so users can only read/write their own data:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 6) Load extension in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

### 7) (Optional) Shortcut settings

- Default shortcut is `Alt+S` (from `manifest.json`)
- You can change it in:
  `chrome://extensions/shortcuts`

## How To Use

1. Open any YouTube video.
2. Click **SAVE TIMESTAMP** (bottom-right) or press `Alt+S`.
3. Pick a category (or create one).
4. Open extension popup to see all saved timestamps.
5. Click a saved item to reopen video at that exact moment.

## Data Model (What Gets Saved)

Each saved timestamp item contains:

- `videoId` (YouTube video ID)
- `title` (video title)
- `currentTime` (saved second)
- `thumbnail` (video image URL)
- `timestamp` (when you saved it)

Main storage shape:

- `categories`: object where key = category name, value = array of saved items

## Local vs Cloud Behavior

- **Signed out**: data is kept in `chrome.storage.local` only.
- **Signed in + online**: data is written to Firestore.
- **Signed in + offline**: changes are queued locally and synced when online.
- On sign-in, local data is migrated to cloud.
- On sign-out, extension tries to cache cloud data back to local first.

## Firestore Document Location

Cloud state is stored in:

`users/{uid}/data/state`

The extension stores category data in JSON form inside this document.

## NPM Scripts

- `npm run setup:config` -> generate `firebase-config.js` from `.env`
- `npm run build:auth` -> bundle `auth.js` into `auth_bundle.js`
- `npm run build` -> run both steps above

## Permissions Used (and Why)

- `storage`: save timestamps and app state
- `tabs`: open saved videos in new tabs
- `windows`: manage popup window behavior
- `identity`: Google OAuth sign-in flow

Host permissions:

- `firestore.googleapis.com` -> cloud data read/write
- `securetoken.googleapis.com` -> token refresh
- `identitytoolkit.googleapis.com` -> Firebase Auth sign-in API

## Troubleshooting

### Error: "Missing Firebase runtime config. Run npm run setup:config."

- You likely have missing values in `.env`
- Run `npm run build` again

### Error: "Authorization page could not be loaded."

- OAuth client/redirect URL is not set correctly
- Check:
  - `manifest.json` has correct OAuth client ID
  - Redirect URL exactly matches `https://<extension-id>.chromiumapp.org/oauth2`

### Error: Firestore permission denied

- Firestore rules are not allowing current user
- Apply rules from `firestore.rules`

### Save button not visible on YouTube

- Button only appears on actual video pages (`watch?v=...`)
- It is hidden in fullscreen mode
- Reload YouTube tab after extension update

### Data did not sync yet

- Check internet connection
- If offline, extension keeps local queue and syncs later

## Security and Privacy Notes

- User data is scoped by Firebase user ID (`uid`) in Firestore rules.
- OAuth tokens are stored in extension local storage for session handling.

## Development Notes

- `firebase-config.js` is generated and ignored by git.
- `auth_bundle.js` is generated from `auth.js`; rebuild after auth changes.
- `data-layer.js` includes migration helpers for old `watchlist` format.
- Popup footer version text may need manual update when manifest version changes.

## License

No explicit license file is included in this repository currently.
