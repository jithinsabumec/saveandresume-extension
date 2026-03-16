async function loadBuiltPopupFrom(basePath) {
  const manifestResponse = await fetch(`${basePath}.vite/manifest.json`)
  if (!manifestResponse.ok) {
    throw new Error(`Could not load manifest from ${basePath}.vite/manifest.json`)
  }

  const manifest = await manifestResponse.json()
  const popupEntry = manifest['popup.html']

  if (!popupEntry || typeof popupEntry.file !== 'string') {
    throw new Error('Popup entry was not found in the built manifest.')
  }

  ;(popupEntry.css || []).forEach((cssPath) => {
    const href = `${basePath}${cssPath}`
    const existingLink = document.querySelector(`link[href="${href}"]`)
    if (existingLink) {
      return
    }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  })

  globalThis.__SAVE_RESUME_POPUP_LOADED_FROM_DIST_BUNDLE__ = true
  await import(`${basePath}${popupEntry.file}`)
}

async function bootstrapPopup() {
  if (!globalThis.__SAVE_RESUME_POPUP_LOADED_FROM_DIST_BUNDLE__) {
    try {
      await loadBuiltPopupFrom('./')
      return
    } catch (error) {
      console.warn('Root popup bundle not available yet, trying dist bundle.', error)
    }
  }

  if (!globalThis.__SAVE_RESUME_POPUP_LOADED_FROM_DIST_BUNDLE__) {
    try {
      await loadBuiltPopupFrom('./dist/')
      return
    } catch (error) {
      console.warn('Dist popup bundle not available yet, falling back to local bundle.', error)
    }
  }

  try {
    await import('./src/main.tsx')
  } catch (error) {
    console.error('Failed to load popup bundle.', error)
    const root = document.getElementById('root')
    if (root) {
      root.innerHTML = `
        <div style="padding:16px;color:#fff;background:#101010;font-family:Arial,sans-serif;min-width:320px;">
          <div style="font-size:14px;line-height:1.5;">
            The popup bundle could not be loaded. Please run <strong>npm run build</strong> and reload the extension.
          </div>
        </div>
      `
    }
  }
}

void bootstrapPopup()
