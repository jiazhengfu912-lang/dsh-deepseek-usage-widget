/** Package-owned invariant companion. @module @deepseek-ai/dsh-deepseek-usage-widget/invariant */

const PACKAGE_NAME = '@deepseek-ai/dsh-deepseek-usage-widget'

export const name = 'deepseek-usage-widget-invariant'
export const inject = ['invariants']

export function apply(ctx: { invariants: { register: (packageName: string, install: () => void) => () => void } }): void {
  ctx.invariants.register(PACKAGE_NAME, () => {})
}
