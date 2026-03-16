const AUTH_SUCCESS = 'AUTH_SUCCESS';
const WELCOME_PAGE_URL = 'https://saveandresume.vercel.app/welcome';
const STUDY_MODE_PAGE_URL = 'https://saveandresume.vercel.app/study-mode';
const STUDY_MODE_UPDATE_VERSION = '1.3.0';

const BREAKING_UPDATES = {
    '2.0.0': {
        message: 'Data storage is changing in this update.',
        effectiveDate: '2025-04-01'
    }
};

try {
    importScripts('firebase-config.js');
    importScripts('data-layer.js');
} catch (error) {
    console.error('Failed to load runtime config files.', error);
}

function openExtensionPage(url, failureMessage) {
    chrome.tabs.create({ url }, () => {
        if (chrome.runtime.lastError) {
            console.warn(failureMessage, chrome.runtime.lastError.message);
        }
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    const currentVersion = chrome.runtime.getManifest().version;

    if (details.reason === 'install') {
        openExtensionPage(
            `${WELCOME_PAGE_URL}?version=${encodeURIComponent(currentVersion)}&ref=install`,
            'Failed to open welcome page after install:'
        );
        return;
    }

    if (
        details.reason === 'update' &&
        currentVersion === STUDY_MODE_UPDATE_VERSION &&
        details.previousVersion !== STUDY_MODE_UPDATE_VERSION
    ) {
        openExtensionPage(
            STUDY_MODE_PAGE_URL,
            `Failed to open study mode page after update to ${STUDY_MODE_UPDATE_VERSION}:`
        );
    }
});

const AUTH_SESSION_KEY = 'authSession';

let watchlistWindow = null;
let firebaseConfigCache = null;

const REQUIRED_FIREBASE_FIELDS = [
    'apiKey',
    'projectId'
];

function readFirebaseRuntimeConfig() {
    if (firebaseConfigCache) {
        return firebaseConfigCache;
    }

    const firebaseConfig = globalThis.__SAVE_RESUME_CONFIG__?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== 'object') {
        throw new Error('Missing Firebase runtime config. Run npm run setup:config.');
    }

    const missingFields = REQUIRED_FIREBASE_FIELDS.filter((field) => {
        const value = firebaseConfig[field];
        return typeof value !== 'string' || value.trim() === '';
    });

    if (missingFields.length > 0) {
        throw new Error(`Missing Firebase config field(s): ${missingFields.join(', ')}`);
    }

    firebaseConfigCache = {
        apiKey: firebaseConfig.apiKey,
        projectId: firebaseConfig.projectId
    };

    return firebaseConfigCache;
}

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

function randomString(length = 64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    let value = '';
    for (let i = 0; i < array.length; i += 1) {
        value += chars[array[i] % chars.length];
    }
    return value;
}

function launchWebAuthFlow(url, interactive = true) {
    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url, interactive }, (callbackUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(callbackUrl || null);
        });
    });
}

function parseOAuthCallback(callbackUrl, expectedState) {
    const callback = new URL(callbackUrl);
    const hashParams = new URLSearchParams(callback.hash.startsWith('#') ? callback.hash.slice(1) : callback.hash);
    const queryParams = callback.searchParams;
    const callbackError = hashParams.get('error') || queryParams.get('error');

    if (callbackError) {
        const description = hashParams.get('error_description') || queryParams.get('error_description');
        throw new Error(description ? `${callbackError}: ${description}` : callbackError);
    }

    const callbackState = hashParams.get('state') || queryParams.get('state');
    if (callbackState !== expectedState) {
        throw new Error('Google OAuth state mismatch.');
    }

    const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    if (!accessToken) {
        throw new Error('Google OAuth did not return access_token.');
    }

    return accessToken;
}

async function getGoogleAccessTokenWithWebAuthFlow() {
    const oauthConfig = chrome.runtime.getManifest()?.oauth2 || {};
    const clientId = oauthConfig.client_id;
    if (typeof clientId !== 'string' || clientId.trim() === '') {
        throw new Error('Missing oauth2.client_id in manifest.json');
    }

    const redirectUri = chrome.identity.getRedirectURL('oauth2');
    const state = randomString(32);
    const scopes = Array.from(new Set([
        ...(Array.isArray(oauthConfig.scopes) ? oauthConfig.scopes : []),
        'openid',
        'email',
        'profile'
    ]));

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'select_account');
    authUrl.searchParams.set('include_granted_scopes', 'true');

    let callbackUrl = null;
    try {
        callbackUrl = await launchWebAuthFlow(authUrl.toString(), true);
    } catch (error) {
        const message = error?.message || 'Unknown launchWebAuthFlow error';
        if (message.includes('Authorization page could not be loaded')) {
            throw new Error(
                `Authorization page could not be loaded. ` +
                `For launchWebAuthFlow, use a Google OAuth Web client ID and add this exact redirect URI in Google Cloud: ${redirectUri}. ` +
                `Current client_id: ${clientId}`
            );
        }
        throw error;
    }

    if (!callbackUrl) {
        throw new Error('Google OAuth flow was cancelled.');
    }

    const accessToken = parseOAuthCallback(callbackUrl, state);
    return { accessToken, redirectUri };
}

