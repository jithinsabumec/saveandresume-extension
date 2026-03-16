import instructionsUrl from '../../instructions.svg'

export default function EmptyState(): JSX.Element {
  return (
    <div className="empty-state-text">
      <img src={instructionsUrl} alt="instructions" className="empty-state-icon" width="300" draggable="false" />
    </div>
  )
}
