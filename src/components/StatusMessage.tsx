import type React from 'react'
import type { StatusTone } from '../types'

interface StatusMessageProps {
  message: { text: string; tone: StatusTone } | null
}

export default function StatusMessage({ message }: StatusMessageProps): JSX.Element {
  const style: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '1.4',
    borderRadius: '6px',
    padding: '8px 10px',
    marginBottom: '10px',
    display: message ? 'block' : 'none'
  }

  if (message?.tone === 'error') {
    style.background = '#3a1a21'
    style.border = '1px solid #7d2e41'
    style.color = '#ffc9d5'
  } else if (message?.tone === 'success') {
    style.background = '#183224'
    style.border = '1px solid #2b6a49'
    style.color = '#b8f7cf'
  } else {
    style.background = '#1d2a3a'
    style.border = '1px solid #385a7b'
    style.color = '#d5e8ff'
  }

  return <div style={style}>{message?.text || ''}</div>
}
