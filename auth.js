'use strict';

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyAyCsypBFTFLTLf5wwky-v0jkMB_ebAsFo",
    authDomain: "save-and-resume.firebaseapp.com",
    projectId: "save-and-resume",
    storageBucket: "save-and-resume.firebasestorage.app",
    messagingSenderId: "169747525486",
    appId: "1:169747525486:web:c13b6c68c8e1d6aa1d9b7f",
    measurementId: "G-LR2Q1RK63T"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

(function () {
    function mapUser(user) {
        return {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL
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

        const redirectUri = chrome.identity.getRedirectURL();
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

        const callbackUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive: true
        });

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
            const accessToken = await getGoogleAccessTokenWithWebAuthFlow();
            console.log('Got OAuth token via launchWebAuthFlow');
            const credential = GoogleAuthProvider.credential(null, accessToken);
            const result = await signInWithCredential(auth, credential);
            console.log('Sign in successful:', result.user.uid);
            return mapUser(result.user);
        } catch (error) {
            console.error('Firebase sign-in error:', error);
            throw error;
        }
    }

    async function signOut() {
        await firebaseSignOut(auth);
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
        return new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged((user) => {
                unsubscribe();
                if (user) {
                    resolve(mapUser(user));
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
