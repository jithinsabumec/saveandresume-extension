import posthog from 'posthog-js'

posthog.init('phc_vnb5QI0svxFHFzYvCOQEYyq9vb4P8sY7hyPmHZnvC4l', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-01-30',
    autocapture: false,
    capture_pageview: false,
    advanced_disable_feature_flags: true,
    advanced_disable_decide: true,
    disable_external_dependency_loading: true,
    disable_compression: true,
    persistence: 'localStorage'
})

const ANALYTICS_QUEUE_KEY = 'analyticsEventQueue'

interface QueuedAnalyticsEvent {
    id: string
    event: string
    properties?: Record<string, unknown>
}

interface PostHogResponse {
    statusCode: number
    text?: string
    error?: unknown
}

interface PostHogInternals {
    analyticsDefaultEndpoint?: string
    calculateEventProperties?: (
        eventName: string,
        eventProperties: Record<string, unknown>,
        timestamp?: Date,
        uuid?: string
    ) => Record<string, unknown>
    requestRouter?: {
        endpointFor: (target: 'api' | 'assets' | 'flags' | 'ui', path?: string) => string
    }
    _send_request?: (options: {
        method: 'POST'
        url: string
        data: {
            uuid: string
            event: string
            properties: Record<string, unknown>
            timestamp: Date
        }
        compression?: 'best-available'
        timeout?: number
        callback?: (response: PostHogResponse) => void
    }) => void
}

let hasStartedAnalyticsBridge = false

function getExtensionVersion(): string {
    try {
        return chrome.runtime.getManifest().version
    } catch {
        return 'unknown'
    }
}

function captureEvent(event: string, properties?: Record<string, unknown>): boolean {
    try {
        posthog.capture(event, {
            extension_version: getExtensionVersion(),
            ...properties
        }, {
            send_instantly: true
        })
        return true
    } catch (error) {
        console.warn('Analytics capture failed:', error)
        return false
    }
}

function createAnalyticsUuid(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
    } catch {
        // Fall back below if the browser crypto API is unavailable.
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getPostHogInternals(): PostHogInternals | null {
    const candidate = posthog as typeof posthog & PostHogInternals

    if (
        typeof candidate.calculateEventProperties !== 'function' ||
        typeof candidate.requestRouter?.endpointFor !== 'function' ||
        typeof candidate._send_request !== 'function'
    ) {
        return null
    }

    return candidate
}

async function captureQueuedEvent(event: string, properties?: Record<string, unknown>): Promise<boolean> {
    const posthogInternals = getPostHogInternals()
    if (!posthogInternals) {
        console.warn('Analytics queue flush skipped because PostHog internals are unavailable.')
        return false
    }

    const timestamp = new Date()
    const uuid = createAnalyticsUuid()

    try {
        const payload = {
            uuid,
            event,
            properties: posthogInternals.calculateEventProperties?.(
                event,
                {
                    extension_version: getExtensionVersion(),
                    ...properties
                },
                timestamp,
                uuid
            ) ?? {},
            timestamp
        }

        const url = posthogInternals.requestRouter?.endpointFor(
            'api',
            posthogInternals.analyticsDefaultEndpoint ?? '/e/'
        )

        if (!url) {
            console.warn('Analytics queue flush skipped because PostHog endpoint is unavailable.')
            return false
        }

        return await new Promise<boolean>((resolve) => {
            posthogInternals._send_request?.({
                method: 'POST',
                url,
                data: payload,
                compression: 'best-available',
                timeout: 10000,
                callback: (response) => {
                    if (response.statusCode === 200) {
                        resolve(true)
                        return
                    }

                    console.warn('Queued analytics capture failed:', response)
                    resolve(false)
                }
            })
        })
    } catch (error) {
        console.warn('Queued analytics capture failed:', error)
        return false
    }
}

function getChromeStorageLocal(): typeof chrome.storage.local | null {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return null
    }

    return chrome.storage.local
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isQueuedAnalyticsEvent(value: unknown): value is QueuedAnalyticsEvent {
    if (!isObjectRecord(value)) {
        return false
    }

    return (
        typeof value.id === 'string' &&
        typeof value.event === 'string' &&
        (value.properties === undefined || isObjectRecord(value.properties))
    )
}

async function getQueuedAnalyticsEvents(): Promise<QueuedAnalyticsEvent[]> {
    const storage = getChromeStorageLocal()
    if (!storage) {
        return []
    }

    return new Promise((resolve) => {
        storage.get([ANALYTICS_QUEUE_KEY], (result) => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to read queued analytics events:', chrome.runtime.lastError.message)
                resolve([])
                return
            }

            const queuedEvents = Array.isArray(result[ANALYTICS_QUEUE_KEY]) ? result[ANALYTICS_QUEUE_KEY] : []
            resolve(queuedEvents.filter(isQueuedAnalyticsEvent))
        })
    })
}

