// Empty for now, but can be used to manage more complex operations later

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

// chrome.runtime.onInstalled.addListener(() => {
//     chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
// });
