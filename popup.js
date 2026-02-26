let isEditMode = false;

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
        runtimeRequest({ type: 'DATA_GET', keys })
            .then((response) => callback(response.data || {}))
            .catch((error) => {
                if (error.message !== 'AUTH_REQUIRED') {
                    console.error('Failed to fetch cloud data:', error);
                }
                callback({});
            });
    },
    set(data, callback) {
        runtimeRequest({ type: 'DATA_SET', data })
            .then(() => {
                if (typeof callback === 'function') callback();
            })
            .catch((error) => {
                console.error('Failed to save cloud data:', error);
            });
    }
};

async function syncAuthSessionToBackground(user) {
    if (!user?.authSession) {
        throw new Error('Missing auth session');
    }

    await runtimeRequest({
        type: 'AUTH_SYNC',
        session: user.authSession
    });
}

async function clearAuthSessionInBackground() {
    await runtimeRequest({ type: 'AUTH_CLEAR' });
}

async function getLocalSummary() {
    const response = await runtimeRequest({ type: 'DATA_LOCAL_SUMMARY' });
    return {
        hasLocalData: Boolean(response.hasLocalData),
        localVideoCount: Number(response.localVideoCount || 0)
    };
}

async function migrateLocalDataToCloud() {
    return runtimeRequest({ type: 'DATA_MIGRATE_LOCAL' });
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

function removeVideoFromWatchlist(videoId, timestamp, category, event) {
    event.stopPropagation();

    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || { Default: [] };

        if (categories[category]) {
            const indexToRemove = categories[category].findIndex(video =>
                video.videoId === videoId && video.timestamp === timestamp
            );

            if (indexToRemove !== -1) {
                // Remove the video from the category
                categories[category].splice(indexToRemove, 1);

                // If the category is empty and not Default, ask if user wants to delete it
                if (category !== 'Default' && categories[category].length === 0) {
                    if (confirm(`The category "${category}" is now empty. Do you want to delete it?`)) {
                        delete categories[category];
                    }
                }

                cloudStorage.set({ categories: categories }, function () {
                    // Update the category count in the sidebar
                    updateCategoryCounts();

                    // Remove the specific list item from the DOM
                    const listItem = document.querySelector(`.watchlist-item[data-video-id="${videoId}"][data-timestamp="${timestamp}"]`);
                    if (listItem) {
                        listItem.style.animation = 'fadeOut 0.2s ease-in-out'; // Add fade-out animation
                        setTimeout(() => {
                            listItem.remove(); // Remove the item after the animation

                            // Check if category section is now empty
                            const safeCategorySelector = escapeForAttributeSelector(category);
                            const categorySection = document.querySelector(`.category-section[data-category="${safeCategorySelector}"]`);
                            if (categorySection && !categorySection.querySelector('.watchlist-item')) {
                                categorySection.style.animation = 'fadeOut 0.2s ease-in-out';
                                setTimeout(() => {
                                    categorySection.remove();

                                    // Check if we should update the categories list UI
                                    if (category !== 'Default' && !categories[category]) {
                                        const categoryItem = document.querySelector(`.category-item[data-category="${safeCategorySelector}"]`);
                                        if (categoryItem) {
                                            categoryItem.remove();
                                        }
                                    }

                                    // If no items left, show empty state
                                    checkEmptyState();
                                }, 200);
                            }
                        }, 200); // Match the duration of the animation
                    }

                    console.log('Video removed from watchlist:', videoId);
                });
            }
        }
    });
}

