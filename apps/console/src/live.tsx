/**
 * Live data. One EventSource per page tells which views changed; each `useLive*` hook refetches its data then. After a
 * reconnect every view refetches, since invalidations sent while disconnected are gone.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Api, Connection, LiveEvent, ViewName } from '@dsh-superagent-ui/contract'
import { ApiError, call } from './api'

const ALL_VIEWS: ViewName[] = ['home', 'health', 'board', 'ticket', 'threads', 'thread']

type Listener = () => void
interface Live {
  connection: Connection | null
  /** Whether the event stream to the BFF is open. */
  streaming: boolean
  subscribe(view: ViewName, listener: Listener): () => void
}
const LiveContext = createContext<Live | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [streaming, setStreaming] = useState(false)
  const listeners = useRef(new Map<ViewName, Set<Listener>>())
  const notify = useCallback((views: readonly ViewName[]) => {
    const called = new Set<Listener>()
    for (const view of views) for (const listener of listeners.current.get(view) ?? []) {
      if (!called.has(listener)) { called.add(listener); listener() }
    }
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/events')
    let opened = false
    source.onopen = () => {
      setStreaming(true)
      if (opened) notify(ALL_VIEWS)
      opened = true
    }
    source.onerror = () => setStreaming(false)
    source.addEventListener('invalidate', event => notify((JSON.parse((event as MessageEvent).data) as Extract<LiveEvent, { type: 'invalidate' }>).views))
    source.addEventListener('connection', event => {
      setConnection((JSON.parse((event as MessageEvent).data) as Extract<LiveEvent, { type: 'connection' }>).connection)
      notify(ALL_VIEWS)
    })
    return () => source.close()
  }, [notify])

  const subscribe = useCallback((view: ViewName, listener: Listener) => {
    const set = listeners.current.get(view) ?? new Set()
    set.add(listener)
    listeners.current.set(view, set)
    return () => { set.delete(listener) }
  }, [])

  return <LiveContext.Provider value={{ connection, streaming, subscribe }}>{children}</LiveContext.Provider>
}

export function useLive(): Live {
  const live = useContext(LiveContext)
  if (!live) throw new Error('useLive needs a LiveProvider')
  return live
}

export interface LiveData<T> { data: T | undefined; error: ApiError | undefined; reload: () => Promise<void> }

/**
 * Loads data now, again whenever one of `views` changes or the window regains focus, and again when `key` changes. Keeps
 * the last data while a refetch fails; drops it when `key` changes, so one record never shows under another's address.
 */
export function useLiveData<T>(views: readonly ViewName[], key: string, load: () => Promise<T>): LiveData<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: ApiError }>({ key })
  const { subscribe } = useLive()
  const seq = useRef(0)
  const loader = useRef(load)
  loader.current = load
  const reload = useCallback(async () => {
    const mine = ++seq.current
    try {
      const data = await loader.current()
      if (mine === seq.current) setState({ key, data })
    } catch (failure) {
      const error = failure instanceof ApiError ? failure : new ApiError(0, 'offline', String(failure))
      if (mine === seq.current) setState(previous => previous.key === key ? { ...previous, error } : { key, error })
    }
  }, [key])
  const viewList = views.join(',')
  useEffect(() => {
    void reload()
    const unsubscribes = (viewList.split(',') as ViewName[]).map(view => subscribe(view, () => void reload()))
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => { for (const unsubscribe of unsubscribes) unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [reload, subscribe, viewList])
  const current = state.key === key ? state : { key }
  return { data: current.data, error: current.error, reload }
}

type ViewRoute<V extends 'home' | 'health' | 'board'> = `GET /api/${V}`
/** A whole-page view with no parameters. */
export function useView<V extends 'home' | 'health' | 'board'>(view: V): LiveData<Api[ViewRoute<V>]['response']> {
  return useLiveData([view], view, () => call(`GET /api/${view}` as ViewRoute<V>) as Promise<Api[ViewRoute<V>]['response']>)
}
