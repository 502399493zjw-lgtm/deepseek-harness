/**
 * DutyPanel: the duty list, run history, and human-decision inbox, opened
 * from the sidebar footer action. All business data arrives through the
 * injected Remote verbs; the open flag and selection are component-local.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyId, DutyRun, HumanRequest } from '@deepseek-ai/dsh-api-remotes/client'
import type { DutyPanelActions, DutyRowView } from './slots.ts'
import css from './DutyPanel.module.css'

/** The panel's composed props: framework owner share plus the injected face. */
export type DutyPanelProps = import('@deepseek-ai/dsh-client-ui-slots')
  .PropsRuntime<'sidebar.footer.action'> & DutyPanelActions & PropsLocale<'duty'>

/** The composed body props: the entry props plus the close callback. */
type DutyPanelBodyProps = DutyPanelProps & { onClose: () => void }

/**
 * Render the sidebar duty entry: a trigger row and, when open, the panel.
 * @param props - framework share, injected verbs, and copy.
 */
export function DutyPanel(props: DutyPanelProps) {
  const { wide, t } = props
  const [open, setOpen] = useState(false)
  return (
    <div className={css.entry}>
      <button
        type="button"
        className={css.trigger}
        onClick={() => { setOpen(value => !value) }}
        aria-expanded={open}
      >
        <span className={css.triggerIcon}>◆</span>
        {wide && <span>{t('entry.label')}</span>}
      </button>
      {open && <DutyPanelBody {...props} onClose={() => { setOpen(false) }} />}
    </div>
  )
}

/** The open panel: duties, runs, and the inbox. */
function DutyPanelBody({ listDuties, listRuns, openRequests, answer, setLifecycle, start, remove, t, onClose }: DutyPanelBodyProps) {
  const [duties, setDuties] = useState<readonly DutyRowView[]>([])
  const [requests, setRequests] = useState<readonly HumanRequest[]>([])
  const [runs, setRuns] = useState<readonly DutyRun[]>([])
  const [selected, setSelected] = useState<DutyId | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    setBusy(true)
    const [dutyResult, requestResult] = await Promise.all([listDuties(), openRequests()])
    setBusy(false)
    setDuties(dutyResult.map(view => ({ id: view.spec.id, title: view.spec.title, state: view.state })))
    setRequests(requestResult)
  }, [listDuties, openRequests])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (selected === undefined) {
      setRuns([])
      return
    }
    void listRuns(selected).then(setRuns)
  }, [selected, listRuns])

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    // Refresh first so a failure message is not cleared by the reload.
    await refresh()
    if (!result.ok) setError(result.error ?? t('error.remote'))
  }

  return (
    <div className={css.overlay}>
      <div className={css.panel}>
        <header className={css.header}>
          <span className={css.panelTitle}>{t('panel.title')}</span>
          <button type="button" className={css.close} onClick={onClose}>{t('panel.close')}</button>
        </header>
        {error !== undefined && <div className={css.error}>{error}</div>}
        <section className={css.section}>
          <h3>{t('inbox.title')}</h3>
          {requests.length === 0
            ? <p className={css.empty}>{t('inbox.empty')}</p>
            : requests.map(request => (
              <div key={request.id} className={css.request}>
                <span className={css.question}>{request.question}</span>
                <AnswerInline
                  pending={busy}
                  onSubmit={(value) => { void run(() => answer(request.dutyId, request.id, value)) }}
                  label={t('run.answer')}
                  placeholder={t('run.answerPlaceholder')}
                />
              </div>
            ))}
        </section>
        <section className={css.section}>
          <h3>{t('list.title')}</h3>
          {duties.length === 0
            ? <p className={css.empty}>{t('list.empty')}</p>
            : duties.map(view => (
              <div
                key={view.id}
                className={css.row}
                data-selected={view.id === selected ? 'true' : 'false'}
              >
                <button type="button" className={css.rowTitle} onClick={() => { setSelected(view.id) }}>
                  <span className={css.title}>{view.title}</span>
                  <span className={css.meta}>
                    {t('row.lifecycle')}: {view.state.lifecycle}
                    {view.state.lastOutcome === undefined ? '' : ` · ${t('row.outcome')}: ${view.state.lastOutcome}`}
                  </span>
                </button>
                <span className={css.actions}>
                  {view.state.lifecycle !== 'active' && view.state.lifecycle !== 'archived' && (
                    <button type="button" disabled={busy} onClick={() => { void run(() => setLifecycle(view.id, 'active')) }}>
                      {t('action.activate')}
                    </button>
                  )}
                  {view.state.lifecycle === 'active' && (
                    <button type="button" disabled={busy} onClick={() => { void run(() => setLifecycle(view.id, 'paused', 'human')) }}>
                      {t('action.pause')}
                    </button>
                  )}
                  {view.state.lifecycle === 'active' && (
                    <button type="button" disabled={busy} onClick={() => { void run(() => start(view.id, 'started from the duty panel')) }}>
                      {t('action.start')}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => { void run(() => remove(view.id)) }}>
                    {t('action.remove')}
                  </button>
                </span>
              </div>
            ))}
        </section>
        {selected !== undefined && (
          <section className={css.section}>
            <h3>{t('runs.title')}</h3>
            {runs.length === 0
              ? <p className={css.empty}>{t('runs.empty')}</p>
              : runs.map(run => (
                <div key={run.id} className={css.runRow}>
                  <span className={css.meta}>#{run.index} {run.status}</span>
                  <span className={css.meta}>{run.cause.reason}</span>
                  {run.summary === undefined ? '' : <span className={css.summary}>{run.summary}</span>}
                </div>
              ))}
          </section>
        )}
        <footer className={css.footer}>
          <button type="button" disabled={busy} onClick={() => { void refresh() }}>{t('action.refresh')}</button>
        </footer>
      </div>
    </div>
  )
}

/** Inline answer input for one open human decision. */
function AnswerInline({ label, placeholder, pending, onSubmit }: {
  label: string
  placeholder: string
  pending: boolean
  onSubmit: (value: string) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <form
      className={css.answerForm}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(draft)
        setDraft('')
      }}
    >
      <input
        className={css.input}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => { setDraft(event.target.value) }}
      />
      <button type="submit" disabled={pending || draft.trim() === ''}>{label}</button>
    </form>
  )
}
