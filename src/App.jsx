import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, Scatter,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { getRollingWindows, runFinalBacktest, DEFAULT_BOOSTER } from './lib/backtest'
import './App.css'

function fmtPct(v) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}
function fmtB(v) {
  return `${(v / 1e8).toFixed(2)}억`
}
function fmtMonthYear(d) {
  return d.slice(0, 7).replace('-', '.')
}

const RULES = [
  { label: 'MA 기간', value: '180일' },
  { label: '이격도 기준', value: '> 40%' },
  { label: 'RSI(14)', value: '≥ 70' },
  { label: '수익률 기준', value: '≥ 25%' },
  { label: '매도 비율', value: '주식 70%' },
  { label: '매도 쿨다운', value: '10거래일' },
  { label: '수요일 적립금', value: '85만원' },
  { label: 'POOL 재투자', value: '매주 5%' },
  { label: 'POOL 비중 캡', value: '≤2억시 10%' },
]

function RulesPanel() {
  return (
    <div className="rules-panel">
      <div className="rules-grid">
        {RULES.map(r => (
          <div key={r.label} className="rule-item">
            <div className="rule-label">{r.label}</div>
            <div className="rule-value">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BoosterPanel({ booster, onChange }) {
  const update = (field, value) => onChange({ ...booster, [field]: value })
  return (
    <div className="rules-panel" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0' }}>
          <input
            type="checkbox"
            checked={booster.enabled}
            onChange={e => update('enabled', e.target.checked)}
          />
          POOL 부스터 (60거래일 고점 대비 급락 시 재투자 비율 상향)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#9ca3af' }}>
          하락 임계치
          <input
            type="number" min={5} max={70} step={1}
            value={booster.drawdownPct}
            onChange={e => update('drawdownPct', Number(e.target.value))}
            disabled={!booster.enabled}
            style={{ width: 56 }}
          />
          %
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#9ca3af' }}>
          재투자 비율
          <input
            type="number" min={5} max={100} step={1}
            value={booster.ratioPct}
            onChange={e => update('ratioPct', Number(e.target.value))}
            disabled={!booster.enabled}
            style={{ width: 56 }}
          />
          %
        </label>
      </div>
    </div>
  )
}

function WindowGrid({ windows, selected, onSelect }) {
  return (
    <div className="window-grid">
      {windows.map(w => {
        const { returnPct } = w.stats
        const colorClass = returnPct > 150 ? 'green' : returnPct > 80 ? 'yellow' : 'red'
        const isSelected = selected && selected.id === w.id
        return (
          <div
            key={w.id}
            className={`window-card ${colorClass}${isSelected ? ' selected' : ''}`}
            onClick={() => onSelect(w)}
          >
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
              {fmtMonthYear(w.startDate)}~{fmtMonthYear(w.endDate)}
            </div>
            <div style={{ fontSize: 13, color: '#e2e8f0' }}>
              수익률 {fmtPct(w.stats.returnPct)}&nbsp;&nbsp;CAGR {w.stats.cagr.toFixed(0)}%
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>
              MDD {w.stats.mdd.toFixed(1)}%&nbsp;&nbsp;매도 {w.stats.sellCount}회
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SellDot({ cx, cy }) {
  if (!cx || !cy) return null
  return (
    <polygon
      points={`${cx},${cy + 2} ${cx - 5},${cy - 7} ${cx + 5},${cy - 7}`}
      fill="#ef4444"
    />
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const total = (d.pool || 0) + (d.stock || 0)
  return (
    <div style={{
      background: '#1e2030', border: '1px solid #374151',
      padding: '10px 14px', borderRadius: 6, fontSize: 12,
    }}>
      <p style={{ color: '#9ca3af', margin: '0 0 4px' }}>{label}</p>
      <p style={{ color: '#e2e8f0', margin: '2px 0' }}>총자산: {(total / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#10b981', margin: '2px 0' }}>주식: {((d.stock || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#3b82f6', margin: '2px 0' }}>POOL: {((d.pool || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#9ca3af', margin: '2px 0' }}>투입: {((d.totalIn || 0) / 1e8).toFixed(2)}억</p>
    </div>
  )
}

function BacktestDetail({ window: win, booster }) {
  const { daily, trades, stats } = useMemo(
    () => runFinalBacktest(win.startDate, win.endDate, booster),
    [win.startDate, win.endDate, booster]
  )

  const sellDates = useMemo(() => new Set(trades.map(t => t.date)), [trades])

  const chartData = useMemo(() => {
    return daily
      .filter((d, i) => i % 5 === 0 || sellDates.has(d.date))
      .map(d => ({
        date: d.date,
        pool: d.pool,
        stock: d.stockValue,
        totalIn: d.totalIn,
        sell: sellDates.has(d.date) ? d.total : null,
      }))
  }, [daily, sellDates])

  return (
    <section style={{ marginTop: 20 }}>
      <div className="stats-bar">
        <div className="stat-item">
          <span className="label">기간</span>
          <span className="value" style={{ fontSize: 13 }}>{stats.startDate} ~ {stats.endDate}</span>
        </div>
        <div className="stat-item">
          <span className="label">총자산</span>
          <span className="value">{fmtB(stats.finalTotal)}</span>
        </div>
        <div className="stat-item">
          <span className="label">수익률</span>
          <span className="value">{fmtPct(stats.returnPct)}</span>
        </div>
        <div className="stat-item">
          <span className="label">CAGR</span>
          <span className="value">{fmtPct(stats.cagr)}</span>
        </div>
        <div className="stat-item">
          <span className="label">MDD</span>
          <span className="value">{stats.mdd.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="label">매도횟수</span>
          <span className="value">{stats.sellCount}회</span>
        </div>
        <div className="stat-item">
          <span className="label">투입자본</span>
          <span className="value">{fmtB(stats.totalIn)}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
          <XAxis dataKey="date" minTickGap={80} />
          <YAxis tickFormatter={v => `${(v / 1e8).toFixed(1)}억`} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone" dataKey="pool" stackId="1"
            fill="#3b82f6" fillOpacity={0.6} stroke="#3b82f6" strokeWidth={1}
            isAnimationActive={false}
          />
          <Area
            type="monotone" dataKey="stock" stackId="1"
            fill="#10b981" fillOpacity={0.6} stroke="#10b981" strokeWidth={1}
            isAnimationActive={false}
          />
          <Line
            type="monotone" dataKey="totalIn"
            stroke="#9ca3af" strokeDasharray="4 3" strokeWidth={1.5}
            dot={false} isAnimationActive={false}
          />
          <Scatter dataKey="sell" shape={<SellDot />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <table className="sell-table">
        <thead>
          <tr>
            <th>#</th>
            <th style={{ textAlign: 'left' }}>날짜</th>
            <th>가격$</th>
            <th>수익률</th>
            <th>RSI</th>
            <th>이격도</th>
            <th>POOL잔액</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.sellNo}>
              <td>{t.sellNo}</td>
              <td style={{ textAlign: 'left' }}>{t.date}</td>
              <td>${t.priceUSD.toFixed(2)}</td>
              <td style={{ color: t.returnPct >= 0 ? '#10b981' : '#ef4444' }}>
                {fmtPct(t.returnPct)}
              </td>
              <td>{t.rsi.toFixed(1)}</td>
              <td>{t.disp.toFixed(1)}%</td>
              <td>{fmtB(t.poolAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function App() {
  const [booster, setBooster] = useState(DEFAULT_BOOSTER)
  const windows = useMemo(() => getRollingWindows(booster), [booster])
  const [sel, setSel] = useState(null)

  return (
    <div className="page">
      <header><h1>TQQQ MA180 전략 대시보드</h1></header>
      <RulesPanel />
      <BoosterPanel booster={booster} onChange={setBooster} />
      <section className="section-title">5년 롤링 윈도우 (분기별)</section>
      <WindowGrid windows={windows} selected={sel} onSelect={setSel} />
      {sel && <BacktestDetail window={sel} booster={booster} />}
    </div>
  )
}

export default App
