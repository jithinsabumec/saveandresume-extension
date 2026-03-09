let isEditMode = false;
const dataClient = globalThis.SaveResumeDataLayer.createClientDataLayer();

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
        const categories = result.categories || {};

        if (categories[category]) {
            const indexToRemove = categories[category].findIndex(video =>
                video.videoId === videoId && video.timestamp === timestamp
            );

            if (indexToRemove !== -1) {
                // Remove the video from the category
                categories[category].splice(indexToRemove, 1);

                // Ask if user wants to delete a category after removing its last timestamp
                if (categories[category].length === 0) {
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
                                    if (!categories[category]) {
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

        const categories = result.categories || {};
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
            if (isEditMode) {
                return;
            }
            filterByCategory('all');
        };
        categoryListElement.appendChild(allCategory);

        // Add all user categories
        Object.keys(categories).sort().forEach(category => {
            const categoryItem = document.createElement('li');
            categoryItem.className = 'category-item can-delete';

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

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-category-btn';
            deleteBtn.title = `Delete "${category}"`;
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path></svg>`;
            deleteBtn.onclick = (event) => {
                event.stopPropagation();
                if (isEditMode) {
                    deleteCategory(category);
                }
            };
            categoryItem.appendChild(deleteBtn);

            categoryItem.setAttribute('data-category', category);
            categoryItem.onclick = () => {
                if (isEditMode) {
                    deleteCategory(category);
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
    if (!confirm(`Are you sure you want to delete the category "${categoryName}" and all its timestamps?`)) {
        return;
    }

    const activeCategoryItem = document.querySelector('.category-item.active');
    const activeCategory = activeCategoryItem?.getAttribute('data-category') || 'all';
    const nextSelectedCategory = activeCategory === categoryName ? 'all' : activeCategory;

    dataClient.get(['categories'])
        .then((data) => {
            const categories = data.categories || {};

            if (!Object.prototype.hasOwnProperty.call(categories, categoryName)) {
                renderCategoryList(() => {
                    filterByCategory(nextSelectedCategory);
                });
                return null;
            }

            const updatedCategories = { ...categories };
            delete updatedCategories[categoryName];

            return dataClient.set({ categories: updatedCategories });
        })
        .then((result) => {
            if (result === null) {
                return;
            }

            renderCategoryList(() => {
                filterByCategory(nextSelectedCategory);
            });
        })
        .catch((error) => {
            console.error('Failed to delete category:', error);
            const details = error?.message || 'Unknown error';
            alert(`Could not delete category. ${details}`);
        });
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
    const mainContent = document.querySelector('.main-content');
    const categoriesContainer = document.querySelector('.categories-container');
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

    function updateAuthUI(user) {
        isAuthenticated = Boolean(user);

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
    }

    setDataLoadingState(true);

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
            try {
                await runMigrationFlow();
            } catch (migrationError) {
                showStatusMessage('Could not sync local timestamps yet. Your local data is still safe. Please try again.', 'error');
                console.error('Migration failed:', migrationError);
            }
            await loadDataIntoUI();
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
            await loadDataIntoUI();
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
    } catch (error) {
        console.error('Failed to load auth status', error);
        try {
            await signOutInBackground();
        } catch (signOutError) {
            console.warn('Failed clearing background auth session:', signOutError);
        }
        updateAuthUI(null);
        await loadDataIntoUI();
    } finally {
        await loadBreakingNotice();
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
