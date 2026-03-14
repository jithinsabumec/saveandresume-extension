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

const dataClient = globalThis.SaveResumeDataLayer.createClientDataLayer();
const CATEGORY_DIALOG_RADIUS = '12px';
const CATEGORY_FIELD_RADIUS = '8px';
const CATEGORY_FIELD_HEIGHT = '36px';
const PRIMARY_FONT_FAMILY = "'Saans', sans-serif";
const MONO_FONT_FAMILY = "'Space Mono', monospace";
const SPACE_MONO_LINK_ID = 'save-resume-space-mono-font';
const SAANS_FONT_STYLE_ID = 'save-resume-saans-font';

function applyCategoryFieldStyles(element) {
    element.style.width = '100%';
    element.style.height = CATEGORY_FIELD_HEIGHT;
    element.style.minHeight = CATEGORY_FIELD_HEIGHT;
    element.style.padding = '0 12px';
    element.style.backgroundColor = '#242424';
    element.style.border = '1px solid #393838';
    element.style.borderRadius = CATEGORY_FIELD_RADIUS;
    element.style.color = '#ffffff';
    element.style.fontSize = '14px';
    element.style.fontWeight = '500';
    element.style.fontFamily = PRIMARY_FONT_FAMILY;
    element.style.boxSizing = 'border-box';
    element.style.outline = 'none';
    element.style.boxShadow = 'none';
}

function applyDialogCheckboxStyles(checkbox) {
    checkbox.style.appearance = 'none';
    checkbox.style.webkitAppearance = 'none';
    checkbox.style.margin = '0';
    checkbox.style.width = '16px';
    checkbox.style.height = '16px';
    checkbox.style.minWidth = '16px';
    checkbox.style.border = '1px solid #3C3C3C';
    checkbox.style.borderRadius = '5px';
    checkbox.style.backgroundColor = '#191919';
    checkbox.style.display = 'inline-flex';
    checkbox.style.alignItems = 'center';
    checkbox.style.justifyContent = 'center';
    checkbox.style.cursor = 'pointer';
    checkbox.style.boxSizing = 'border-box';
    checkbox.style.transition = 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease';
    checkbox.style.outline = 'none';
    checkbox.style.backgroundRepeat = 'no-repeat';
    checkbox.style.backgroundPosition = 'center';
    checkbox.style.backgroundSize = '10px 10px';

    const setCheckboxVisualState = () => {
        if (checkbox.checked) {
            checkbox.style.backgroundColor = '#781D2F';
            checkbox.style.borderColor = '#ED1A43';
            checkbox.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' viewBox='0 0 10 8'%3E%3Cpath fill='%23FFFFFF' d='M3.6 7.2L.4 4 .9 3.5 3.6 6.2 9.1.7l.5.5z'/%3E%3C/svg%3E")`;
        } else {
            checkbox.style.backgroundColor = '#191919';
            checkbox.style.borderColor = '#3C3C3C';
            checkbox.style.backgroundImage = 'none';
        }
    };

    checkbox.addEventListener('change', setCheckboxVisualState);
    checkbox.addEventListener('focus', () => {
        checkbox.style.boxShadow = '0 0 0 2px rgba(237, 26, 67, 0.25)';
    });
    checkbox.addEventListener('blur', () => {
        checkbox.style.boxShadow = 'none';
    });

    setCheckboxVisualState();
}

function getCloudCategories(callback) {
    dataClient.get(['categories'])
        .then((data) => callback(data.categories || {}, null))
        .catch((error) => callback(null, error));
}

function setCloudCategories(categories, callback) {
    dataClient.set({ categories })
        .then(() => {
            if (typeof callback === 'function') callback(null);
        })
        .catch((error) => {
            if (typeof callback === 'function') callback(error);
        });
}

function getLocalBooleanPreference(key, fallback) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!Object.prototype.hasOwnProperty.call(result, key)) {
                resolve(Boolean(fallback));
                return;
            }

            resolve(result[key] === true);
        });
    });
}

function setLocalBooleanPreference(key, value) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: Boolean(value) }, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(Boolean(value));
        });
    });
}

function getStudyModePreference() {
    return getLocalBooleanPreference('studyMode', false);
}

function getShowNotesModalPreference() {
    return getLocalBooleanPreference('showNotesModal', true);
}

function setShowNotesModalPreference(value) {
    return setLocalBooleanPreference('showNotesModal', value);
}