async function signInWithGoogleAccessToken(accessToken, requestUri) {
    const { apiKey } = readFirebaseRuntimeConfig();
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
            requestUri,
            returnSecureToken: true,
            returnIdpCredential: true
        })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = payload?.error?.message || `Firebase sign-in failed (${response.status})`;
        throw new Error(message);
    }

    const expiresInSeconds = Number(payload.expiresIn || 3600);
    const safeExpiresInSeconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
    const uid = typeof payload.localId === 'string' ? payload.localId : '';
    const idToken = typeof payload.idToken === 'string' ? payload.idToken : '';
    const refreshToken = typeof payload.refreshToken === 'string' ? payload.refreshToken : '';

    if (!uid || !idToken || !refreshToken) {
        throw new Error('Firebase sign-in response missing required fields.');
    }

    return {
        uid,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : '',
        email: typeof payload.email === 'string' ? payload.email : '',
        photoURL: typeof payload.photoUrl === 'string' ? payload.photoUrl : '',
        idToken,
        refreshToken,
        expiresAt: Date.now() + (safeExpiresInSeconds * 1000)
    };
}

async function signInAndPersistAuthSession() {
    const { accessToken, redirectUri } = await getGoogleAccessTokenWithWebAuthFlow();
    const session = await signInWithGoogleAccessToken(accessToken, redirectUri);
    await saveAuthSession(session);
    return session;
}

async function clearCachedIdentityTokens() {
    if (typeof chrome.identity.clearAllCachedAuthTokens !== 'function') {
        return;
    }

    await new Promise((resolve, reject) => {
        chrome.identity.clearAllCachedAuthTokens(() => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function refreshAuthSession(session) {
    if (typeof session.refreshToken !== 'string' || session.refreshToken.trim() === '') {
        throw new Error('Missing refresh token');
    }

    const { apiKey } = readFirebaseRuntimeConfig();
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
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

const dataLayer = globalThis.SaveResumeDataLayer.createBackgroundDataLayer({
    chromeApi: chrome,
    readFirebaseRuntimeConfig,
    getAuthSession,
    getValidAuthSession,
    breakingUpdates: BREAKING_UPDATES
});

(async () => {
    try {
        await dataLayer.bootstrapVersionState();
    } catch (error) {
        console.warn('Version bootstrap failed:', error);
    }
})();

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

function isYouTubeWatchTab(tab) {
    return typeof tab?.url === 'string' && tab.url.includes('://www.youtube.com/watch');
}

function sendAddTimestampShortcut(targetTab) {
    if (targetTab?.id === undefined) {
        console.warn('Add-timestamp shortcut could not find a valid tab id.');
        return;
    }

    chrome.tabs.sendMessage(targetTab.id, { action: 'addTimestamp' }, () => {
        if (chrome.runtime.lastError) {
            console.warn('Unable to send addTimestamp command:', chrome.runtime.lastError.message);
        }
    });
}

chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'add-timestamp') {
        return;
    }

    if (isYouTubeWatchTab(tab)) {
        sendAddTimestampShortcut(tab);
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (focusedTabs) => {
        if (chrome.runtime.lastError) {
            console.warn('Unable to query the focused tab for add-timestamp shortcut:', chrome.runtime.lastError);
            return;
        }

        const focusedTab = focusedTabs?.[0];
        if (isYouTubeWatchTab(focusedTab)) {
            sendAddTimestampShortcut(focusedTab);
            return;
        }

        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                console.warn('Unable to query active tabs:', chrome.runtime.lastError);
                return;
            }

            const activeYouTubeTabs = (tabs || []).filter(isYouTubeWatchTab);
            if (activeYouTubeTabs.length === 1) {
                sendAddTimestampShortcut(activeYouTubeTabs[0]);
                return;
            }

            console.warn('Add-timestamp shortcut could not find a focused YouTube video tab.');
        });
    });
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

        if (message.type === 'AUTH_SIGN_IN') {
            const session = await signInAndPersistAuthSession();
            sendOk(sendResponse, {
                user: {
                    uid: session.uid,
                    displayName: session.displayName || '',
                    email: session.email || '',
                    photoURL: session.photoURL || ''
                }
            });
            return;
        }

        if (message.type === 'AUTH_SIGN_OUT') {
            try {
                await dataLayer.cacheFirestoreToLocalBeforeSignOut();
            } catch (error) {
                if (!dataLayer.isLikelyOfflineError(error)) {
                    throw error;
                }
                console.warn('Sign-out cache step skipped due offline state:', error?.message || error);
            }

            await clearAuthSession();
            try {
                await clearCachedIdentityTokens();
            } catch (error) {
                console.warn('Failed to clear cached identity tokens:', error);
            }
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
            const summary = await dataLayer.getLocalSummary();
            sendOk(sendResponse, summary);
            return;
        }

        if (message.type === 'DATA_MIGRATE_LOCAL') {
            const migration = await dataLayer.migrateLocalDataToCloud();
            sendOk(sendResponse, migration);
            return;
        }

        if (message.type === 'DATA_GET') {
            const data = await dataLayer.readData(message.keys || []);
            sendOk(sendResponse, { data });
            return;
        }

        if (message.type === 'DATA_SET') {
            const result = await dataLayer.writeData(message.data || {});
            sendOk(sendResponse, result);
            return;
        }

        if (message.type === 'DATA_NETWORK_STATUS') {
            const result = await dataLayer.setNetworkStatus(message.online === true);
            sendOk(sendResponse, result);
            return;
        }

        if (message.type === 'DATA_GET_BREAKING_UPDATE_NOTICE') {
            const notice = await dataLayer.getBreakingUpdateNotice();
            sendOk(sendResponse, { notice });
            return;
        }

        if (message.type === 'DATA_DISMISS_BREAKING_UPDATE_NOTICE') {
            await dataLayer.dismissBreakingUpdateNotice();
            sendOk(sendResponse);
            return;
        }

        if (message.type === 'DATA_FLUSH_PENDING') {
            const result = await dataLayer.flushPendingQueue();
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
