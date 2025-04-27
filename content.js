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

    // Add styles
    const style = document.createElement('style');
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
    document.body.appendChild(popup);

    // Remove popup after 3 seconds
    setTimeout(() => {
        popup.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => popup.remove(), 300);
    }, 3000);
}

// Function to save video info to storage with current timestamp
function saveVideoToWatchlist(videoId, title, currentTime) {
    // Get the current video ID and title from the page
    const currentVideoId = new URLSearchParams(window.location.search).get('v');
    // Get title from YouTube's video title element
    const currentTitle = document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() || document.title;
    const thumbnailUrl = getVideoThumbnail(currentVideoId);
    
    chrome.storage.local.get(['watchlist'], function(result) {
        const watchlist = result.watchlist || [];
        const cleanedTitle = cleanVideoTitle(currentTitle);  // Clean the current title
        const videoData = { 
            videoId: currentVideoId,
            title: cleanedTitle, 
            currentTime,
            thumbnail: thumbnailUrl,
            timestamp: Date.now()
        };
        
        const existingVideoIndex = watchlist.findIndex(video => video.videoId === currentVideoId);
        const formattedTime = formatTime(currentTime);
        
        if (existingVideoIndex === -1) {
            // Video not in watchlist, add it
            watchlist.unshift(videoData);
            chrome.storage.local.set({ watchlist: watchlist }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error saving to storage:', chrome.runtime.lastError);
                    showCustomPopup({ 
                        action: 'added',
                        time: formattedTime 
                    });
                    return;
                }
                showCustomPopup({ 
                    action: 'added',
                    time: formattedTime 
                });
                console.log('Timestamp added to watchlist:', videoData);
            });
        } else {
            // Video exists, update its timestamp
            watchlist[existingVideoIndex].currentTime = currentTime;
            watchlist[existingVideoIndex].timestamp = Date.now();
            watchlist[existingVideoIndex].title = cleanedTitle;  // Update title in case it changed
            
            const updatedVideo = watchlist.splice(existingVideoIndex, 1)[0];
            watchlist.unshift(updatedVideo);
            
            chrome.storage.local.set({ watchlist: watchlist }, function() {
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
                console.log('Timestamp updated for video:', updatedVideo);
            });
        }
    });
}

// Create and inject "Add to Watchlist" button
function addButton() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    const videoTitle = document.title;
    const isHomePage = window.location.pathname === '/';
    const isFullscreen = document.fullscreenElement !== null;
    
    // Remove existing button if it exists
    const existingBtn = document.getElementById('addToWatchlistBtn');
    if (existingBtn) {
        existingBtn.remove();
    }
    
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
        const videoId = new URLSearchParams(window.location.search).get('v');
        const videoTitle = document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() || document.title;
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            saveVideoToWatchlist(videoId, videoTitle, currentTime);
        } else {
            console.error('No video element found.');
        }
    }
});