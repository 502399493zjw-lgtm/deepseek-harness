/**
 * The Duty verification seam: a registry of independent completion checkers.
 * The run runtime consults it before accepting `duty_step_done` when a Duty's
 * contract opts into verification; the registry itself owns only selection and
 * failure containment.
 * @module @deepseek-ai/dsh-duty-verify
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { DutyVerificationRequest, DutyVerdict, DutyVerifier } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dutyVerifiers: DutyVerifierRegistry
  }
}

/** Registry policy: which verifier the runtime consults. */
export interface Config {
  /** Verifier id selected for runs whose contract opts into verification. */
  readonly verifier: string
}

/**
 * Registry of independent completion checkers. The runtime resolves the
 * configured verifier through {@link resolve}; a missing verifier is a loud
 * misconfiguration, never a silent pass.
 */
export class DutyVerifierRegistry extends Service {
  /** Loader validation for the selected verifier. */
  static Config: s<Config> = s.object({
    verifier: s.string().required(),
  })

  private readonly policy: Config
  private readonly verifiers = new Map<string, DutyVerifier>()

  /**
   * Compose the registry and adopt its selection policy.
   * @param ctx - Cordis context; the registry itself depends on no service.
   * @param config - The selected verifier id.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dutyVerifiers')
    this.policy = config
  }

  /**
   * Register one completion checker.
   * @param verifier - The checker to register under its id.
   * @returns the disposer that unregisters it.
   */
  register(verifier: DutyVerifier): () => void {
    if (this.verifiers.has(verifier.id)) {
      throw new Error(`duty-verify: verifier '${verifier.id}' is already registered`)
    }
    this.verifiers.set(verifier.id, verifier)
    return () => {
      this.verifiers.delete(verifier.id)
    }
  }

  /**
   * Registered verifier ids, in registration order.
   * @returns the current verifier id list.
   */
  verifierIds(): readonly string[] {
    return [...this.verifiers.keys()]
  }

  /**
   * Resolve the configured verifier.
   * @returns the selected checker, or `undefined` when nothing is registered
   * under the configured id.
   */
  resolve(): DutyVerifier | undefined {
    return this.verifiers.get(this.policy.verifier)
  }

  /**
   * Judge one reported completion through the configured or the named
   * verifier.
   * @param request - the step, its summary, and the bounded evidence.
   * @param verifierId - an explicit verifier id; absent, the configured
   * default is selected.
   * @returns the verdict; throws when the selected verifier is missing.
   */
  async verify(request: DutyVerificationRequest, verifierId?: string): Promise<DutyVerdict> {
    const selected = verifierId ?? this.policy.verifier
    const verifier = this.verifiers.get(selected)
    if (verifier === undefined) {
      throw new Error(`duty-verify: no verifier '${selected}' is registered`)
    }
    return verifier.verify(request)
  }
}

export default DutyVerifierRegistry
