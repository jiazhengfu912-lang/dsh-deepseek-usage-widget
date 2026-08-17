/**
 * DeepSeek API usage floating widget — browser half.
 * Registers the frame-wide `shell.overlay` entry and renders the floating
 * collapsed card / expanded dashboard, reading the Host-owned snapshot route.
 * @module @deepseek-ai/dsh-deepseek-usage-widget/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { FloatingWidget } from './widget.tsx'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'deepseek-usage-widget', order: 100 },
    FloatingWidget,
  ))
}
