/**
 * DeepSeek API usage floating widget — Host half.
 *
 * Owns everything secret or durable: resolves `DEEPSEEK_API_KEY` through the
 * credentials seam, fetches the official balance endpoint, incrementally folds
 * `assistant/message` usage events into per-day totals, persists both the
 * widget position and the daily cache through the storage domain, and serves
 * one JSON snapshot (plus a position write and a manual refresh) over three
 * package-owned HTTP routes. The API key never leaves this process.
 *
 * @module @deepseek-ai/dsh-deepseek-usage-widget
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'
const BALANCE_REFRESH_MS = 60_000
const PERSIST_DEBOUNCE_MS = 2_000

/** Official unit prices (CNY per 1M tokens), base flat rates. */
const INPUT_PRICE = 1.0
const CACHE_HIT_PRICE = 0.02
const OUTPUT_PRICE = 2.0

/** One day's aggregated usage, persisted verbatim. */
const dailyUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  reasoningTokens: z.number().nonnegative(),
  requests: z.number().int().nonnegative(),
})

type DailyUsage = z.infer<typeof dailyUsageSchema>

/** The single durable record: widget position plus the whole daily fold. */
const stateSchema = z.object({
  position: z.object({ x: z.number(), y: z.number() }),
  daily: z.record(z.string(), dailyUsageSchema),
})

type WidgetState = z.infer<typeof stateSchema>

const widgetDomainSpec = defineDomain({
  name: 'deepseek_usage_widget',
  version: 0,
  tables: {
    state: domainTable<string, WidgetState>(stateSchema),
  },
})

interface BalanceState {
  kind: 'no-key' | 'loading' | 'success' | 'error'
  available: boolean | undefined
  currency: string | undefined
  total: number | undefined
  granted: number | undefined
  toppedUp: number | undefined
  updatedAt: number | undefined
  error: string | undefined
}

function emptyBalance(kind: BalanceState['kind']): BalanceState {
  return { kind, available: undefined, currency: undefined, total: undefined, granted: undefined, toppedUp: undefined, updatedAt: undefined, error: undefined }
}

