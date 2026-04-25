/**
 * Intro video splash. Plays once at app boot before the main menu.
 *
 * Browser autoplay policies require a user gesture before any video can
 * play with sound, so the flow is:
 *
 *   1. Show a "点击开始" splash on top of the (silenced) video preview.
 *   2. On click/tap/key, unmute and (re)play from the start with audio.
 *   3. Skippable thereafter via tap, Esc, Enter, or Space.
 */

export interface IntroController {
  /** Show the video and resolve when it ends OR is skipped. */
  show: () => Promise<void>
  hide: () => void
}

export function createIntro(videoUrl: string): IntroController {
  let host: HTMLDivElement | null = null
  let video: HTMLVideoElement | null = null

  const hide = (): void => {
    if (video) {
      try {
        video.pause()
      } catch {
        /* noop */
      }
      video = null
    }
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
  }

  const show = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      hide()

      host = document.createElement('div')
      host.style.cssText = `
        position: fixed; inset: 0; z-index: 200;
        display: flex; align-items: center; justify-content: center;
        background: #000;
      `

      // Underlying video element. Stays muted + paused at frame 0 until
      // the user clicks "开始" — that's the only way to play with audio
      // under autoplay policy.
      video = document.createElement('video')
      video.src = videoUrl
      video.muted = true
      video.playsInline = true
      video.setAttribute('webkit-playsinline', 'true')
      video.preload = 'auto'
      video.controls = false
      video.style.cssText = `
        width: 100%; height: 100%;
        object-fit: cover;
        background: #000;
      `

      // Foreground click-to-start overlay. Vanishes on first user gesture.
      const splash = document.createElement('div')
      splash.style.cssText = `
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 18px;
        background: linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.85));
        color: #fff; cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
      `
      const splashTitle = document.createElement('div')
      splashTitle.textContent = 'F1 体感飙速'
      splashTitle.style.cssText = 'font-size: 40px; font-weight: 900; letter-spacing: 6px;'
      const splashSub = document.createElement('div')
      splashSub.textContent = 'FEEL THE F1'
      splashSub.style.cssText = 'font-size: 16px; color: #ff1801; letter-spacing: 8px; font-weight: 700;'
      const playBtn = document.createElement('button')
      playBtn.textContent = '▶ 点 击 开 始'
      playBtn.style.cssText = `
        margin-top: 16px;
        min-width: 240px; min-height: 86px;
        background: #ff1801; color: #fff;
        border: none; border-radius: 12px;
        font-size: 24px; font-weight: 900; letter-spacing: 6px;
        cursor: pointer;
      `
      const splashHint = document.createElement('div')
      splashHint.textContent = '点击播放开场视频(请打开音量)'
      splashHint.style.cssText = 'font-size: 13px; color: #ddd; letter-spacing: 2px; opacity: 0.85;'
      splash.appendChild(splashTitle)
      splash.appendChild(splashSub)
      splash.appendChild(playBtn)
      splash.appendChild(splashHint)

      // Skip hint — only shown after the video starts.
      const skipHint = document.createElement('div')
      skipHint.textContent = '点击 / 任意键 跳过'
      skipHint.style.cssText = `
        position: absolute; right: 24px; bottom: 24px;
        color: rgba(255,255,255,0.75);
        font-size: 13px; letter-spacing: 2px;
        background: rgba(0,0,0,0.45);
        padding: 6px 14px; border-radius: 6px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        opacity: 0;
        transition: opacity 0.3s ease;
      `

      host.appendChild(video)
      host.appendChild(skipHint)
      host.appendChild(splash)
      document.body.appendChild(host)

      let started = false
      let settled = false

      const finish = (): void => {
        if (settled) return
        settled = true
        cleanup()
        hide()
        resolve()
      }

      const startPlayback = (): void => {
        if (started || !video) return
        started = true
        // Take down the splash overlay.
        if (splash.parentElement) splash.parentElement.removeChild(splash)
        // Now we can unmute — the click counts as a user gesture.
        video.muted = false
        video.currentTime = 0
        const p = video.play()
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('[intro] play failed, falling back to muted:', err)
            if (video) {
              video.muted = true
              video.play().catch(() => finish())
            }
          })
        }
        // Reveal skip hint with a small delay so it doesn't compete with
        // the video opening.
        setTimeout(() => { skipHint.style.opacity = '1' }, 600)
        // Bind skip handlers AFTER the splash click so the same click
        // doesn't immediately trigger them.
        setTimeout(() => {
          window.addEventListener('keydown', onKey, true)
          host?.addEventListener('click', onSkipClick)
        }, 250)
      }

      const onSplashClick = (): void => startPlayback()
      const onSkipClick = (): void => finish()
      const onKey = (ev: KeyboardEvent): void => {
        if (
          ev.key === 'Escape' ||
          ev.key === 'Enter' ||
          ev.key === ' ' ||
          ev.key === 'Spacebar'
        ) {
          ev.preventDefault()
          if (!started) startPlayback()
          else finish()
        }
      }
      const onEnded = (): void => finish()
      const onError = (e: Event): void => {
        console.warn('[intro] video failed:', e)
        finish()
      }

      const cleanup = (): void => {
        window.removeEventListener('keydown', onKey, true)
        if (host) host.removeEventListener('click', onSkipClick)
        splash.removeEventListener('click', onSplashClick)
        if (video) {
          video.removeEventListener('ended', onEnded)
          video.removeEventListener('error', onError)
        }
      }

      splash.addEventListener('click', onSplashClick)
      // Allow keyboard (Enter/Space) to also start before any click.
      window.addEventListener('keydown', onKey, true)
      video.addEventListener('ended', onEnded)
      video.addEventListener('error', onError)
    })
  }

  return { show, hide }
}