function getNormalizedVideoTimestampEntries(video) {
    const fallbackTime = Math.max(0, Number(video?.currentTime) || 0);
    const fallbackSavedAt = Math.max(0, Number(video?.timestamp) || Date.now());
    const rawEntries = Array.isArray(video?.timestamps) && video.timestamps.length > 0
        ? video.timestamps
        : [{ time: fallbackTime, note: '', savedAt: fallbackSavedAt }];

    return rawEntries.map((entry) => ({
        time: Math.max(0, Number(entry?.time) || 0),
        note: typeof entry?.note === 'string' ? entry.note : '',
        savedAt: Math.max(0, Number(entry?.savedAt) || fallbackSavedAt)
    }));
}

function ensureDialogFontsLoaded() {
    if (isExtensionContextValid() && !document.getElementById(SAANS_FONT_STYLE_ID)) {
        const saansFontStyle = document.createElement('style');
        saansFontStyle.id = SAANS_FONT_STYLE_ID;
        saansFontStyle.textContent = `
            @font-face {
                font-family: 'Saans';
                src: url('${chrome.runtime.getURL('SaansCollectionVF-TRIAL.ttf')}') format('truetype');
                font-style: normal;
                font-weight: 100 900;
                font-display: swap;
            }
        `;
        document.head.appendChild(saansFontStyle);
    }

    if (!document.getElementById(SPACE_MONO_LINK_ID)) {
        const fontLink = document.createElement('link');
        fontLink.id = SPACE_MONO_LINK_ID;
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap';
        document.head.appendChild(fontLink);
    }
}

function createDialogScaffold(dialogTitle, onClose) {
    const existingDialog = document.getElementById('category-selection-dialog');
    const existingBackdrop = document.getElementById('category-selection-backdrop');
    if (existingDialog) existingDialog.remove();
    if (existingBackdrop) existingBackdrop.remove();

    ensureDialogFontsLoaded();

    const dialog = document.createElement('div');
    dialog.id = 'category-selection-dialog';
    dialog.style.position = 'fixed';
    dialog.style.top = '50%';
    dialog.style.left = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.width = '350px';
    dialog.style.maxHeight = '400px';
    dialog.style.backgroundColor = '#191919';
    dialog.style.borderRadius = CATEGORY_DIALOG_RADIUS;
    dialog.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.5)';
    dialog.style.padding = '16px';
    dialog.style.zIndex = '10000';
    dialog.style.color = '#ffffff';
    dialog.style.fontFamily = PRIMARY_FONT_FAMILY;
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '16px';

    const backdrop = document.createElement('div');
    backdrop.id = 'category-selection-backdrop';
    backdrop.style.position = 'fixed';
    backdrop.style.top = '0';
    backdrop.style.left = '0';
    backdrop.style.right = '0';
    backdrop.style.bottom = '0';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    backdrop.style.zIndex = '9999';

    const closeDialog = () => {
        if (typeof onClose === 'function') {
            onClose();
        }
        dialog.remove();
        backdrop.remove();
    };

    backdrop.onclick = (event) => {
        if (event.target === backdrop) {
            closeDialog();
        }
    };

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const headerTitle = document.createElement('h3');
    headerTitle.textContent = dialogTitle;
    headerTitle.style.margin = '0';
    headerTitle.style.fontSize = '18px';
    headerTitle.style.fontWeight = '500';
    headerTitle.style.fontFamily = PRIMARY_FONT_FAMILY;

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

    return { dialog, backdrop, closeDialog };
}

