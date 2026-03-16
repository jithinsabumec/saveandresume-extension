import type React from 'react'

export interface VideoTimestampEntry {
  time: number
  note: string
  savedAt: number
}

export interface VideoEntry {
  videoId: string
  title: string
  currentTime: number
  thumbnail: string
  timestamp: number
  studyMode?: boolean
  studyModeOverridden?: boolean
  timestamps?: VideoTimestampEntry[]
}

export interface Categories {
  [categoryName: string]: VideoEntry[]
}

export interface StorageResult {
  categories?: Categories
  watchlist?: VideoEntry[]
}

export interface AuthUser {
  uid: string
  displayName: string
  email: string
  photoURL: string
}

export interface LocalSummary {
  hasLocalData: boolean
  localVideoCount: number
}

export interface BreakingNotice {
  bannerText: string
}

export interface InfoPopoverCopy {
  title: string
  body: string
  examples: string[]
  footer: string
}

export interface InfoButtonProps {
  ref: (node: HTMLSpanElement | null) => void
  onMouseEnter: React.MouseEventHandler<HTMLSpanElement>
  onMouseLeave: React.MouseEventHandler<HTMLSpanElement>
  onFocus: React.FocusEventHandler<HTMLSpanElement>
  onBlur: React.FocusEventHandler<HTMLSpanElement>
  onMouseDown: React.MouseEventHandler<HTMLSpanElement>
  onClick: React.MouseEventHandler<HTMLSpanElement>
  onKeyDown: React.KeyboardEventHandler<HTMLSpanElement>
}

export type StatusTone = 'info' | 'success' | 'error'

export type DropdownMenuState = {
  videoId: string
  timestamp: number
} | null
