// Empty for now, but can be used to manage more complex operations later

const AUTH_SUCCESS = 'AUTH_SUCCESS';

let watchlistWindow = null; 

chrome.action.onClicked.addListener(() => {
    if (watchlistWindow) {
        // If window exists, focus it
        chrome.windows.update(watchlistWindow.id, { focused: true });
    } else {
        // Create new window
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

// Clean up reference when window is closed
chrome.windows.onRemoved.addListener((windowId) => {
    if (watchlistWindow && watchlistWindow.id === windowId) {
        watchlistWindow = null;
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === "add-timestamp") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "addTimestamp" });
        });
    }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== AUTH_SUCCESS) {
        return;
    }

    const { user, token } = message;

    chrome.storage.local.set({ user, token }, () => {
        if (chrome.runtime.lastError) {
            console.error('Failed to store auth data:', chrome.runtime.lastError);
        }

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
    });

    return true; // Keep the message channel open for async response.
});

// chrome.runtime.onInstalled.addListener(() => {
//     chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
// });
