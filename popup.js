let isEditMode = false;
let pendingCategoryDeletion = null;
const dataClient = globalThis.SaveResumeDataLayer.createClientDataLayer();
const PROTECTED_CATEGORY_NAMES = new Set(['Default']);
const expandedStudyVideos = new Set();
const PROFILE_PLACEHOLDER_IMAGE = 'profile.png';
let closeProfileDropdownHandler = null;
let activeStudyModeInfoAnchor = null;
let infoPopoverOutsideClickHandler = null;

const STUDY_MODE_GLOBAL_INFO_COPY = Object.freeze({
    title: 'What is Study Mode?',
    body: 'Study Mode transforms any video card into a research card. Instead of a single resume timestamp, you can save multiple moments in a video and add a personal note to each one. Use it when you are learning something, doing research, or want to remember why a specific moment in a video mattered to you.',
    examples: [
        'Watching a tutorial? Mark every concept you want to revisit later.',
        'In a research session? Add your thoughts at each key moment.'
    ],
    footer: 'You can switch Study Mode off at any time. Your timestamps and notes are always kept safe.'
});

const STUDY_MODE_VIDEO_INFO_COPY = Object.freeze({
    title: 'Study Mode for this video',
    body: 'Turning on Study Mode for this video lets you save multiple timestamps and add notes to each one - just for this video. Other videos stay in Resume Mode unless you turn on Study Mode globally from your profile.',
    examples: [],
    footer: 'Turning Study Mode off later will not delete your timestamps or notes. Everything is saved and will come back if you switch it on again.'
});

function runtimeRequest(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response || response.ok !== true) {
                reject(new Error(response?.error || 'UNKNOWN_ERROR'));
                return;
            }

            resolve(response);
        });
    });
}

const cloudStorage = {
    get(keys, callback) {
        dataClient.get(keys)
            .then((data) => callback(data || {}))
            .catch((error) => {
                console.error('Failed to fetch timestamp data:', error);
                callback({});
            });
    },
    set(data, callback) {
        dataClient.set(data)
            .then(() => {
                if (typeof callback === 'function') callback();
            })
            .catch((error) => {
                console.error('Failed to save timestamp data:', error);
            });
    }
};

async function signInWithGoogleInBackground() {
    const response = await runtimeRequest({ type: 'AUTH_SIGN_IN' });
    return response.user || null;
}

async function signOutInBackground() {
    await runtimeRequest({ type: 'AUTH_SIGN_OUT' });
}

async function getLocalSummary() {
    return dataClient.getLocalSummary();
}

