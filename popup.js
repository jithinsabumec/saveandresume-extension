let isEditMode = false;

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

// Helper function to update category count in sidebar
function updateCategoryCount(category, count) {
    // Find the category item in the sidebar
    const categoryItem = document.querySelector(`.category-item[data-category="${category}"]`);
    if (categoryItem) {
        const categoryText = categoryItem.querySelector('span');
        if (categoryText) {
            categoryText.textContent = `${category} (${count})`;
        }
    }
    
    // Also update the "All" category count
    updateAllCategoryCount();
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
        
        // Update the "All" category count
        const allCategoryItem = document.querySelector(`.category-item[data-category="all"]`);
        if (allCategoryItem) {
            allCategoryItem.textContent = `All (${totalVideos})`;
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
            
            // Create a category section
            const categorySection = document.createElement('div');
            categorySection.className = 'category-section';
            categorySection.setAttribute('data-category', category);
            
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
                        <span class="video-timestamp-label">Timestamp</span>
                        <span class="timestamp-separator">-</span>
                        <span class="timestamp-value">${formatTime(video.currentTime)}</span>
                    </div>
                    <button class="remove-button" title="Remove from watchlist">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="#666666" viewBox="0 0 256 256"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>
                    </button>
                `;
                
                const removeButton = listItem.querySelector('.remove-button');
                removeButton.onclick = (e) => removeVideoFromWatchlist(video.videoId, video.timestamp, category, e);
                
                categorySection.appendChild(listItem);
            });
            
            watchlistElement.appendChild(categorySection);
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
        allCategory.textContent = 'All';
        allCategory.setAttribute('data-category', 'all');
        allCategory.onclick = () => filterByCategory('all');
        categoryListElement.appendChild(allCategory);
        
        // Add all user categories
        Object.keys(categories).sort().forEach(category => {
            const categoryItem = document.createElement('li');
            categoryItem.className = 'category-item';
            
            // Create a container for category text
            const categoryText = document.createElement('span');
            categoryText.textContent = `${category} (${categories[category].length})`;
            categoryItem.appendChild(categoryText);
            
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
                        <span class="video-timestamp-label">Timestamp</span>
                        <span class="timestamp-separator">-</span>
                        <span class="timestamp-value">${formatTime(video.currentTime)}</span>
                    </div>
                    <button class="remove-button" title="Remove from watchlist">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="#666666" viewBox="0 0 256 256"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>
                    </button>
                `;
                
                const removeButton = listItem.querySelector('.remove-button');
                removeButton.onclick = (e) => removeVideoFromWatchlist(video.videoId, video.timestamp, category, e);
                
                categorySection.appendChild(listItem);
            });
            
            watchlistElement.appendChild(categorySection);
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

// Setup event listeners
document.addEventListener('DOMContentLoaded', () => {
    renderWatchlist();
    renderCategoryList();
    
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