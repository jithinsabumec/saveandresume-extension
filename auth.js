'use strict';

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";

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
    async function signInWithGoogle() {
        console.log('Starting signInWithGoogle...');
        return new Promise((resolve, reject) => {
            console.log('Calling chrome.identity.getAuthToken...');
            chrome.identity.getAuthToken({ interactive: true }, async function (token) {
                if (chrome.runtime.lastError) {
                    console.error('chrome.identity.getAuthToken error:', chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                console.log('Got auth token:', token ? 'Token received' : 'No token');

                try {
                    console.log('Creating credential...');
                    const credential = GoogleAuthProvider.credential(null, token);
                    console.log('Signing in with credential...');
                    const result = await signInWithCredential(auth, credential);
                    console.log('Sign in successful:', result.user.uid);
                    const user = result.user;

                    resolve({
                        uid: user.uid,
                        displayName: user.displayName,
                        email: user.email,
                        photoURL: user.photoURL
                    });
                } catch (error) {
                    console.error('Firebase sign-in error:', error);
                    reject(error);
                }
            });
        });
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
                    resolve({
                        uid: user.uid,
                        displayName: user.displayName,
                        email: user.email,
                        photoURL: user.photoURL
                    });
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