async function migrateLocalDataToCloud() {
    return dataClient.migrateLocalDataToCloud();
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleAuthError(message, error) {
    console.error(message, error);
    const details = error?.message || 'Unknown error';

    if (details.includes('Missing or insufficient permissions')) {
        alert(`${message}: Firestore permission denied. Update Firestore Security Rules so authenticated users can read/write only their own data (users/{uid}/...).`);
        return;
    }

    alert(`${message}: ${details}`);
}

function openVideo(videoId, currentTime) {
    const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(currentTime)}s`;
    chrome.tabs.create({ url });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hideStudyModeInfoPopover() {
    const existing = document.getElementById('study-mode-info-popover');
    if (existing) {
        existing.remove();
    }

    if (infoPopoverOutsideClickHandler) {
        document.removeEventListener('mousedown', infoPopoverOutsideClickHandler);
        infoPopoverOutsideClickHandler = null;
    }

    activeStudyModeInfoAnchor = null;
}

function positionInfoPopover(anchorElement, popover) {
    const anchorRect = anchorElement.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 8;
    const edgePadding = 8;

    const spaceBelow = viewportHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const shouldOpenAbove = spaceBelow < popoverRect.height + gap && spaceAbove > spaceBelow;

    let top = shouldOpenAbove
        ? anchorRect.top - popoverRect.height - gap
        : anchorRect.bottom + gap;
    top = Math.max(edgePadding, Math.min(top, viewportHeight - popoverRect.height - edgePadding));

    let left = anchorRect.left + (anchorRect.width / 2) - (popoverRect.width / 2);
    left = Math.max(edgePadding, Math.min(left, viewportWidth - popoverRect.width - edgePadding));

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
}

function showInfoPopover(anchorElement, title, bodyText, examples, footerText) {
    const existing = document.getElementById('study-mode-info-popover');
    const shouldToggleOff = Boolean(existing && activeStudyModeInfoAnchor === anchorElement);
    hideStudyModeInfoPopover();
    if (shouldToggleOff) {
        return;
    }

    const popover = document.createElement('div');
    popover.id = 'study-mode-info-popover';

    const titleElement = document.createElement('div');
    titleElement.className = 'info-popover-title';
    titleElement.textContent = title;
    popover.appendChild(titleElement);

    const bodyElement = document.createElement('div');
    bodyElement.className = 'info-popover-body';
    bodyElement.textContent = bodyText;
    popover.appendChild(bodyElement);

    if (Array.isArray(examples)) {
        examples.forEach((exampleText) => {
            const exampleElement = document.createElement('div');
            exampleElement.className = 'info-popover-example';
            exampleElement.textContent = exampleText;
            popover.appendChild(exampleElement);
        });
    }

    const footerElement = document.createElement('div');
    footerElement.className = 'info-popover-footer';
    footerElement.textContent = footerText;
    popover.appendChild(footerElement);

    document.body.appendChild(popover);
    positionInfoPopover(anchorElement, popover);

    activeStudyModeInfoAnchor = anchorElement;
    infoPopoverOutsideClickHandler = (event) => {
        if (popover.contains(event.target)) {
            return;
        }
        if (event.target.closest('.info-btn')) {
            return;
        }
        hideStudyModeInfoPopover();
    };
    document.addEventListener('mousedown', infoPopoverOutsideClickHandler);
}

function bindStudyModeInfoButton(infoButton, copy) {
    if (!infoButton || !copy) {
        return;
    }

    const openInfoPopover = (event) => {
        event.preventDefault();
        event.stopPropagation();
        showInfoPopover(infoButton, copy.title, copy.body, copy.examples, copy.footer);
    };

    infoButton.addEventListener('click', openInfoPopover);
    infoButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            openInfoPopover(event);
        }
    });
}

function safeThumbnailUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
        }
        return parsed.href;
    } catch (error) {
        return '';
    }
}

function escapeForAttributeSelector(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(String(value));
    }

    return String(value).replace(/["\\]/g, '\\$&');
}

function getBooleanFromLocalStorage(key, fallback = false) {
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

function setBooleanInLocalStorage(key, value) {
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

function getStudyMode() {
    return getBooleanFromLocalStorage('studyMode', false);
}

function setStudyMode(value) {
    return setBooleanInLocalStorage('studyMode', value);
}

function getActiveCategoryFilter() {
    return document.querySelector('.category-item.active')?.getAttribute('data-category') || 'all';
}

function getNormalizedVideoTimestampEntries(video) {
    const fallbackTime = Math.max(0, Number(video?.currentTime) || 0);
    const fallbackSavedAt = Math.max(0, Number(video?.timestamp) || Date.now());
    const rawEntries = Array.isArray(video?.timestamps) && video.timestamps.length > 0
        ? video.timestamps
        : [{ time: fallbackTime, note: '', savedAt: fallbackSavedAt }];

    return rawEntries
        .map((entry) => ({
            time: Math.max(0, Number(entry?.time) || 0),
            note: typeof entry?.note === 'string' ? entry.note : '',
            savedAt: Math.max(0, Number(entry?.savedAt) || fallbackSavedAt)
        }));
}

function getVideoTimestampEntries(video) {
    return getNormalizedVideoTimestampEntries(video)
        .sort((left, right) => {
            if (left.time !== right.time) {
                return left.time - right.time;
            }
            return left.savedAt - right.savedAt;
        });
}

function getLatestTimestampEntry(video) {
    const entries = getNormalizedVideoTimestampEntries(video);
    return entries.reduce((latest, entry) => {
        if (!latest) {
            return entry;
        }

        return entry.savedAt >= latest.savedAt ? entry : latest;
    }, null);
}

function isStudyModeVideo(video, globalStudyMode) {
    return Boolean(globalStudyMode || video?.studyMode === true);
}

function setStudyModePillState(pillElement, isOn) {
    if (!pillElement) {
        return;
    }

    pillElement.classList.toggle('is-on', isOn);
    pillElement.classList.toggle('is-off', !isOn);
    pillElement.setAttribute('data-state', isOn ? 'on' : 'off');
}

function updateVideoNoteText(noteElement, nextValue) {
    if (!noteElement) {
        return;
    }

    const trimmed = String(nextValue || '').trim();
    const isPlaceholder = trimmed.length === 0;
    noteElement.textContent = isPlaceholder ? 'Add a note...' : trimmed;
    noteElement.classList.toggle('is-placeholder', isPlaceholder);
}

function saveVideoNote(category, videoId, savedAt, nextNote, noteElement) {
    const trimmedNote = String(nextNote || '').trim();

    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        const videos = Array.isArray(categories[category]) ? categories[category] : [];
        const targetVideo = videos.find((video) => video.videoId === videoId);

        if (!targetVideo) {
            return;
        }

        const targetEntry = getNormalizedVideoTimestampEntries(targetVideo).find((entry) => entry.savedAt === savedAt);
        if (!targetEntry) {
            return;
        }

        targetEntry.note = trimmedNote;
        targetVideo.timestamps = getNormalizedVideoTimestampEntries(targetVideo).map((entry) => (
            entry.savedAt === savedAt
                ? { ...entry, note: trimmedNote }
                : entry
        ));

        cloudStorage.set({ categories }, function () {
            updateVideoNoteText(noteElement, trimmedNote);
        });
    });
}

function activateInlineNoteEdit(noteElement, category, videoId, savedAt) {
    if (!noteElement || noteElement.dataset.editing === 'true') {
        return;
    }

    const originalValue = noteElement.dataset.noteValue || '';
    const input = document.createElement('textarea');
    input.className = 'note-input';
    input.value = originalValue;
    input.placeholder = 'Add a note...';
    input.rows = 1;

    noteElement.dataset.editing = 'true';
    noteElement.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const autoSizeInput = () => {
        input.style.height = 'auto';
        input.style.height = `${Math.max(input.scrollHeight, 14)}px`;
    };
    autoSizeInput();

    let didFinish = false;

    const restoreDisplay = (nextValue, shouldSave) => {
        if (didFinish) {
            return;
        }
        didFinish = true;

        noteElement.dataset.editing = 'false';
        noteElement.dataset.noteValue = shouldSave ? String(nextValue || '').trim() : originalValue;
        updateVideoNoteText(noteElement, noteElement.dataset.noteValue);
        input.replaceWith(noteElement);

        if (shouldSave) {
            saveVideoNote(category, videoId, savedAt, nextValue, noteElement);
        }
    };

    input.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('keydown', (event) => {
        event.stopPropagation();

        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            restoreDisplay(input.value, true);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            restoreDisplay(originalValue, false);
        }
    });

    input.addEventListener('blur', () => {
        restoreDisplay(input.value, true);
    });

    input.addEventListener('input', autoSizeInput);
}

function removeVideoFromWatchlist(videoToRemove, category, event) {
    event.stopPropagation();
    const activeCategory = getActiveCategoryFilter();
    const timestampEntries = Array.isArray(videoToRemove?.timestamps) ? videoToRemove.timestamps : [];
    if (timestampEntries.length > 0) {
        const message = `This video has ${timestampEntries.length} ${timestampEntries.length === 1 ? 'timestamp' : 'timestamps'} and notes saved. Deleting it will remove everything.`;
        if (!window.confirm(message)) {
            return;
        }
    }

    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        let didRemoveTimestamp = false;

        Object.keys(categories).forEach((categoryName) => {
            const videos = Array.isArray(categories[categoryName]) ? categories[categoryName] : [];
            const filteredVideos = videos.filter((candidateVideo) => {
                return candidateVideo.videoId !== videoToRemove.videoId;
            });

            if (filteredVideos.length !== videos.length) {
                didRemoveTimestamp = true;
                categories[categoryName] = filteredVideos;
            }
        });

        if (!didRemoveTimestamp) {
            return;
        }

        // Remove only timestamp entries. Keep categories even when they become empty.
        cloudStorage.set({ categories: categories }, function () {
            renderCategoryList(() => {
                const shouldKeepSelectedCategory = activeCategory === 'all' || Object.prototype.hasOwnProperty.call(categories, activeCategory);
                filterByCategory(shouldKeepSelectedCategory ? activeCategory : 'all');
                updateCategoryCounts();
            });
        });
    });
}

// Helper function to update category counts in the UI
function updateCategoryCounts() {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};

        // Update each category count pill
        Object.keys(categories).forEach(category => {
            const safeCategorySelector = escapeForAttributeSelector(category);
            const categoryItems = document.querySelectorAll(`[data-category="${safeCategorySelector}"]`);
            categoryItems.forEach(item => {
                const countPill = item.querySelector('.category-count');
                if (countPill) {
                    countPill.textContent = categories[category].length;
                }
            });
        });

        // Also update the "All" category count
        updateAllCategoryCount();
    });
}

// Helper function to update the "All" category count
function updateAllCategoryCount() {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        let totalVideos = 0;

        // Count total videos across all categories
        Object.keys(categories).forEach(category => {
            totalVideos += categories[category].length;
        });

        // Update the "All" category count pill
        const allCountPill = document.getElementById('allCategoryCount');
        if (allCountPill) {
            allCountPill.textContent = totalVideos;
        }
    });
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00";

    seconds = Math.round(seconds);

    if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function checkEmptyState() {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        let totalVideos = 0;

        // Count total videos across all categories
        Object.keys(categories).forEach(category => {
            totalVideos += categories[category].length;
        });

        const watchlistElement = document.getElementById('watchlist');

        if (totalVideos === 0) {
            watchlistElement.innerHTML = ''; // Clear existing items
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state-text';
            emptyState.innerHTML = `
                <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
            `;
            watchlistElement.appendChild(emptyState);
        }
    });
}

function isCategoryEditModeActive() {
    const categoryList = document.getElementById('categoryList');
    return Boolean(categoryList && categoryList.classList.contains('edit-mode'));
}

function isProtectedCategory(categoryName) {
    return PROTECTED_CATEGORY_NAMES.has(String(categoryName || '').trim());
}

function showWatchlistEmptyState(watchlistElement) {
    watchlistElement.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state-text';
    emptyState.innerHTML = `
        <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
    `;
    watchlistElement.appendChild(emptyState);
}

function buildExpandedRowsMarkup(video) {
    return getVideoTimestampEntries(video).map((entry) => {
        const noteText = String(entry.note || '').trim();
        const safeNoteText = escapeHtml(noteText);
        const safeDisplayText = noteText ? safeNoteText : 'Add a note...';

        return `
            <div class="timestamp-row" data-saved-at="${entry.savedAt}">
                <button class="timestamp-row-time" type="button" data-time="${entry.time}" title="Jump to timestamp">
                    <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="10" height="10" />
                    <span class="timestamp-value">${escapeHtml(formatTime(entry.time))}</span>
                </button>
                <button
                    class="note-display${noteText ? '' : ' is-placeholder'}"
                    type="button"
                    data-note-value="${safeNoteText}"
                >${safeDisplayText}</button>
            </div>
        `;
    }).join('');
}

function createWatchlistItem(video, category, globalStudyMode) {
    const latestTimestampEntry = getLatestTimestampEntry(video);
    const effectiveTime = Math.max(0, Number(video.currentTime) || latestTimestampEntry?.time || 0);
    const safeTitle = escapeHtml(video.title || 'Untitled video');
    const safeThumbnail = escapeHtml(safeThumbnailUrl(video.thumbnail));
    const safeTimestamp = escapeHtml(formatTime(effectiveTime));
    const isStudyMode = isStudyModeVideo(video, globalStudyMode);
    const isExpanded = isStudyMode && expandedStudyVideos.has(video.videoId);
    const studyModeInfoButtonId = `study-mode-info-btn-video-${String(video.videoId || 'video')}-${String(video.timestamp || 0)}`
        .replace(/[^a-zA-Z0-9_-]/g, '-');

    const listItem = document.createElement('li');
    listItem.className = `watchlist-item${isExpanded ? ' is-expanded' : ''}`;
    listItem.setAttribute('data-video-id', video.videoId);
    listItem.setAttribute('data-timestamp', video.timestamp);

    listItem.innerHTML = `
        <div class="watchlist-card-header">
            <div class="thumbnail-wrapper">
                <img class="thumbnail" src="${safeThumbnail}" alt="${safeTitle}" />
            </div>
            <div class="video-info">
                <h3 class="video-title">${safeTitle}</h3>
                ${isStudyMode ? `
                    <button class="expand-btn${isExpanded ? ' is-expanded' : ''}" type="button">
                        <span>${isExpanded ? 'Collapse' : 'Expand'}</span>
                        <img src="study-mode-chevron.svg" class="expand-btn-chevron" alt="" width="8" height="8" />
                    </button>
                ` : `
                    <div class="video-timestamp">
                        <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="10" height="10" />
                        <span class="timestamp-value">${safeTimestamp}</span>
                    </div>
                `}
            </div>
            <div class="video-actions">
                <button class="three-dot-menu" type="button" title="More options">
                    <img src="menu.svg" width="20" height="20" alt="Menu" />
                </button>
                <div class="dropdown-menu" style="display: none;">
                    <div class="menu-section">
                        <div class="category-options"></div>
                    </div>
                    <div class="menu-divider"></div>
                    <button class="menu-item study-mode-menu-item" type="button">
                        <span class="profile-menu-leading study-mode-leading">
                            <img src="study-mode-icon.svg" width="12" height="12" alt="">
                            <span>Study Mode</span>
                            <span
                                id="${studyModeInfoButtonId}"
                                class="info-btn study-mode-info-btn"
                                role="button"
                                tabindex="0"
                                aria-label="Study Mode for this video"
                                title="Study Mode for this video"
                            ><img src="Info.svg" width="14" height="14" alt="" aria-hidden="true"></span>
                        </span>
                        <span class="study-mode-controls">
                            <span class="study-mode-pill" aria-hidden="true"></span>
                        </span>
                    </button>
                    <div class="menu-divider"></div>
                    <button class="menu-item delete-item" type="button">
                        <img src="delete.svg" alt="Delete" />
                        Delete
                    </button>
                </div>
            </div>
        </div>
        ${isStudyMode ? `
            <div class="expanded-rows${isExpanded ? ' is-visible' : ''}" ${isExpanded ? '' : 'hidden'}>
                ${buildExpandedRowsMarkup(video)}
            </div>
        ` : ''}
    `;

    const headerArea = listItem.querySelector('.watchlist-card-header');
    const threeDotMenu = listItem.querySelector('.three-dot-menu');
    const dropdownMenu = listItem.querySelector('.dropdown-menu');
    const deleteItem = listItem.querySelector('.delete-item');
    const studyModeMenuItem = listItem.querySelector('.study-mode-menu-item');
    const studyModeMenuPill = studyModeMenuItem?.querySelector('.study-mode-pill');
    const studyModeInfoButton = listItem.querySelector(`#${studyModeInfoButtonId}`);

    headerArea.addEventListener('click', () => {
        openVideo(video.videoId, effectiveTime);
    });

    threeDotMenu.onclick = (event) => {
        event.stopPropagation();
        toggleDropdown(dropdownMenu);
        populateCategoryOptions(dropdownMenu.querySelector('.category-options'), video);
        setStudyModePillState(studyModeMenuPill, video.studyMode === true);
        if (dropdownMenu.style.display !== 'block' && activeStudyModeInfoAnchor && dropdownMenu.contains(activeStudyModeInfoAnchor)) {
            hideStudyModeInfoPopover();
        }
    };

    dropdownMenu.onclick = (event) => {
        event.stopPropagation();
    };

    studyModeMenuItem.onclick = (event) => {
        event.stopPropagation();
        if (event.target.closest('.info-btn')) {
            return;
        }
        toggleVideoStudyMode(video, category, { keepMenuOpen: true });
        hideStudyModeInfoPopover();
    };

    bindStudyModeInfoButton(studyModeInfoButton, STUDY_MODE_VIDEO_INFO_COPY);

    deleteItem.onclick = (event) => {
        event.stopPropagation();
        removeVideoFromWatchlist(video, category, event);
        dropdownMenu.style.display = 'none';
        hideStudyModeInfoPopover();
    };

    if (isStudyMode) {
        const expandButton = listItem.querySelector('.expand-btn');
        expandButton?.addEventListener('click', (event) => {
            event.stopPropagation();

            const isNowExpanded = !expandedStudyVideos.has(video.videoId);
            if (isNowExpanded) {
                expandedStudyVideos.add(video.videoId);
            } else {
                expandedStudyVideos.delete(video.videoId);
            }

            listItem.classList.toggle('is-expanded', isNowExpanded);
            expandButton.classList.toggle('is-expanded', isNowExpanded);

            const expandSpan = expandButton.querySelector('span');
            if (expandSpan) {
                expandSpan.textContent = isNowExpanded ? 'Collapse' : 'Expand';
            }

            const expandedRows = listItem.querySelector('.expanded-rows');
            if (expandedRows) {
                expandedRows.classList.toggle('is-visible', isNowExpanded);
                if (isNowExpanded) {
                    expandedRows.removeAttribute('hidden');
                } else {
                    expandedRows.setAttribute('hidden', '');
                }
            }
        });

        listItem.querySelectorAll('.timestamp-row').forEach((rowElement) => {
            rowElement.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });

        listItem.querySelectorAll('.note-display').forEach((noteElement) => {
            const savedAt = Number(noteElement.closest('.timestamp-row')?.dataset.savedAt || 0);
            noteElement.addEventListener('click', (event) => {
                event.stopPropagation();
                activateInlineNoteEdit(noteElement, category, video.videoId, savedAt);
            });
        });

        listItem.querySelectorAll('.timestamp-row-time').forEach((timeElement) => {
            timeElement.addEventListener('click', (event) => {
                event.stopPropagation();
                const time = Number(event.currentTarget.dataset.time || 0);
                openVideo(video.videoId, time);
            });
        });
    }

    return listItem;
}

