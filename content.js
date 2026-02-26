// Function to clean video title
function cleanVideoTitle(title) { 
    return title
        .replace(/^\([^)]*\)\s*/, '')  // Remove brackets at start
        .replace(/^[\[\]0-9]+\s*/, '') // Remove numbers in brackets
        .replace(/\s*- YouTube$/, '');  // Remove "- YouTube" from the end
}

// Function to format time adaptively
function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    
    const days = Math.floor(seconds / (24 * 60 * 60));
    const remainingSecondsAfterDays = seconds % (24 * 60 * 60);
    const hours = Math.floor(remainingSecondsAfterDays / (60 * 60));
    const remainingSecondsAfterHours = remainingSecondsAfterDays % (60 * 60);
    const minutes = Math.floor(remainingSecondsAfterHours / 60);
    const remainingSeconds = Math.floor(remainingSecondsAfterHours % 60);
    
    let parts = [];
    
    // Only add days if there are any
    if (days > 0) {
        parts.push(days.toString().padStart(2, '0'));
    }
    
    // Only add hours if there are any or if we have days
    if (hours > 0 || days > 0) {
        parts.push(hours.toString().padStart(2, '0'));
    }
    
    // Always add minutes and seconds
    parts.push(minutes.toString().padStart(2, '0'));
    parts.push(remainingSeconds.toString().padStart(2, '0'));
    
    return parts.join(':');
}

// Function to get video thumbnail URL
function getVideoThumbnail(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

// Function to create and show custom popup
function showCustomPopup(data) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    // Remove existing popup if any
    const existingPopup = document.getElementById('yt-watchlist-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'yt-watchlist-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <img src="${chrome.runtime.getURL('icon.png')}" width="42" height="42" alt="Icon">
            <div class="popup-text">
                <span class="popup-label">Timestamp ${data.action} at</span>
                <span class="popup-time">${data.time}</span>
            </div>
        </div>
    `;

    // Add styles once and reuse.
    const popupStyleId = 'yt-watchlist-popup-style';
    let style = document.getElementById(popupStyleId);
    if (!style) {
        style = document.createElement('style');
        style.id = popupStyleId;
        style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');

        #yt-watchlist-popup {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            animation: slideIn 0.3s ease-out;
        }
        
        #yt-watchlist-popup .popup-content {
            background: #1C1C1C;
            border: 1px solid #292929;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0px 4px 22.9px 0px rgba(0, 0, 0, 0.25);
        }

        #yt-watchlist-popup .popup-text {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 2px;
        }

        #yt-watchlist-popup .popup-label {
            font-family: 'Manrope', sans-serif;
            font-weight: 400;
            color: #AAAAAA;
            font-size: 16px;
            line-height: 1.2;
        }

        #yt-watchlist-popup .popup-time {
            font-family: 'Space Mono', monospace;
            color: #ffffff;
            font-size: 24px;
            line-height: 1.2;
        }
        
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
        document.head.appendChild(style);
    }
    document.body.appendChild(popup);

    // Remove popup after 3 seconds
    setTimeout(() => {
        popup.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => popup.remove(), 300);
    }, 3000);
}

// Function to check if extension context is valid
function isExtensionContextValid() {
    try {
        return chrome && chrome.runtime && chrome.runtime.id;
    } catch (e) {
        return false;
    }
}

// Function to handle context invalidation
function handleContextInvalidation() {
    // Remove the "Add to Watchlist" button if it exists
    const existingBtn = document.getElementById('addToWatchlistBtn');
    if (existingBtn) {
        existingBtn.remove();
    }
    
    // Remove any existing reload prompt
    const existingPrompt = document.getElementById('extension-reload-prompt');
    if (existingPrompt) {
        return; // Already showing prompt
    }
    
    // Show a reload prompt
    const reloadPrompt = document.createElement('div');
    reloadPrompt.id = 'extension-reload-prompt';
    reloadPrompt.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 12px 16px;
        border-radius: 4px;
        font-family: 'Manrope', sans-serif;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
        animation: slideIn 0.3s ease-out;
    `;
    reloadPrompt.innerHTML = 'Extension updated. <strong>Click to reload page</strong>';
    reloadPrompt.onclick = () => location.reload();
    
    document.body.appendChild(reloadPrompt);
}

// Function to find which category a video belongs to
function findVideoCategory(videoId, callback) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || {};
        let foundCategory = null;
        
        for (const category in categories) {
            const index = categories[category].findIndex(video => video.videoId === videoId);
            if (index !== -1) {
                foundCategory = category;
                break;
            }
        }
        callback(foundCategory);
    });
}

