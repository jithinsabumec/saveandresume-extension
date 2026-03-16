import type React from 'react'
import timestampUrl from '../../timestamp.svg'
import studyModeChevronUrl from '../../study-mode-chevron.svg'

interface VideoCardProps {
  title: string
  thumbnail: string
  isStudyMode: boolean
  isExpanded: boolean
  timestampText: string
  onOpenVideo: () => void
  onToggleExpand: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}

export default function VideoCard({
  title,
  thumbnail,
  isStudyMode,
  isExpanded,
  timestampText,
  onOpenVideo,
  onToggleExpand,
  children
}: VideoCardProps): JSX.Element {
  return (
    <div className="watchlist-card-header" onClick={onOpenVideo}>
      <div className="thumbnail-wrapper">
        <img className="thumbnail" src={thumbnail} alt={title} />
      </div>
      <div className="video-info">
        <h3 className="video-title">{title}</h3>
        {isStudyMode ? (
          <button className={`expand-btn${isExpanded ? ' is-expanded' : ''}`} type="button" onClick={onToggleExpand}>
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
            <img src={studyModeChevronUrl} className="expand-btn-chevron" alt="" width="8" height="8" />
          </button>
        ) : (
          <div className="video-timestamp">
            <img src={timestampUrl} className="timestamp-icon" alt="timestamp" width="10" height="10" />
            <span className="timestamp-value">{timestampText}</span>
          </div>
        )}
      </div>
      <div className="video-actions">{children}</div>
    </div>
  )
}
