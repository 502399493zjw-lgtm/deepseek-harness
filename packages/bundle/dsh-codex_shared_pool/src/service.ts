/** Shared host service consumed by optional OpenAI Codex front-door adapters. */

import type { AuthInteraction } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus } from './auth.ts'
import type { OpenAICodexAuthStatus } from './auth.ts'
import { OpenAICodexCredentialStore } from './store.ts'
import { ImageToolPolicy } from './tool-policy.ts'
import type {
  ImageToolPreferences,
  ResponseApiPreferences,
} from './tool-policy.ts'
import { readOpenAICodexRateLimits } from './usage.ts'
import type { OpenAICodexUsage } from './usage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-owned account and preference service for optional front doors. */
    openAICodex: OpenAICodexService
  }
}

/** Initial settings contributed by the bundle configuration. */
export interface OpenAICodexServiceOptions extends ImageToolPreferences, ResponseApiPreferences {}

/**
 * One provider-owned host service shared by Web routes and terminal adapters.
 * Credentials and live policy stay singletons even when several front doors are mounted.
 */
export class OpenAICodexService {
  /** Profile-aware OAuth credential source. */
  readonly credentials: OpenAICodexCredentialStore
  /** Live image and Responses preference owner. */
  readonly policy: ImageToolPolicy

  constructor(options: OpenAICodexServiceOptions, resolveSessionId?: () => string | undefined) {
    this.credentials = new OpenAICodexCredentialStore(undefined, resolveSessionId)
    this.policy = new ImageToolPolicy(options)
  }

  /**
   * Attach the durable settings document when the active profile provides it.
   * @param ctx - Settings-capable plugin context.
   */
  attachSettings(ctx: Context): void {
    this.policy.attach(ctx)
  }

  /**
   * Start the provider-native OAuth lifecycle.
   * @param interaction - Authentication prompts and notifications.
   */
  login(interaction: AuthInteraction): Promise<void> {
    return loginOpenAICodex(interaction, this.credentials)
  }

  /** Remove this plugin's credential without touching Codex CLI/Desktop. */
  logout(): Promise<void> {
    return logoutOpenAICodex(this.credentials)
  }

  /**
   * Read non-secret authentication metadata.
   * @returns Authentication state and token expiry metadata.
   */
  authStatus(): Promise<OpenAICodexAuthStatus> {
    return openAICodexAuthStatus(this.credentials)
  }

  /**
   * Read current subscription limits without issuing a model request.
   * @returns Secret-free quota projection.
   */
  usage(): Promise<OpenAICodexUsage> {
    return readOpenAICodexRateLimits(this.credentials)
  }

  /**
   * Read current image-tool preferences.
   * @returns Current image-tool preferences.
   */
  imagePreferences(): ImageToolPreferences {
    return this.policy.snapshot()
  }

  /**
   * Persist image-tool preference fields.
   * @param patch - Fields to update.
   * @returns Authoritative preferences after the update.
   */
  updateImagePreferences(patch: Partial<ImageToolPreferences>): Promise<ImageToolPreferences> {
    return this.policy.update(patch)
  }

  /**
   * Read current Codex Responses preferences.
   * @returns Current Codex Responses preferences.
   */
  responsePreferences(): ResponseApiPreferences {
    return this.policy.responseApiSnapshot()
  }

  /**
   * Persist Codex Responses preference fields.
   * @param patch - Fields to update.
   * @returns Authoritative preferences after the update.
   */
  updateResponsePreferences(patch: Partial<ResponseApiPreferences>): Promise<ResponseApiPreferences> {
    return this.policy.updateResponseApi(patch)
  }
}