// Function to save video info to storage with current timestamp
function saveVideoToWatchlist(videoId, title, currentTime) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    const currentVideoId = new URLSearchParams(window.location.search).get('v');
    const currentTitle = document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() || document.title;
    const thumbnailUrl = getVideoThumbnail(currentVideoId);
    const cleanedTitle = cleanVideoTitle(currentTitle);
    
    // Check if video already exists in any category
    findVideoCategory(currentVideoId, (existingCategory) => {
        if (existingCategory) {
            // Video exists, update timestamp directly without showing dialog
            console.log(`Video ${currentVideoId} found in category ${existingCategory}. Updating timestamp.`);
            saveTimestampWithCategory(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory);
        } else {
            // Video is new, show category selection dialog
            console.log(`Video ${currentVideoId} not found. Showing category dialog.`);
            showCategorySelectionDialog(currentVideoId, cleanedTitle, currentTime, thumbnailUrl);
        }
    });
}

// Function to show category selection dialog
function showCategorySelectionDialog(videoId, title, currentTime, thumbnailUrl) {
    // Remove existing dialog and backdrop if any
    const existingDialog = document.getElementById('category-selection-dialog');
    const existingBackdrop = document.getElementById('category-selection-backdrop');
    if (existingDialog) existingDialog.remove();
    if (existingBackdrop) existingBackdrop.remove();
    
    // Create dialog container
    const dialog = document.createElement('div');
    dialog.id = 'category-selection-dialog';
    dialog.style.position = 'fixed';
    dialog.style.top = '50%';
    dialog.style.left = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.width = '350px';
    dialog.style.maxHeight = '400px';
    dialog.style.backgroundColor = '#191919';
    dialog.style.borderRadius = '8px';
    dialog.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.5)';
    dialog.style.padding = '20px';
    dialog.style.zIndex = '10000';
    dialog.style.color = '#ffffff';
    dialog.style.fontFamily = 'Manrope, sans-serif';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '16px';

    // Add fonts once and reuse.
    const fontLinkId = 'save-resume-fonts';
    if (!document.getElementById(fontLinkId)) {
        const fontLink = document.createElement('link');
        fontLink.id = fontLinkId;
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Manrope:wght@400;500;600&display=swap';
        document.head.appendChild(fontLink);
    }
    
    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'category-selection-backdrop'; // Give backdrop an ID
    backdrop.style.position = 'fixed';
    backdrop.style.top = '0';
    backdrop.style.left = '0';
    backdrop.style.right = '0';
    backdrop.style.bottom = '0';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    backdrop.style.zIndex = '9999';
    
    // Get formatted time for display
    const formattedTime = formatTime(currentTime);
    
    // Helper function to close dialog and backdrop
    const closeDialog = () => {
        dialog.remove();
        backdrop.remove();
    };

    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            closeDialog();
        }
    };
    
    // Create dialog header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    
    const headerTitle = document.createElement('h3');
    headerTitle.textContent = 'Assign Category';
    headerTitle.style.margin = '0';
    headerTitle.style.fontSize = '18px';
    headerTitle.style.fontWeight = '500';
    headerTitle.style.fontFamily = 'Manrope, sans-serif';
    
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.fontSize = '24px';
    closeButton.style.color = '#7C7C7C';
    closeButton.style.cursor = 'pointer';
    closeButton.style.padding = '0';
    closeButton.onclick = closeDialog;
    
    header.appendChild(headerTitle);
    header.appendChild(closeButton);
    dialog.appendChild(header);
    
    // Create timestamp display
    const timestampInfo = document.createElement('div');
    timestampInfo.style.backgroundColor = '#242424';
    timestampInfo.style.padding = '12px';
    timestampInfo.style.borderRadius = '4px';
    timestampInfo.style.display = 'flex';
    timestampInfo.style.alignItems = 'center';
    timestampInfo.style.gap = '12px';
    timestampInfo.style.border = '1px solid #404040';
    
    const thumbnailImg = document.createElement('img');
    thumbnailImg.src = thumbnailUrl;
    thumbnailImg.style.width = '80px';
    thumbnailImg.style.height = '45px';
    thumbnailImg.style.borderRadius = '4px';
    thumbnailImg.style.objectFit = 'cover';
    
    const infoText = document.createElement('div');
    infoText.style.display = 'flex';
    infoText.style.flexDirection = 'column';
    infoText.style.gap = '4px';
    
    const titleText = document.createElement('div');
    titleText.textContent = title;
    titleText.style.fontSize = '14px';
    titleText.style.lineHeight = '1.4';
    titleText.style.overflow = 'hidden';
    titleText.style.display = '-webkit-box';
    titleText.style.webkitLineClamp = '2';
    titleText.style.webkitBoxOrient = 'vertical';
    titleText.style.textOverflow = 'ellipsis';
    titleText.style.fontFamily = 'Manrope, sans-serif';
    
    const timeText = document.createElement('div');
    // Change timestamp value color to grey (#7C7C7C)
    timeText.innerHTML = `
        <span style="color: #7C7C7C; font-size: 12px; font-family: 'Manrope', sans-serif;">Timestamp - </span>
        <span style="font-family: 'Space Mono', monospace !important; font-size: 12px; font-weight: 400 !important; color: #7C7C7C;">${formattedTime}</span>
    `;
    
    infoText.appendChild(titleText);
    infoText.appendChild(timeText);
    
    timestampInfo.appendChild(thumbnailImg);
    timestampInfo.appendChild(infoText);
    dialog.appendChild(timestampInfo);
    
    // Create category selection
    const categorySection = document.createElement('div');
    categorySection.style.display = 'flex';
    categorySection.style.flexDirection = 'column';
    categorySection.style.gap = '8px';
    
    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'Choose a category';
    categoryLabel.style.fontSize = '14px';
    categoryLabel.style.fontFamily = 'Manrope, sans-serif';
    
    const categorySelect = document.createElement('select');
    categorySelect.id = 'category-select';
    categorySelect.style.backgroundColor = '#242424';
    categorySelect.style.border = '1px solid #393838';
    categorySelect.style.borderRadius = '4px';
    categorySelect.style.padding = '8px';
    categorySelect.style.color = '#ffffff';
    categorySelect.style.fontFamily = 'Manrope, sans-serif';
    categorySelect.style.width = '100%';
    categorySelect.style.appearance = 'auto';
    
    // Add "Create new..." option
    const createNewOption = document.createElement('option');
    createNewOption.value = 'create-new';
    createNewOption.textContent = '+ Create new category';
    createNewOption.style.fontFamily = 'Manrope, sans-serif';
    
    const newCategoryInput = document.createElement('input');
    newCategoryInput.type = 'text';
    newCategoryInput.placeholder = 'Enter new category name';
    newCategoryInput.style.backgroundColor = '#242424';
    newCategoryInput.style.border = '1px solid #393838';
    newCategoryInput.style.borderRadius = '4px';
    newCategoryInput.style.padding = '8px';
    newCategoryInput.style.color = '#ffffff';
    newCategoryInput.style.fontFamily = 'Manrope, sans-serif';
    newCategoryInput.style.width = '100%';
    newCategoryInput.style.display = 'none';
    newCategoryInput.style.boxSizing = 'border-box';
    newCategoryInput.style.outline = 'none';
    newCategoryInput.onfocus = function() {
        this.style.outline = 'none';
        this.style.boxShadow = '0 0 0 1px rgba(121, 121, 121, 0.6)';
        this.style.borderColor = 'transparent';
        this.style.transition = 'box-shadow 0.2s ease, border-color 0.2s ease';
    };
    newCategoryInput.onblur = function() {
        this.style.boxShadow = 'none';
        this.style.borderColor = '#393838';
    };

    // Load existing categories
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        
        // Default option
        const defaultOption = document.createElement('option');
        defaultOption.value = 'Default';
        defaultOption.textContent = 'Default';
        defaultOption.selected = true;
        defaultOption.style.fontFamily = 'Manrope, sans-serif';
        categorySelect.appendChild(defaultOption);
        
        // Other categories
        Object.keys(categories)
            .filter(cat => cat !== 'Default')
            .sort()
            .forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                option.style.fontFamily = 'Manrope, sans-serif';
                categorySelect.appendChild(option);
            });
        
        categorySelect.appendChild(createNewOption);
    });
    
    categorySelect.onchange = function() {
        if (this.value === 'create-new') {
            // Show new category input
            this.style.display = 'none';
            newCategoryInput.style.display = 'block';
            newCategoryInput.focus();
        }
    };
    
    categorySection.appendChild(categoryLabel);
    categorySection.appendChild(categorySelect);
    categorySection.appendChild(newCategoryInput);
    dialog.appendChild(categorySection);
    
    // Create action buttons
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.marginTop = '8px';
    
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#242424';
    cancelButton.style.border = '1px solid #393838';
    cancelButton.style.borderRadius = '4px';
    cancelButton.style.padding = '8px 12px';
    cancelButton.style.color = '#7C7C7C';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontFamily = 'Manrope, sans-serif';
    cancelButton.style.transition = 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease';
    cancelButton.onmouseover = function() {
        this.style.backgroundColor = '#333333';
        this.style.borderColor = '#555555';
        this.style.color = '#ffffff';
    };
    cancelButton.onmouseout = function() {
        this.style.backgroundColor = '#242424';
        this.style.borderColor = '#393838';
        this.style.color = '#7C7C7C';
    };
    cancelButton.onclick = closeDialog;
    
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.style.backgroundColor = '#781D2F';
    saveButton.style.border = '1px solid #ED1A43';
    saveButton.style.borderRadius = '4px';
    saveButton.style.padding = '8px 12px';
    saveButton.style.color = '#ffffff';
    saveButton.style.cursor = 'pointer';
    saveButton.style.fontFamily = 'Manrope, sans-serif';
    saveButton.style.transition = 'background-color 0.2s ease';
    saveButton.onmouseover = function() {
        this.style.backgroundColor = '#611726';
    };
    saveButton.onmouseout = function() {
        this.style.backgroundColor = '#781D2F';
    };
    saveButton.onclick = function() {
        let selectedCategory;
        
        if (newCategoryInput.style.display === 'block') {
            selectedCategory = newCategoryInput.value.trim();
            if (!selectedCategory) {
                alert('Please enter a category name');
                return;
            }
        } else {
            selectedCategory = categorySelect.value;
        }
        
        saveTimestampWithCategory(videoId, title, currentTime, thumbnailUrl, selectedCategory);
        closeDialog();
    };
    
    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(saveButton);
    dialog.appendChild(buttonsContainer);
    
    // Add dialog and backdrop to page
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
}

