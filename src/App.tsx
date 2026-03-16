import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Header from './components/Header'
import CategoryList from './components/CategoryList'
import WatchlistItem from './components/WatchlistItem'
import CategoryModal from './components/CategoryModal'
import DeleteCategoryModal from './components/DeleteCategoryModal'
import EmptyState from './components/EmptyState'
import LoadingState from './components/LoadingState'
import StatusMessage from './components/StatusMessage'
import MigrationHint from './components/MigrationHint'
import BreakingNoticeBanner from './components/BreakingNoticeBanner'
import UndoNotification from './components/UndoNotification'
import { handleAuthError, runtimeRequest, signInWithGoogleInBackground, signOutInBackground } from './lib/auth'
import {
  cloudStorage,
  getDataClientApi,
  getLocalSummary,
  migrateLocalDataToCloud,
  resolveLegacyVideoStudyMode,
  setLegacyVideoStudyMode,
  waitForDataLayer
} from './lib/storage'
import { openVideo } from './lib/video'
import type {
  AuthUser,
  Categories,
  InfoButtonProps,
  InfoPopoverCopy,
  StatusTone,
  StorageResult,
  VideoEntry,
  VideoTimestampEntry
} from './types'

const PROTECTED_CATEGORY_NAMES = new Set(['Default'])

const STUDY_MODE_GLOBAL_INFO_COPY = Object.freeze({
  title: 'Default to Study Mode',
  body: 'When this is on, every new video you save will automatically be in Study Mode. That means you can save multiple timestamps and add notes from the moment you first save a video. Videos you have already saved are not affected - they keep their current mode.',
  examples: [
    'Doing a research session? Turn this on before you start and every video you save will be ready for notes.',
    'Just resuming a show? Leave this off and save individual videos to Study Mode as needed.'
  ],
  footer: 'You can always switch any individual video in or out of Study Mode using its three-dot menu.'
} satisfies InfoPopoverCopy)

const STUDY_MODE_VIDEO_INFO_COPY = Object.freeze({
  title: 'Study Mode for this video',
  body: 'Turning this on lets you save multiple timestamps and add notes to each one - just for this video. It does not affect any other video in your list.',
  examples: [
    'This overrides the global default. If your default is set to off, you can still turn Study Mode on for individual videos you want to research.',
    'Turning Study Mode off for this video will not delete your timestamps or notes. Everything is preserved and will come back if you switch it on again.'
  ],
  footer: 'To set Study Mode as the default for all new saves, use the Default to Study Mode toggle in your profile menu.'
} satisfies InfoPopoverCopy)

const UNDO_DURATION_MS = 30000

interface InfoPopoverState {
  key: string
  copy: InfoPopoverCopy
  top: number
  left: number
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getBooleanFromLocalStorage(key: string, fallback = false): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        resolve(Boolean(fallback))
        return
      }

      resolve(result[key] === true)
    })
  })
}

function setBooleanInLocalStorage(key: string, value: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: Boolean(value) }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      resolve(Boolean(value))
    })
  })
}

function getStudyMode(): Promise<boolean> {
  return getBooleanFromLocalStorage('studyMode', false)
}

function setStudyMode(value: boolean): Promise<boolean> {
  return setBooleanInLocalStorage('studyMode', value)
}

function getNormalizedVideoTimestampEntries(video: VideoEntry): VideoTimestampEntry[] {
  const fallbackTime = Math.max(0, Number(video?.currentTime) || 0)
  const fallbackSavedAt = Math.max(0, Number(video?.timestamp) || Date.now())
  const rawEntries =
    Array.isArray(video?.timestamps) && video.timestamps.length > 0
      ? video.timestamps
      : [{ time: fallbackTime, note: '', savedAt: fallbackSavedAt }]

  return rawEntries.map((entry) => ({
    time: Math.max(0, Number(entry?.time) || 0),
    note: typeof entry?.note === 'string' ? entry.note : '',
    savedAt: Math.max(0, Number(entry?.savedAt) || fallbackSavedAt)
  }))
}

function autoSizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  textarea.style.height = `${Math.max(textarea.scrollHeight, 14)}px`
}

