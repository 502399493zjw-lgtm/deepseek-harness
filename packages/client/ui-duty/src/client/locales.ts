/**
 * Duty surface copy, Chinese product language with an English fallback.
 * @module @deepseek-ai/dsh-client-ui-duty/client/locales
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'entry.label': 'Duty',
  'panel.title': 'Duties',
  'panel.close': '关闭',
  'list.title': 'Duty 列表',
  'list.empty': '还没有 Duty。可用 duty_create 工具或 /loop 命令创建。',
  'row.lifecycle': '状态',
  'row.outcome': '最近',
  'action.activate': '激活',
  'action.pause': '暂停',
  'action.start': '立即运行',
  'action.remove': '删除',
  'run.steps': '个步骤',
  'run.waiting': '等待人工答复',
  'run.answer': '答复',
  'run.answerPlaceholder': '答复…',
  'run.finished': '已结束',
  'run.attempts': '次尝试',
  'run.verdict.pass': '验收通过',
  'run.verdict.fail': '验收未通过',
  'run.appeal.accepted': '已人工接受',
  'inbox.title': '待答复的人工决策',
  'inbox.empty': '没有待答复的人工决策。',
  'error.remote': '远端调用失败',
  'action.refresh': '刷新',
  'runs.title': 'Run 记录',
  'runs.empty': '还没有 run。',
} satisfies Record<string, string>

/** The duty namespace key union. */
export type DutyKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'entry.label': 'Duty',
  'panel.title': 'Duties',
  'panel.close': 'Close',
  'list.title': 'Duties',
  'list.empty': 'No duties yet. Create one with duty_create or /loop.',
  'row.lifecycle': 'state',
  'row.outcome': 'last',
  'action.activate': 'Activate',
  'action.pause': 'Pause',
  'action.start': 'Run now',
  'action.remove': 'Remove',
  'run.steps': 'steps',
  'run.waiting': 'waiting for a human answer',
  'run.answer': 'Answer',
  'run.answerPlaceholder': 'answer…',
  'run.finished': 'finished',
  'run.attempts': 'attempt',
  'run.verdict.pass': 'verified',
  'run.verdict.fail': 'verification failed',
  'run.appeal.accepted': 'accepted by human',
  'inbox.title': 'Open human decisions',
  'inbox.empty': 'No open human decisions.',
  'error.remote': 'remote call failed',
  'action.refresh': 'Refresh',
  'runs.title': 'Runs',
  'runs.empty': 'No runs yet.',
} satisfies Record<DutyKey, string>
