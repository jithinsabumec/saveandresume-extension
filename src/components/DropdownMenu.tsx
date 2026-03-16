import type React from 'react'
import type { Categories, InfoButtonProps } from '../types'
import deleteUrl from '../../delete.svg'
import studyModeIconUrl from '../../study-mode-icon.svg'
import infoUrl from '../../Info.svg'

interface DropdownMenuProps {
  categories: Categories
  videoId: string
  timestamp: number
  isOpen: boolean
  selectedCategory: string | null
  isStudyMode: boolean
  studyModeInfoButtonId: string
  studyModeInfoButtonProps: InfoButtonProps
  onSelectCategory: (category: string) => void
  onToggleStudyMode: (event: React.MouseEvent<HTMLButtonElement>) => void
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void
}

const selectedIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><path fill="#1FA700" d="M3.359 6L0 2.64l.947-.947 2.412 2.407L9.053 0 10 .947 3.359 6Z"/></svg>'

export default function DropdownMenu({
  categories,
  isOpen,
  selectedCategory,
  isStudyMode,
  studyModeInfoButtonId,
  studyModeInfoButtonProps,
  onSelectCategory,
  onToggleStudyMode,
  onDelete
}: DropdownMenuProps): JSX.Element {
  return (
    <div className="dropdown-menu" style={{ display: isOpen ? 'block' : 'none' }} onClick={(event) => event.stopPropagation()}>
      <div className="menu-section">
        <div className="category-options">
          {Object.keys(categories)
            .sort((left, right) => left.localeCompare(right))
            .map((category) => (
              <button
                key={category}
                type="button"
                className={`category-option${selectedCategory === category ? ' selected' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (selectedCategory === category) {
                    return
                  }
                  onSelectCategory(category)
                }}
              >
                <span className="category-check" dangerouslySetInnerHTML={{ __html: selectedIcon }}></span>
                <span className="menu-category-name">{category}</span>
              </button>
            ))}
        </div>
      </div>
      <div className="menu-divider"></div>
      <button className="menu-item study-mode-menu-item" type="button" onClick={onToggleStudyMode}>
        <span className="profile-menu-leading study-mode-leading">
          <img src={studyModeIconUrl} width="12" height="12" alt="" />
          <span>Study Mode</span>
          <span
            id={studyModeInfoButtonId}
            className="info-btn study-mode-info-btn"
            role="button"
            tabIndex={0}
            aria-label="Study Mode for this video"
            title="Study Mode for this video"
            {...studyModeInfoButtonProps}
          >
            <img src={infoUrl} width="14" height="14" alt="" aria-hidden="true" />
          </span>
        </span>
        <span className="study-mode-controls">
          <span
            className={`study-mode-pill ${isStudyMode ? 'is-on' : 'is-off'}`}
            aria-hidden="true"
            data-state={isStudyMode ? 'on' : 'off'}
          ></span>
        </span>
      </button>
      <div className="menu-divider"></div>
      <button className="menu-item delete-item" type="button" onClick={onDelete}>
        <img src={deleteUrl} alt="Delete" />
        Delete
      </button>
    </div>
  )
}