function createTimestampInfoCard(title, currentTime, thumbnailUrl) {
    const timestampInfo = document.createElement('div');
    timestampInfo.style.backgroundColor = '#191919';
    timestampInfo.style.padding = '8px';
    timestampInfo.style.borderRadius = '8px';
    timestampInfo.style.display = 'flex';
    timestampInfo.style.alignItems = 'center';
    timestampInfo.style.gap = '12px';
    timestampInfo.style.border = '1px solid #2D2D2D';

    const thumbnailImg = document.createElement('img');
    thumbnailImg.src = thumbnailUrl;
    thumbnailImg.style.width = '100px';
    thumbnailImg.style.height = '56px';
    thumbnailImg.style.borderRadius = '6px';
    thumbnailImg.style.objectFit = 'cover';

    const infoText = document.createElement('div');
    infoText.style.display = 'flex';
    infoText.style.flexDirection = 'column';
    infoText.style.gap = '4px';
    infoText.style.flex = '1';
    infoText.style.minWidth = '0';

    const titleText = document.createElement('div');
    titleText.textContent = title;
    titleText.style.fontSize = '14px';
    titleText.style.fontWeight = '500';
    titleText.style.color = '#ffffff';
    titleText.style.lineHeight = '1.4';
    titleText.style.overflow = 'hidden';
    titleText.style.display = '-webkit-box';
    titleText.style.webkitLineClamp = '2';
    titleText.style.webkitBoxOrient = 'vertical';
    titleText.style.textOverflow = 'ellipsis';
    titleText.style.fontFamily = PRIMARY_FONT_FAMILY;

    const timeText = document.createElement('div');
    timeText.style.display = 'flex';
    timeText.style.alignItems = 'center';
    timeText.style.gap = '4px';

    if (isExtensionContextValid()) {
        const timestampIcon = document.createElement('img');
        timestampIcon.src = chrome.runtime.getURL('timestamp.svg');
        timestampIcon.alt = 'Timestamp';
        timestampIcon.style.width = '12px';
        timestampIcon.style.height = '12px';
        timestampIcon.style.display = 'block';
        timeText.appendChild(timestampIcon);
    }

    const timeValue = document.createElement('span');
    timeValue.textContent = formatTime(currentTime);
    timeValue.style.fontFamily = MONO_FONT_FAMILY;
    timeValue.style.fontSize = '12px';
    timeValue.style.fontWeight = '400';
    timeValue.style.color = '#7C7C7C';
    timeText.appendChild(timeValue);

    infoText.appendChild(titleText);
    infoText.appendChild(timeText);
    timestampInfo.appendChild(thumbnailImg);
    timestampInfo.appendChild(infoText);

    return timestampInfo;
}

function createNotesInputField(placeholderText) {
    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.placeholder = placeholderText;
    applyCategoryFieldStyles(notesInput);
    return notesInput;
}

