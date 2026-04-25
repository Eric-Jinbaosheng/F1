const TOAST_CLASS = 'f1s-toast'

export function showToast(msg: string, duration = 3000): void {
  try {
    const el = document.createElement('div')
    el.className = TOAST_CLASS
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(() => {
      el.remove()
    }, duration)
  } catch (e) {
    console.warn('[F1S] toast failed:', e)
  }
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    console.warn('[F1S] global error:', e.error ?? e.message)
    showToast('哎呀,出错了,请重启试试吧~')
  })
  window.addEventListener('unhandledrejection', (e) => {
    console.warn('[F1S] unhandled promise:', e.reason)
    showToast('哎呀,出错了,请重启试试吧~')
  })
}

export async function safeAsync<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[F1S] ${label} failed:`, e)
    return fallback
  }
}
