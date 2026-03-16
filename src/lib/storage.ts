import type { LocalSummary } from '../types'

let dataClientInstance: any = null

function getSaveResumeDataLayer(): any {
  const saveResumeDataLayer = (globalThis as any).SaveResumeDataLayer

  if (!saveResumeDataLayer) {
    throw new Error('SaveResumeDataLayer is not available yet.')
  }

  return saveResumeDataLayer
}

function getDataClient(): any {
  if (!dataClientInstance) {
    dataClientInstance = getSaveResumeDataLayer().createClientDataLayer()
  }

  return dataClientInstance
}

function getDataLayerHelpers(): any {
  return getSaveResumeDataLayer().helpers
}

export async function waitForDataLayer(timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const startTime = Date.now()

  while (!(globalThis as any).SaveResumeDataLayer) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('SaveResumeDataLayer did not become available in time.')
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }
}

export const cloudStorage = {
  get(keys: string[], callback: (result: any) => void): void {
    getDataClient()
      .get(keys)
      .then((data: any) => callback(data || {}))
      .catch((error: any) => {
        console.error('Failed to fetch timestamp data:', error)
        callback({})
      })
  },
  set(data: any, callback?: () => void): void {
    getDataClient()
      .set(data)
      .then(() => {
        if (typeof callback === 'function') callback()
      })
      .catch((error: any) => {
        console.error('Failed to save timestamp data:', error)
      })
  }
}

export async function getLocalSummary(): Promise<LocalSummary> {
  return getDataClient().getLocalSummary()
}

export async function migrateLocalDataToCloud(): Promise<void> {
  return getDataClient().migrateLocalDataToCloud()
}

export function resolveLegacyVideoStudyMode(video: any, globalStudyMode = false): boolean {
  return getDataLayerHelpers().resolveLegacyVideoStudyMode(video, globalStudyMode)
}

export function setLegacyVideoStudyMode(video: any, studyMode: boolean): any {
  return getDataLayerHelpers().setLegacyVideoStudyMode(video, studyMode)
}

export function getDataClientApi(): any {
  return getDataClient()
}