// Function to create and show custom popup
function showCustomPopup(data) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    ensureDialogFontsLoaded();

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
            border-radius: 8px;
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
            font-family: ${PRIMARY_FONT_FAMILY};
            font-weight: 400;
            color: #AAAAAA;
            font-size: 16px;
            line-height: 1.2;
        }

        #yt-watchlist-popup .popup-time {
            font-family: ${MONO_FONT_FAMILY};
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
        font-family: ${PRIMARY_FONT_FAMILY};
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

    getCloudCategories((categories, error) => {
        if (error) {
            console.error('Failed to load categories:', error);
            callback(null);
            return;
        }

        let foundCategory = null;
        let foundVideo = null;

        for (const category in categories) {
            const index = categories[category].findIndex(video => video.videoId === videoId);
            if (index !== -1) {
                foundCategory = category;
                foundVideo = categories[category][index];
                break;
            }
        }
        callback(foundCategory, foundVideo);
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
    findVideoCategory(currentVideoId, (existingCategory, existingVideo) => {
        const continueSaveForExistingVideo = (effectiveStudyMode) => {
            console.log(`Video ${currentVideoId} found in category ${existingCategory}. Updating timestamp.`);

            if (!effectiveStudyMode) {
                saveTimestampWithCategory(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory, '');
                return;
            }

            getShowNotesModalPreference()
                .then((shouldShowNotesModal) => {
                    if (shouldShowNotesModal) {
                        showRepeatSaveDialog(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory);
                        return;
                    }

                    saveTimestampWithCategory(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory, '');
                })
                .catch((error) => {
                    console.error('Failed to read showNotesModal preference:', error);
                    saveTimestampWithCategory(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, existingCategory, '');
                });
        };

        getStudyModePreference()
            .then((globalStudyMode) => {
                if (existingCategory) {
                    const effectiveStudyMode = Boolean(globalStudyMode || existingVideo?.studyMode === true);
                    continueSaveForExistingVideo(effectiveStudyMode);
                    return;
                }

                // Video is new, show category selection dialog
                console.log(`Video ${currentVideoId} not found. Showing category dialog.`);
                showCategorySelectionDialog(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, globalStudyMode);
            })
            .catch((error) => {
                console.error('Failed to read Study Mode preference:', error);
                if (existingCategory) {
                    const effectiveStudyMode = existingVideo?.studyMode === true;
                    continueSaveForExistingVideo(effectiveStudyMode);
                    return;
                }
                showCategorySelectionDialog(currentVideoId, cleanedTitle, currentTime, thumbnailUrl, false);
            });
    });
}

let lastShortcutHandledAt = 0;

function triggerShortcutCategoryDialog() {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    const now = Date.now();
    if (now - lastShortcutHandledAt < 300) {
        return;
    }
    lastShortcutHandledAt = now;

    const videoId = new URLSearchParams(window.location.search).get('v');
    const videoTitle = document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() || document.title;
    const video = document.querySelector('video');

    if (!video || !videoId) {
        console.error('Unable to save timestamp from shortcut: missing video context.');
        return;
    }

    const currentTime = video.currentTime;
    saveVideoToWatchlist(videoId, videoTitle, currentTime);
}

function isEditableShortcutTarget(target) {
    if (!target) {
        return false;
    }

    const tagName = target.tagName ? target.tagName.toLowerCase() : '';
    return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

// Function to show category selection dialog
async function showCategorySelectionDialog(videoId, title, currentTime, thumbnailUrl, globalStudyMode = false) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    let removeCategoryDropdownDocumentListener = null;
    const { dialog, backdrop, closeDialog } = createDialogScaffold('Assign Category', () => {
        if (removeCategoryDropdownDocumentListener) {
            document.removeEventListener('click', removeCategoryDropdownDocumentListener);
            removeCategoryDropdownDocumentListener = null;
        }
    });

    dialog.appendChild(createTimestampInfoCard(title, currentTime, thumbnailUrl));

    const categorySection = document.createElement('div');
    categorySection.style.display = 'flex';
    categorySection.style.flexDirection = 'column';
    categorySection.style.gap = '8px';

    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'Choose a category';
    categoryLabel.style.fontSize = '14px';
    categoryLabel.style.fontWeight = '500';
    categoryLabel.style.color = '#ffffff';
    categoryLabel.style.fontFamily = PRIMARY_FONT_FAMILY;

    const categoryDropdown = document.createElement('div');
    categoryDropdown.style.position = 'relative';
    categoryDropdown.style.width = '100%';

    const categoryTrigger = document.createElement('button');
    categoryTrigger.type = 'button';
    applyCategoryFieldStyles(categoryTrigger);
    categoryTrigger.style.display = 'flex';
    categoryTrigger.style.alignItems = 'center';
    categoryTrigger.style.justifyContent = 'space-between';
    categoryTrigger.style.cursor = 'pointer';
    categoryTrigger.setAttribute('aria-haspopup', 'listbox');
    categoryTrigger.setAttribute('aria-expanded', 'false');

    const categoryTriggerText = document.createElement('span');
    categoryTriggerText.textContent = 'Default';

    const categoryTriggerChevron = document.createElement('span');
    categoryTriggerChevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 256 256"><path fill="#ffffff" d="M208.49,104.49a8,8,0,0,1,0,11.31l-72,72a8,8,0,0,1-11.31,0l-72-72a8,8,0,0,1,11.31-11.31L128,168l63.51-63.52A8,8,0,0,1,208.49,104.49Z"></path></svg>`;
    categoryTriggerChevron.style.display = 'inline-flex';

    categoryTrigger.appendChild(categoryTriggerText);
    categoryTrigger.appendChild(categoryTriggerChevron);

    const categoryDropdownMenu = document.createElement('div');
    categoryDropdownMenu.style.position = 'absolute';
    categoryDropdownMenu.style.top = 'calc(100% + 6px)';
    categoryDropdownMenu.style.left = '0';
    categoryDropdownMenu.style.right = '0';
    categoryDropdownMenu.style.backgroundColor = '#191919';
    categoryDropdownMenu.style.border = '1px solid #2D2D2D';
    categoryDropdownMenu.style.borderRadius = CATEGORY_FIELD_RADIUS;
    categoryDropdownMenu.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.35)';
    categoryDropdownMenu.style.padding = '4px';
    categoryDropdownMenu.style.boxSizing = 'border-box';
    categoryDropdownMenu.style.overflow = 'hidden';
    categoryDropdownMenu.style.zIndex = '10001';
    categoryDropdownMenu.style.display = 'none';

    const categoryOptionsList = document.createElement('div');
    categoryOptionsList.style.display = 'flex';
    categoryOptionsList.style.flexDirection = 'column';
    categoryOptionsList.style.gap = '0';
    categoryOptionsList.style.width = '100%';
    categoryOptionsList.style.boxSizing = 'border-box';
    categoryDropdownMenu.appendChild(categoryOptionsList);

    categoryDropdown.appendChild(categoryTrigger);
    categoryDropdown.appendChild(categoryDropdownMenu);

    const newCategoryInput = document.createElement('input');
    newCategoryInput.type = 'text';
    newCategoryInput.placeholder = 'Enter new category name';
    applyCategoryFieldStyles(newCategoryInput);
    newCategoryInput.style.display = 'none';

    let notesInput = null;
    let notesSection = null;
    let showNotesRow = null;

    if (globalStudyMode) {
        notesSection = document.createElement('div');
        notesSection.style.display = 'flex';
        notesSection.style.flexDirection = 'column';
        notesSection.style.gap = '8px';

        const notesLabel = document.createElement('label');
        notesLabel.textContent = 'Notes';
        notesLabel.style.fontSize = '14px';
        notesLabel.style.fontWeight = '500';
        notesLabel.style.color = '#ffffff';
        notesLabel.style.fontFamily = PRIMARY_FONT_FAMILY;

        notesInput = createNotesInputField('Add a note for this timestamp... (optional)');
        notesSection.appendChild(notesLabel);
        notesSection.appendChild(notesInput);

        showNotesRow = document.createElement('label');
        showNotesRow.style.display = 'flex';
        showNotesRow.style.alignItems = 'center';
        showNotesRow.style.gap = '8px';
        showNotesRow.style.fontSize = '13px';
        showNotesRow.style.color = '#D2D2D2';
        showNotesRow.style.cursor = 'pointer';

        const showNotesCheckbox = document.createElement('input');
        showNotesCheckbox.type = 'checkbox';
        showNotesCheckbox.checked = await getShowNotesModalPreference().catch(() => true);
        applyDialogCheckboxStyles(showNotesCheckbox);

        const showNotesText = document.createElement('span');
        showNotesText.textContent = 'Ask me to add notes every time I save';

        showNotesRow.appendChild(showNotesCheckbox);
        showNotesRow.appendChild(showNotesText);

        showNotesCheckbox.addEventListener('change', () => {
            setShowNotesModalPreference(showNotesCheckbox.checked).catch((error) => {
                console.error('Failed to save showNotesModal preference:', error);
            });
        });
    }

    const selectedTickIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><path fill="#1FA700" d="M3.359 6L0 2.64l.947-.947 2.412 2.407L9.053 0 10 .947 3.359 6Z"/></svg>';
    let selectedCategoryValue = 'Default';
    let availableCategories = ['Default'];

    const buildAvailableCategories = (categoriesObj) => {
        const savedCategoryNames = Object.keys(categoriesObj || {})
            .filter((categoryName) => categoryName !== 'Default')
            .sort();
        return ['Default', ...savedCategoryNames];
    };

    const closeCategoryDropdown = () => {
        categoryDropdownMenu.style.display = 'none';
        categoryTrigger.setAttribute('aria-expanded', 'false');
    };

    const setSelectedCategory = (categoryName) => {
        selectedCategoryValue = categoryName;
        categoryTriggerText.textContent = categoryName;
        categoryTrigger.style.display = 'flex';
        newCategoryInput.style.display = 'none';
    };

    const createCategoryRow = (label, value, isCreateNew = false) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.appearance = 'none';
        row.style.webkitAppearance = 'none';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.width = '100%';
        row.style.minHeight = '32px';
        row.style.padding = '6px 10px';
        row.style.background = 'transparent';
        row.style.border = 'none';
        row.style.borderRadius = '8px';
        row.style.cursor = 'pointer';
        row.style.boxSizing = 'border-box';
        row.style.outline = 'none';
        row.style.boxShadow = 'none';

        const check = document.createElement('span');
        check.style.width = '10px';
        check.style.minWidth = '10px';
        check.style.height = '6px';
        check.style.display = 'inline-flex';
        check.style.alignItems = 'center';
        check.style.justifyContent = 'center';
        check.innerHTML = selectedTickIcon;

        const text = document.createElement('span');
        text.textContent = label;
        text.style.fontFamily = PRIMARY_FONT_FAMILY;
        text.style.fontSize = '14px';
        text.style.fontWeight = '500';
        text.style.lineHeight = '20px';
        text.style.whiteSpace = 'normal';
        text.style.overflowWrap = 'anywhere';

        const updateState = () => {
            const isSelected = !isCreateNew && selectedCategoryValue === value;
            check.style.opacity = isSelected ? '1' : '0';
            text.style.color = isSelected ? '#FFFFFF' : '#D2D2D2';
        };
        updateState();

        row.onmouseover = () => {
            row.style.backgroundColor = '#2B2B2B';
            if (!(!isCreateNew && selectedCategoryValue === value)) {
                text.style.color = '#FFFFFF';
            }
        };
        row.onmouseout = () => {
            row.style.backgroundColor = 'transparent';
            updateState();
        };

        row.onclick = (event) => {
            event.stopPropagation();
            if (isCreateNew) {
                closeCategoryDropdown();
                categoryTrigger.style.display = 'none';
                newCategoryInput.style.display = 'block';
                newCategoryInput.focus();
                return;
            }

            setSelectedCategory(value);
            renderCategoryOptions();
            closeCategoryDropdown();
        };

        row.appendChild(check);
        row.appendChild(text);
        return row;
    };

    const renderCategoryOptions = () => {
        categoryOptionsList.innerHTML = '';

        availableCategories.forEach((categoryName) => {
            categoryOptionsList.appendChild(createCategoryRow(categoryName, categoryName, false));
        });

        categoryOptionsList.appendChild(createCategoryRow('+ Create new category', 'create-new', true));
    };

    categoryTrigger.onclick = (event) => {
        event.stopPropagation();
        const shouldOpen = categoryDropdownMenu.style.display !== 'block';
        if (shouldOpen) {
            categoryDropdownMenu.style.display = 'block';
            categoryTrigger.setAttribute('aria-expanded', 'true');
        } else {
            closeCategoryDropdown();
        }
    };

    removeCategoryDropdownDocumentListener = (event) => {
        if (!categoryDropdown.contains(event.target)) {
            closeCategoryDropdown();
        }
    };
    document.addEventListener('click', removeCategoryDropdownDocumentListener);

    getCloudCategories((categories, error) => {
        if (error) {
            closeDialog();
            console.error('Failed to load categories:', error);
            return;
        }

        availableCategories = buildAvailableCategories(categories);
        renderCategoryOptions();
    });

    categorySection.appendChild(categoryLabel);
    categorySection.appendChild(categoryDropdown);
    categorySection.appendChild(newCategoryInput);
    dialog.appendChild(categorySection);
    if (notesSection) {
        dialog.appendChild(notesSection);
    }
    if (showNotesRow) {
        dialog.appendChild(showNotesRow);
    }

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.marginTop = '8px';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#242424';
    cancelButton.style.border = '1px solid #393838';
    cancelButton.style.borderRadius = '10px';
    cancelButton.style.padding = '8px 12px';
    cancelButton.style.color = '#7C7C7C';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontFamily = PRIMARY_FONT_FAMILY;
    cancelButton.onclick = closeDialog;

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.style.backgroundColor = '#781D2F';
    saveButton.style.border = '1px solid #ED1A43';
    saveButton.style.borderRadius = '10px';
    saveButton.style.padding = '8px 12px';
    saveButton.style.color = '#ffffff';
    saveButton.style.cursor = 'pointer';
    saveButton.style.fontFamily = PRIMARY_FONT_FAMILY;
    saveButton.onclick = () => {
        const selectedCategory = newCategoryInput.style.display === 'block'
            ? newCategoryInput.value.trim()
            : selectedCategoryValue;

        if (!selectedCategory) {
            alert('Please enter a category name');
            return;
        }

        saveTimestampWithCategory(videoId, title, currentTime, thumbnailUrl, selectedCategory, notesInput ? notesInput.value : '');
        closeDialog();
    };

    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(saveButton);
    dialog.appendChild(buttonsContainer);

    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
}