function renderVideosForCategory(selectedCategory, onComplete) {
    const done = () => {
        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    cloudStorage.get(['categories', 'watchlist'], function (result) {
        if (result.watchlist && result.watchlist.length > 0) {
            migrateData(result.watchlist, onComplete);
            return;
        }

        const categories = result.categories || {};
        const watchlistElement = document.getElementById('watchlist');
        watchlistElement.innerHTML = '';

        let totalVideos = 0;
        Object.keys(categories).forEach((categoryName) => {
            totalVideos += categories[categoryName].length;
        });

        if (totalVideos === 0) {
            showWatchlistEmptyState(watchlistElement);
            done();
            return;
        }

        const renderWithStudyMode = (globalStudyMode) => {
            let renderedCount = 0;

            Object.keys(categories).sort((left, right) => left.localeCompare(right)).forEach((categoryName) => {
                if (selectedCategory !== 'all' && categoryName !== selectedCategory) {
                    return;
                }

                const videos = Array.isArray(categories[categoryName]) ? categories[categoryName] : [];
                videos.forEach((video) => {
                    watchlistElement.appendChild(createWatchlistItem(video, categoryName, globalStudyMode));
                    renderedCount += 1;
                });
            });

            if (renderedCount === 0) {
                showWatchlistEmptyState(watchlistElement);
            }

            done();
        };

        getStudyMode()
            .then((globalStudyMode) => {
                renderWithStudyMode(globalStudyMode);
            })
            .catch((error) => {
                console.error('Failed to read Study Mode preference:', error);
                renderWithStudyMode(false);
            });
    });
}

function renderWatchlist(onComplete) {
    renderVideosForCategory('all', onComplete);
}

function migrateData(watchlist, onComplete) {
    console.log('Migrating data to new format...');
    const categories = { Default: [] };

    // Copy all videos to Default category
    watchlist.forEach(video => {
        categories.Default.push(video);
    });

    // Update storage with new format and remove old format
    cloudStorage.set({ categories: categories, watchlist: [] }, function () {
        console.log('Data migration completed successfully');
        renderWatchlist(onComplete); // Re-render with new format
    });
}

function renderCategoryList(onComplete) {
    const done = () => {
        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        const categoryListElement = document.getElementById('categoryList');
        categoryListElement.innerHTML = ''; // Clear existing items
        const totalVideos = Object.values(categories).reduce((sum, videos) => sum + videos.length, 0);

        // Add "All" category which will show everything
        const allCategory = document.createElement('li');
        allCategory.className = 'category-item all-category active';

        // Create category name text
        const allCategoryText = document.createElement('span');
        allCategoryText.className = 'category-name';
        allCategoryText.textContent = 'All';
        allCategory.appendChild(allCategoryText);

        // Create video count pill for All category
        const allCountPill = document.createElement('span');
        allCountPill.className = 'category-count';
        allCountPill.id = 'allCategoryCount';
        allCountPill.textContent = totalVideos;
        allCategory.appendChild(allCountPill);

        allCategory.setAttribute('data-category', 'all');
        allCategory.onclick = () => {
            if (isCategoryEditModeActive()) {
                return;
            }
            filterByCategory('all');
        };
        categoryListElement.appendChild(allCategory);

        // Add all user categories
        Object.keys(categories).sort().forEach(category => {
            const isProtected = isProtectedCategory(category);
            const categoryItem = document.createElement('li');
            categoryItem.className = isProtected
                ? 'category-item protected-category'
                : 'category-item can-delete';

            // Create a container for category text
            // Create category name text
            const categoryText = document.createElement('span');
            categoryText.className = 'category-name';
            categoryText.textContent = category;
            categoryItem.appendChild(categoryText);

            // Create video count pill
            const countPill = document.createElement('span');
            countPill.className = 'category-count';
            countPill.textContent = categories[category].length;
            categoryItem.appendChild(countPill);

            if (isProtected) {
                categoryItem.title = `"${category}" can't be deleted`;
            } else {
                const deleteBtn = document.createElement('span');
                deleteBtn.className = 'delete-category-btn';
                deleteBtn.title = `Delete "${category}"`;
                deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path></svg>`;
                deleteBtn.onclick = (event) => {
                    event.stopPropagation();
                    if (isCategoryEditModeActive()) {
                        deleteCategory(category);
                    }
                };
                categoryItem.appendChild(deleteBtn);
            }

            categoryItem.setAttribute('data-category', category);
            categoryItem.onclick = () => {
                if (isCategoryEditModeActive()) {
                    if (!isProtected) {
                        deleteCategory(category);
                    }
                    return;
                }

                filterByCategory(category);
            };
            categoryListElement.appendChild(categoryItem);
        });
        done();
    });
}

// Add function to delete category
function deleteCategory(categoryName) {
    if (isProtectedCategory(categoryName)) {
        alert(`"${categoryName}" is built in and can't be deleted.`);
        return;
    }

    const modal = document.getElementById('deleteCategoryModal');
    const message = document.getElementById('deleteCategoryMessage');
    const confirmButton = document.getElementById('confirmDeleteCategoryBtn');

    pendingCategoryDeletion = categoryName;

    if (message) {
        const safeCategoryName = escapeHtml(categoryName);
        message.innerHTML = `Delete "<strong>${safeCategoryName}</strong>" and remove the timestamps saved inside it?`;
    }

    if (modal) {
        modal.style.display = 'flex';
    }

    if (confirmButton) {
        confirmButton.focus();
    }
}

async function confirmDeleteCategory() {
    const categoryName = pendingCategoryDeletion;
    if (!categoryName) {
        return;
    }

    const activeCategoryItem = document.querySelector('.category-item.active');
    const activeCategory = activeCategoryItem?.getAttribute('data-category') || 'all';
    const nextSelectedCategory = activeCategory === categoryName ? 'all' : activeCategory;

    try {
        const data = await dataClient.get(['categories']);
        const categories = data.categories || {};

        if (!Object.prototype.hasOwnProperty.call(categories, categoryName)) {
            hideDeleteCategoryModal();
            renderCategoryList(() => {
                filterByCategory(nextSelectedCategory);
            });
            return;
        }

        const updatedCategories = { ...categories };
        delete updatedCategories[categoryName];

        await dataClient.set({ categories: updatedCategories });

        hideDeleteCategoryModal();
        renderCategoryList(() => {
            filterByCategory(nextSelectedCategory);
        });
    } catch (error) {
        console.error('Failed to delete category:', error);
        const details = error?.message || 'Unknown error';
        alert(`Could not delete category. ${details}`);
    }
}

function filterByCategory(selectedCategory, onComplete) {
    // Update UI to show the selected category is active
    const categoryItems = document.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
        if (item.getAttribute('data-category') === selectedCategory) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    renderVideosForCategory(selectedCategory, onComplete);
}

// Helper functions no longer needed since we're always re-rendering
function showEmptyState() {
    const watchlistElement = document.getElementById('watchlist');
    watchlistElement.innerHTML = ''; // Clear existing items
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state-text';
    emptyState.innerHTML = `
        <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
    `;
    watchlistElement.appendChild(emptyState);
}

function hideEmptyState() {
    const existingEmptyState = document.querySelector('.empty-state-text');
    if (existingEmptyState) {
        existingEmptyState.remove();
    }
}

// Modal handling
function showCategoryModal() {
    const modal = document.getElementById('categoryModal');
    modal.style.display = 'block';
    document.getElementById('categoryNameInput').value = '';
    document.getElementById('categoryNameInput').focus();
}

function hideCategoryModal() {
    const modal = document.getElementById('categoryModal');
    modal.style.display = 'none';
}

function hideDeleteCategoryModal() {
    const modal = document.getElementById('deleteCategoryModal');
    const message = document.getElementById('deleteCategoryMessage');

    pendingCategoryDeletion = null;

    if (modal) {
        modal.style.display = 'none';
    }

    if (message) {
        message.textContent = '';
    }
}

async function addNewCategory() {
    const categoryName = document.getElementById('categoryNameInput').value.trim();
    if (!categoryName) {
        alert('Please enter a category name');
        return;
    }

    try {
        const data = await dataClient.get(['categories']);
        const categories = data.categories || {};

        // Check if category already exists
        if (categories[categoryName]) {
            alert(`Category "${categoryName}" already exists`);
            return;
        }

        // Add new empty category
        categories[categoryName] = [];

        await dataClient.set({ categories });
        hideCategoryModal();
        renderCategoryList();
        console.log('New category added:', categoryName);
    } catch (error) {
        console.error('Failed to add category:', error);
        const details = error?.message || 'Unknown error';
        alert(`Could not add category. ${details}`);
    }
}

// Add function to toggle edit mode
function toggleEditMode() {
    isEditMode = !isEditMode;

    // Get UI elements
    const categoryList = document.getElementById('categoryList');
    const deleteModeHint = document.getElementById('deleteModeHint');
    const editBtn = document.getElementById('editCategoriesBtn');
    const addBtn = document.getElementById('addCategoryBtn');
    const saveBtn = document.getElementById('saveCategoriesBtn');

    if (isEditMode) {
        // Enter edit mode
        categoryList.classList.add('edit-mode');
        if (deleteModeHint) deleteModeHint.style.display = 'block';
        editBtn.style.display = 'none';
        addBtn.style.display = 'none';
        saveBtn.style.display = 'flex';
    } else {
        // Exit edit mode
        categoryList.classList.remove('edit-mode');
        if (deleteModeHint) deleteModeHint.style.display = 'none';
        editBtn.style.display = 'flex';
        addBtn.style.display = 'flex';
        saveBtn.style.display = 'none';
    }
}

function closeVideoDropdownMenus(exceptDropdown = null) {
    let didCloseContainingDropdown = false;
    document.querySelectorAll('.dropdown-menu').forEach((menu) => {
        if (menu !== exceptDropdown) {
            if (menu.style.display === 'block' && activeStudyModeInfoAnchor && menu.contains(activeStudyModeInfoAnchor)) {
                didCloseContainingDropdown = true;
            }
            menu.style.display = 'none';
        }
    });

    if (didCloseContainingDropdown) {
        hideStudyModeInfoPopover();
    }
}

function closeProfileDropdownFromOutside() {
    hideStudyModeInfoPopover();
    if (typeof closeProfileDropdownHandler === 'function') {
        closeProfileDropdownHandler();
        return;
    }

    const profileDropdown = document.getElementById('profile-dropdown');
    const profileButton = document.getElementById('profile-button');
    if (profileDropdown) {
        profileDropdown.hidden = true;
    }
    if (profileButton) {
        profileButton.setAttribute('aria-expanded', 'false');
    }
}

// Dropdown menu functionality
function toggleDropdown(dropdown) {
    closeProfileDropdownFromOutside();
    const isOpen = dropdown.style.display === 'block';
    closeVideoDropdownMenus(dropdown);

    // Toggle current dropdown
    dropdown.style.display = isOpen ? 'none' : 'block';
}

// Populate category options in dropdown
function populateCategoryOptions(container, video) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        const selectedIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><path fill="#1FA700" d="M3.359 6L0 2.64l.947-.947 2.412 2.407L9.053 0 10 .947 3.359 6Z"/></svg>';
        container.innerHTML = '';

        const sortedCategories = Object.keys(categories).sort((a, b) => {
            return a.localeCompare(b);
        });

        let selectedCategory = null;
        sortedCategories.forEach((category) => {
            const videoInCategory = categories[category].some((v) =>
                v.videoId === video.videoId && v.timestamp === video.timestamp
            );
            if (!selectedCategory && videoInCategory) {
                selectedCategory = category;
            }
        });

        sortedCategories.forEach(category => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'category-option';

            const checkIcon = document.createElement('span');
            checkIcon.className = 'category-check';
            checkIcon.innerHTML = selectedIcon;

            const label = document.createElement('span');
            label.className = 'menu-category-name';
            label.textContent = category;

            if (selectedCategory === category) {
                option.classList.add('selected');
            }

            option.onclick = (e) => {
                e.stopPropagation();
                if (option.classList.contains('selected')) {
                    return;
                }

                container.querySelectorAll('.category-option').forEach((row) => {
                    row.classList.remove('selected');
                });
                option.classList.add('selected');
                assignVideoToSingleCategory(video, category);
            };

            option.appendChild(checkIcon);
            option.appendChild(label);
            container.appendChild(option);
        });
    });
}

