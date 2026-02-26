const AUTH_SUCCESS = 'AUTH_SUCCESS';

const AUTH_SESSION_KEY = 'authSession';
const FIREBASE_API_KEY = 'AIzaSyAyCsypBFTFLTLf5wwky-v0jkMB_ebAsFo';
const FIREBASE_PROJECT_ID = 'save-and-resume';
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const STATE_DOC_PATH_SUFFIX = '/data/state';

let watchlistWindow = null;

function isTrustedExternalSender(sender) {
    if (!sender) {
        return false;
    }

    if (sender.id && sender.id === chrome.runtime.id) {
        return true;
    }

    const extensionBaseUrl = chrome.runtime.getURL('');
    return Boolean(
        (sender.url && sender.url.startsWith(extensionBaseUrl)) ||
        (sender.origin && sender.origin.startsWith(extensionBaseUrl))
    );
}

function isValidAuthPayload(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }

    if (!message.user || typeof message.user !== 'object') {
        return false;
    }

    if (message.token !== undefined && typeof message.token !== 'string') {
        return false;
    }

    return true;
}

function normalizeVideo(video) {
    if (!video || typeof video !== 'object') {
        return null;
    }

    if (typeof video.videoId !== 'string' || video.videoId.trim() === '') {
        return null;
    }

    const currentTime = Number(video.currentTime);
    const timestamp = Number(video.timestamp);

    return {
        videoId: video.videoId,
        title: typeof video.title === 'string' ? video.title : '',
        currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
        thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail : '',
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now()
    };
}

function normalizeCategories(input) {
    const categories = {};

    if (input && typeof input === 'object') {
        Object.entries(input).forEach(([category, videos]) => {
            if (typeof category !== 'string' || category.trim() === '') {
                return;
            }

            const list = Array.isArray(videos) ? videos : [];
            const normalizedVideos = [];

            list.forEach((video) => {
                const normalized = normalizeVideo(video);
                if (!normalized) {
                    return;
                }

                const existingIndex = normalizedVideos.findIndex((v) => v.videoId === normalized.videoId);
                if (existingIndex === -1) {
                    normalizedVideos.push(normalized);
                    return;
                }

                if (normalized.timestamp >= normalizedVideos[existingIndex].timestamp) {
                    normalizedVideos[existingIndex] = normalized;
                }
            });

            categories[category] = normalizedVideos;
        });
    }

    if (!categories.Default) {
        categories.Default = [];
    }

    return categories;
}

function mergeCategories(remoteCategories, localCategories) {
    const merged = normalizeCategories(remoteCategories);
    const normalizedLocal = normalizeCategories(localCategories);

    Object.entries(normalizedLocal).forEach(([category, localVideos]) => {
        if (!merged[category]) {
            merged[category] = [];
        }

        localVideos.forEach((localVideo) => {
            const existingIndex = merged[category].findIndex((video) => video.videoId === localVideo.videoId);

            if (existingIndex === -1) {
                merged[category].push(localVideo);
                return;
            }

            if (localVideo.timestamp >= merged[category][existingIndex].timestamp) {
                merged[category][existingIndex] = localVideo;
            }
        });
    });

    Object.keys(merged).forEach((category) => {
        merged[category].sort((a, b) => b.timestamp - a.timestamp);
    });

    return merged;
}

function countVideos(categories) {
    const normalized = normalizeCategories(categories);
    return Object.values(normalized).reduce((total, list) => total + list.length, 0);
}

function parseStateDocument(documentPayload) {
    const fields = documentPayload?.fields || {};
    let categories = { Default: [] };

    if (fields.categoriesJson?.stringValue) {
        try {
            categories = normalizeCategories(JSON.parse(fields.categoriesJson.stringValue));
        } catch (error) {
            console.error('Failed to parse categoriesJson from Firestore. Using defaults.', error);
        }
    }

    const migrationComplete = fields.migrationComplete?.booleanValue === true;

    return {
        categories,
        migrationComplete
    };
}

function buildStateDocUrl(uid) {
    return `${FIRESTORE_BASE_URL}/users/${encodeURIComponent(uid)}${STATE_DOC_PATH_SUFFIX}`;
}

function getStorageLocal(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            resolve(result);
        });
    });
}

function setStorageLocal(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            resolve();
        });
    });
}

function removeStorageLocal(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            resolve();
        });
    });
}

async function getAuthSession() {
    const result = await getStorageLocal([AUTH_SESSION_KEY]);
    return result[AUTH_SESSION_KEY] || null;
}

async function saveAuthSession(session) {
    await setStorageLocal({ [AUTH_SESSION_KEY]: session });
}

