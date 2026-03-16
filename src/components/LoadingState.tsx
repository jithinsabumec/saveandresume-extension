interface LoadingStateProps {
  isLoading: boolean
}

export default function LoadingState({ isLoading }: LoadingStateProps): JSX.Element {
  return (
    <div
      id="data-loading-state"
      className="data-loading-state"
      role="status"
      aria-live="polite"
      aria-hidden={isLoading ? 'false' : 'true'}
    >
      <div className="loading-spinner" aria-hidden="true"></div>
      <div className="data-loading-text">Loading timestamps...</div>
    </div>
  )
}