// Function to save timestamp with selected category
function saveTimestampWithCategory(videoId, title, currentTime, thumbnailUrl, category) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    const videoData = { 
        videoId: videoId,
        title: title, 
        currentTime,
        thumbnail: thumbnailUrl,
        timestamp: Date.now()
    };
    
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        
        // Ensure category exists
        if (!categories[category]) {
            categories[category] = [];
        }
        
        // Check if video already exists in this category
        const existingVideoIndex = categories[category].findIndex(video => video.videoId === videoId);
        const formattedTime = formatTime(currentTime);
        
        if (existingVideoIndex === -1) {
            // Video not in this category, add it at the beginning
            categories[category].unshift(videoData);
            
            // Save to storage
            chrome.storage.local.set({ categories: categories }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error saving to storage:', chrome.runtime.lastError);
                    showCustomPopup({ 
                        action: 'error',
                        time: formattedTime 
                    });
                    return;
                }
                showCustomPopup({ 
                    action: 'added',
                    time: formattedTime 
                });
                console.log('Timestamp added to category:', category, videoData);
            });
        } else {
            // Video exists in this category, update its timestamp
            categories[category][existingVideoIndex].currentTime = currentTime;
            categories[category][existingVideoIndex].timestamp = Date.now();
            categories[category][existingVideoIndex].title = title;  // Update title in case it changed
            
            // Move to the beginning of the category
            const updatedVideo = categories[category].splice(existingVideoIndex, 1)[0];
            categories[category].unshift(updatedVideo);
            
            // Save to storage
            chrome.storage.local.set({ categories: categories }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error saving to storage:', chrome.runtime.lastError);
                    showCustomPopup({ 
                        action: 'error',
                        time: formattedTime 
                    });
                    return;
                }
                showCustomPopup({ 
                    action: 'updated',
                    time: formattedTime 
                });
                console.log('Timestamp updated in category:', category, updatedVideo);
            });
        }
    });
}

