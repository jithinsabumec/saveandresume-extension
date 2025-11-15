'use strict';

(function () {
    const AUTH_SUCCESS = 'AUTH_SUCCESS';
    const USER_STORAGE_KEY = 'user';

    async function openAuthTab() {
        const extensionId = chrome.runtime.id;
        const authUrl = `http://localhost:8080/auth.html?extensionId=${encodeURIComponent(extensionId)}`;

        return new Promise((resolve, reject) => {
            chrome.tabs.create({ url: authUrl, active: true }, (tab) => {
                if (chrome.runtime.lastError || !tab || typeof tab.id !== 'number') {
                    reject(new Error(chrome.runtime.lastError?.message || 'Unable to open authentication tab.'));
                    return;
                }

                resolve(tab.id);
            });
        });
    }

    function waitForAuth(tabId) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Timed out waiting for authentication.'));
            }, 1000 * 60 * 5); // 5 minutes

            function onAuthMessage(message, sender, sendResponse) {
                if (!message || message.type !== AUTH_SUCCESS) {
                    return;
                }

                clearTimeout(timeoutId);
                cleanup();

                resolve({ message, sender });
                sendResponse({ received: true });
            }

            function onRemoved(removedTabId) {
                if (removedTabId === tabId) {
                    clearTimeout(timeoutId);
                    cleanup();
                    reject(new Error('Authentication tab was closed before completion.'));
                }
            }

            function cleanup() {
                chrome.runtime.onMessage.removeListener(onAuthMessage);
                if (chrome.runtime.onMessageExternal) {
                    chrome.runtime.onMessageExternal.removeListener(onAuthMessage);
                }
                chrome.tabs.onRemoved.removeListener(onRemoved);
            }

            chrome.runtime.onMessage.addListener(onAuthMessage);
            if (chrome.runtime.onMessageExternal) {
                chrome.runtime.onMessageExternal.addListener(onAuthMessage);
            }
            chrome.tabs.onRemoved.addListener(onRemoved);
        });
    }

    async function signInWithGoogle() {
        const tabId = await openAuthTab();

        try {
            const { message } = await waitForAuth(tabId);
            const user = message.user;

            await chrome.storage.local.set({ [USER_STORAGE_KEY]: user });

            chrome.tabs.remove(tabId, () => {
                // Ignore errors when closing the tab (it might already be closed).
                if (chrome.runtime.lastError) {
                    console.warn('Auth tab close warning:', chrome.runtime.lastError);
                }
            });

            return user;
        } catch (error) {
            chrome.tabs.remove(tabId, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Auth tab close warning:', chrome.runtime.lastError);
                }
            });
            throw error;
        }
    }

    async function signOut() {
        await chrome.storage.local.remove(USER_STORAGE_KEY);
    }

    async function getCurrentUser() {
        const result = await chrome.storage.local.get(USER_STORAGE_KEY);
        return result[USER_STORAGE_KEY] || null;
    }

    window.auth = {
        signInWithGoogle,
        signOut,
        getCurrentUser
    };
})();
