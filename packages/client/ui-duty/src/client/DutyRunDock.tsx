/**
 * DutyRunDock: the live run board docked above the composer when the current
 * Session belongs to a major-trigger run. Everything renders from the `duty`
 * session projection; the only verb is answering the open human decision.
 */

import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyRunDockActions } from './slots.ts'
import css from './DutyRunDock.module.css'

/** The dock's composed props: framework owner share plus the injected verbs. */
export type DutyRunDockProps = import('@deepseek-ai/dsh-client-ui-slots')
  .PropsRuntime<'conversation.input.dock'> & DutyRunDockActions & PropsLocale<'duty'>

/** Step status glyphs. */
const STEP_MARKS = {
  started: '·',
  completed: '✓',
  failed: '✗',
} as const

/**
 * Render the live run board.
 * @param props - framework share, injected verbs, and copy.
 */
export function DutyRunDock({ useProjection, answer, t }: DutyRunDockProps) {
  const projection = useProjection('duty')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  if (projection === undefined || projection.bound === undefined) return null
  const bound = projection.bound
  const waiting = projection.waitingHuman

  const submitAnswer = async (requestId: string, value: string): Promise<void> => {
    if (pending || value.trim() === '') return
    setPending(true)
    setError(undefined)
    const result = await answer(bound.dutyId, requestId, value)
    setPending(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className={css.dock}>
      <span className={css.title}>Duty</span>
      <span className={css.steps}>
        {projection.steps.filter(step => step.status === 'completed').length}
        /{projection.steps.length} {t('run.steps')}
      </span>
      {waiting !== undefined && (
        <AnswerForm
          question={waiting.question}
          placeholder={t('run.answerPlaceholder')}
          submitLabel={t('run.answer')}
          pending={pending}
          onSubmit={(value) => { void submitAnswer(waiting.requestId, value) }}
        />
      )}
      {projection.finished !== undefined && (
        <span className={css.finished}>
          {t('run.finished')}: {projection.finished.status}
          {projection.finished.summary === undefined ? '' : ` — ${projection.finished.summary}`}
        </span>
      )}
      {error !== undefined && <span className={css.error}>{error}</span>}
      {projection.steps.length > 0 && (
        <ol className={css.stepList}>
          {projection.steps.map(step => (
            <li key={step.stepId} className={css.step} data-status={step.status}>
              <span className={css.mark}>{STEP_MARKS[step.status]}</span>
              {step.label}
              {step.status === 'started' && step.attempts > 1
                ? ` (${step.attempts}${t('run.attempts')})`
                : ''}
              {step.status === 'completed' && step.summary !== undefined ? ` — ${step.summary}` : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Local answer form; the open question is the only human-decision surface. */
function AnswerForm({ question, placeholder, submitLabel, pending, onSubmit }: {
  question: string
  placeholder: string
  submitLabel: string
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
      <span className={css.question}>{question}</span>
      <input
        className={css.input}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => { setDraft(event.target.value) }}
      />
      <button className={css.submit} type="submit" disabled={pending || draft.trim() === ''}>
        {submitLabel}
      </button>
    </form>
  )
}
