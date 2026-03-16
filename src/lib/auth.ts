export function runtimeRequest(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!response || response.ok !== true) {
        reject(new Error(response?.error || 'UNKNOWN_ERROR'))
        return
      }

      resolve(response)
    })
  })
}

export async function signInWithGoogleInBackground(): Promise<any> {
  const response = await runtimeRequest({ type: 'AUTH_SIGN_IN' })
  return response.user || null
}

export async function signOutInBackground(): Promise<void> {
  await runtimeRequest({ type: 'AUTH_SIGN_OUT' })
}

export function handleAuthError(message: string, error: any): void {
  console.error(message, error)
  const details = error?.message || 'Unknown error'

  if (details.includes('Missing or insufficient permissions')) {
    alert(`${message}: Firestore permission denied. Update Firestore Security Rules so authenticated users can read/write only their own data (users/{uid}/...).`)
    return
  }

  alert(`${message}: ${details}`)
}