async function clearAuthSession() {
    await removeStorageLocal([AUTH_SESSION_KEY]);
}

function validateAuthSession(session) {
    if (!session || typeof session !== 'object') {
        return false;
    }

    if (typeof session.uid !== 'string' || session.uid.trim() === '') {
        return false;
    }

    if (typeof session.idToken !== 'string' || session.idToken.trim() === '') {
        return false;
    }

    if (!Number.isFinite(Number(session.expiresAt))) {
        return false;
    }

    return true;
}

async function refreshAuthSession(session) {
    if (typeof session.refreshToken !== 'string' || session.refreshToken.trim() === '') {
        throw new Error('Missing refresh token');
    }

    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = payload?.error?.message || 'Failed to refresh auth session.';
        throw new Error(message);
    }

    const expiresInSeconds = Number(payload.expires_in || 3600);
    const now = Date.now();

    return {
        ...session,
        uid: payload.user_id || session.uid,
        idToken: payload.id_token,
        refreshToken: payload.refresh_token || session.refreshToken,
        expiresAt: now + (expiresInSeconds * 1000)
    };
}

async function getValidAuthSession() {
    const session = await getAuthSession();

    if (!validateAuthSession(session)) {
        throw new Error('AUTH_REQUIRED');
    }

    if (Number(session.expiresAt) > (Date.now() + 60 * 1000)) {
        return session;
    }

    try {
        const refreshedSession = await refreshAuthSession(session);
        await saveAuthSession(refreshedSession);
        return refreshedSession;
    } catch (error) {
        await clearAuthSession();
        throw new Error('AUTH_REQUIRED');
    }
}

