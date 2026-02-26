let isEditMode = false;

function handleAuthError(message, error) {
    console.error(message, error);
    alert(`${message}. Check the console for details.`);
}

function openVideo(videoId, currentTime) {
    const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(currentTime)}s`;
    chrome.tabs.create({ url });
}

function removeVideoFromWatchlist(videoId, timestamp, category, event) {
    event.stopPropagation(); 
    
    chrome.storage.local.get(['categories'], function(result) {
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
                
                chrome.storage.local.set({ categories: categories }, function() {
                    if (chrome.runtime.lastError) {
                        console.error('Error saving to storage:', chrome.runtime.lastError);
                        return;
                    }
                    
                    // Update the category count in the sidebar
                    updateCategoryCount(category, categories[category] ? categories[category].length : 0);
                    
                    // Remove the specific list item from the DOM
                    const listItem = document.querySelector(`.watchlist-item[data-video-id="${videoId}"][data-timestamp="${timestamp}"]`);
                    if (listItem) {
                        listItem.style.animation = 'fadeOut 0.2s ease-in-out'; // Add fade-out animation
                        setTimeout(() => {
                            listItem.remove(); // Remove the item after the animation
                            
                            // Check if category section is now empty
                            const categorySection = document.querySelector(`.category-section[data-category="${category}"]`);
                            if (categorySection && !categorySection.querySelector('.watchlist-item')) {
                                categorySection.style.animation = 'fadeOut 0.2s ease-in-out';
                                setTimeout(() => {
                                    categorySection.remove();
                                    
                                    // Check if we should update the categories list UI
                                    if (category !== 'Default' && !categories[category]) {
                                        const categoryItem = document.querySelector(`.category-item[data-category="${category}"]`);
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
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        
        // Update each category count pill
        Object.keys(categories).forEach(category => {
            const categoryItems = document.querySelectorAll(`[data-category="${category}"]`);
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
    chrome.storage.local.get(['categories'], function(result) {
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
    chrome.storage.local.get(['categories'], function(result) {
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

function renderWatchlist() {
    chrome.storage.local.get(['categories', 'watchlist'], function(result) {
        // Check if we need to migrate data from old format
        if (result.watchlist && result.watchlist.length > 0) {
            // This is old format data, migrate it
            migrateData(result.watchlist);
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
                
                listItem.innerHTML = `
                    <img class="thumbnail" src="${video.thumbnail}" alt="${video.title}" />
                    <div class="video-info">
                        <h3 class="video-title">${video.title}</h3>
                        <div class="video-timestamp">
                            <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="16" height="16" />
                            <span class="timestamp-value">${formatTime(video.currentTime)}</span>
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="three-dot-menu" title="More options">
                            <img src="menu.svg" width="20" height="20" alt="Menu" />
                        </button>
                        <div class="dropdown-menu" style="display: none;">
                            <div class="menu-section">
                                <div class="menu-title">Assign to groups:</div>
                                <div class="category-options">
                                    <!-- Categories will be populated here -->
                                </div>
                            </div>
                            <div class="menu-divider"></div>
                            <button class="menu-item delete-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#666666" viewBox="0 0 256 256"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>
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

function migrateData(watchlist) {
    console.log('Migrating data to new format...');
    const categories = { Default: [] };
    
    // Copy all videos to Default category
    watchlist.forEach(video => {
        categories.Default.push(video);
    });
    
    // Update storage with new format and remove old format
    chrome.storage.local.set({ categories: categories, watchlist: [] }, function() {
        if (chrome.runtime.lastError) {
            console.error('Error migrating data:', chrome.runtime.lastError);
            return;
        }
        console.log('Data migration completed successfully');
        renderWatchlist(); // Re-render with new format
    });
}

function renderCategoryList() {
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        const categoryListElement = document.getElementById('categoryList');
        categoryListElement.innerHTML = ''; // Clear existing items
        
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
        allCountPill.textContent = '0';
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
    });
}