// Create and inject "Add to Watchlist" button
function addButton() {
    // Check if extension context is valid before adding button
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }
    
    // Remove existing button if any
    const existingBtn = document.getElementById('addToWatchlistBtn');
    if (existingBtn) {
        existingBtn.remove();
    }
    
    const videoId = new URLSearchParams(window.location.search).get('v');
    const videoTitle = document.title;
    const isHomePage = window.location.pathname === '/';
    const isFullscreen = document.fullscreenElement !== null;
    
    // Only add button if:
    // 1. We have a video ID (we're on a video page)
    // 2. We're not on the homepage
    // 3. We're not in fullscreen mode
    // 4. Button doesn't already exist
    if (videoId && !isHomePage && !isFullscreen) {
        const btn = document.createElement('button');
        btn.id = 'addToWatchlistBtn';
        btn.innerText = 'SAVE TIMESTAMP';
        btn.style.fontFamily = 'Space Grotesk, sans-serif';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.padding = '12px 16px';
        btn.style.background = '#1C1C1C';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'medium';
        btn.style.borderRadius = '5px';
        btn.style.boxShadow = '0px 9px 57.2px rgba(0, 0, 0, 0.25), 0px 2px 8.5px rgba(0, 0, 0, 0.15)';
        btn.style.cursor = 'pointer';
        btn.style.zIndex = '9999';
        btn.style.border = '1px solid #393838';
        btn.style.fontSize = '16px';
        btn.style.letterSpacing = 0;
        btn.style.boxShadow = '0px 0px 29.4px 0px #000;';
        
        btn.onclick = function() {
            if (!isExtensionContextValid()) {
                handleContextInvalidation();
                return;
            }
            
            const video = document.querySelector('video');
            const currentTime = video.currentTime;
            console.log('Video current time:', currentTime);
            console.log('Video current time (readable):', video.currentTime / 60, 'minutes');
            saveVideoToWatchlist(videoId, videoTitle, currentTime);
        };
        btn.addEventListener('mouseenter', () => {
            btn.style.backgroundColor = '#781D2F';  // darker red on hover
            btn.style.border = '1px solid #ED1A43';
            btn.style.transform = 'scale(1.02)';    // slightly larger
            btn.style.transition = 'all 0.2s ease'; // smooth transition
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.backgroundColor = '#2d2d2d';  // original color on hover out
            btn.style.transform = 'scale(1)';       // original size
            btn.style.border = '1px solid #393838';
            btn.style.boxShadow = '0px 0px 29.4px 0px #000;';
        });
        document.body.appendChild(btn);
    }
}