// Keep each timestamp in exactly one category.
function assignVideoToSingleCategory(video, targetCategory) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};

        if (!categories[targetCategory]) {
            categories[targetCategory] = [];
        }

        Object.keys(categories).forEach((category) => {
            categories[category] = categories[category].filter((v) =>
                !(v.videoId === video.videoId && v.timestamp === video.timestamp)
            );
        });

        categories[targetCategory].push(video);

        cloudStorage.set({ categories: categories }, function () {
            updateCategoryCounts();
            filterByCategory(getActiveCategoryFilter());
        });
    });
}

function toggleVideoStudyMode(video, category, options = {}) {
    const keepMenuOpen = options?.keepMenuOpen === true;
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        const videos = Array.isArray(categories[category]) ? categories[category] : [];
        const targetVideo = videos.find((candidateVideo) => candidateVideo.videoId === video.videoId);

        if (!targetVideo) {
            return;
        }

        const latestTimestampEntry = getLatestTimestampEntry(targetVideo);
        targetVideo.studyMode = targetVideo.studyMode !== true;

        if (latestTimestampEntry) {
            targetVideo.currentTime = latestTimestampEntry.time;
            targetVideo.timestamp = latestTimestampEntry.savedAt;
        }

        const activeCategory = getActiveCategoryFilter();
        cloudStorage.set({ categories }, function () {
            filterByCategory(activeCategory, () => {
                if (!keepMenuOpen) {
                    return;
                }

                const escapedVideoId = escapeForAttributeSelector(video.videoId);
                const targetListItem = document.querySelector(`.watchlist-item[data-video-id="${escapedVideoId}"]`);
                const targetThreeDotMenu = targetListItem?.querySelector('.three-dot-menu');
                if (targetThreeDotMenu) {
                    targetThreeDotMenu.click();
                }
            });
        });
    });
}

