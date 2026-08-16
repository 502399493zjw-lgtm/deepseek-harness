/**
 * Client-namespace projection of the run machine types: a pure re-export of
 * the package's types outlet. Client code imports ONLY the client namespace,
 * so ./client projects the same single-source content ./types serves to host
 * consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-duty-runner/client
 */

export type * from './types.ts'
