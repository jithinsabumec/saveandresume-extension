interface MigrationHintProps {
  text: string | null
  isHiding: boolean
  onDismiss: () => void
}

export default function MigrationHint({ text, isHiding, onDismiss }: MigrationHintProps): JSX.Element {
  return (
    <div
      className={`local-sync-banner${isHiding ? ' is-hiding' : ''}`}
      style={{ display: text || isHiding ? 'flex' : 'none' }}
    >
      <span className="local-sync-banner-text">{text || ''}</span>
      <button
        type="button"
        className="local-sync-banner-dismiss"
        aria-label="Dismiss local sync banner"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}
