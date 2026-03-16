interface BreakingNoticeBannerProps {
  text: string | null
  onDismiss: () => void
}

export default function BreakingNoticeBanner({ text, onDismiss }: BreakingNoticeBannerProps): JSX.Element {
  return (
    <div
      style={{
        display: text ? 'flex' : 'none',
        background: '#33240f',
        border: '1px solid #6e4f22',
        color: '#f6d9a6',
        borderRadius: '8px',
        fontSize: '12px',
        lineHeight: '1.4',
        padding: '10px 12px',
        marginBottom: '12px',
        gap: '8px',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <span>{text || ''}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: '#6e4f22',
          border: 'none',
          borderRadius: '999px',
          color: '#fff',
          fontSize: '11px',
          padding: '4px 10px',
          cursor: 'pointer'
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