// Helper function to update category counts in the UI
function updateCategoryCounts() {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || { Default: [] };

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

function renderWatchlist(onComplete) {
    const done = () => {
        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    cloudStorage.get(['categories', 'watchlist'], function (result) {
        // Check if we need to migrate data from old format
        if (result.watchlist && result.watchlist.length > 0) {
            // This is old format data, migrate it
            migrateData(result.watchlist, onComplete);
            return; // renderWatchlist will be called again after migration
        }

        const categories = result.categories || { Default: [] };
        const watchlistElement = document.getElementById('watchlist');
        watchlistElement.innerHTML = ''; // Clear existing items

        // First check if we have any videos at all
        let totalVideos = 0;
        Object.keys(categories).forEach(category => {
            totalVideos += categories[category].length;
        });

        if (totalVideos === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state-text';
            emptyState.innerHTML = `
                <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
            `;
            watchlistElement.appendChild(emptyState);
            done();
            return;
        }

        // Render each category and its videos
        Object.keys(categories).sort((a, b) => {
            // Always keep Default category at the top
            if (a === 'Default') return -1;
            if (b === 'Default') return 1;
            return a.localeCompare(b);
        }).forEach(category => {
            const videos = categories[category];

            if (videos.length === 0) return; // Skip empty categories

            // Add videos for this category (without header)
            videos.forEach((video) => {
                const listItem = document.createElement('li');
                listItem.className = 'watchlist-item';
                listItem.onclick = () => openVideo(video.videoId, video.currentTime);
                listItem.setAttribute('data-video-id', video.videoId);
                listItem.setAttribute('data-timestamp', video.timestamp);
                const safeTitle = escapeHtml(video.title || 'Untitled video');
                const safeThumbnail = escapeHtml(safeThumbnailUrl(video.thumbnail));
                const safeTimestamp = escapeHtml(formatTime(video.currentTime));

                listItem.innerHTML = `
                    <img class="thumbnail" src="${safeThumbnail}" alt="${safeTitle}" />
                    <div class="video-info">
                        <h3 class="video-title">${safeTitle}</h3>
                        <div class="video-timestamp">
                            <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="16" height="16" />
                            <span class="timestamp-value">${safeTimestamp}</span>
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="three-dot-menu" title="More options">
                            <img src="menu.svg" width="20" height="20" alt="Menu" />
                        </button>
                        <div class="dropdown-menu" style="display: none;">
                            <div class="menu-section">
                                <div class="category-options">
                                    <!-- Categories will be populated here -->
                                </div>
                            </div>
                            <div class="menu-divider"></div>
                            <button class="menu-item delete-item">
                                <img src="delete.svg" alt="Delete" />
                                Delete
                            </button>
                        </div>
                    </div>
                `;

                const threeDotMenu = listItem.querySelector('.three-dot-menu');
                const dropdownMenu = listItem.querySelector('.dropdown-menu');
                const deleteItem = listItem.querySelector('.delete-item');

                threeDotMenu.onclick = (e) => {
                    e.stopPropagation();
                    toggleDropdown(dropdownMenu);
                    populateCategoryOptions(dropdownMenu.querySelector('.category-options'), video);
                };

                // Prevent clicks inside dropdown from bubbling to video card
                dropdownMenu.onclick = (e) => {
                    e.stopPropagation();
                };

                deleteItem.onclick = (e) => {
                    e.stopPropagation();
                    removeVideoFromWatchlist(video.videoId, video.timestamp, category, e);
                    dropdownMenu.style.display = 'none';
                };

                watchlistElement.appendChild(listItem);
            });
        });
        done();
    });
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
        const categories = result.categories || { Default: [] };
        const categoryListElement = document.getElementById('categoryList');
        categoryListElement.innerHTML = ''; // Clear existing items
        const totalVideos = Object.values(categories).reduce((sum, videos) => sum + videos.length, 0);

        // Add "All" category which will show everything
        const allCategory = document.createElement('li');
        allCategory.className = 'category-item active';

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
        allCategory.onclick = () => filterByCategory('all');
        categoryListElement.appendChild(allCategory);

        // Add all user categories
        Object.keys(categories).sort().forEach(category => {
            const categoryItem = document.createElement('li');
            categoryItem.className = 'category-item';

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

            // Add delete button (hidden by default, shown in edit mode)
            if (category !== 'Default') {
                const deleteBtn = document.createElement('span');
                deleteBtn.className = 'delete-category-btn';
                deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path></svg>`;
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteCategory(category);
                };
                categoryItem.appendChild(deleteBtn);
            }

            categoryItem.setAttribute('data-category', category);
            categoryItem.onclick = () => filterByCategory(category);
            categoryListElement.appendChild(categoryItem);
        });
        done();
    });
}

// Add function to delete category
function deleteCategory(categoryName) {
    if (confirm(`Are you sure you want to delete the category "${categoryName}" and all its timestamps?`)) {
        cloudStorage.get(['categories'], function (result) {
            const categories = result.categories || {};

            // Cannot delete Default category
            if (categoryName === 'Default') return;

            // Delete the category
            delete categories[categoryName];

            // Save updated categories
            cloudStorage.set({ categories: categories }, function () {
                renderCategoryList();
                renderWatchlist();

                // If we were viewing the deleted category, switch to All
                const activeCategoryItem = document.querySelector('.category-item.active');
                if (activeCategoryItem && activeCategoryItem.getAttribute('data-category') === categoryName) {
                    filterByCategory('all');
                }
            });
        });
    }
}

function filterByCategory(selectedCategory) {
    // Update UI to show the selected category is active
    const categoryItems = document.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
        if (item.getAttribute('data-category') === selectedCategory) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // To avoid any state inconsistencies, always re-render the entire watchlist
    // and then show/hide sections based on the selected category
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || {};
        const watchlistElement = document.getElementById('watchlist');
        let totalVideos = 0;

        // Count total videos across all categories
        Object.keys(categories).forEach(category => {
            totalVideos += categories[category].length;
        });

        // If no videos at all, just show empty state and return
        if (totalVideos === 0) {
            watchlistElement.innerHTML = '';
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state-text';
            emptyState.innerHTML = `
                <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
            `;
            watchlistElement.appendChild(emptyState);
            return;
        }

        // Check if there are videos in the selected specific category
        if (selectedCategory !== 'all' &&
            (!categories[selectedCategory] || categories[selectedCategory].length === 0)) {
            // Selected category is empty, show empty state
            watchlistElement.innerHTML = '';
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state-text';
            emptyState.innerHTML = `
                <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
            `;
            watchlistElement.appendChild(emptyState);
            return;
        }

        // Re-render the entire watchlist
        watchlistElement.innerHTML = ''; // Clear existing content

        // Render each category and its videos
        Object.keys(categories).sort((a, b) => {
            // Always keep Default category at the top
            if (a === 'Default') return -1;
            if (b === 'Default') return 1;
            return a.localeCompare(b);
        }).forEach(category => {
            if (selectedCategory !== 'all' && category !== selectedCategory) {
                return;
            }

            const videos = categories[category];

            if (videos.length === 0) return; // Skip empty categories

            // Create a category section
            const categorySection = document.createElement('div');
            categorySection.className = 'category-section';
            categorySection.setAttribute('data-category', category);

            // Set display property based on selected category
            if (selectedCategory === 'all' || selectedCategory === category) {
                categorySection.style.display = 'block';
            } else {
                categorySection.style.display = 'none';
            }

            // Add category header
            const categoryHeader = document.createElement('div');
            categoryHeader.className = 'category-header';
            const categoryHeaderTitle = document.createElement('div');
            categoryHeaderTitle.className = 'category-header-title';
            categoryHeaderTitle.textContent = category;
            categoryHeader.appendChild(categoryHeaderTitle);
            categorySection.appendChild(categoryHeader);

            // Add videos for this category
            videos.forEach((video) => {
                const listItem = document.createElement('li');
                listItem.className = 'watchlist-item';
                listItem.onclick = () => openVideo(video.videoId, video.currentTime);
                listItem.setAttribute('data-video-id', video.videoId);
                listItem.setAttribute('data-timestamp', video.timestamp);
                const safeTitle = escapeHtml(video.title || 'Untitled video');
                const safeThumbnail = escapeHtml(safeThumbnailUrl(video.thumbnail));
                const safeTimestamp = escapeHtml(formatTime(video.currentTime));

                listItem.innerHTML = `
                    <img class="thumbnail" src="${safeThumbnail}" alt="${safeTitle}" />
                    <div class="video-info">
                        <h3 class="video-title">${safeTitle}</h3>
                        <div class="video-timestamp">
                            <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="16" height="16" />
                            <span class="timestamp-value">${safeTimestamp}</span>
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="three-dot-menu" title="More options">
                            <img src="menu.svg" width="20" height="20" alt="Menu" />
                        </button>
                        <div class="dropdown-menu" style="display: none;">
                            <div class="menu-section">
                                <div class="category-options">
                                    <!-- Categories will be populated here -->
                                </div>
                            </div>
                            <div class="menu-divider"></div>
                            <button class="menu-item delete-item">
                                <img src="delete.svg" alt="Delete" />
                                Delete
                            </button>
                        </div>
                    </div>
                `;

                const threeDotMenu = listItem.querySelector('.three-dot-menu');
                const dropdownMenu = listItem.querySelector('.dropdown-menu');
                const deleteItem = listItem.querySelector('.delete-item');

                threeDotMenu.onclick = (e) => {
                    e.stopPropagation();
                    toggleDropdown(dropdownMenu);
                    populateCategoryOptions(dropdownMenu.querySelector('.category-options'), video);
                };

                // Prevent clicks inside dropdown from bubbling to video card
                dropdownMenu.onclick = (e) => {
                    e.stopPropagation();
                };

                deleteItem.onclick = (e) => {
                    e.stopPropagation();
                    removeVideoFromWatchlist(video.videoId, video.timestamp, category, e);
                    dropdownMenu.style.display = 'none';
                };

                watchlistElement.appendChild(listItem);
            });
        });
    });
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

function addNewCategory() {
    const categoryName = document.getElementById('categoryNameInput').value.trim();
    if (!categoryName) {
        alert('Please enter a category name');
        return;
    }

    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || { Default: [] };

        // Check if category already exists
        if (categories[categoryName]) {
            alert(`Category "${categoryName}" already exists`);
            return;
        }

        // Add new empty category
        categories[categoryName] = [];

        cloudStorage.set({ categories: categories }, function () {
            hideCategoryModal();
            renderCategoryList();
            console.log('New category added:', categoryName);
        });
    });
}

// Add function to toggle edit mode
function toggleEditMode() {
    isEditMode = !isEditMode;

    // Get UI elements
    const categoryList = document.getElementById('categoryList');
    const editBtn = document.getElementById('editCategoriesBtn');
    const addBtn = document.getElementById('addCategoryBtn');
    const saveBtn = document.getElementById('saveCategoriesBtn');

    if (isEditMode) {
        // Enter edit mode
        categoryList.classList.add('edit-mode');
        editBtn.style.display = 'none';
        addBtn.style.display = 'none';
        saveBtn.style.display = 'flex';
    } else {
        // Exit edit mode
        categoryList.classList.remove('edit-mode');
        editBtn.style.display = 'flex';
        addBtn.style.display = 'flex';
        saveBtn.style.display = 'none';
    }
}

// Dropdown menu functionality
function toggleDropdown(dropdown) {
    // Close all other dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        if (menu !== dropdown) {
            menu.style.display = 'none';
        }
    });

    // Toggle current dropdown
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// Populate category options in dropdown
function populateCategoryOptions(container, video) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || { Default: [] };
        const selectedIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><path fill="#1FA700" d="M3.359 6L0 2.64l.947-.947 2.412 2.407L9.053 0 10 .947 3.359 6Z"/></svg>';
        container.innerHTML = '';

        const sortedCategories = Object.keys(categories).sort((a, b) => {
            if (a === 'Default') return -1;
            if (b === 'Default') return 1;
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
        const categories = result.categories || { Default: [] };

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
        });
    });
}

// Add video to category
function addVideoToCategory(video, category) {
    cloudStorage.get(['categories'], function (result) {
        const categories = result.categories || { Default: [] };

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
        const categories = result.categories || { Default: [] };

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
        const categories = result.categories || { Default: [] };

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
    if (!e.target.closest('.video-actions')) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const signedOutState = document.getElementById('signed-out-state');
    const signedInState = document.getElementById('signed-in-state');
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userPhoto = document.getElementById('user-photo');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const editCategoriesBtn = document.getElementById('editCategoriesBtn');
    const saveCategoriesBtn = document.getElementById('saveCategoriesBtn');
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    const cancelCategoryBtn = document.getElementById('cancelCategoryBtn');
    const closeModalBtn = document.querySelector('.close-modal');
    const categoryNameInput = document.getElementById('categoryNameInput');
    const categoriesContainer = document.querySelector('.categories-container');
    const dataLoadingState = document.getElementById('data-loading-state');
    const dataLoadingText = dataLoadingState?.querySelector('.data-loading-text');
    const migrationHint = document.createElement('div');
    migrationHint.style.fontSize = '11px';
    migrationHint.style.color = '#a0a0a0';
    migrationHint.style.lineHeight = '1.4';
    migrationHint.style.marginTop = '8px';
    migrationHint.style.maxWidth = '220px';
    migrationHint.style.textAlign = 'left';
    migrationHint.style.display = 'none';
    signedOutState.appendChild(migrationHint);

    const migrationOverlay = document.createElement('div');
    migrationOverlay.style.position = 'fixed';
    migrationOverlay.style.inset = '0';
    migrationOverlay.style.background = 'rgba(0, 0, 0, 0.55)';
    migrationOverlay.style.display = 'none';
    migrationOverlay.style.alignItems = 'center';
    migrationOverlay.style.justifyContent = 'center';
    migrationOverlay.style.zIndex = '99999';
    migrationOverlay.innerHTML = `
        <div style="background:#191919;border:1px solid #383838;border-radius:8px;padding:16px;max-width:280px;text-align:center;color:#fff;font-family:Manrope,sans-serif;">
            <div id="migration-overlay-text" style="font-size:14px;line-height:1.4;">Migrating your timestamps...</div>
        </div>
    `;
    document.body.appendChild(migrationOverlay);
    const migrationOverlayText = migrationOverlay.querySelector('#migration-overlay-text');

    function updateAuthUI(user) {
        const dataActionsEnabled = Boolean(user);
        [addCategoryBtn, editCategoriesBtn, saveCategoriesBtn, saveCategoryBtn].forEach((button) => {
            button.disabled = !dataActionsEnabled;
            button.style.opacity = dataActionsEnabled ? '1' : '0.6';
            button.style.cursor = dataActionsEnabled ? '' : 'not-allowed';
        });

        if (user) {
            signedOutState.style.display = 'none';
            signedInState.style.display = 'flex';

            if (user.photoURL) {
                const tooltipParts = [];
                if (user.displayName) tooltipParts.push(user.displayName);
                if (user.email) tooltipParts.push(user.email);
                const tooltipText = tooltipParts.join('\n') || 'Signed in account';

                userPhoto.src = user.photoURL;
                userPhoto.style.display = 'block';
                userPhoto.title = tooltipText;
                userPhoto.setAttribute('aria-label', tooltipText);
            } else {
                userPhoto.removeAttribute('src');
                userPhoto.style.display = 'none';
                userPhoto.removeAttribute('title');
                userPhoto.removeAttribute('aria-label');
            }
        } else {
            signedInState.style.display = 'none';
            signedOutState.style.display = 'flex';
            userPhoto.removeAttribute('src');
            userPhoto.removeAttribute('title');
            userPhoto.removeAttribute('aria-label');
        }
    }

    function showMigrationOverlay(message) {
        migrationOverlayText.textContent = message;
        migrationOverlay.style.display = 'flex';
    }

    function hideMigrationOverlay() {
        migrationOverlay.style.display = 'none';
    }

    async function refreshSignedOutHint() {
        try {
            const summary = await getLocalSummary();
            if (summary.hasLocalData) {
                migrationHint.textContent = `${summary.localVideoCount} local timestamps found. Sign in to migrate and sync to Firebase.`;
                migrationHint.style.display = 'block';
            } else {
                migrationHint.textContent = '';
                migrationHint.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load local summary:', error);
            migrationHint.textContent = '';
            migrationHint.style.display = 'none';
        }
    }

    async function runMigrationFlow() {
        const summary = await getLocalSummary();

        if (!summary.hasLocalData) {
            await migrateLocalDataToCloud();
            return;
        }

        showMigrationOverlay(`Migrating ${summary.localVideoCount} timestamps to Firebase...`);
        await migrateLocalDataToCloud();
        showMigrationOverlay('Migration complete. Your timestamps now sync across devices.');
        await wait(900);
        hideMigrationOverlay();
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

    async function loadCloudDataIntoUI() {
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
    }

    setDataLoadingState(true);

    signInBtn.addEventListener('click', async () => {
        if (!window.auth) {
            handleAuthError('Authentication module not loaded', new Error('window.auth missing'));
            return;
        }

        try {
            setButtonsDisabled(true);
            const user = await window.auth.signInWithGoogle();
            await syncAuthSessionToBackground(user);
            updateAuthUI(user);
            try {
                await runMigrationFlow();
            } catch (migrationError) {
                handleAuthError('Migration failed', migrationError);
            }
            await loadCloudDataIntoUI();
            await refreshSignedOutHint();
        } catch (error) {
            handleAuthError('Sign-in failed', error);
            hideMigrationOverlay();
        } finally {
            setButtonsDisabled(false);
        }
    });

    signOutBtn.addEventListener('click', async () => {
        if (!window.auth) {
            handleAuthError('Authentication module not loaded', new Error('window.auth missing'));
            return;
        }

        try {
            setButtonsDisabled(true);
            await window.auth.signOut();
            await clearAuthSessionInBackground();
            updateAuthUI(null);
            await loadCloudDataIntoUI();
            await refreshSignedOutHint();
        } catch (error) {
            handleAuthError('Sign-out failed', error);
        } finally {
            setButtonsDisabled(false);
        }
    });

    if (window.auth?.getCurrentUser) {
        try {
            const user = await window.auth.getCurrentUser();
            if (user) {
                await syncAuthSessionToBackground(user);
                updateAuthUI(user);
                try {
                    await runMigrationFlow();
                } catch (migrationError) {
                    console.error('Migration flow failed:', migrationError);
                }
                await loadCloudDataIntoUI();
            } else {
                await clearAuthSessionInBackground();
                updateAuthUI(null);
                await loadCloudDataIntoUI();
            }
        } catch (error) {
            console.error('Failed to load current user', error);
            try {
                await clearAuthSessionInBackground();
            } catch (clearError) {
                console.warn('Failed clearing background auth session:', clearError);
            }
            updateAuthUI(null);
            await loadCloudDataIntoUI();
        } finally {
            hideMigrationOverlay();
            await refreshSignedOutHint();
        }
    } else {
        try {
            await clearAuthSessionInBackground();
        } catch (error) {
            console.warn('Failed clearing background auth session:', error);
        }
        updateAuthUI(null);
        await loadCloudDataIntoUI();
        await refreshSignedOutHint();
    }

    // Setup modal event listeners
    addCategoryBtn.addEventListener('click', showCategoryModal);
    saveCategoryBtn.addEventListener('click', addNewCategory);
    cancelCategoryBtn.addEventListener('click', hideCategoryModal);
    closeModalBtn.addEventListener('click', hideCategoryModal);

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