// Add video to category
function addVideoToCategory(video, category) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};

        if (!categories[category]) {
            categories[category] = [];
        }

        // Check if video already exists in category
        const exists = categories[category].some(v =>
            v.videoId === video.videoId && v.timestamp === video.timestamp
        );

        if (!exists) {
            categories[category].push(video);
            cloudStorage.set({ categories: categories }, function () {
                updateCategoryCounts();
            });
        }
    });
}

// Remove video from category
function removeVideoFromCategory(video, category) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};

        if (categories[category]) {
            categories[category] = categories[category].filter(v =>
                !(v.videoId === video.videoId && v.timestamp === video.timestamp)
            );

            cloudStorage.set({ categories: categories }, function () {
                updateCategoryCounts();

                // Check if video exists in any other category
                let videoExistsInOtherCategory = false;
                for (const cat in categories) {
                    if (categories[cat].some(v => v.videoId === video.videoId && v.timestamp === video.timestamp)) {
                        videoExistsInOtherCategory = true;
                        break;
                    }
                }

                // If video doesn't exist in any category, show undo notification
                if (!videoExistsInOtherCategory) {
                    showUndoNotification(video);
                }

                renderWatchlist(); // Re-render to update the display
            });
        }
    });
}

// Undo notification functionality
let undoTimeout;

