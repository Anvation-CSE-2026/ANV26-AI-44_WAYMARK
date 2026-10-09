import { useEffect, useState } from 'react'
import type { DependencyList } from 'react'

interface State<T> {
  data: T | null
  error: string | null
  loading: boolean
}

interface Options {
  /** Keep the previous result visible while a new request is in flight. */
  keepPrevious?: boolean
}

export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: Options = {},
) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const keepPrevious = options.keepPrevious ?? false

  useEffect(() => {
    const ctrl = new AbortController()
    setState((s) => ({ data: keepPrevious ? s.data : null, error: null, loading: true }))
    fetcher(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setState({ data: null, error: e instanceof Error ? e.message : 'Something went wrong.', loading: false })
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { ...state, reload: () => setNonce((n) => n + 1) }
}