async function setQueuedAnalyticsEvents(events: QueuedAnalyticsEvent[]): Promise<void> {
    const storage = getChromeStorageLocal()
    if (!storage) {
        return
    }

    return new Promise((resolve) => {
        storage.set({ [ANALYTICS_QUEUE_KEY]: events }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to update queued analytics events:', chrome.runtime.lastError.message)
            }
            resolve()
        })
    })
}

async function consumeQueuedAnalyticsEvent(id: string): Promise<void> {
    const queuedEvents = await getQueuedAnalyticsEvents()
    const nextQueuedEvents = queuedEvents.filter((queuedEvent) => queuedEvent.id !== id)

    if (nextQueuedEvents.length === queuedEvents.length) {
        return
    }

    await setQueuedAnalyticsEvents(nextQueuedEvents)
}

async function captureAndConsumeQueuedAnalyticsEvent(queuedEvent: QueuedAnalyticsEvent): Promise<void> {
    if (await captureQueuedEvent(queuedEvent.event, queuedEvent.properties)) {
        await consumeQueuedAnalyticsEvent(queuedEvent.id)
    }
}

export function track(event: string, properties?: Record<string, unknown>): void {
    captureEvent(event, properties)
}

export async function trackQueuedEvent(
    event: string,
    properties?: Record<string, unknown>
): Promise<boolean> {
    return captureQueuedEvent(event, properties)
}

export function identifyUser(uid: string, email: string, name: string): void {
    try {
        posthog.identify(uid, { email, name })
    } catch (error) {
        console.warn('Analytics identify failed:', error)
    }
}

export function resetUser(): void {
    try {
        posthog.reset()
    } catch (error) {
        console.warn('Analytics reset failed:', error)
    }
}

export async function flushQueuedAnalyticsEvents(): Promise<void> {
    const queuedEvents = await getQueuedAnalyticsEvents()
    if (queuedEvents.length === 0) {
        return
    }

    const successfulEventIds = new Set<string>()

    for (const queuedEvent of queuedEvents) {
        if (await captureQueuedEvent(queuedEvent.event, queuedEvent.properties)) {
            successfulEventIds.add(queuedEvent.id)
        }
    }

    if (successfulEventIds.size > 0) {
        const latestQueuedEvents = await getQueuedAnalyticsEvents()
        const remainingEvents = latestQueuedEvents.filter(
            (queuedEvent) => !successfulEventIds.has(queuedEvent.id)
        )
        await setQueuedAnalyticsEvents(remainingEvents)
    }
}

export function startAnalyticsBridge(): void {
    if (hasStartedAnalyticsBridge || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
        return
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type !== 'ANALYTICS_EVENT' || !isQueuedAnalyticsEvent(message.payload)) {
            return
        }

        void captureAndConsumeQueuedAnalyticsEvent(message.payload)
    })

    hasStartedAnalyticsBridge = true
}

export default posthog
