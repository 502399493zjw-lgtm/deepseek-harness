/** Cross-feature requests to open one registered Settings section. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Latest Settings navigation request, with a revision for repeated destinations. */
export interface SettingsNavigationRequest {
  revision: number
  sectionId: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsNavigation: SettingsNavigationController
  }
}

/** Service used by feature-owned entry points to open their Settings section. */
export class SettingsNavigationController extends Service {
  /** Observable request source consumed by the Settings shell. */
  readonly requests: SnapshotStore<SettingsNavigationRequest> = createSnapshotStore({
    revision: 0,
    sectionId: undefined,
  })

  /**
   * @param ctx - the providing plugin's context.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsNavigation')
  }

  /**
   * Request that the Settings shell open a registered section.
   * @param sectionId - target settings.section registration id.
   */
  openSection(sectionId: string): void {
    const { requests } = this
    requests.set({
      revision: requests.getSnapshot().revision + 1,
      sectionId,
    })
  }
}