function showUndoNotification(video) {
    // Clear any existing timeout
    if (undoTimeout) {
        clearTimeout(undoTimeout);
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'undo-notification';
    notification.innerHTML = `
        <span class="notification-text">Timestamp deleted</span>
        <button class="undo-button">
            Undo
            <div class="undo-timer"></div>
        </button>
    `;

    // Add to body
    document.body.appendChild(notification);

    // Start timer animation
    const timerBar = notification.querySelector('.undo-timer');
    timerBar.style.animation = 'timerCountdown 5s linear forwards';
    timerBar.style.display = 'block';

    // Set up undo button
    const undoButton = notification.querySelector('.undo-button');
    undoButton.onclick = () => {
        clearTimeout(undoTimeout);
        restoreVideo(video);
        notification.remove();
    };

    // Auto-remove after 5 seconds
    undoTimeout = setTimeout(() => {
        notification.remove();
    }, 5000);

    // Remove notification when animation ends
    timerBar.addEventListener('animationend', () => {
        notification.remove();
    });
}

function restoreVideo(video) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};

        // Add video back to Default category
        if (!categories.Default) {
            categories.Default = [];
        }

        // Check if video already exists in Default
        const exists = categories.Default.some(v =>
            v.videoId === video.videoId && v.timestamp === video.timestamp
        );

        if (!exists) {
            categories.Default.push(video);
            cloudStorage.set({ categories: categories }, function () {
                updateCategoryCounts();
                renderWatchlist();
            });
        }
    });
}