async function firestoreFetchState(uid, idToken) {
    const response = await fetch(buildStateDocUrl(uid), {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${idToken}`
        }
    });

    if (response.status === 404) {
        return {
            categories: { Default: [] },
            migrationComplete: false
        };
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = payload?.error?.message || `Firestore fetch failed (${response.status})`;
        throw new Error(message);
    }

    return parseStateDocument(payload);
}

async function firestoreSaveState(uid, idToken, categories, options = {}) {
    const normalized = normalizeCategories(categories);
    const now = Date.now();

    const fields = {
        schemaVersion: { integerValue: '2' },
        categoriesJson: { stringValue: JSON.stringify(normalized) },
        migrationComplete: { booleanValue: options.migrationComplete !== false },
        updatedAt: { integerValue: String(now) }
    };

    if (options.migrationComplete !== false) {
        fields.migratedAt = { integerValue: String(options.migratedAt || now) };
    }

    const response = await fetch(buildStateDocUrl(uid), {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = payload?.error?.message || `Firestore save failed (${response.status})`;
        throw new Error(message);
    }

    return parseStateDocument(payload);
}

function extractLocalCategories(result) {
    const legacyWatchlist = Array.isArray(result.watchlist) ? result.watchlist : [];
    const hasLegacyWatchlist = legacyWatchlist.length > 0;

    let categories = normalizeCategories(result.categories || {});

    if (hasLegacyWatchlist) {
        const legacyDefault = legacyWatchlist.map(normalizeVideo).filter(Boolean);
        categories = mergeCategories(categories, { Default: legacyDefault });
    }

    return categories;
}

async function getLocalSummary() {
    const result = await getStorageLocal(['categories', 'watchlist']);
    const localCategories = extractLocalCategories(result);
    const localVideoCount = countVideos(localCategories);

    return {
        localVideoCount,
        hasLocalData: localVideoCount > 0
    };
}

async function migrateLocalDataToCloud() {
    const session = await getValidAuthSession();
    const localResult = await getStorageLocal(['categories', 'watchlist']);
    const localCategories = extractLocalCategories(localResult);
    const localVideoCount = countVideos(localCategories);

    const remoteState = await firestoreFetchState(session.uid, session.idToken);
    const mergedCategories = mergeCategories(remoteState.categories, localCategories);
    const mergedVideoCount = countVideos(mergedCategories);

    if (localVideoCount > 0 || !remoteState.migrationComplete) {
        await firestoreSaveState(session.uid, session.idToken, mergedCategories, {
            migrationComplete: true
        });
    }

    if (localVideoCount > 0) {
        await removeStorageLocal(['categories', 'watchlist']);
    }

    return {
        localVideoCount,
        mergedVideoCount,
        migrated: localVideoCount > 0,
        alreadyMigrated: remoteState.migrationComplete && localVideoCount === 0
    };
}

async function handleCloudGet(keys) {
    const requestedKeys = Array.isArray(keys) ? keys : [keys];
    const session = await getValidAuthSession();
    const state = await firestoreFetchState(session.uid, session.idToken);

    const result = {};

    requestedKeys.forEach((key) => {
        if (key === 'categories') {
            result.categories = state.categories;
            return;
        }

        if (key === 'watchlist') {
            result.watchlist = [];
            return;
        }

        result[key] = undefined;
    });

    return result;
}

async function handleCloudSet(data) {
    const session = await getValidAuthSession();

    if (!data || typeof data !== 'object') {
        return { success: true };
    }

    if (Object.prototype.hasOwnProperty.call(data, 'categories')) {
        await firestoreSaveState(session.uid, session.idToken, data.categories, {
            migrationComplete: true
        });
    }

    return { success: true };
}

function sendOk(sendResponse, payload = {}) {
    sendResponse({ ok: true, ...payload });
}

function sendError(sendResponse, error) {
    const message = error instanceof Error ? error.message : String(error || 'UNKNOWN_ERROR');
    sendResponse({ ok: false, error: message });
}

chrome.action.onClicked.addListener(() => {
    if (watchlistWindow) {
        chrome.windows.update(watchlistWindow.id, { focused: true });
    } else {
        chrome.windows.create({
            url: 'popup.html',
            type: 'popup',
            width: 400,
            height: 600,
            focused: true
        }, (window) => {
            watchlistWindow = window;
        });
    }
});

chrome.windows.onRemoved.addListener((windowId) => {
    if (watchlistWindow && watchlistWindow.id === windowId) {
        watchlistWindow = null;
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'add-timestamp') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                console.warn('Unable to query active tab:', chrome.runtime.lastError);
                return;
            }

            const activeTabId = tabs?.[0]?.id;
            if (activeTabId === undefined) {
                return;
            }

            chrome.tabs.sendMessage(activeTabId, { action: 'addTimestamp' }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Unable to send addTimestamp command:', chrome.runtime.lastError.message);
                }
            });
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (!message || typeof message !== 'object') {
            sendError(sendResponse, 'INVALID_MESSAGE');
            return;
        }

        if (message.type === 'AUTH_SYNC') {
            const session = message.session;

            if (!validateAuthSession(session)) {
                sendError(sendResponse, 'INVALID_AUTH_SESSION');
                return;
            }

            await saveAuthSession(session);
            sendOk(sendResponse);
            return;
        }

        if (message.type === 'AUTH_CLEAR') {
            await clearAuthSession();
            sendOk(sendResponse);
            return;
        }

        if (message.type === 'AUTH_STATUS') {
            const session = await getAuthSession();
            sendOk(sendResponse, {
                authenticated: validateAuthSession(session),
                user: session ? {
                    uid: session.uid,
                    displayName: session.displayName || '',
                    email: session.email || '',
                    photoURL: session.photoURL || ''
                } : null
            });
            return;
        }

        if (message.type === 'DATA_LOCAL_SUMMARY') {
            const summary = await getLocalSummary();
            sendOk(sendResponse, summary);
            return;
        }

        if (message.type === 'DATA_MIGRATE_LOCAL') {
            const migration = await migrateLocalDataToCloud();
            sendOk(sendResponse, migration);
            return;
        }

        if (message.type === 'DATA_GET') {
            const data = await handleCloudGet(message.keys || []);
            sendOk(sendResponse, { data });
            return;
        }

        if (message.type === 'DATA_SET') {
            const result = await handleCloudSet(message.data || {});
            sendOk(sendResponse, result);
            return;
        }

        sendError(sendResponse, 'UNSUPPORTED_MESSAGE_TYPE');
    })().catch((error) => {
        const isAuthRequired = error instanceof Error && error.message === 'AUTH_REQUIRED';
        if (!isAuthRequired) {
            console.error('Background message handler failed:', error);
        }
        sendError(sendResponse, error);
    });

    return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== AUTH_SUCCESS) {
        return;
    }

    if (!isTrustedExternalSender(sender)) {
        console.warn('Received AUTH_SUCCESS from non-standard sender metadata:', sender);
    }

    if (!isValidAuthPayload(message)) {
        console.warn('Rejected AUTH_SUCCESS with invalid payload.');
        sendResponse({ received: false, error: 'invalid_payload' });
        return;
    }

    const { user, token } = message;

    chrome.runtime.sendMessage({ type: AUTH_SUCCESS, user, token }).catch(() => {
        // Ignore failures if no listeners are available.
    });

    if (sender.tab && sender.tab.id !== undefined) {
        chrome.tabs.remove(sender.tab.id, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to close auth tab:', chrome.runtime.lastError);
            }
        });
    }

    sendResponse({ received: true });

    return true;
});
