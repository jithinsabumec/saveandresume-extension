import posthog from 'posthog-js'

posthog.init('phc_vnb5QI0svxFHFzYvC0QEYyq9vb4P8sY7hyPmHZnvC4l', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-01-30',
    autocapture: false,
    capture_pageview: false,
    persistence: 'localStorage'
})

export default posthog