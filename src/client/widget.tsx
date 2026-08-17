/**
 * Floating widget UI: collapsed Aurora card and expanded usage dashboard with
 * a CSS-driven morph, pointer drag, and position persistence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import css from './styles.module.css'

interface BalanceState {
  kind: 'no-key' | 'loading' | 'success' | 'error'
  available?: boolean
  currency?: string
  total?: number
  granted?: number
  toppedUp?: number
  updatedAt?: number
  error?: string
}

interface DayPoint {
  date: string
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens?: number
  requests: number
  cost: number
}

interface Snapshot {
  balance: BalanceState
  position: { x: number; y: number }
  days: DayPoint[]
  officialDays?: DayPoint[]
  pricing?: { currency: string; estimated: boolean }
}

const EMPTY: Snapshot = { balance: { kind: 'loading' }, position: { x: 24, y: 24 }, days: [], officialDays: [] }

function fmtMoney(value: number | undefined, currency: string | undefined): string {
  if (value === undefined) return '--.--'
  const c = (currency ?? 'CNY').toUpperCase()
  const symbol = c === 'USD' ? '$' : c === 'CNY' ? '¥' : `${c} `
  return `${symbol}${value.toFixed(2)}`
}

function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function sum(days: DayPoint[], pick: (d: DayPoint) => number): number {
  return days.reduce((acc, d) => acc + pick(d), 0)
}

export function FloatingWidget(): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 24 })
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost')
  const [range, setRange] = useState<'7d' | '30d'>('7d')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!expanded) return
    const onDown = (e: PointerEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('pointerdown', onDown) }
  }, [expanded])

  const applySnapshot = useCallback((data: Snapshot) => {
    setSnapshot(data)
    const p = data.position ?? { x: 24, y: 24 }
    // Clamp into the current viewport so a persisted off-screen position
    // (e.g. saved on a wider monitor) never hides the widget.
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - 240, p.x)),
      y: Math.max(8, Math.min(window.innerHeight - 120, p.y)),
    })
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/deepseek-usage/snapshot')
      if (!res.ok) return
      applySnapshot((await res.json()) as Snapshot)
    } catch {
      /* keep last-good */
    }
  }, [applySnapshot])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/deepseek-usage/refresh', { method: 'POST' })
      if (!res.ok) return
      applySnapshot((await res.json()) as Snapshot)
    } catch {
      /* keep last-good */
    }
  }, [applySnapshot])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 60_000)
    return () => { clearInterval(id) }
  }, [load])

  const savePosition = useCallback((next: { x: number; y: number }) => {
    setPos(next)
    void fetch('/deepseek-usage/position', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {})
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (expanded && target.closest('button')) return
    const startX = e.clientX
    const startY = e.clientY
    const startPos = pos
    let moved = false
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return
      moved = true
      setPos({
        x: clamp(startPos.x + dx, 8, window.innerWidth - 240),
        y: clamp(startPos.y + dy, 8, window.innerHeight - 120),
      })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        savePosition({
          x: clamp(startPos.x + dx, 8, window.innerWidth - 240),
          y: clamp(startPos.y + dy, 8, window.innerHeight - 120),
        })
      } else if (!expanded) {
        setExpanded(true)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [expanded, pos, savePosition])

  const isOfficial = (snapshot.officialDays?.length ?? 0) > 0
  const effectiveDays = isOfficial ? (snapshot.officialDays ?? []) : snapshot.days
  const today = effectiveDays[effectiveDays.length - 1]
  const rangeDays = useMemo(() => {
    const n = range === '7d' ? 7 : 30
    return effectiveDays.slice(-n)
  }, [effectiveDays, range])

  const totalCost = sum(effectiveDays, d => d.cost)
  const totalTokens = sum(effectiveDays, d => d.inputTokens + d.cacheReadTokens + d.outputTokens)
  const totalRequests = sum(effectiveDays, d => d.requests)

  const balance = snapshot.balance
  const available = balance.kind === 'success' ? balance.available === true : undefined

  return (
    <div
      ref={containerRef}
      className={expanded ? css.expanded : css.collapsed}
      style={{ left: pos.x, top: pos.y }}
      data-expanded={expanded}
    >
      {!expanded ? (
        <div
          role="button"
          tabIndex={0}
          className={css.collapsedCard}
          onPointerDown={onPointerDown}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(true) }}
        >
          <span className={css.brand}>DeepSeek</span>
          <span className={css.dot} data-ok={available} />
          <span className={css.balance}>
            {balance.kind === 'loading' ? '--.--' : fmtMoney(balance.total, balance.currency)}
          </span>
          <span className={css.caption}>API Balance</span>
        </div>
      ) : (
        <div className={css.panel} onPointerDown={onPointerDown}>
          <header className={css.header}>
            <div className={css.titleRow}>
              <span className={css.title}>DeepSeek Usage</span>
              <span className={css.dot} data-ok={available} />
              <span className={css.availability}>{available === true ? 'Available' : available === false ? 'Unavailable' : '—'}</span>
            </div>
            <div className={css.headerActions}>
              <span className={css.updated}>
                {balance.updatedAt !== undefined
                  ? `Last updated ${new Date(balance.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
              </span>
              <button type="button" onClick={() => { void refresh() }}>Refresh</button>
            </div>
          </header>

          <section className={css.section}>
            <div className={css.bigNumber}>{balance.kind === 'loading' ? '--.--' : fmtMoney(balance.total, balance.currency)}</div>
            <div className={css.caption}>Total Balance（总余额）</div>
            {balance.kind === 'no-key'
              ? <div className={css.notice}>No DEEPSEEK_API_KEY configured — balance unavailable.</div>
              : null}
            {balance.kind === 'error' || (balance.kind === 'success' && balance.error !== undefined)
              ? <div className={css.notice}>Unable to refresh{balance.error !== undefined ? ` — ${balance.error}` : ''}. Showing last known balance.</div>
              : null}
          </section>

          <section className={css.section}>
            <div className={css.kpis}>
              <div className={css.kpi}><span>Today Cost</span><b>{today !== undefined ? fmtMoney(today.cost, balance.currency) : '--'}</b></div>
              <div className={css.kpi}><span>Tokens (today)</span><b>{today !== undefined ? fmtTokens(today.inputTokens + today.cacheReadTokens + today.outputTokens) : '--'}</b></div>
              <div className={css.kpi}><span>Requests</span><b>{today !== undefined ? today.requests : '--'}</b></div>
            </div>
            <div className={css.subStats}>
              <span>Input {fmtTokens(today?.inputTokens ?? 0)}</span>
              <span>Cache hit {fmtTokens(today?.cacheReadTokens ?? 0)}</span>
              <span>Cache miss {fmtTokens(today?.inputTokens ?? 0)}</span>
              <span>Output {fmtTokens(today?.outputTokens ?? 0)}</span>
              {!isOfficial && <span>Reasoning {fmtTokens(today?.reasoningTokens ?? 0)}</span>}
            </div>
          </section>

          <section className={css.section}>
            <div className={css.trendHeader}>
              <span className={css.trendTitle}>Trend</span>
              <div className={css.toggles}>
                <button type="button" data-active={metric === 'cost'} onClick={() => { setMetric('cost') }}>Cost</button>
                <button type="button" data-active={metric === 'tokens'} onClick={() => { setMetric('tokens') }}>Tokens</button>
                <button type="button" data-active={range === '7d'} onClick={() => { setRange('7d') }}>7d</button>
                <button type="button" data-active={range === '30d'} onClick={() => { setRange('30d') }}>30d</button>
              </div>
            </div>
            <Trend days={rangeDays} metric={metric} />
            <div className={css.totals}>
              <span>Total cost {totalCost.toFixed(4)} · Tokens {fmtTokens(totalTokens)} · Requests {totalRequests}</span>
              <span className={css.estimate}>{isOfficial ? '官方数据 Official' : '本地估算 Estimated / local usage'}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function fmtAxis(value: number, metric: 'cost' | 'tokens'): string {
  return metric === 'cost' ? `¥${value.toFixed(2)}` : fmtTokens(value)
}

function Trend({ days, metric }: { days: DayPoint[]; metric: 'cost' | 'tokens' }): React.ReactNode {
  const [hover, setHover] = useState<number | null>(null)
  const W = 440
  const H = 160
  const padL = 44
  const padR = 10
  const padT = 10
  const padB = 22
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const n = days.length

  const values = days.map(d => metric === 'cost' ? d.cost : d.outputTokens + d.inputTokens + d.cacheReadTokens)
  const max = Math.max(1, ...values)

  const xOf = (i: number) => n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW
  const yOf = (v: number) => padT + plotH - (v / max) * plotH

  const linePath = n === 0 ? '' : values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const areaPath = n === 0 ? '' : `M${xOf(0).toFixed(1)},${padT + plotH} ` + values.map((v, i) => `L${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ') + ` L${xOf(n - 1).toFixed(1)},${padT + plotH} Z`

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = ((e.clientX - rect.left) - padL) / plotW
    const idx = Math.round(ratio * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, idx)))
  }

  const hovered = hover !== null && hover < n ? days[hover] : undefined
  const hoverTokens = hovered !== undefined ? hovered.outputTokens + hovered.inputTokens + hovered.cacheReadTokens : 0
  const tooltipLeft = hover !== null && n > 0 ? Math.max(0, Math.min(xOf(hover) - 80, W - 168)) : 0

  return (
    <div className={css.chartWrap} onMouseMove={onMove} onMouseLeave={() => { setHover(null) }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={css.chart} preserveAspectRatio="none">
        {[0, 0.5, 1].map((t, i) => {
          const y = padT + plotH - t * plotH
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} className={css.gridLine} />
              <text x={padL - 6} y={y + 3} className={css.axisLabel} textAnchor="end">{fmtAxis(t * max, metric)}</text>
            </g>
          )
        })}
        {n > 0 && [0, Math.floor((n - 1) / 2), n - 1].map((i) => {
          const d = days[i]
          if (d === undefined) return null
          return <text key={i} x={xOf(i)} y={H - 6} className={css.axisLabel} textAnchor="middle">{d.date.slice(5)}</text>
        })}
        {n > 0 && <polygon points={areaPath} className={css.chartArea} />}
        {n > 0 && <path d={linePath} className={css.chartLine} fill="none" />}
        {hover !== null && n > 0 && (
          <line x1={xOf(hover)} y1={padT} x2={xOf(hover)} y2={padT + plotH} className={css.hoverLine} />
        )}
        {hover !== null && n > 0 && (
          <circle cx={xOf(hover)} cy={yOf(values[hover] ?? 0)} r={3.5} className={css.hoverDot} />
        )}
      </svg>
      {hovered !== undefined && (
        <div className={css.tooltip} style={{ left: tooltipLeft }}>
          <div className={css.tooltipDate}>{hovered.date}</div>
          <div className={css.tooltipRow}>花费 Cost：¥{hovered.cost.toFixed(4)}</div>
          <div className={css.tooltipRow}>Tokens：{fmtTokens(hoverTokens)}</div>
          <div className={css.tooltipRow}>请求 Requests：{hovered.requests}</div>
        </div>
      )}
    </div>
  )
}