// Listen for fullscreen changes
document.addEventListener('fullscreenchange', addButton);

// Initial button creation
window.onload = addButton;

// Also watch for URL changes (for single-page-app navigation)
let lastUrl = location.href; 
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        addButton();
    }
}).observe(document, {subtree: true, childList: true});

// Add this at the start of the file
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "addTimestamp") {
        if (!isExtensionContextValid()) {
            handleContextInvalidation();
            return;
        }
        
        const videoId = new URLSearchParams(window.location.search).get('v');
        const videoTitle = document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() || document.title;
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            const thumbnailUrl = getVideoThumbnail(videoId);
            const cleanedTitle = cleanVideoTitle(videoTitle);
            
            // Check if video already exists before showing dialog
            findVideoCategory(videoId, (existingCategory) => {
                if (existingCategory) {
                    // Video exists, update timestamp directly
                    console.log(`Video ${videoId} found via shortcut in category ${existingCategory}. Updating timestamp.`);
                    saveTimestampWithCategory(videoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory);
                } else {
                    // Video is new, show category selection dialog
                    console.log(`Video ${videoId} not found via shortcut. Showing category dialog.`);
                    showCategorySelectionDialog(videoId, cleanedTitle, currentTime, thumbnailUrl);
                }
            });
        } else {
            console.error('No video element found.');
        }
    }
});
