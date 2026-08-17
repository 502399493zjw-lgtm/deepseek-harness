/**
 * Settings domain base plugin, browser half. Provides `ctx.settingsScope` for
 * durable namespace access and `ctx.settingsNavigation` for cross-feature
 * section-open requests, and owns the canonical slot-type contract for the
 * settings surface. It depends on no `ui-*` presentation package, so any
 * feature that owns a preference or section entry point can reach it: the
 * settings SHELL — the `sidebar.settings` occupant, its navigation, and the
 * chrome — lives in ui-settings-general, because a shell dependency on
 * ui-sidebar would close a reference cycle through ui-layout and ui-theme.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsNavigationController } from './navigation.ts'
import { SettingsScopeBinder } from './settings-scope.ts'

export type {
  SettingsGeneralItemOwnerProps, SettingsHeaderOwnerProps, SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps, SettingsTriggerOwnerProps,
} from './contract/slots.ts'
export type { SettingsNavigationRequest } from './navigation.ts'
export { SettingsScopeController, SettingsScopeBinder } from './settings-scope.ts'

/**
 * Required services: none. The transport is resolved per caller through
 * `this.ctx` at `bind` time, so this plugin waits for nothing.
 */
export const inject = []

/**
 * Provide the settings namespace and section-navigation services.
 *
 * Constructing the service in this plugin's fiber keeps its traced methods
 * bound to each consuming plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  new SettingsScopeBinder(ctx)
  new SettingsNavigationController(ctx)
}