// Add function to delete category
function deleteCategory(categoryName) {
    if (confirm(`Are you sure you want to delete the category "${categoryName}" and all its timestamps?`)) {
        chrome.storage.local.get(['categories'], function(result) {
            const categories = result.categories || {};
            
            // Cannot delete Default category
            if (categoryName === 'Default') return;
            
            // Delete the category
            delete categories[categoryName];
            
            // Save updated categories
            chrome.storage.local.set({ categories: categories }, function() {
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
    chrome.storage.local.get(['categories'], function(result) {
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
            categoryHeader.innerHTML = `
                <div class="category-header-title">${category}</div>
            `;
            categorySection.appendChild(categoryHeader);
            
            // Add videos for this category
            videos.forEach((video) => {
                const listItem = document.createElement('li');
                listItem.className = 'watchlist-item';
                listItem.onclick = () => openVideo(video.videoId, video.currentTime);
                listItem.setAttribute('data-video-id', video.videoId);
                listItem.setAttribute('data-timestamp', video.timestamp);
                
                listItem.innerHTML = `
                    <img class="thumbnail" src="${video.thumbnail}" alt="${video.title}" />
                    <div class="video-info">
                        <h3 class="video-title">${video.title}</h3>
                        <div class="video-timestamp">
                            <img src="timestamp.svg" class="timestamp-icon" alt="timestamp" width="16" height="16" />
                            <span class="timestamp-value">${formatTime(video.currentTime)}</span>
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="three-dot-menu" title="More options">
                            <img src="menu.svg" width="20" height="20" alt="Menu" />
                        </button>
                        <div class="dropdown-menu" style="display: none;">
                            <div class="menu-section">
                                <div class="menu-title">Assign to groups:</div>
                                <div class="category-options">
                                    <!-- Categories will be populated here -->
                                </div>
                            </div>
                            <div class="menu-divider"></div>
                            <button class="menu-item delete-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#666666" viewBox="0 0 256 256"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>
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
    
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        
        // Check if category already exists
        if (categories[categoryName]) {
            alert(`Category "${categoryName}" already exists`);
            return;
        }
        
        // Add new empty category
        categories[categoryName] = [];
        
        chrome.storage.local.set({ categories: categories }, function() {
            if (chrome.runtime.lastError) {
                console.error('Error saving category:', chrome.runtime.lastError);
                return;
            }
            
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
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        container.innerHTML = '';
        
        Object.keys(categories).sort().forEach(category => {
            const option = document.createElement('label');
            option.className = 'category-option';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = category;
            
            // Check if video is in this category
            const videoInCategory = categories[category].some(v => 
                v.videoId === video.videoId && v.timestamp === video.timestamp
            );
            checkbox.checked = videoInCategory;
            
            checkbox.onchange = (e) => {
                e.stopPropagation();
                if (checkbox.checked) {
                    addVideoToCategory(video, category);
                } else {
                    removeVideoFromCategory(video, category);
                }
            };
            
            const label = document.createElement('span');
            label.textContent = category;
            
            option.appendChild(checkbox);
            option.appendChild(label);
            container.appendChild(option);
        });
    });
}

// Add video to category
function addVideoToCategory(video, category) {
    chrome.storage.local.get(['categories'], function(result) {
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
            chrome.storage.local.set({ categories: categories }, function() {
                updateCategoryCounts();
            });
        }
    });
}

// Remove video from category
function removeVideoFromCategory(video, category) {
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || { Default: [] };
        
        if (categories[category]) {
            categories[category] = categories[category].filter(v => 
                !(v.videoId === video.videoId && v.timestamp === video.timestamp)
            );
            
            chrome.storage.local.set({ categories: categories }, function() {
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
    chrome.storage.local.get(['categories'], function(result) {
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
            chrome.storage.local.set({ categories: categories }, function() {
                updateCategoryCounts();
                renderWatchlist();
            });
        }
    });
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.video-actions')) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    renderWatchlist();
    renderCategoryList();

    const signedOutState = document.getElementById('signed-out-state');
    const signedInState = document.getElementById('signed-in-state');
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');
    const userEmail = document.getElementById('user-email');

    function updateAuthUI(user) {
        if (user) {
            signedOutState.style.display = 'none';
            signedInState.style.display = 'flex';
            userName.textContent = user.displayName || 'Signed in';
            userEmail.textContent = user.email || '';

            if (user.photoURL) {
                userPhoto.src = user.photoURL;
                userPhoto.style.display = 'block';
            } else {
                userPhoto.removeAttribute('src');
                userPhoto.style.display = 'none';
            }
        } else {
            signedInState.style.display = 'none';
            signedOutState.style.display = 'flex';
            userPhoto.removeAttribute('src');
            userName.textContent = '';
            userEmail.textContent = '';
        }
    }

    function setButtonsDisabled(isDisabled) {
        signInBtn.disabled = isDisabled;
        signOutBtn.disabled = isDisabled;
    }

    signInBtn.addEventListener('click', async () => {
        if (!window.auth) {
            handleAuthError('Authentication module not loaded', new Error('window.auth missing'));
            return;
        }

        try {
            setButtonsDisabled(true);
            const user = await window.auth.signInWithGoogle();
            updateAuthUI(user);
        } catch (error) {
            handleAuthError('Sign-in failed', error);
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
            updateAuthUI(null);
        } catch (error) {
            handleAuthError('Sign-out failed', error);
        } finally {
            setButtonsDisabled(false);
        }
    });

    if (window.auth?.getCurrentUser) {
        window.auth.getCurrentUser()
            .then((user) => updateAuthUI(user))
            .catch((error) => {
                console.error('Failed to load current user', error);
                updateAuthUI(null);
            });
    } else {
        updateAuthUI(null);
    }

    // Setup modal event listeners
    document.getElementById('addCategoryBtn').addEventListener('click', showCategoryModal);
    document.getElementById('saveCategoryBtn').addEventListener('click', addNewCategory);
    document.getElementById('cancelCategoryBtn').addEventListener('click', hideCategoryModal);
    document.querySelector('.close-modal').addEventListener('click', hideCategoryModal);

    // Setup edit mode toggle
    document.getElementById('editCategoriesBtn').addEventListener('click', toggleEditMode);
    document.getElementById('saveCategoriesBtn').addEventListener('click', toggleEditMode);

    // Allow pressing Enter to save category
    document.getElementById('categoryNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addNewCategory();
        }
    });
});