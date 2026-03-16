import type React from 'react'
import { formatTime } from '../lib/format'
import { track } from '../lib/analytics'
import { safeThumbnailUrl } from '../lib/escape'
import { resolveLegacyVideoStudyMode } from '../lib/storage'
import type { Categories, InfoButtonProps, VideoEntry, VideoTimestampEntry } from '../types'
import VideoCard from './VideoCard'
import DropdownMenu from './DropdownMenu'
import menuUrl from '../../menu.svg'
import timestampUrl from '../../timestamp.svg'

interface WatchlistItemProps {
  video: VideoEntry
  category: string
  categories: Categories
  isDropdownOpen: boolean
  globalStudyMode: boolean
  isExpanded: boolean
  editingNoteKey: string | null
  noteDraft: string
  noteInputRef: React.RefCallback<HTMLTextAreaElement>
  studyModeInfoButtonProps: InfoButtonProps
  onOpenVideo: (videoId: string, currentTime: number, isStudyMode?: boolean) => void
  onToggleDropdown: (key: string) => void
  onDelete: (video: VideoEntry, category: string) => void
  onCategoryChange: (video: VideoEntry, targetCategory: string) => void
  onToggleStudyMode: (video: VideoEntry, category: string) => void
  onToggleExpand: (videoId: string) => void
  onStartNoteEdit: (video: VideoEntry, category: string, savedAt: number, note: string) => void
  onNoteDraftChange: (value: string, textarea: HTMLTextAreaElement | null) => void
  onFinishNoteEdit: (
    video: VideoEntry,
    category: string,
    savedAt: number,
    nextNote: string,
    shouldSave: boolean,
    originalNoteValue: string
  ) => void
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

function getVideoTimestampEntries(video: VideoEntry): VideoTimestampEntry[] {
  return getNormalizedVideoTimestampEntries(video).sort((left, right) => {
    if (left.time !== right.time) {
      return left.time - right.time
    }
    return left.savedAt - right.savedAt
  })
}

function getLatestTimestampEntry(video: VideoEntry): VideoTimestampEntry | null {
  const entries = getNormalizedVideoTimestampEntries(video)
  return entries.reduce<VideoTimestampEntry | null>((latest, entry) => {
    if (!latest) {
      return entry
    }

    return entry.savedAt >= latest.savedAt ? entry : latest
  }, null)
}

export default function WatchlistItem({
  video,
  category,
  categories,
  isDropdownOpen,
  globalStudyMode,
  isExpanded,
  editingNoteKey,
  noteDraft,
  noteInputRef,
  studyModeInfoButtonProps,
  onOpenVideo,
  onToggleDropdown,
  onDelete,
  onCategoryChange,
  onToggleStudyMode,
  onToggleExpand,
  onStartNoteEdit,
  onNoteDraftChange,
  onFinishNoteEdit
}: WatchlistItemProps): JSX.Element {
  const latestTimestampEntry = getLatestTimestampEntry(video)
  const effectiveTime = Math.max(0, Number(video.currentTime) || latestTimestampEntry?.time || 0)
  const isStudyMode = resolveLegacyVideoStudyMode(video, globalStudyMode)
  const isExpandedForRender = isStudyMode && isExpanded
  const timestampEntries = getVideoTimestampEntries(video)
  const itemKey = `${video.videoId}-${video.timestamp}`
  const studyModeInfoButtonId = `study-mode-info-btn-video-${String(video.videoId || 'video')}-${String(video.timestamp || 0)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-'
  )

  let selectedCategory: string | null = null
  Object.keys(categories)
    .sort((left, right) => left.localeCompare(right))
    .forEach((categoryName) => {
      const videoInCategory = categories[categoryName].some(
        (candidateVideo) => candidateVideo.videoId === video.videoId && candidateVideo.timestamp === video.timestamp
      )
      if (!selectedCategory && videoInCategory) {
        selectedCategory = categoryName
      }
    })

  return (
    <li
      className={`watchlist-item${isExpandedForRender ? ' is-expanded' : ''}`}
      data-video-id={video.videoId}
      data-timestamp={video.timestamp}
    >
      <VideoCard
        title={video.title || 'Untitled video'}
        thumbnail={safeThumbnailUrl(video.thumbnail)}
        isStudyMode={isStudyMode}
        isExpanded={isExpandedForRender}
        timestampText={formatTime(effectiveTime)}
        onOpenVideo={() => onOpenVideo(video.videoId, effectiveTime, isStudyMode)}
        onToggleExpand={(event) => {
          event.stopPropagation()
          const willExpand = !isExpanded
          if (willExpand) {
            const entries = getVideoTimestampEntries(video)
            track('card_expanded', {
              has_notes: entries.some((entry) => entry.note && entry.note.length > 0),
              timestamp_count: entries.length
            })
          } else {
            track('card_collapsed')
          }
          onToggleExpand(video.videoId)
        }}
      >
        <button
          className="three-dot-menu"
          type="button"
          title="More options"
          onClick={(event) => {
            event.stopPropagation()
            onToggleDropdown(itemKey)
          }}
        >
          <img src={menuUrl} width="20" height="20" alt="Menu" />
        </button>
        <DropdownMenu
          categories={categories}
          videoId={video.videoId}
          timestamp={video.timestamp}
          isOpen={isDropdownOpen}
          selectedCategory={selectedCategory}
          isStudyMode={isStudyMode}
          studyModeInfoButtonId={studyModeInfoButtonId}
          studyModeInfoButtonProps={studyModeInfoButtonProps}
          onSelectCategory={(targetCategory) => onCategoryChange(video, targetCategory)}
          onToggleStudyMode={(event) => {
            event.stopPropagation()
            if ((event.target as HTMLElement).closest('.info-btn')) {
              return
            }
            track('study_mode_toggled', {
              scope: 'per_video',
              new_state: !isStudyMode
            })
            onToggleStudyMode(video, category)
          }}
          onDelete={(event) => {
            event.stopPropagation()
            onDelete(video, category)
          }}
        />
      </VideoCard>
      {isStudyMode ? (
        <div className={`expanded-rows${isExpanded ? ' is-visible' : ''}`} hidden={!isExpanded}>
          {timestampEntries.map((entry) => {
            const noteKey = `${video.videoId}-${entry.savedAt}`
            const isEditing = editingNoteKey === noteKey
            const noteText = String(entry.note || '').trim()
            const displayText = noteText || 'Add a note...'

            return (
              <div key={entry.savedAt} className="timestamp-row" data-saved-at={entry.savedAt} onClick={(event) => event.stopPropagation()}>
                <button
                  className="timestamp-row-time"
                  type="button"
                  data-time={entry.time}
                  title="Jump to timestamp"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenVideo(video.videoId, Number((event.currentTarget as HTMLButtonElement).dataset.time || 0), isStudyMode)
                  }}
                >
                  <img src={timestampUrl} className="timestamp-icon" alt="timestamp" width="10" height="10" />
                  <span className="timestamp-value">{formatTime(entry.time)}</span>
                </button>
                {isEditing ? (
                  <textarea
                    ref={noteInputRef}
                    className="note-input"
                    value={noteDraft}
                    placeholder="Add a note..."
                    rows={1}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => {
                      const wasEmpty = noteText.trim().length === 0
                      if (noteDraft.trim() !== noteText.trim()) {
                        track('note_edited', { was_empty: wasEmpty })
                      }
                      onFinishNoteEdit(video, category, entry.savedAt, noteDraft, true, noteText)
                    }}
                    onChange={(event) => onNoteDraftChange(event.target.value, event.target)}
                    onKeyDown={(event) => {
                      event.stopPropagation()

                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        const wasEmpty = noteText.trim().length === 0
                        if (noteDraft.trim() !== noteText.trim()) {
                          track('note_edited', { was_empty: wasEmpty })
                        }
                        onFinishNoteEdit(video, category, entry.savedAt, noteDraft, true, noteText)
                        return
                      }

                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault()
                        onFinishNoteEdit(video, category, entry.savedAt, noteDraft, true, noteText)
                        return
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault()
                        onFinishNoteEdit(video, category, entry.savedAt, noteText, false, noteText)
                      }
                    }}
                  ></textarea>
                ) : (
                  <button
                    className={`note-display${noteText ? '' : ' is-placeholder'}`}
                    type="button"
                    data-note-value={noteText}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStartNoteEdit(video, category, entry.savedAt, noteText)
                    }}
                  >
                    {displayText}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </li>
  )
}
