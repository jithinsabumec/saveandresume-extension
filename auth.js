'use strict';

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";

const REQUIRED_FIREBASE_FIELDS = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId'
];

function readFirebaseRuntimeConfig() {
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

    return {
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        storageBucket: firebaseConfig.storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
        appId: firebaseConfig.appId,
        ...(typeof firebaseConfig.measurementId === 'string' && firebaseConfig.measurementId.trim() !== ''
            ? { measurementId: firebaseConfig.measurementId }
            : {})
    };
}

let auth = null;
let authInitError = null;

try {
    const app = initializeApp(readFirebaseRuntimeConfig());
    auth = getAuth(app);
} catch (error) {
    authInitError = error instanceof Error ? error : new Error(String(error || 'Unknown Firebase init error'));
    console.error('Failed to initialize Firebase Auth:', authInitError);
}

function requireAuthInstance() {
    if (auth) {
        return auth;
    }
    throw authInitError || new Error('Firebase Auth is not initialized.');
}

(function () {
    async function mapUser(user) {
        const idTokenResult = await user.getIdTokenResult();
        const expiresAt = Date.parse(idTokenResult.expirationTime);

        return {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            authSession: {
                uid: user.uid,
                displayName: user.displayName || '',
                email: user.email || '',
                photoURL: user.photoURL || '',
                idToken: idTokenResult.token,
                refreshToken: user.refreshToken,
                expiresAt: Number.isFinite(expiresAt) ? expiresAt : (Date.now() + 55 * 60 * 1000)
            }
        };
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

    async function getGoogleAccessTokenWithWebAuthFlow() {
        const clientId = chrome.runtime.getManifest()?.oauth2?.client_id;
        if (!clientId) {
            throw new Error('Missing oauth2.client_id in manifest.json');
        }

        const redirectUri = chrome.identity.getRedirectURL('oauth2');
        const state = randomString(32);
        const scopes = Array.from(new Set([
            ...(chrome.runtime.getManifest()?.oauth2?.scopes || []),
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
            callbackUrl = await chrome.identity.launchWebAuthFlow({
                url: authUrl.toString(),
                interactive: true
            });
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

        const callback = new URL(callbackUrl);
        const hashParams = new URLSearchParams(callback.hash.startsWith('#') ? callback.hash.slice(1) : callback.hash);
        const callbackError = hashParams.get('error') || callback.searchParams.get('error');
        if (callbackError) {
            const description = hashParams.get('error_description') || callback.searchParams.get('error_description');
            throw new Error(description ? `${callbackError}: ${description}` : callbackError);
        }

        const callbackState = hashParams.get('state') || callback.searchParams.get('state');
        if (callbackState !== state) {
            throw new Error('Google OAuth state mismatch.');
        }

        const accessToken = hashParams.get('access_token');
        if (!accessToken) {
            throw new Error('Google OAuth did not return access_token.');
        }

        return accessToken;
    }

    async function signInWithGoogle() {
        console.log('Starting signInWithGoogle...');
        try {
            const authInstance = requireAuthInstance();
            const accessToken = await getGoogleAccessTokenWithWebAuthFlow();
            console.log('Got OAuth token via launchWebAuthFlow');
            const credential = GoogleAuthProvider.credential(null, accessToken);
            const result = await signInWithCredential(authInstance, credential);
            console.log('Sign in successful:', result.user.uid);
            return await mapUser(result.user);
        } catch (error) {
            console.error('Firebase sign-in error:', error);
            throw error;
        }
    }

    async function signOut() {
        const authInstance = requireAuthInstance();
        await firebaseSignOut(authInstance);
        // Optional: Revoke the token from chrome.identity if desired
        return new Promise((resolve) => {
            chrome.identity.getAuthToken({ interactive: false }, function (token) {
                if (token) {
                    chrome.identity.removeCachedAuthToken({ token: token }, function () { });
                }
                resolve();
            });
        });
    }

    async function getCurrentUser() {
        const authInstance = requireAuthInstance();
        return new Promise((resolve) => {
            const unsubscribe = authInstance.onAuthStateChanged(async (user) => {
                unsubscribe();
                if (user) {
                    resolve(await mapUser(user));
                } else {
                    resolve(null);
                }
            });
        });
    }

    window.auth = {
        signInWithGoogle,
        signOut,
        getCurrentUser
    };
})();