function showRepeatSaveDialog(videoId, title, currentTime, thumbnailUrl, category) {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    const { dialog, backdrop, closeDialog } = createDialogScaffold('Add a note');
    dialog.appendChild(createTimestampInfoCard(title, currentTime, thumbnailUrl));

    const notesInput = createNotesInputField('Add a note for this timestamp... (optional)');
    dialog.appendChild(notesInput);

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.marginTop = '8px';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#242424';
    cancelButton.style.border = '1px solid #393838';
    cancelButton.style.borderRadius = '10px';
    cancelButton.style.padding = '8px 12px';
    cancelButton.style.color = '#7C7C7C';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontFamily = PRIMARY_FONT_FAMILY;
    cancelButton.onclick = closeDialog;

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.style.backgroundColor = '#781D2F';
    saveButton.style.border = '1px solid #ED1A43';
    saveButton.style.borderRadius = '10px';
    saveButton.style.padding = '8px 12px';
    saveButton.style.color = '#ffffff';
    saveButton.style.cursor = 'pointer';
    saveButton.style.fontFamily = PRIMARY_FONT_FAMILY;
    saveButton.onclick = () => {
        saveTimestampWithCategory(videoId, title, currentTime, thumbnailUrl, category, notesInput.value);
        closeDialog();
    };

    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(saveButton);
    dialog.appendChild(buttonsContainer);

    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
}

