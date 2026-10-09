import { useEffect } from 'react'
import type { ReactNode } from 'react'

export interface ToastData {
  id: number
  message: ReactNode
  actionLabel?: string
  onAction?: () => void
}

/** Polite, dismissible notice at the bottom of the screen. Moves on by itself after a while. */
export function Toast({ toast, onClose }: { toast: ToastData | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 9000)
    return () => clearTimeout(t)
  }, [toast, onClose])
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex justify-center px-4">
      {toast && (
        <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-3 rounded-[12px] bg-navy px-4 py-3 text-ivory shadow-card">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.()
                onClose()
              }}
              className="rounded-md bg-brass px-3 py-1 font-semibold text-navy hover:brightness-95"
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Dismiss notice" className="rounded-md px-2 py-1 hover:bg-white/10">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
