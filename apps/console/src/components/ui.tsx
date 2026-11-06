/** Small shared pieces: pills, chips, in-page confirmation, toasts, and the banner for an unreachable dsh-superagent. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Connection, ThreadRef } from '@dsh-superagent-ui/contract'
import { ApiError } from '../api'
import { SOURCE_NAME, UPSTREAM, type Tone } from '../text'

export function Pill({ tone = 'muted', dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={`pill t-${tone}${dot ? '' : ' nodot'}`}>{children}</span>
}

export function SourceChip({ thread }: { thread: ThreadRef }) {
  return <span className="chip"><b>{SOURCE_NAME[thread.source] ?? thread.source}</b>{thread.title}</span>
}

interface ConfirmRequest { title: string; body: ReactNode; action: string; resolve(ok: boolean): void }
interface Ui {
  toast(message: string): void
  confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean>
}
const UiContext = createContext<Ui | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 4000)
  }, [])
  const confirm = useCallback((next: Omit<ConfirmRequest, 'resolve'>) => new Promise<boolean>(resolve => setRequest({ ...next, resolve })), [])
  const answer = (ok: boolean) => { request?.resolve(ok); setRequest(null) }
  useEffect(() => {
    if (!request) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') answer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return <UiContext.Provider value={{ toast, confirm }}>
    {children}
    {request && <div className="layer" onClick={() => answer(false)}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={event => event.stopPropagation()}>
        <h2 id="dlg-title">{request.title}</h2>
        <div className="sub dlg-body">{request.body}</div>
        <div className="acts">
          <button className="btn ghost" onClick={() => answer(false)}>取消</button>
          <button className="btn primary" autoFocus onClick={() => answer(true)}>{request.action}</button>
        </div>
      </div>
    </div>}
    <div className="toast" role="status" aria-live="polite" hidden={!message}>{message}</div>
  </UiContext.Provider>
}

export function useUi(): Ui {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi needs a UiProvider')
  return ui
}

/** Runs an operation, says how it went, and refreshes the view. */
export function useAction(reload: () => Promise<void> | void) {
  const { toast } = useUi()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(async (key: string, operation: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await operation()
      toast(done)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : String(error))
    } finally {
      setBusy(null)
      void reload()
    }
  }, [reload, toast])
  return { busy, run }
}

export function ConnectionBanner({ connection, error }: { connection?: Connection | null; error?: ApiError }) {
  if (error?.kind === 'offline') return <div className="banner danger">{error.message}</div>
  const state = error?.upstream ?? (connection && connection.upstream !== 'ok' ? connection.upstream : undefined)
  if (!state || state === 'ok') return null
  return <div className="banner danger">{UPSTREAM[state](connection?.url ?? 'SUPERAGENT_URL')}</div>
}

/** Refreshes relative times once a minute. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