function positionInfoPopover(anchorElement: HTMLElement, popover: HTMLElement): { top: number; left: number } {
  const anchorRect = anchorElement.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const gap = 8
  const edgePadding = 8

  const spaceBelow = viewportHeight - anchorRect.bottom
  const spaceAbove = anchorRect.top
  const shouldOpenAbove = spaceBelow < popoverRect.height + gap && spaceAbove > spaceBelow

  let top = shouldOpenAbove ? anchorRect.top - popoverRect.height - gap : anchorRect.bottom + gap
  top = Math.max(edgePadding, Math.min(top, viewportHeight - popoverRect.height - edgePadding))

  let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2
  left = Math.max(edgePadding, Math.min(left, viewportWidth - popoverRect.width - edgePadding))

  return {
    top: Math.round(top),
    left: Math.round(left)
  }
}

function getCloudData(keys: string[]): Promise<StorageResult> {
  return new Promise((resolve) => {
    cloudStorage.get(keys, (result) => resolve(result))
  })
}

function setCloudData(data: Partial<StorageResult>): Promise<void> {
  return new Promise((resolve) => {
    cloudStorage.set(data, resolve)
  })
}

export default function App(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [categories, setCategories] = useState<Categories>({})
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isEditMode, setIsEditMode] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ text: string; tone: StatusTone } | null>(null)
  const [migrationHintText, setMigrationHintText] = useState<string | null>(null)
  const [isMigrationHintHiding, setIsMigrationHintHiding] = useState<boolean>(false)
  const [breakingNoticeText, setBreakingNoticeText] = useState<string | null>(null)
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false)
  const [showDeleteCategoryModal, setShowDeleteCategoryModal] = useState<boolean>(false)
  const [pendingCategoryDeletion, setPendingCategoryDeletion] = useState<string | null>(null)
  const [undoVideo, setUndoVideo] = useState<VideoEntry | null>(null)
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null)
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState<boolean>(false)
  const [studyModeEnabled, setStudyModeEnabled] = useState<boolean>(false)
  const [buttonsDisabled, setButtonsDisabled] = useState<boolean>(false)
  const [categoryInputValue, setCategoryInputValue] = useState<string>('')
  const [expandedStudyVideos, setExpandedStudyVideos] = useState<Set<string>>(new Set())
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<string>('')
  const [infoPopoverData, setInfoPopoverData] = useState<InfoPopoverState | null>(null)

  const profileButtonWrapperRef = useRef<HTMLDivElement>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const confirmDeleteCategoryRef = useRef<HTMLButtonElement>(null)
  const watchlistContainerRef = useRef<HTMLDivElement>(null)
  const infoPopoverRef = useRef<HTMLDivElement>(null)
  const infoButtonRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const infoPopoverHideTimerRef = useRef<number | null>(null)
  const migrationHintTimerRef = useRef<number | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const isMountedRef = useRef<boolean>(true)

  const orderedCategories = Object.keys(categories).sort((left, right) => left.localeCompare(right))
  const visibleVideos: Array<{ category: string; video: VideoEntry }> = []
  let totalVideos = 0

  orderedCategories.forEach((categoryName) => {
    totalVideos += categories[categoryName].length

    if (activeCategory !== 'all' && activeCategory !== categoryName) {
      return
    }

    categories[categoryName].forEach((video) => {
      visibleVideos.push({ category: categoryName, video })
    })
  })

  const tooltipParts: string[] = []
  if (user?.displayName) tooltipParts.push(user.displayName)
  if (user?.email) tooltipParts.push(user.email)
  const profileTooltip = tooltipParts.join('\n') || 'Profile menu'

  function clearInfoPopoverTimer(): void {
    if (infoPopoverHideTimerRef.current) {
      window.clearTimeout(infoPopoverHideTimerRef.current)
      infoPopoverHideTimerRef.current = null
    }
  }

  function hideStudyModeInfoPopover(): void {
    clearInfoPopoverTimer()
    setInfoPopoverData(null)
  }

  function scheduleHideInfoPopover(): void {
    clearInfoPopoverTimer()
    infoPopoverHideTimerRef.current = window.setTimeout(() => {
      hideStudyModeInfoPopover()
    }, 140)
  }

  function openInfoPopover(key: string, copy: InfoPopoverCopy): void {
    clearInfoPopoverTimer()
    const anchorElement = infoButtonRefs.current[key]

    if (!anchorElement) {
      return
    }

    setInfoPopoverData({
      key,
      copy,
      top: 8,
      left: 8
    })
  }

  function buildInfoButtonProps(key: string, copy: InfoPopoverCopy): InfoButtonProps {
    return {
      ref: (node) => {
        infoButtonRefs.current[key] = node
      },
      onMouseEnter: () => {
        openInfoPopover(key, copy)
      },
      onMouseLeave: () => {
        scheduleHideInfoPopover()
      },
      onFocus: () => {
        openInfoPopover(key, copy)
      },
      onBlur: () => {
        scheduleHideInfoPopover()
      },
      onMouseDown: (event) => {
        event.preventDefault()
      },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          openInfoPopover(key, copy)
        }

        if (event.key === 'Escape') {
          hideStudyModeInfoPopover()
        }
      }
    }
  }

  async function syncStudyModePills(): Promise<void> {
    try {
      const nextStudyModeEnabled = await getStudyMode()
      if (isMountedRef.current) {
        setStudyModeEnabled(nextStudyModeEnabled)
      }
    } catch (error) {
      console.error('Failed to sync Study Mode toggle:', error)
    }
  }

  function showStatusMessage(message: string, tone: StatusTone = 'info'): void {
    setStatusMessage({ text: message, tone })
  }

  function hideStatusMessage(): void {
    setStatusMessage(null)
  }

  function getBannerDismissed(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['bannerDismissed'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(result.bannerDismissed === true)
      })
    })
  }

  function setBannerDismissed(value: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ bannerDismissed: Boolean(value) }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    })
  }

  function hideMigrationHintImmediately(): void {
    if (migrationHintTimerRef.current) {
      window.clearTimeout(migrationHintTimerRef.current)
      migrationHintTimerRef.current = null
    }

    setIsMigrationHintHiding(false)
    setMigrationHintText(null)
  }

  async function dismissMigrationHintWithFade(): Promise<void> {
    try {
      await setBannerDismissed(true)
    } catch (error) {
      console.warn('Failed to save bannerDismissed flag:', error)
    }

    setIsMigrationHintHiding(true)
    migrationHintTimerRef.current = window.setTimeout(() => {
      hideMigrationHintImmediately()
    }, 300)
  }

  async function loadBreakingNotice(): Promise<void> {
    try {
      const notice = await getDataClientApi().getBreakingUpdateNotice()
      if (!notice || !notice.bannerText) {
        if (isMountedRef.current) {
          setBreakingNoticeText(null)
        }
        return
      }

      if (isMountedRef.current) {
        setBreakingNoticeText(notice.bannerText)
      }
    } catch (error) {
      console.warn('Failed to load breaking update notice:', error)
    }
  }

  async function refreshSignedOutHint(isAuthenticated: boolean): Promise<void> {
    try {
      if (isAuthenticated) {
        hideMigrationHintImmediately()
        return
      }

      const summary = await getLocalSummary()
      const bannerDismissed = await getBannerDismissed()
      if (summary.hasLocalData && !bannerDismissed) {
        const count = Number(summary.localVideoCount || 0)
        const unit = count === 1 ? 'timestamp' : 'timestamps'
        if (isMountedRef.current) {
          setMigrationHintText(`${count} local ${unit} found. Sign in to sync.`)
          setIsMigrationHintHiding(false)
        }
      } else {
        hideMigrationHintImmediately()
      }
    } catch (error) {
      console.error('Failed to load local summary:', error)
      hideMigrationHintImmediately()
    }
  }

  async function runMigrationFlow(): Promise<void> {
    const summary = await getLocalSummary()

    if (!summary.hasLocalData) {
      await migrateLocalDataToCloud()
      return
    }

    showStatusMessage(`Found ${summary.localVideoCount} saved timestamps. Syncing to your account.`, 'info')
    await migrateLocalDataToCloud()
    showStatusMessage('Sync complete. Your timestamps are now linked to your account.', 'success')
    await wait(1500)
    hideStatusMessage()
  }

  async function loadStoredCategories(): Promise<Categories> {
    const result = await getCloudData(['categories', 'watchlist'])

    if (result.watchlist && result.watchlist.length > 0) {
      console.log('Migrating data to new format...')
      const nextCategories = { Default: [...result.watchlist] }
      await setCloudData({ categories: nextCategories, watchlist: [] })
      console.log('Data migration completed successfully')
      return nextCategories
    }

    return result.categories || {}
  }

  async function refreshCategories(resetActiveCategory = false): Promise<void> {
    const nextCategories = await loadStoredCategories()

    if (!isMountedRef.current) {
      return
    }

    setCategories(nextCategories)
    if (resetActiveCategory) {
      setActiveCategory('all')
    }
  }

  async function loadDataIntoUI(resetActiveCategory = false): Promise<void> {
    if (isMountedRef.current) {
      setIsLoading(true)
    }

    try {
      await refreshCategories(resetActiveCategory)
    } finally {
      requestAnimationFrame(() => {
        if (isMountedRef.current) {
          setIsLoading(false)
        }
      })
    }
  }

  async function toggleGlobalStudyMode(): Promise<void> {
    const nextValue = !(await getStudyMode())
    await setStudyMode(nextValue)
    await syncStudyModePills()
  }

  async function handleSignIn(): Promise<void> {
    try {
      setButtonsDisabled(true)
      const nextUser = await signInWithGoogleInBackground()
      if (!nextUser) {
        throw new Error('Sign-in did not return user details.')
      }

      try {
        await setBannerDismissed(true)
        hideMigrationHintImmediately()
      } catch (dismissError) {
        console.warn('Failed to persist bannerDismissed after sign-in:', dismissError)
      }

      if (isMountedRef.current) {
        setUser(nextUser)
        setIsProfileDropdownOpen(false)
      }
      hideStudyModeInfoPopover()

      try {
        await runMigrationFlow()
      } catch (migrationError) {
        showStatusMessage('Could not sync local timestamps yet. Your local data is still safe. Please try again.', 'error')
        console.error('Migration failed:', migrationError)
      }

      await loadDataIntoUI(true)
      await syncStudyModePills()
      await refreshSignedOutHint(true)
    } catch (error) {
      handleAuthError('Sign-in failed', error)
      hideStatusMessage()
    } finally {
      if (isMountedRef.current) {
        setButtonsDisabled(false)
      }
    }
  }

  async function handleSignOut(): Promise<void> {
    try {
      setButtonsDisabled(true)
      await signOutInBackground()
      if (isMountedRef.current) {
        setUser(null)
        setIsProfileDropdownOpen(false)
      }
      hideStudyModeInfoPopover()
      await loadDataIntoUI(true)
      await syncStudyModePills()
      await refreshSignedOutHint(false)
      hideStatusMessage()
    } catch (error) {
      handleAuthError('Sign-out failed', error)
    } finally {
      if (isMountedRef.current) {
        setButtonsDisabled(false)
      }
    }
  }

  async function handleAddCategory(name: string): Promise<void> {
    const categoryName = name.trim()
    if (!categoryName) {
      alert('Please enter a category name')
      return
    }

    try {
      const data = await getDataClientApi().get(['categories'])
      const nextCategories = data.categories || {}

      if (nextCategories[categoryName]) {
        alert(`Category "${categoryName}" already exists`)
        return
      }

      nextCategories[categoryName] = []

      await getDataClientApi().set({ categories: nextCategories })
      if (isMountedRef.current) {
        setShowCategoryModal(false)
        setCategoryInputValue('')
      }
      await refreshCategories(false)
      console.log('New category added:', categoryName)
    } catch (error: any) {
      console.error('Failed to add category:', error)
      const details = error?.message || 'Unknown error'
      alert(`Could not add category. ${details}`)
    }
  }

  function handleDeleteCategoryRequest(categoryName: string): void {
    if (PROTECTED_CATEGORY_NAMES.has(String(categoryName || '').trim())) {
      alert(`"${categoryName}" is built in and can't be deleted.`)
      return
    }

    setPendingCategoryDeletion(categoryName)
    setShowDeleteCategoryModal(true)
  }

  async function confirmDeleteCategory(): Promise<void> {
    const categoryName = pendingCategoryDeletion
    if (!categoryName) {
      return
    }

    const nextSelectedCategory = activeCategory === categoryName ? 'all' : activeCategory

    try {
      const data = await getDataClientApi().get(['categories'])
      const nextCategories = data.categories || {}

      if (!Object.prototype.hasOwnProperty.call(nextCategories, categoryName)) {
        if (isMountedRef.current) {
          setShowDeleteCategoryModal(false)
          setPendingCategoryDeletion(null)
          setActiveCategory(nextSelectedCategory)
        }
        await refreshCategories(false)
        return
      }

      const updatedCategories = { ...nextCategories }
      delete updatedCategories[categoryName]

      await getDataClientApi().set({ categories: updatedCategories })

      if (isMountedRef.current) {
        setShowDeleteCategoryModal(false)
        setPendingCategoryDeletion(null)
        setActiveCategory(nextSelectedCategory)
      }
      await refreshCategories(false)
    } catch (error: any) {
      console.error('Failed to delete category:', error)
      const details = error?.message || 'Unknown error'
      alert(`Could not delete category. ${details}`)
    }
  }

  async function assignVideoToSingleCategory(video: VideoEntry, targetCategory: string): Promise<void> {
    const result = await getCloudData(['categories'])
    const nextCategories = result.categories || {}

    if (!nextCategories[targetCategory]) {
      nextCategories[targetCategory] = []
    }

    Object.keys(nextCategories).forEach((categoryName) => {
      nextCategories[categoryName] = nextCategories[categoryName].filter(
        (candidateVideo) => !(candidateVideo.videoId === video.videoId && candidateVideo.timestamp === video.timestamp)
      )
    })

    nextCategories[targetCategory].push(video)

    await setCloudData({ categories: nextCategories })
    await refreshCategories(false)
    if (isMountedRef.current) {
      setOpenDropdownKey(`${video.videoId}-${video.timestamp}`)
    }
  }

  async function toggleVideoStudyMode(video: VideoEntry, category: string): Promise<void> {
    const result = await getCloudData(['categories'])
    const nextCategories = result.categories || {}
    const videos = Array.isArray(nextCategories[category]) ? nextCategories[category] : []
    const targetVideoIndex = videos.findIndex((candidateVideo) => candidateVideo.videoId === video.videoId)
    const targetVideo = targetVideoIndex === -1 ? null : videos[targetVideoIndex]

    if (!targetVideo) {
      return
    }

    try {
      const globalStudyMode = await getStudyMode()
      const currentStudyMode = resolveLegacyVideoStudyMode(targetVideo, globalStudyMode)
      const updatedVideo = setLegacyVideoStudyMode(targetVideo, !currentStudyMode)

      if (!updatedVideo) {
        return
      }

      videos[targetVideoIndex] = updatedVideo
      await setCloudData({ categories: nextCategories })
      await refreshCategories(false)

      if (isMountedRef.current) {
        setOpenDropdownKey(`${video.videoId}-${video.timestamp}`)
      }
    } catch (error) {
      console.error('Failed to read Study Mode preference while updating a video:', error)
    }
  }

  async function saveVideoNote(category: string, videoId: string, savedAt: number, nextNote: string): Promise<void> {
    const trimmedNote = String(nextNote || '').trim()
    const result = await getCloudData(['categories'])
    const nextCategories = result.categories || {}
    const videos = Array.isArray(nextCategories[category]) ? nextCategories[category] : []
    const targetVideo = videos.find((candidateVideo) => candidateVideo.videoId === videoId)

    if (!targetVideo) {
      return
    }

    const targetEntry = getNormalizedVideoTimestampEntries(targetVideo).find((entry) => entry.savedAt === savedAt)
    if (!targetEntry) {
      return
    }

    targetEntry.note = trimmedNote
    targetVideo.timestamps = getNormalizedVideoTimestampEntries(targetVideo).map((entry) =>
      entry.savedAt === savedAt ? { ...entry, note: trimmedNote } : entry
    )

    await setCloudData({ categories: nextCategories })
    await refreshCategories(false)
  }

  async function removeVideoFromWatchlist(videoToRemove: VideoEntry): Promise<void> {
    const result = await getCloudData(['categories'])
    const nextCategories = result.categories || {}
    let didRemoveTimestamp = false

    Object.keys(nextCategories).forEach((categoryName) => {
      const videos = Array.isArray(nextCategories[categoryName]) ? nextCategories[categoryName] : []
      const filteredVideos = videos.filter((candidateVideo) => candidateVideo.videoId !== videoToRemove.videoId)

      if (filteredVideos.length !== videos.length) {
        didRemoveTimestamp = true
        nextCategories[categoryName] = filteredVideos
      }
    })

    if (!didRemoveTimestamp) {
      return
    }

    await setCloudData({ categories: nextCategories })
    await refreshCategories(false)

    if (isMountedRef.current) {
      setUndoVideo(videoToRemove)
      setOpenDropdownKey(null)
      setEditingNoteKey(null)
    }
  }

  async function restoreVideo(video: VideoEntry): Promise<void> {
    const result = await getCloudData(['categories'])
    const nextCategories = result.categories || {}

    if (!nextCategories.Default) {
      nextCategories.Default = []
    }

    const exists = nextCategories.Default.some(
      (candidateVideo) => candidateVideo.videoId === video.videoId && candidateVideo.timestamp === video.timestamp
    )

    if (!exists) {
      nextCategories.Default.push(video)
      await setCloudData({ categories: nextCategories })
      await refreshCategories(false)
    }
  }

  useLayoutEffect(() => {
    if (!infoPopoverData || !infoPopoverRef.current) {
      return
    }

    const anchorElement = infoButtonRefs.current[infoPopoverData.key]
    if (!anchorElement) {
      setInfoPopoverData(null)
      return
    }

    const nextPosition = positionInfoPopover(anchorElement, infoPopoverRef.current)
    if (nextPosition.top !== infoPopoverData.top || nextPosition.left !== infoPopoverData.left) {
      setInfoPopoverData((current) => {
        if (!current) {
          return current
        }
        return {
          ...current,
          ...nextPosition
        }
      })
    }
  }, [infoPopoverData])

  useEffect(() => {
    if (!infoPopoverData) {
      return
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      if (infoPopoverRef.current?.contains(target)) {
        return
      }

      if (target.closest('.info-btn')) {
        return
      }

      hideStudyModeInfoPopover()
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [infoPopoverData])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('#study-mode-info-popover')) {
        return
      }
      if (!target.closest('.video-actions')) {
        setOpenDropdownKey(null)
        const anchorElement = infoPopoverData ? infoButtonRefs.current[infoPopoverData.key] : null
        if (anchorElement && anchorElement.closest('.dropdown-menu')) {
          hideStudyModeInfoPopover()
        }
      }
    }

    document.addEventListener('click', handleDocumentClick)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [infoPopoverData])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('#study-mode-info-popover')) {
        return
      }
      if (!target.closest('#profile-btn-wrapper')) {
        setIsProfileDropdownOpen(false)
        const anchorElement = infoPopoverData ? infoButtonRefs.current[infoPopoverData.key] : null
        if (anchorElement && anchorElement.closest('#profile-btn-wrapper')) {
          hideStudyModeInfoPopover()
        }
      }
    }

    document.addEventListener('click', handleDocumentClick)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [infoPopoverData])

  useEffect(() => {
    const watchlistElement = watchlistContainerRef.current
    const handleScroll = () => {
      hideStudyModeInfoPopover()
    }

    watchlistElement?.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })

    return () => {
      watchlistElement?.removeEventListener('scroll', handleScroll)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  useEffect(() => {
    if (showCategoryModal) {
      categoryInputRef.current?.focus()
    }
  }, [showCategoryModal])

  useEffect(() => {
    if (showDeleteCategoryModal) {
      confirmDeleteCategoryRef.current?.focus()
    }
  }, [showDeleteCategoryModal])

  useEffect(() => {
    if (!editingNoteKey || !noteInputRef.current) {
      return
    }

    noteInputRef.current.focus()
    noteInputRef.current.setSelectionRange(noteInputRef.current.value.length, noteInputRef.current.value.length)
    autoSizeTextarea(noteInputRef.current)
  }, [editingNoteKey])

  useEffect(() => {
    if (activeCategory !== 'all' && !categories[activeCategory]) {
      setActiveCategory('all')
    }
  }, [activeCategory, categories])

  useEffect(() => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }

    if (!undoVideo) {
      return
    }

    undoTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setUndoVideo(null)
      }
    }, UNDO_DURATION_MS)

    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current)
        undoTimerRef.current = null
      }
    }
  }, [undoVideo])

  useEffect(() => {
    if (!infoPopoverData) {
      return
    }

    const anchorElement = infoButtonRefs.current[infoPopoverData.key]
    if (!anchorElement || !anchorElement.isConnected) {
      hideStudyModeInfoPopover()
    }
  }, [categories, infoPopoverData, isProfileDropdownOpen, openDropdownKey])

  useEffect(() => {
    setOpenDropdownKey(null)
    setEditingNoteKey(null)
    hideStudyModeInfoPopover()
  }, [activeCategory])

  useEffect(() => {
    isMountedRef.current = true

    async function initialize(): Promise<void> {
      let authenticated = false

      try {
        await waitForDataLayer()
        const authStatus = await runtimeRequest({ type: 'AUTH_STATUS' })
        const nextUser = authStatus.authenticated ? authStatus.user : null
        authenticated = Boolean(nextUser)

        if (isMountedRef.current) {
          setUser(nextUser)
        }

        await loadDataIntoUI(true)
        await syncStudyModePills()
      } catch (error) {
        console.error('Failed to load auth status', error)
        try {
          await signOutInBackground()
        } catch (signOutError) {
          console.warn('Failed clearing background auth session:', signOutError)
        }

        if (isMountedRef.current) {
          setUser(null)
        }

        await loadDataIntoUI(true)
        await syncStudyModePills()
      } finally {
        await loadBreakingNotice()
        await refreshSignedOutHint(authenticated)
      }
    }

    void initialize()

    return () => {
      isMountedRef.current = false
      clearInfoPopoverTimer()
      if (migrationHintTimerRef.current) {
        window.clearTimeout(migrationHintTimerRef.current)
      }
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current)
      }
    }
  }, [])

  const infoPopover =
    infoPopoverData && document.body
      ? createPortal(
        <div
          id="study-mode-info-popover"
          ref={infoPopoverRef}
          style={{ top: `${infoPopoverData.top}px`, left: `${infoPopoverData.left}px` }}
          onMouseEnter={clearInfoPopoverTimer}
          onMouseLeave={scheduleHideInfoPopover}
        >
          <div className="info-popover-title">{infoPopoverData.copy.title}</div>
          <div className="info-popover-body">{infoPopoverData.copy.body}</div>
          {Array.isArray(infoPopoverData.copy.examples)
            ? infoPopoverData.copy.examples.map((exampleText) => (
              <div key={exampleText} className="info-popover-example">
                {exampleText}
              </div>
            ))
            : null}
          <div className="info-popover-footer">{infoPopoverData.copy.footer}</div>
        </div>,
        document.body
      )
      : null

  return (
    <>
      <div className="container">
        <Header
          user={user}
          onSignIn={() => {
            void handleSignIn()
          }}
          onSignOut={() => {
            void handleSignOut()
          }}
          isDisabled={buttonsDisabled}
          isProfileDropdownOpen={isProfileDropdownOpen}
          profileTooltip={profileTooltip}
          studyModeEnabled={studyModeEnabled}
          profileButtonWrapperRef={profileButtonWrapperRef}
          onToggleProfileDropdown={(event) => {
            event.stopPropagation()
            setOpenDropdownKey(null)
            if (isProfileDropdownOpen) {
              setIsProfileDropdownOpen(false)
              hideStudyModeInfoPopover()
              return
            }

            setIsProfileDropdownOpen(true)
            void syncStudyModePills()
          }}
          onToggleStudyMode={(event) => {
            event.stopPropagation()
            void toggleGlobalStudyMode().catch((error) => {
              handleAuthError('Could not update Study Mode', error)
            })
          }}
          signedInInfoButtonProps={buildInfoButtonProps('profile-in', STUDY_MODE_GLOBAL_INFO_COPY)}
          signedOutInfoButtonProps={buildInfoButtonProps('profile-out', STUDY_MODE_GLOBAL_INFO_COPY)}
        />

        <div className="main-content">
          <BreakingNoticeBanner
            text={breakingNoticeText}
            onDismiss={() => {
              setBreakingNoticeText(null)
              void getDataClientApi().dismissBreakingUpdateNotice().catch((error: unknown) => {
                console.warn('Failed to dismiss breaking update notice:', error)
              })
            }}
          />
          <StatusMessage message={statusMessage} />
          <MigrationHint
            text={migrationHintText}
            isHiding={isMigrationHintHiding}
            onDismiss={() => {
              void dismissMigrationHintWithFade()
            }}
          />

          <main>
            <div className={`categories-container${isLoading ? ' is-loading' : ''}`}>
              <LoadingState isLoading={isLoading} />
              <CategoryList
                categories={categories}
                activeCategory={activeCategory}
                isEditMode={isEditMode}
                onSelectCategory={(category) => {
                  setActiveCategory(category)
                }}
                onAddCategory={() => {
                  setCategoryInputValue('')
                  setShowCategoryModal(true)
                }}
                onToggleEditMode={() => {
                  setIsEditMode((current) => !current)
                }}
                onDeleteCategory={handleDeleteCategoryRequest}
              />
              <div id="watchlist-container" ref={watchlistContainerRef}>
                <ul id="watchlist">
                  {totalVideos === 0 || visibleVideos.length === 0
                    ? (
                      <EmptyState />
                    )
                    : (
                      visibleVideos.map(({ category, video }) => (
                        <WatchlistItem
                          key={`${video.videoId}-${video.timestamp}`}
                          video={video}
                          category={category}
                          categories={categories}
                          isDropdownOpen={openDropdownKey === `${video.videoId}-${video.timestamp}`}
                          globalStudyMode={studyModeEnabled}
                          isExpanded={expandedStudyVideos.has(video.videoId)}
                          editingNoteKey={editingNoteKey}
                          noteDraft={noteDraft}
                          noteInputRef={(node) => {
                            noteInputRef.current = node
                          }}
                          studyModeInfoButtonProps={buildInfoButtonProps(
                            `video-${video.videoId}-${video.timestamp}`,
                            STUDY_MODE_VIDEO_INFO_COPY
                          )}
                          onOpenVideo={openVideo}
                          onToggleDropdown={(key) => {
                            setIsProfileDropdownOpen(false)
                            hideStudyModeInfoPopover()
                            setOpenDropdownKey((current) => (current === key ? null : key))
                          }}
                          onDelete={(targetVideo) => {
                            hideStudyModeInfoPopover()
                            void removeVideoFromWatchlist(targetVideo)
                          }}
                          onCategoryChange={(targetVideo, targetCategory) => {
                            void assignVideoToSingleCategory(targetVideo, targetCategory)
                          }}
                          onToggleStudyMode={(targetVideo, targetCategory) => {
                            hideStudyModeInfoPopover()
                            void toggleVideoStudyMode(targetVideo, targetCategory)
                          }}
                          onToggleExpand={(videoId) => {
                            setExpandedStudyVideos((current) => {
                              const next = new Set(current)
                              if (next.has(videoId)) {
                                next.delete(videoId)
                              } else {
                                next.add(videoId)
                              }
                              return next
                            })
                          }}
                          onStartNoteEdit={(targetVideo, targetCategory, savedAt, note) => {
                            setOpenDropdownKey(null)
                            setEditingNoteKey(`${targetVideo.videoId}-${savedAt}`)
                            setNoteDraft(note)
                          }}
                          onNoteDraftChange={(value, textarea) => {
                            setNoteDraft(value)
                            autoSizeTextarea(textarea)
                          }}
                          onFinishNoteEdit={(targetVideo, targetCategory, savedAt, nextNote, shouldSave) => {
                            setEditingNoteKey(null)
                            setNoteDraft('')
                            if (shouldSave) {
                              void saveVideoNote(targetCategory, targetVideo.videoId, savedAt, nextNote)
                            }
                          }}
                        />
                      ))
                    )}
                </ul>
              </div>
            </div>
          </main>

          <footer>
            <div className="footer-container">
              <div className="footer-text">
                <div>Love to test out our mobile app?</div>
                <a
                  href="https://app.youform.com/forms/izw2jg5v"
                  className="get-in-touch"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Let me know!
                </a>
              </div>
              <div>•</div>
              <div>v1.4.0</div>
            </div>
          </footer>
        </div>
      </div>

      <CategoryModal
        isOpen={showCategoryModal}
        value={categoryInputValue}
        inputRef={categoryInputRef}
        onSave={(name) => {
          void handleAddCategory(name)
        }}
        onClose={() => {
          setShowCategoryModal(false)
        }}
        onChange={setCategoryInputValue}
      />

      <DeleteCategoryModal
        isOpen={showDeleteCategoryModal}
        categoryName={pendingCategoryDeletion}
        confirmButtonRef={confirmDeleteCategoryRef}
        onConfirm={() => {
          void confirmDeleteCategory()
        }}
        onClose={() => {
          setShowDeleteCategoryModal(false)
          setPendingCategoryDeletion(null)
        }}
      />

      <UndoNotification
        isVisible={Boolean(undoVideo)}
        animationKey={undoVideo ? `${undoVideo.videoId}-${undoVideo.timestamp}` : 'hidden'}
        onUndo={() => {
          if (!undoVideo) {
            return
          }

          if (undoTimerRef.current) {
            window.clearTimeout(undoTimerRef.current)
            undoTimerRef.current = null
          }
          void restoreVideo(undoVideo)
          setUndoVideo(null)
        }}
        onTimerEnd={() => {
          if (undoTimerRef.current) {
            window.clearTimeout(undoTimerRef.current)
            undoTimerRef.current = null
          }
          setUndoVideo(null)
        }}
      />

      {infoPopover}
    </>
  )
}