function localDayKey(ms: number): string {
  const d = new Date(ms)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function dayKeyToMs(key: string): number {
  const parts = key.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  return new Date(y, m - 1, d).getTime()
}

function estimateCost(u: DailyUsage): number {
  return (u.inputTokens * INPUT_PRICE + u.cacheReadTokens * CACHE_HIT_PRICE + u.outputTokens * OUTPUT_PRICE) / 1_000_000
}

export default class DeepSeekUsageWidgetService extends Service {
  static inject = ['credentials', 'storageDomain', 'webServer']

  private domain?: Domain<typeof widgetDomainSpec>
  private table?: KvTable<string, WidgetState>
  private position: { x: number; y: number } = { x: 24, y: 24 }
  private readonly daily = new Map<string, DailyUsage>()
  private balance: BalanceState = emptyBalance('no-key')
  private persistTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context) {
    super(ctx, 'deepseekUsageWidget')
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(widgetDomainSpec)
    this.domain = domain
    this.table = domain.table('state')

    const stored = this.table.get('state')
    if (stored !== undefined) {
      this.position = stored.position
      for (const [key, value] of Object.entries(stored.daily)) this.daily.set(key, value)
    }

    this.ctx.effect(() => () => {
      if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
      void this.domain?.close()
    }, 'deepseek-usage-widget: domain close')
    this.ctx.on('session/event', (_session, event: SessionEvent) => { this.observe(event) })

    this.ctx.effect(() => {
      const offSnapshot = this.ctx.webServer.register({
        kind: 'exact',
        path: '/deepseek-usage/snapshot',
        handler: (req, res) => { void this.serveSnapshot(req, res) },
      })
      const offPosition = this.ctx.webServer.register({
        kind: 'exact',
        path: '/deepseek-usage/position',
        handler: (req, res) => { void this.servePosition(req, res) },
      })
      const offRefresh = this.ctx.webServer.register({
        kind: 'exact',
        path: '/deepseek-usage/refresh',
        handler: (req, res) => { void this.serveRefresh(req, res) },
      })
      return () => { offSnapshot(); offPosition(); offRefresh() }
    }, 'deepseek-usage-widget: routes')

    await this.refreshBalance()
    const intervalId = setInterval(() => { void this.refreshBalance() }, BALANCE_REFRESH_MS)
    this.ctx.effect(() => () => { clearInterval(intervalId) }, 'deepseek-usage-widget: balance interval')
  }

  private observe(event: SessionEvent): void {
    if (event.type !== 'assistant/message') return
    const usage = event.data.usage
    if (usage === undefined) return
    const key = localDayKey(event.time)
    const prev = this.daily.get(key) ?? { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, requests: 0 }
    const next: DailyUsage = {
      inputTokens: prev.inputTokens + usage.inputTokens,
      cacheReadTokens: prev.cacheReadTokens + (usage.cacheReadTokens ?? 0),
      outputTokens: prev.outputTokens + usage.outputTokens,
      reasoningTokens: prev.reasoningTokens + (usage.reasoningTokens ?? 0),
      requests: prev.requests + 1,
    }
    this.daily.set(key, next)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer !== undefined) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.persist()
    }, PERSIST_DEBOUNCE_MS)
  }

  private persist(): void {
    if (this.table === undefined) return
    const daily: Record<string, DailyUsage> = {}
    for (const [key, value] of this.daily) daily[key] = value
    void this.table.put('state', { position: this.position, daily })
  }

  private async refreshBalance(): Promise<void> {
    const hit = await this.ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))
    if (hit === undefined) {
      this.balance = emptyBalance('no-key')
      return
    }
    const previous = this.balance
    try {
      const res = await fetch(BALANCE_ENDPOINT, { headers: { authorization: `Bearer ${hit.value}` } })
      if (!res.ok) {
        const message = `balance endpoint HTTP ${res.status}`
        this.balance = previous.kind === 'success'
          ? { ...previous, error: message }
          : { ...emptyBalance('error'), error: message }
        return
      }
      const body = (await res.json()) as {
        is_available?: boolean
        balance_infos?: Array<{
          currency?: string
          total_balance?: string
          granted_balance?: string
          topped_up_balance?: string
        }>
      }
      // DeepSeek may return one entry per currency (CNY + USD). Prefer the CNY
      // entry, then the entry with the largest total, so a zero USD entry never
      // masks a real CNY balance.
      const infos = body.balance_infos ?? []
      const info = infos.find(entry => (entry.currency ?? '').toUpperCase() === 'CNY')
        ?? infos.reduce<typeof infos[number] | undefined>((best, entry) => {
          const cur = entry.total_balance === undefined ? -1 : Number(entry.total_balance)
          const bestValue = best?.total_balance === undefined ? -1 : Number(best.total_balance)
          return cur > bestValue ? entry : best
        }, undefined)
      this.balance = {
        kind: 'success',
        available: body.is_available === true,
        currency: info?.currency ?? 'CNY',
        total: info === undefined ? undefined : Number(info.total_balance),
        granted: info === undefined ? undefined : Number(info.granted_balance),
        toppedUp: info === undefined ? undefined : Number(info.topped_up_balance),
        updatedAt: Date.now(),
        error: undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.balance = previous.kind === 'success'
        ? { ...previous, error: message }
        : { ...emptyBalance('error'), error: message }
    }
  }

  private snapshot(): unknown {
    const days = [...this.daily.entries()].map(([date, u]) => ({
      date,
      inputTokens: u.inputTokens,
      cacheReadTokens: u.cacheReadTokens,
      outputTokens: u.outputTokens,
      reasoningTokens: u.reasoningTokens,
      requests: u.requests,
      cost: estimateCost(u),
    })).sort((a, b) => dayKeyToMs(a.date) - dayKeyToMs(b.date))
    return {
      balance: this.balance,
      position: this.position,
      days,
      pricing: { input: INPUT_PRICE, cacheHit: CACHE_HIT_PRICE, output: OUTPUT_PRICE, currency: 'CNY', estimated: true },
    }
  }

  private async serveSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
    const body = JSON.stringify(this.snapshot())
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(body)
  }

  private async servePosition(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { x?: unknown; y?: unknown }
      const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : this.position.x
      const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : this.position.y
      this.position = { x, y }
      this.persist()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON body' }))
    }
  }

  private async serveRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    await this.refreshBalance()
    const body = JSON.stringify(this.snapshot())
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(body)
  }
}