// Close dropdowns when clicking outside
document.addEventListener('click', function (e) {
    if (e.target.closest('#study-mode-info-popover')) {
        return;
    }
    if (!e.target.closest('.video-actions')) {
        closeVideoDropdownMenus();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userPhoto = document.getElementById('user-photo');
    const profileButton = document.getElementById('profile-button');
    const profileButtonWrapper = document.getElementById('profile-btn-wrapper');
    const profileDropdown = document.getElementById('profile-dropdown');
    const profileDropdownSignedIn = document.getElementById('profile-dropdown-signed-in');
    const profileDropdownSignedOut = document.getElementById('profile-dropdown-signed-out');
    const profileUserInfo = document.getElementById('profile-user-info');
    const studyModeToggleIn = document.getElementById('study-mode-toggle-in');
    const studyModeToggleOut = document.getElementById('study-mode-toggle-out');
    const studyModeInfoBtnIn = document.getElementById('study-mode-info-btn-in');
    const studyModeInfoBtnOut = document.getElementById('study-mode-info-btn-out');
    const studyModePillIn = document.getElementById('study-mode-pill-in');
    const studyModePillOut = document.getElementById('study-mode-pill-out');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const editCategoriesBtn = document.getElementById('editCategoriesBtn');
    const saveCategoriesBtn = document.getElementById('saveCategoriesBtn');
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    const cancelCategoryBtn = document.getElementById('cancelCategoryBtn');
    const closeCategoryModalBtn = document.getElementById('closeCategoryModalBtn');
    const categoryNameInput = document.getElementById('categoryNameInput');
    const deleteCategoryModal = document.getElementById('deleteCategoryModal');
    const confirmDeleteCategoryBtn = document.getElementById('confirmDeleteCategoryBtn');
    const cancelDeleteCategoryBtn = document.getElementById('cancelDeleteCategoryBtn');
    const closeDeleteCategoryModalBtn = document.getElementById('closeDeleteCategoryModalBtn');
    const mainContent = document.querySelector('.main-content');
    const categoriesContainer = document.querySelector('.categories-container');
    const watchlistContainer = document.getElementById('watchlist-container');
    const dataLoadingState = document.getElementById('data-loading-state');
    const dataLoadingText = dataLoadingState?.querySelector('.data-loading-text');

    const breakingNoticeBanner = document.createElement('div');
    breakingNoticeBanner.style.display = 'none';
    breakingNoticeBanner.style.background = '#33240f';
    breakingNoticeBanner.style.border = '1px solid #6e4f22';
    breakingNoticeBanner.style.color = '#f6d9a6';
    breakingNoticeBanner.style.borderRadius = '8px';
    breakingNoticeBanner.style.fontSize = '12px';
    breakingNoticeBanner.style.lineHeight = '1.4';
    breakingNoticeBanner.style.padding = '10px 12px';
    breakingNoticeBanner.style.marginBottom = '12px';
    breakingNoticeBanner.style.display = 'none';
    breakingNoticeBanner.style.gap = '8px';
    breakingNoticeBanner.style.alignItems = 'center';
    breakingNoticeBanner.style.justifyContent = 'space-between';

    const breakingNoticeText = document.createElement('span');
    const dismissNoticeBtn = document.createElement('button');
    dismissNoticeBtn.textContent = 'Dismiss';
    dismissNoticeBtn.style.background = '#6e4f22';
    dismissNoticeBtn.style.border = 'none';
    dismissNoticeBtn.style.borderRadius = '999px';
    dismissNoticeBtn.style.color = '#fff';
    dismissNoticeBtn.style.fontSize = '11px';
    dismissNoticeBtn.style.padding = '4px 10px';
    dismissNoticeBtn.style.cursor = 'pointer';
    dismissNoticeBtn.addEventListener('click', async () => {
        breakingNoticeBanner.style.display = 'none';
        try {
            await dataClient.dismissBreakingUpdateNotice();
        } catch (error) {
            console.warn('Failed to dismiss breaking update notice:', error);
        }
    });

    breakingNoticeBanner.appendChild(breakingNoticeText);
    breakingNoticeBanner.appendChild(dismissNoticeBtn);
    if (mainContent) {
        mainContent.insertBefore(breakingNoticeBanner, mainContent.firstChild);
    }

    const statusMessage = document.createElement('div');
    statusMessage.style.fontSize = '12px';
    statusMessage.style.lineHeight = '1.4';
    statusMessage.style.borderRadius = '6px';
    statusMessage.style.padding = '8px 10px';
    statusMessage.style.marginBottom = '10px';
    statusMessage.style.display = 'none';
    if (mainContent) {
        mainContent.insertBefore(statusMessage, breakingNoticeBanner.nextSibling);
    }

    const migrationHint = document.createElement('div');
    migrationHint.className = 'local-sync-banner';
    migrationHint.style.display = 'none';

    const migrationHintText = document.createElement('span');
    migrationHintText.className = 'local-sync-banner-text';

    const migrationHintDismissBtn = document.createElement('button');
    migrationHintDismissBtn.type = 'button';
    migrationHintDismissBtn.className = 'local-sync-banner-dismiss';
    migrationHintDismissBtn.setAttribute('aria-label', 'Dismiss local sync banner');
    migrationHintDismissBtn.textContent = '×';

    migrationHint.appendChild(migrationHintText);
    migrationHint.appendChild(migrationHintDismissBtn);
    if (mainContent) {
        mainContent.insertBefore(migrationHint, statusMessage.nextSibling);
    }

    let isAuthenticated = false;
    let profileDropdownOpen = false;

    function closeProfileDropdown() {
        profileDropdown.hidden = true;
        profileDropdownOpen = false;
        profileButton.setAttribute('aria-expanded', 'false');
        hideStudyModeInfoPopover();
    }

    function openProfileDropdown() {
        profileDropdown.hidden = false;
        profileDropdownOpen = true;
        profileButton.setAttribute('aria-expanded', 'true');
    }
    closeProfileDropdownHandler = closeProfileDropdown;

    async function syncStudyModePills() {
        try {
            const studyModeEnabled = await getStudyMode();
            setStudyModePillState(studyModePillIn, studyModeEnabled);
            setStudyModePillState(studyModePillOut, studyModeEnabled);
        } catch (error) {
            console.error('Failed to sync Study Mode toggle:', error);
        }
    }

    function updateAuthUI(user) {
        isAuthenticated = Boolean(user);
        const tooltipParts = [];
        if (user?.displayName) tooltipParts.push(user.displayName);
        if (user?.email) tooltipParts.push(user.email);
        const tooltipText = tooltipParts.join('\n') || 'Profile menu';

        if (user) {
            profileDropdownSignedOut.hidden = true;
            profileDropdownSignedIn.hidden = false;
            profileUserInfo.innerHTML = `
                <div class="profile-user-name">${escapeHtml(user.displayName || 'Signed in')}</div>
                <div class="profile-user-email">${escapeHtml(user.email || '')}</div>
            `;
        } else {
            profileDropdownSignedIn.hidden = true;
            profileDropdownSignedOut.hidden = false;
            profileUserInfo.textContent = '';
        }

        userPhoto.src = user?.photoURL || PROFILE_PLACEHOLDER_IMAGE;
        userPhoto.title = tooltipText;
        userPhoto.setAttribute('aria-label', tooltipText);
        profileButton.title = tooltipText;
    }

    function showStatusMessage(message, tone = 'info') {
        statusMessage.textContent = message;
        statusMessage.style.display = 'block';
        if (tone === 'error') {
            statusMessage.style.background = '#3a1a21';
            statusMessage.style.border = '1px solid #7d2e41';
            statusMessage.style.color = '#ffc9d5';
            return;
        }

        if (tone === 'success') {
            statusMessage.style.background = '#183224';
            statusMessage.style.border = '1px solid #2b6a49';
            statusMessage.style.color = '#b8f7cf';
            return;
        }

        statusMessage.style.background = '#1d2a3a';
        statusMessage.style.border = '1px solid #385a7b';
        statusMessage.style.color = '#d5e8ff';
    }

    function hideStatusMessage() {
        statusMessage.style.display = 'none';
        statusMessage.textContent = '';
    }

    function getBannerDismissed() {
        // Dev test reset: run `chrome.storage.local.remove('bannerDismissed')` in popup DevTools console.
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['bannerDismissed'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(result.bannerDismissed === true);
            });
        });
    }

    function setBannerDismissed(value) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ bannerDismissed: Boolean(value) }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function hideMigrationHintImmediately() {
        migrationHint.classList.remove('is-hiding');
        migrationHint.style.display = 'none';
        migrationHintText.textContent = '';
    }

    async function dismissMigrationHintWithFade() {
        try {
            await setBannerDismissed(true);
        } catch (error) {
            console.warn('Failed to save bannerDismissed flag:', error);
        }

        migrationHint.classList.add('is-hiding');
        window.setTimeout(() => {
            hideMigrationHintImmediately();
        }, 300);
    }

    migrationHintDismissBtn.addEventListener('click', () => {
        dismissMigrationHintWithFade();
    });

    async function loadBreakingNotice() {
        try {
            const notice = await dataClient.getBreakingUpdateNotice();
            if (!notice || !notice.bannerText) {
                breakingNoticeBanner.style.display = 'none';
                return;
            }
            breakingNoticeText.textContent = notice.bannerText;
            breakingNoticeBanner.style.display = 'flex';
        } catch (error) {
            console.warn('Failed to load breaking update notice:', error);
        }
    }

    async function refreshSignedOutHint() {
        try {
            if (isAuthenticated) {
                hideMigrationHintImmediately();
                return;
            }

            const summary = await getLocalSummary();
            const bannerDismissed = await getBannerDismissed();
            if (summary.hasLocalData && !bannerDismissed) {
                const count = Number(summary.localVideoCount || 0);
                const unit = count === 1 ? 'timestamp' : 'timestamps';
                migrationHintText.textContent = `${count} local ${unit} found. Sign in to sync.`;
                migrationHint.classList.remove('is-hiding');
                migrationHint.style.display = 'flex';
            } else {
                hideMigrationHintImmediately();
            }
        } catch (error) {
            console.error('Failed to load local summary:', error);
            hideMigrationHintImmediately();
        }
    }

    async function runMigrationFlow() {
        const summary = await getLocalSummary();

        if (!summary.hasLocalData) {
            await migrateLocalDataToCloud();
            return;
        }

        showStatusMessage(`Found ${summary.localVideoCount} saved timestamps. Syncing to your account.`, 'info');
        await migrateLocalDataToCloud();
        showStatusMessage('Sync complete. Your timestamps are now linked to your account.', 'success');
        await wait(1500);
        hideStatusMessage();
    }

    async function toggleGlobalStudyMode() {
        const nextValue = !(await getStudyMode());
        await setStudyMode(nextValue);
        await syncStudyModePills();
        filterByCategory(getActiveCategoryFilter());
    }

    function setDataLoadingState(isLoading, message = 'Loading timestamps...') {
        if (dataLoadingText) {
            dataLoadingText.textContent = message;
        }

        if (!categoriesContainer || !dataLoadingState) {
            return;
        }

        categoriesContainer.classList.toggle('is-loading', isLoading);
        dataLoadingState.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
    }

    function renderWatchlistAsync() {
        return new Promise((resolve) => {
            renderWatchlist(resolve);
        });
    }

    function renderCategoryListAsync() {
        return new Promise((resolve) => {
            renderCategoryList(resolve);
        });
    }

    async function loadDataIntoUI() {
        setDataLoadingState(true);
        try {
            await Promise.all([renderWatchlistAsync(), renderCategoryListAsync()]);
        } finally {
            requestAnimationFrame(() => {
                setDataLoadingState(false);
            });
        }
    }

    function setButtonsDisabled(isDisabled) {
        signInBtn.disabled = isDisabled;
        signOutBtn.disabled = isDisabled;
        studyModeToggleIn.disabled = isDisabled;
        studyModeToggleOut.disabled = isDisabled;
    }

    setDataLoadingState(true);

    profileButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        closeVideoDropdownMenus();

        if (profileDropdownOpen) {
            closeProfileDropdown();
            return;
        }

        openProfileDropdown();
        await syncStudyModePills();
    });

    document.addEventListener('click', (event) => {
        if (event.target.closest('#study-mode-info-popover')) {
            return;
        }
        if (!event.target.closest('#profile-btn-wrapper')) {
            closeProfileDropdown();
        }
    });

    [studyModeToggleIn, studyModeToggleOut].forEach((toggleButton) => {
        toggleButton.addEventListener('click', async (event) => {
            event.stopPropagation();

            try {
                await toggleGlobalStudyMode();
            } catch (error) {
                handleAuthError('Could not update Study Mode', error);
            }
        });
    });

    [studyModeInfoBtnIn, studyModeInfoBtnOut].forEach((infoButton) => {
        bindStudyModeInfoButton(infoButton, STUDY_MODE_GLOBAL_INFO_COPY);
    });

    if (watchlistContainer) {
        watchlistContainer.addEventListener('scroll', () => {
            hideStudyModeInfoPopover();
        }, { passive: true });
    }
    window.addEventListener('scroll', () => {
        hideStudyModeInfoPopover();
    }, { passive: true, capture: true });

    signInBtn.addEventListener('click', async () => {
        try {
            setButtonsDisabled(true);
            const user = await signInWithGoogleInBackground();
            if (!user) {
                throw new Error('Sign-in did not return user details.');
            }

            try {
                await setBannerDismissed(true);
                hideMigrationHintImmediately();
            } catch (dismissError) {
                console.warn('Failed to persist bannerDismissed after sign-in:', dismissError);
            }

            updateAuthUI(user);
            closeProfileDropdown();
            try {
                await runMigrationFlow();
            } catch (migrationError) {
                showStatusMessage('Could not sync local timestamps yet. Your local data is still safe. Please try again.', 'error');
                console.error('Migration failed:', migrationError);
            }
            await loadDataIntoUI();
            await syncStudyModePills();
            await refreshSignedOutHint();
        } catch (error) {
            handleAuthError('Sign-in failed', error);
            hideStatusMessage();
        } finally {
            setButtonsDisabled(false);
        }
    });

    signOutBtn.addEventListener('click', async () => {
        try {
            setButtonsDisabled(true);
            await signOutInBackground();
            updateAuthUI(null);
            closeProfileDropdown();
            await loadDataIntoUI();
            await syncStudyModePills();
            await refreshSignedOutHint();
            hideStatusMessage();
        } catch (error) {
            handleAuthError('Sign-out failed', error);
        } finally {
            setButtonsDisabled(false);
        }
    });

    try {
        const authStatus = await runtimeRequest({ type: 'AUTH_STATUS' });
        const user = authStatus.authenticated ? authStatus.user : null;
        updateAuthUI(user);
        await loadDataIntoUI();
        await syncStudyModePills();
    } catch (error) {
        console.error('Failed to load auth status', error);
        try {
            await signOutInBackground();
        } catch (signOutError) {
            console.warn('Failed clearing background auth session:', signOutError);
        }
        updateAuthUI(null);
        await loadDataIntoUI();
        await syncStudyModePills();
    } finally {
        await loadBreakingNotice();
        await refreshSignedOutHint();
    }

    // Setup modal event listeners
    addCategoryBtn.addEventListener('click', showCategoryModal);
    saveCategoryBtn.addEventListener('click', addNewCategory);
    cancelCategoryBtn.addEventListener('click', hideCategoryModal);
    closeCategoryModalBtn.addEventListener('click', hideCategoryModal);
    confirmDeleteCategoryBtn.addEventListener('click', confirmDeleteCategory);
    cancelDeleteCategoryBtn.addEventListener('click', hideDeleteCategoryModal);
    closeDeleteCategoryModalBtn.addEventListener('click', hideDeleteCategoryModal);

    deleteCategoryModal.addEventListener('click', (event) => {
        if (event.target === deleteCategoryModal) {
            hideDeleteCategoryModal();
        }
    });

    // Setup edit mode toggle
    editCategoriesBtn.addEventListener('click', toggleEditMode);
    saveCategoriesBtn.addEventListener('click', toggleEditMode);

    // Allow pressing Enter to save category
    categoryNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addNewCategory();
        }
    });
});
