interface UndoNotificationProps {
  isVisible: boolean
  animationKey: string
  onUndo: () => void
  onTimerEnd: () => void
}

const UNDO_DURATION_SECONDS = 30

export default function UndoNotification({
  isVisible,
  animationKey,
  onUndo,
  onTimerEnd
}: UndoNotificationProps): JSX.Element | null {
  if (!isVisible) {
    return null
  }

  return (
    <div className="undo-notification">
      <span className="notification-text">Timestamp deleted</span>
      <button
        key={animationKey}
        className="undo-button"
        type="button"
        onClick={onUndo}
        style={{ animation: `undoStrokeCountdown ${UNDO_DURATION_SECONDS}s linear forwards` }}
      >
        <span className="undo-button-label">Undo</span>
        <div
          key={animationKey}
          className="undo-timer"
          style={{ animation: `timerCountdown ${UNDO_DURATION_SECONDS}s linear forwards`, display: 'block' }}
          onAnimationEnd={onTimerEnd}
        >
          <div className="undo-timer-fill"></div>
        </div>
      </button>
    </div>
  )
}
