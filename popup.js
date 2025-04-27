function openVideo(videoId, currentTime) {
    const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(currentTime)}s`;
    chrome.tabs.create({ url });
}

function removeVideoFromWatchlist(videoId, timestamp, event) {
    event.stopPropagation();
    
    chrome.storage.local.get(['watchlist'], function(result) {
        const watchlist = result.watchlist || [];
        const indexToRemove = watchlist.findIndex(video => 
            video.videoId === videoId && video.timestamp === timestamp
        );
        
        if (indexToRemove !== -1) {
            // Remove the video from the watchlist
            watchlist.splice(indexToRemove, 1);
            chrome.storage.local.set({ watchlist: watchlist }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error saving to storage:', chrome.runtime.lastError);
                    return;
                }
                
                // Remove the specific list item from the DOM
                const listItem = document.querySelector(`.watchlist-item[data-video-id="${videoId}"]`);
                if (listItem) {
                    listItem.style.animation = 'fadeOut 0.2s ease-in-out'; // Add fade-out animation
                    setTimeout(() => {
                        listItem.remove(); // Remove the item after the animation
                    }, 200); // Match the duration of the animation
                }
                renderWatchlist();
                console.log('Video removed from watchlist:', videoId);
            });
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

function renderWatchlist() {
    chrome.storage.local.get(['watchlist'], function(result) {
        const watchlist = result.watchlist || [];
        const watchlistElement = document.getElementById('watchlist');
        
        watchlistElement.innerHTML = ''; // Clear existing items

        if (watchlist.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state-text';
            emptyState.innerHTML = `
                <img src="./instructions.svg" alt="instructions" class="empty-state-icon" width="300" draggable="false" />
            `;
            watchlistElement.appendChild(emptyState);
            return;
        }

        watchlist.forEach((video) => {
            const listItem = document.createElement('li');
            listItem.className = 'watchlist-item';
            listItem.onclick = () => openVideo(video.videoId, video.currentTime);
            listItem.setAttribute('data-video-id', video.videoId);
            
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
            removeButton.onclick = (e) => removeVideoFromWatchlist(video.videoId, video.timestamp, e);
            
            watchlistElement.appendChild(listItem);
        });
    });
}

document.addEventListener('DOMContentLoaded', renderWatchlist);