import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, Scatter, ReferenceArea,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { getRollingWindows, runFinalBacktest, DEFAULT_SETTINGS, DATA_START, DATA_END } from './lib/backtest'
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

const FIXED_RULES = [
  { label: 'MA 기간', value: '180일' },
  { label: '이격도 기준', value: '> 40%' },
  { label: 'RSI(14)', value: '≥ 70' },
  { label: '수익률 기준', value: '≥ 25%' },
  { label: '매도 비율', value: '주식 70%' },
  { label: '매도 쿨다운', value: '10거래일' },
]

function RulesPanel() {
  return (
    <div className="rules-panel">
      <div className="rules-grid">
        {FIXED_RULES.map(r => (
          <div key={r.label} className="rule-item">
            <div className="rule-label">{r.label}</div>
            <div className="rule-value">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StrategyInfo() {
  return (
    <div className="rules-panel info-panel-static">
      <h3 className="panel-heading">전략 설명</h3>
      <div className="info-body">
        <p>
          <b>매수</b> — 시작일에 초기 투입금을 일시 매수하고, 이후 매주 수요일마다 정액을 적립매수합니다.
        </p>
        <p>
          <b>매도</b> — <i>주가가 180일 이동평균보다 40%를 초과해서 높고</i>, <i>RSI(14)가 70 이상</i>이고,
          <i> 평단가 대비 수익률이 25% 이상</i>인 세 조건을 동시에 만족하면 보유 주식의 70%를 매도합니다.
          매도 직후 10거래일 동안은 재매도하지 않습니다(쿨다운).
        </p>
        <p>
          <b>POOL 재투자</b> — 매도로 확보한 현금은 POOL에 쌓이고, 매주 수요일 POOL 잔고의 5%가
          정액 적립금과 함께 재투자됩니다. 단 총자산이 설정한 비중캡 기준 이하일 때 POOL 비중이
          10%를 넘으면, 초과분을 즉시 매수해 현금이 과도하게 쌓이지 않게 합니다.
        </p>
        <p>
          <b>POOL 부스터(옵션)</b> — 최근 N거래일(기본 60일) 고점 대비 설정한 낙폭(기본 -25%) 이상
          하락한 주에는, 평소 5%였던 POOL 재투자 비율을 설정한 값(기본 25%)까지 올려서 급락 구간에
          더 공격적으로 재투자합니다. 짧고 굵게 끝나는 급락에는 유리하지만, 2022년처럼 길게 끄는
          약세장에서는 평단가를 오히려 높일 수 있다는 점이 백테스트로 확인됐습니다.
        </p>
        <p>
          <b>파라미터</b> — 초기 투입금, 수요일 적립금, POOL 비중캡 기준, 부스터 조건은 상단
          파라미터 패널에서 직접 바꾸고 "적용"을 누르면 모든 백테스트(롤링 윈도우 + 직접 기간 설정)에
          한번에 반영됩니다.
        </p>
      </div>
    </div>
  )
}

function numField(label, value, onChange, opts = {}) {
  return (
    <label key={label} className="param-field">
      <span>{label}</span>
      <span className="param-input">
        <input
          type="number" min={opts.min ?? 0} max={opts.max} step={opts.step ?? 1}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          disabled={opts.disabled}
        />
        <em>{opts.unit}</em>
      </span>
    </label>
  )
}

function ParametersPanel({ draft, onDraftChange, onApply, dirty }) {
  const set = (field, value) => onDraftChange({ ...draft, [field]: value })
  return (
    <div className="rules-panel param-panel">
      <h3 className="panel-heading">파라미터 설정</h3>
      <div className="param-grid">
        {numField('초기 투입금', draft.initialKRW / 1e8, v => set('initialKRW', v * 1e8), { step: 0.1, unit: '억원' })}
        {numField('수요일 적립금', draft.weeklyKRW / 10000, v => set('weeklyKRW', v * 10000), { step: 5, unit: '만원' })}
        {numField('POOL 비중캡 기준', draft.poolCapKRW / 1e8, v => set('poolCapKRW', v * 1e8), { step: 0.1, unit: '억원' })}
      </div>

      <div className="param-divider" />

      <label className="param-checkbox">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={e => set('enabled', e.target.checked)}
        />
        POOL 부스터 사용 (고점 대비 급락 시 재투자 비율 상향)
      </label>
      <div className="param-grid">
        {numField('기준 고점 기간', draft.lookback, v => set('lookback', v), { min: 5, max: 250, step: 5, unit: '거래일', disabled: !draft.enabled })}
        {numField('하락 임계치', draft.drawdownPct, v => set('drawdownPct', v), { min: 5, max: 70, step: 1, unit: '%', disabled: !draft.enabled })}
        {numField('재투자 비율', draft.ratioPct, v => set('ratioPct', v), { min: 5, max: 200, step: 1, unit: '%', disabled: !draft.enabled })}
      </div>

      <button type="button" className="run-btn apply-btn" onClick={onApply} disabled={!dirty}>
        {dirty ? '적용' : '적용됨'}
      </button>
    </div>
  )
}

function CustomRangeForm({ onRun }) {
  const [startDate, setStartDate] = useState(DATA_START)
  const [endDate, setEndDate] = useState(DATA_END)
  const [err, setErr] = useState(null)

  const submit = e => {
    e.preventDefault()
    if (startDate >= endDate) { setErr('시작일이 종료일보다 빨라야 합니다'); return }
    if (startDate < DATA_START || endDate > DATA_END) { setErr(`데이터 범위(${DATA_START} ~ ${DATA_END}) 안에서 선택해주세요`); return }
    setErr(null)
    onRun({ id: `custom-${startDate}-${endDate}`, startDate, endDate })
  }

  return (
    <form onSubmit={submit} className="rules-panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <h3 className="panel-heading" style={{ width: '100%' }}>직접 기간 설정</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#9ca3af' }}>
        시작일
        <input type="date" value={startDate} min={DATA_START} max={DATA_END}
          onChange={e => setStartDate(e.target.value)} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#9ca3af' }}>
        종료일
        <input type="date" value={endDate} min={DATA_START} max={DATA_END}
          onChange={e => setEndDate(e.target.value)} />
      </label>
      <button type="submit" className="run-btn" style={{ marginTop: 0, padding: '8px 18px', fontSize: 13 }}>
        기간 조회
      </button>
      {err && <span className="error" style={{ marginTop: 0 }}>{err}</span>}
    </form>
  )
}

function Sidebar({ view, onSelect }) {
  const items = [
    { id: 'rolling', label: '5년 롤링 윈도우' },
    { id: 'custom', label: '직접 기간 설정' },
    { id: 'info', label: '전략 설명 보기' },
  ]
  return (
    <nav className="sidebar">
      {items.map(it => (
        <button
          key={it.id}
          className={`sidebar-item${view === it.id ? ' active' : ''}`}
          onClick={() => onSelect(it.id)}
        >
          {it.label}
        </button>
      ))}
    </nav>
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
      <p style={{ color: '#f3f4f6', margin: '2px 0' }}>TQQQ 가격: ${d.priceUSD != null ? d.priceUSD.toFixed(2) : '-'}</p>
      <p style={{ color: '#f3f4f6', margin: '2px 0' }}>RSI(14): {d.rsi != null && !isNaN(d.rsi) ? d.rsi.toFixed(1) : '-'}</p>
      <p style={{ color: '#f3f4f6', margin: '2px 0' }}>180일 이격도: {d.disp != null && !isNaN(d.disp) ? `${d.disp.toFixed(1)}%` : '-'}</p>
      <p style={{ color: '#e2e8f0', margin: '6px 0 2px' }}>총자산: {(total / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#10b981', margin: '2px 0' }}>주식: {((d.stock || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#3b82f6', margin: '2px 0' }}>POOL: {((d.pool || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#9ca3af', margin: '2px 0' }}>투입: {((d.totalIn || 0) / 1e8).toFixed(2)}억</p>
    </div>
  )
}

function BacktestDetail({ window: win, settings }) {
  const { daily, trades, stats } = useMemo(
    () => runFinalBacktest(win.startDate, win.endDate, settings),
    [win.startDate, win.endDate, settings]
  )

  const sellDates = useMemo(() => new Set(trades.map(t => t.date)), [trades])

  // 부스터 발동(조건 충족) 구간을 연속 구간으로 묶어서 차트 음영 표시용으로 변환
  const boostRanges = useMemo(() => {
    const ranges = []
    let start = null
    for (let i = 0; i < daily.length; i++) {
      if (daily[i].boostCond && start === null) start = daily[i].date
      if (!daily[i].boostCond && start !== null) {
        ranges.push([start, daily[i - 1].date])
        start = null
      }
    }
    if (start !== null) ranges.push([start, daily[daily.length - 1].date])
    return ranges
  }, [daily])
  const boostBoundaryDates = useMemo(() => new Set(boostRanges.flat()), [boostRanges])

  const chartData = useMemo(() => {
    return daily
      .filter((d, i) => i % 5 === 0 || sellDates.has(d.date) || boostBoundaryDates.has(d.date))
      .map(d => ({
        date: d.date,
        pool: d.pool,
        stock: d.stockValue,
        totalIn: d.totalIn,
        priceUSD: d.priceUSD,
        rsi: d.rsi,
        disp: d.disp,
        sell: sellDates.has(d.date) ? d.total : null,
      }))
  }, [daily, sellDates, boostBoundaryDates])

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
        {settings.enabled && (
          <div className="stat-item">
            <span className="label">부스터 발동</span>
            <span className="value">{stats.boostedWeeks}/{stats.totalWeeks}주</span>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
          <XAxis dataKey="date" minTickGap={80} />
          <YAxis tickFormatter={v => `${(v / 1e8).toFixed(1)}억`} width={55} />
          <Tooltip content={<CustomTooltip />} />
          {boostRanges.map(([s, e]) => (
            <ReferenceArea key={`${s}-${e}`} x1={s} x2={e} fill="#f59e0b" fillOpacity={0.14} strokeOpacity={0} ifOverflow="visible" />
          ))}
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
      {settings.enabled && boostRanges.length > 0 && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: -18, marginBottom: 18 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#f59e0b', opacity: 0.4, marginRight: 6, verticalAlign: 'middle' }} />
          음영 구간 = POOL 부스터 발동 중 (고점 대비 -{settings.drawdownPct}% 이상 하락)
        </div>
      )}

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
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [draft, setDraft] = useState(DEFAULT_SETTINGS)
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const windows = useMemo(() => getRollingWindows(settings), [settings])
  const [sel, setSel] = useState(null)
  const [view, setView] = useState('rolling')

  const applySettings = () => setSettings(draft)

  return (
    <div className="page">
      <header>
        <h1>TQQQ MA180 전략 대시보드</h1>
        <div className="sub">데이터 최신일: {DATA_END} (매일 자동 갱신)</div>
      </header>
      <RulesPanel />
      <ParametersPanel draft={draft} onDraftChange={setDraft} onApply={applySettings} dirty={dirty} />

      <div className="layout">
        <Sidebar view={view} onSelect={id => { setView(id); if (id !== 'custom') setSel(null) }} />
        <div className="main-content">
          {view === 'info' && <StrategyInfo />}

          {view === 'custom' && (
            <>
              <CustomRangeForm onRun={setSel} />
              {sel && sel.id.startsWith('custom-') && <BacktestDetail window={sel} settings={settings} />}
            </>
          )}

          {view === 'rolling' && (
            <>
              <section className="section-title">5년 롤링 윈도우 (분기별)</section>
              <WindowGrid windows={windows} selected={sel} onSelect={setSel} />
              {sel && !sel.id.toString().startsWith('custom-') && <BacktestDetail window={sel} settings={settings} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