// Function to save timestamp with selected category
function saveTimestampWithCategory(videoId, title, currentTime, thumbnailUrl, category, note = '') {
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    getCloudCategories((categories, error) => {
        if (error) {
            console.error('Failed to load categories:', error);
            return;
        }

        const persistTimestamp = (globalStudyMode) => {
            if (!categories[category]) {
                categories[category] = [];
            }

            const existingVideoIndex = categories[category].findIndex((video) => video.videoId === videoId);
            const newTimestampEntry = {
                time: currentTime,
                note: String(note || '').trim(),
                savedAt: Date.now()
            };
            const formattedTime = formatTime(currentTime);

            if (existingVideoIndex === -1) {
                const videoData = {
                    videoId,
                    title,
                    currentTime,
                    thumbnail: thumbnailUrl,
                    timestamp: newTimestampEntry.savedAt,
                    studyMode: globalStudyMode,
                    timestamps: [newTimestampEntry]
                };

                categories[category].unshift(videoData);

                setCloudCategories(categories, (saveError) => {
                    if (saveError) {
                        console.error('Error saving to timestamp store:', saveError);
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
                return;
            }

            const existingVideo = categories[category][existingVideoIndex];
            const effectiveStudyMode = Boolean(globalStudyMode || existingVideo.studyMode === true);
            existingVideo.timestamps = effectiveStudyMode
                ? [
                    ...getNormalizedVideoTimestampEntries(existingVideo),
                    newTimestampEntry
                ]
                : [newTimestampEntry];
            existingVideo.currentTime = currentTime;
            existingVideo.timestamp = newTimestampEntry.savedAt;
            existingVideo.title = title;
            existingVideo.thumbnail = thumbnailUrl;
            existingVideo.studyMode = effectiveStudyMode;

            const updatedVideo = categories[category].splice(existingVideoIndex, 1)[0];
            categories[category].unshift(updatedVideo);

            setCloudCategories(categories, (saveError) => {
                if (saveError) {
                    console.error('Error saving to timestamp store:', saveError);
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
        };

        getStudyModePreference()
            .then((globalStudyMode) => {
                persistTimestamp(globalStudyMode);
            })
            .catch((preferenceError) => {
                console.error('Failed to read Study Mode preference:', preferenceError);
                persistTimestamp(false);
            });
    });
}

// Create and inject "Add to Watchlist" button
function addButton() {
    // Check if extension context is valid before adding button
    if (!isExtensionContextValid()) {
        handleContextInvalidation();
        return;
    }

    ensureDialogFontsLoaded();

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
        btn.style.fontFamily = MONO_FONT_FAMILY;
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.padding = '8px 16px';
        btn.style.background = '#1C1C1C';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'medium';
        btn.style.borderRadius = '10px';
        btn.style.boxShadow = '0px 9px 57.2px rgba(0, 0, 0, 0.25), 0px 2px 8.5px rgba(0, 0, 0, 0.15)';
        btn.style.cursor = 'pointer';
        btn.style.zIndex = '9999';
        btn.style.border = '1px solid #393838';
        btn.style.fontSize = '16px';
        btn.style.letterSpacing = 0;
        btn.style.boxShadow = '0px 0px 29.4px 0px #000;';

        btn.onclick = function () {
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
}).observe(document, { subtree: true, childList: true });

// Add this at the start of the file
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "addTimestamp") {
        triggerShortcutCategoryDialog();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat) {
        return;
    }

    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
    }

    if (event.code !== 'KeyS') {
        return;
    }

    if (isEditableShortcutTarget(event.target)) {
        return;
    }

    event.preventDefault();
    triggerShortcutCategoryDialog();
});
