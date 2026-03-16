function fallbackOpenVideo(videoId: string, currentTime: number): void {
  const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(currentTime)}s`
  chrome.tabs.create({ url }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to open new tab:', chrome.runtime.lastError.message)
    }
  })
}

export function openVideo(videoId: string, currentTime: number): void {
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to query tabs:', chrome.runtime.lastError.message)
      fallbackOpenVideo(videoId, currentTime)
      return
    }

    const matchingTab = tabs.find((tab) => tab.url && tab.url.includes(`v=${videoId}`))

    if (matchingTab?.id != null && matchingTab.windowId != null) {
      chrome.tabs.sendMessage(
        matchingTab.id,
        { action: 'seekToTimestamp', time: currentTime },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('Seek message failed:', chrome.runtime.lastError.message)
            fallbackOpenVideo(videoId, currentTime)
            return
          }
        }
      )

      chrome.tabs.update(matchingTab.id, { active: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to focus tab:', chrome.runtime.lastError.message)
        }
      })

      chrome.windows.update(matchingTab.windowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to focus window:', chrome.runtime.lastError.message)
        }
      })
    } else {
      fallbackOpenVideo(videoId, currentTime)
    }
  })
}
