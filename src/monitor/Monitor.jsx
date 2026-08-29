import { useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot, Scatter, Cell, Legend,
} from 'recharts'
import tqqqRaw from '../data/tqqq.json'
import qqqRaw from '../data/qqq.json'
import * as M from './compute.js'
import './monitor.css'

// ── 색 (다크 배경에서 6개 검사 통과한 조합) ──────────────────────────
const S1 = '#c98500', S2 = '#199e70', S3 = '#d95926', S4 = '#9085e9'
const INK = '#e8a33d', GRID = '#1c2528', MUTE = '#7c9490', TXT = '#dfe8e6'

const RANGES = [['all', '전체'], [10, '10년'], [5, '5년'], [3, '3년'], [1, '1년'], [0.5, '6개월']]
const MAS = [20, 50, 60, 100, 180]
// 화면 폭보다 점이 많아 봐야 보이지 않는다. 그리는 점만 솎아내고
// 지표·통계는 항상 일봉 전체로 계산한다.
const MAX_PTS = 900

// 신호 성능 — scripts/calibrate-bands.mjs 실측 (표본 = 사이클 고점 13개).
// 포착 = 고점 직전 21거래일 안에 신호가 켜졌는가, 체류 = 전체 거래일 중 켜진 비율.
// TQQQ 180일 이격도(편차%)·매도선 +40%·RSI 73 기준으로 재계산한 값이다.
const SIGPERF = [
  ['고정: 이격도≥+40% AND RSI≥73', 38.5, 2.4, 16, true],
  ['혼합: 이격도 국면선 AND RSI≥73', 46.2, 2.9, 15.9, false],
  ['RSI ≥73 단독', 53.8, 7.2, 7.5, false],
  ['적응형 AND (margin 0)', 61.5, 8.7, 7.1, false],
  ['이격도 ≥+40% 단독', 53.8, 8.9, 6, false],
  ['고정: 이격도≥+40% OR RSI≥73', 69.2, 13.7, 5.1, false],
]
// -30% 낙폭 사전경보 성능 — scripts/calibrate-bands.mjs 실측.
// 경보 시점 = -30%에 닿기 직전까지 켜져 있던 신호 구간의 시작일,
// 리드 = 그 날부터 -30% 도달일까지, 오경보 = 이후 1년 안에 -30%가 오지 않은 신호 구간 비율.
const WARNPERF = [
  ['매도조건 (이격도≥+40% & RSI≥73)', '8/13', '125일', '-1.4%', '23%'],
  ['QQQ 200일선 하향돌파', '11/13', '49일', '-29.8%', '20%'],
  ['QQQ 50일선 하향돌파', '13/13', '42일', '-17.5%', '39%'],
  ['고점대비 -10% 도달', '13/13', '60일', '-12.8%', '24%'],
]

// 파이프라인 전체가 13ms라 MA를 바꿀 때 통째로 다시 돌려도 문제없다.
// 행 객체를 재활용해 제자리에서 고치면 안 된다 — recharts가 차트에 넘긴
// 데이터를 내부 스토어에서 동결(dev)하기 때문에 두 번째 계산에서 터진다.
function useMonitor(ma, rsiN) {
  return useMemo(() => {
    const rows = M.buildSeries(tqqqRaw, qqqRaw)
    M.addDrawdown(rows)
    M.addIndicators(rows, ma, rsiN)
    const cycles = M.findCycles(rows)
    const fit = M.regimeFit(rows, cycles)
    M.addPeakLines(rows, fit)
    const marks = M.cycleMarks(cycles)
    const bands = M.bandStats(cycles)
    const now = M.nowStats(rows)
    const annual = M.annualStats(rows)
    const sim = M.simulate3x(rows)
    const px = rows.filter(r => r.px != null).map(r => r.px)
    const rolls = {
      act: [M.rollingStats(px, 5), M.rollingStats(px, 10)],
      sim: [M.rollingStats(sim.series.map(s => s.sim), 5), M.rollingStats(sim.series.map(s => s.sim), 10)],
    }
    return { rows, cycles, marks, fit, bands, now, annual, sim, rolls }
  }, [ma, rsiN])
}

const Tile = ({ label, value, unit, tone, sub }) => (
  <div className="mn-tile">
    <div className="k">{label}</div>
    <div className="v" style={{ color: tone }}>{value}<small>{unit}</small></div>
    <div className="n">{sub}</div>
  </div>
)

/**
 * rows = { dataKey: 포맷함수 }. 여기 정의된 키만 보여준다.
 * (마커용 Scatter 계열이 툴팁에 섞여 들어오는 것을 막는다)
 */
function TipBox({ active, payload, rows }) {
  if (!active || !payload?.length) return null
  const p0 = payload.find(p => p.payload?.ymd)?.payload
  const seen = new Set()
  const items = payload.filter(p => {
    if (!rows?.[p.dataKey] || p.value == null || seen.has(p.dataKey)) return false
    seen.add(p.dataKey); return true
  })
  if (!p0) return null
  return (
    <div className="mn-tip">
      <div className="t">{p0.ymd}</div>
      {items.map((p, i) => (
        <div className="r" key={i}>
          <span>{p.name}</span>
          <span style={{ color: p.color }}>{rows[p.dataKey](p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// 사이클 마커 — 26개뿐이라 ReferenceDot으로 직접 찍는다(깊은 낙폭은 큰 점).
// 화면 밖 점은 recharts가 알아서 버린다(ifOverflow 기본 discard).
const marksFor = (marks, key) => marks.map((m, i) => (
  m[key] == null ? null : (
    <ReferenceDot key={key + i} x={m.t} y={m[key]} r={m.deep ? 5.5 : 3.5}
      fill={m.kind === 'peak' ? S3 : S2} stroke="#12181a" strokeWidth={1.5} />
  )
))

// 이격도는 편차 표기라 부호를 붙여야 읽힌다 (+40% = 매도선, 0 = 이동평균선 위).
const sp = (v, d = 1) => (v == null || isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)

// 툴팁 element를 렌더마다 새로 만들면 recharts가 매번 다시 그린다. 모듈 고정.
const TIP_GROWTH = <TipBox rows={{ growth: v => Math.round(v).toLocaleString(), dd: v => v + '%' }} />
const TIP_DD = <TipBox rows={{ dd: v => v + '%' }} />
const TIP_PX = <TipBox rows={{ px: v => '$' + v.toFixed(2) }} />
const TIP_DISP = <TipBox rows={{ disp: v => sp(v), peakline: v => sp(v) }} />
const TIP_RSI = <TipBox rows={{ rsi: v => v.toFixed(1), peakline_r: v => v.toFixed(1) }} />
const TIP_SIM = <TipBox rows={{
  sim: v => v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString(),
  q1: v => Math.round(v).toLocaleString() }} />

const xTickFmt = (span) => (v) => {
  const y = Math.floor(v + 1e-6), m = Math.min(12, Math.max(1, Math.round((v - y) * 12) + 1))
  return span > 2.5 ? `'${String(y).slice(2)}` : `${String(y).slice(2)}.${m}`
}

export default function Monitor() {
  const [ma, setMa] = useState(180)
  const [range, setRange] = useState('all')
  const [end, setEnd] = useState(null)
  const [pin, setPin] = useState(null)
  const [tab, setTab] = useState('cycle')
  const D = useMonitor(ma, 14)
  const { rows, cycles, marks, fit, bands, now, annual, sim, rolls } = D

  const withPx = useMemo(() => rows.filter(r => r.px != null), [rows])
  const tFirst = withPx[0].t, tLast = withPx[withPx.length - 1].t
  const span = range === 'all' ? tLast - tFirst : range
  const maxEnd = tLast, minEnd = Math.min(tFirst + span, tLast)
  const tEnd = Math.min(maxEnd, Math.max(minEnd, end ?? tLast))
  const tStart = tEnd - span
  // 넓게 볼 때만 솎아낸다. 1~3년으로 좁히면 일봉 그대로 나온다.
  // 사이클 고점·저점 날짜는 반드시 남긴다 — 솎이면 축 자동범위가 그만큼
  // 좁아져서 그 자리에 찍을 마커가 범위 밖으로 버려진다.
  const markT = useMemo(() => new Set(marks.map(m => m.t)), [marks])
  const view = useMemo(() => {
    const w = withPx.filter(r => r.t >= tStart - 0.02 && r.t <= tEnd + 0.02)
    if (w.length <= MAX_PTS) return w
    const step = Math.ceil(w.length / MAX_PTS)
    const out = w.filter((r, i) => i % step === 0 || markT.has(r.t))
    if (out[out.length - 1] !== w[w.length - 1]) out.push(w[w.length - 1])
    return out
  }, [withPx, tStart, tEnd, markT])

  // ④ 장기전망은 1999년부터 6,900일이라 같은 이유로 솎아낸다(구간 고정).
  const simView = useMemo(() => {
    const step = Math.ceil(sim.series.length / MAX_PTS)
    return step <= 1 ? sim.series : sim.series.filter((_, i) => i % step === 0)
  }, [sim])

  const shift = d => setEnd(Math.min(maxEnd, Math.max(minEnd, tEnd + d)))
  const xf = useMemo(() => xTickFmt(span), [span])
  const ticks = useMemo(() => {
    const st = span > 12 ? 2 : span > 6 ? 1 : span > 2.5 ? 0.5 : span > 1.2 ? 0.25 : 1 / 12
    const out = []
    for (let v = Math.ceil(tStart / st) * st; v <= tEnd; v += st) out.push(+v.toFixed(4))
    return out
  }, [span, tStart, tEnd])

  const XA = useMemo(() => ({ dataKey: 't', type: 'number', domain: [tStart, tEnd], ticks, tickFormatter: xf,
    tick: { fill: MUTE, fontSize: 10.5 }, axisLine: { stroke: '#1f2b2e' }, tickLine: false, allowDataOverflow: true }),
  [tStart, tEnd, ticks, xf])
  // recharts는 차트 위 mousemove가 선행돼야 activeLabel을 채운다.
  // 값을 못 잡은 클릭은 무시해야 고정이 엉뚱하게 유지되지 않는다.
  const onClickChart = useCallback(e => {
    const x = e?.activeLabel
    if (typeof x !== 'number') return
    setPin(p => (p != null && Math.abs(p - x) < 1e-9) ? null : x)
  }, [])
  const pinLine = () => pin == null ? null
    : <ReferenceLine x={pin} stroke={INK} strokeWidth={1.4} ifOverflow="extendDomain" />

  // 고정된 지점의 실제 행 — 선만 고정되고 값이 사라지지 않도록 별도 표시
  const pinRow = useMemo(() => {
    if (pin == null) return null
    let best = null, bd = Infinity
    for (const r of view) {
      const g = Math.abs(r.t - pin)
      if (g < bd) { bd = g; best = r }
    }
    return best
  }, [pin, view])

  const TABS = [['cycle', '① 성장·낙폭'], ['disp', '② 가격·이격도·RSI'],
    ['regime', '③ 국면 분석'], ['outlook', '④ 장기전망']]

  return (
    <div className="monitor">
      <div className="mn-head">
        <h2>TQQQ 포지셔닝 모니터</h2>
        <span className="mn-sub">상장 2010.2.11 ~ {now.date} · 일봉 {withPx.length.toLocaleString()}건 · 자동 갱신</span>
      </div>

      <div className="mn-rail">
        <Tile label="성장지수 (상장=100)" value={now.growth.toLocaleString()} tone={S1}
          sub={`$${now.price} · ${now.years}년 CAGR ${now.cagr}%`} />
        <Tile label="사상최고 대비 낙폭" value={now.dd} unit="%" tone={now.dd < -20 ? S3 : TXT}
          sub={`역대 최악 ${now.mdd_all}% (2022.12)`} />
        <Tile label={`TQQQ ${ma}일선 이격도`} value={sp(now.disp)}
          tone={now.disp >= bands.up_disp ? S3 : now.disp <= bands.dn_disp ? S2 : TXT}
          sub={`매도선 ${sp(bands.up_disp, 0)}${ma === 180 ? '' : ' (180일 기준)'} · 실측 고점 중앙 ${sp(bands.peak_disp.med)}`} />
        <Tile label="TQQQ RSI(14)" value={now.rsi}
          tone={now.rsi >= bands.up_rsi ? S3 : now.rsi <= bands.dn_rsi ? S2 : TXT}
          sub={`매도선 ${bands.up_rsi} · 실측 고점 중앙 ${bands.peak_rsi.med} / 저점 ${bands.trough_rsi.med}`} />
        <Tile label="전략 매도조건" value={now.combo ? '충족' : '미충족'}
          tone={now.combo ? S3 : S2}
          sub={`이격도>${sp(bands.up_disp, 0)} AND RSI≥${bands.up_rsi} — 매도조건 상황판과 같은 기준(수익률 25% 조건 제외)`} />
      </div>

      <div className="mn-tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={`mn-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {(tab === 'cycle' || tab === 'disp') && (
        <div className="mn-ctl">
          <span className="ck">기간</span>
          {RANGES.map(([v, l]) => (
            <button key={l} className={`mn-tab sm${range === v ? ' on' : ''}`}
              onClick={() => { setRange(v); setEnd(null) }}>{l}</button>
          ))}
          {tab === 'disp' && <>
            <span className="ck" style={{ marginLeft: 10 }}>이격도 MA</span>
            {MAS.map(v => (
              <button key={v} className={`mn-tab sm${ma === v ? ' on' : ''}`} onClick={() => setMa(v)}>{v}일</button>
            ))}
          </>}
          {pin != null && <button className="mn-tab sm" onClick={() => setPin(null)}>📌 고정 해제</button>}
        </div>
      )}
      {(tab === 'cycle' || tab === 'disp') && range !== 'all' && (
        <div className="mn-scroll">
          <button className="mn-tab sm" onClick={() => shift(-span * 0.4)}>◀</button>
          <input type="range" min={minEnd} max={maxEnd} step={0.01} value={tEnd}
            onChange={e => setEnd(+e.target.value)} aria-label="기간 좌우 이동" />
          <button className="mn-tab sm" onClick={() => shift(span * 0.4)}>▶</button>
          <span className="ck">{xf(tStart)} ~ {xf(tEnd)}</span>
        </div>
      )}

      {/* 고정된 지점의 값 — 마우스를 떼도 유지된다 */}
      {(tab === 'cycle' || tab === 'disp') && pinRow && (
        <div className="mn-pinbar">
          <span className="pd">📌 {pinRow.ymd}</span>
          <span className="pv"><i>TQQQ</i>${pinRow.px?.toFixed(2)}</span>
          <span className="pv"><i>고점대비</i><b style={{ color: pinRow.dd <= -30 ? S3 : TXT }}>{pinRow.dd?.toFixed(1)}%</b></span>
          <span className="pv"><i>이격도(MA{ma})</i>
            <b style={{ color: pinRow.disp >= bands.up_disp ? S3 : pinRow.disp <= bands.dn_disp ? S2 : TXT }}>
              {sp(pinRow.disp)}</b></span>
          <span className="pv"><i>국면 예상고점</i>{sp(pinRow.peakline)}</span>
          <span className="pv"><i>RSI(14)</i>
            <b style={{ color: pinRow.rsi >= bands.up_rsi ? S3 : pinRow.rsi <= bands.dn_rsi ? S2 : TXT }}>
              {pinRow.rsi?.toFixed(1)}</b></span>
          <span className="pv"><i>성장지수</i>{pinRow.growth?.toLocaleString()}</span>
          {pinRow.disp >= bands.up_disp && pinRow.rsi >= bands.up_rsi &&
            <span className="pv sig">전략 매도조건 충족</span>}
          <button className="mn-tab sm" onClick={() => setPin(null)}>해제</button>
        </div>
      )}

      {/* ① 성장 · 낙폭 */}
      {tab === 'cycle' && (
        <>
          <p className="mn-note">TQQQ 성장지수(상장=100, 로그 축)와 고점 대비 낙폭. 점은 {bands.mdd_th}% 이상 하락 사이클 {bands.n}회의 <b style={{ color: S3 }}>고점</b>·<b style={{ color: S2 }}>저점</b>(큰 점 = 깊은 낙폭).</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={view} syncId="mn" onClick={onClickChart} margin={{ top: 10, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...XA} />
              <YAxis scale="log" domain={['auto', 'auto']} width={64} tick={{ fill: MUTE, fontSize: 10 }}
                axisLine={false} tickLine={false} tickFormatter={v => Math.round(v).toLocaleString()} />
              <Tooltip content={TIP_GROWTH} />
              <Line type="monotone" dataKey="growth" name="성장지수" stroke={S1} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              {marksFor(marks, 'growth')}
              {pinLine()}
            </ComposedChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={view} syncId="mn" onClick={onClickChart} margin={{ top: 4, right: 18, left: 4, bottom: 5 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...XA} />
              <YAxis domain={[-90, 0]} ticks={[0, -20, -40, -60, -80]} width={64}
                tickFormatter={v => v + '%'} tick={{ fill: MUTE, fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={-40} stroke={S3} strokeOpacity={0.45} />
              <Tooltip content={TIP_DD} />
              <Area type="monotone" dataKey="dd" name="고점대비 낙폭" stroke={S3} strokeWidth={1.4} fill={S3} fillOpacity={0.22} dot={false} isAnimationActive={false} />
              {pinLine()}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mn-note">{bands.mdd_th}% 이상 하락 사이클 {bands.n}회 — 그중 {bands.deep_th}% 이상 깊은 낙폭 {bands.n_deep}회</p>
          <div className="mn-tw">
            <table>
              <thead><tr><th>#</th><th>고점</th><th>저점</th><th>최대낙폭</th><th>저점→회복</th><th>이격도</th><th>RSI</th><th>유형</th></tr></thead>
              <tbody>
                {cycles.map(c => (
                  <tr key={c.no} style={{ opacity: c.deep ? 1 : 0.72 }}>
                    <td>{c.no}</td><td>{c.pk.ymd}</td>
                    <td style={{ color: INK }}>{c.tr.ymd}</td>
                    <td style={{ color: S3, fontWeight: 600 }}>{c.mdd}%</td>
                    <td>{c.recDays != null ? c.recDays + '일' : '진행중'}</td>
                    <td>{sp(c.pk.disp)} → {sp(c.tr.disp)}</td>
                    <td>{c.pk.rsi} → {c.tr.rsi}</td>
                    <td style={{ color: MUTE }}>{c.deep ? '깊은' : '얕은'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ② 가격 · 이격도 · RSI */}
      {tab === 'disp' && (
        <>
          <p className="mn-note">차트를 클릭하면 세 차트에 세로선이 <b style={{ color: INK }}>고정</b>됩니다. 마우스만 올리면 세 차트 값이 함께 표시됩니다.</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={view} syncId="mn2" onClick={onClickChart} margin={{ top: 10, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...XA} />
              <YAxis scale="log" domain={['auto', 'auto']} width={64} tick={{ fill: MUTE, fontSize: 10 }}
                axisLine={false} tickLine={false} tickFormatter={v => '$' + (v >= 10 ? v.toFixed(0) : v.toFixed(2))} />
              <Tooltip content={TIP_PX} />
              <Line type="monotone" dataKey="px" name="TQQQ 종가" stroke={S2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              {marksFor(marks, 'px')}
              {pinLine()}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mn-note">TQQQ가 자기 <b>{ma}일</b> 이동평균에서 떨어진 정도 — <b>매도 전략과 같은 값</b>입니다
            (0 = 이동평균선 위, <b style={{ color: S3 }}>{sp(bands.up_disp, 0)} 초과 = 매도 조건</b>).
            점선은 <b style={{ color: S4 }}>국면 조정 예상 고점선</b>(직전 6개월 QQQ 상승률 기준).</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={view} syncId="mn2" onClick={onClickChart} margin={{ top: 10, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <ReferenceArea y1={bands.up_disp} y2={300} fill={S3} fillOpacity={0.07} />
              <ReferenceArea y1={-100} y2={bands.dn_disp} fill={S2} fillOpacity={0.07} />
              <XAxis {...XA} />
              <YAxis domain={['auto', 'auto']} width={64} tickFormatter={v => sp(v, 0)}
                tick={{ fill: MUTE, fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke={MUTE} strokeOpacity={0.5} />
              <ReferenceLine y={bands.up_disp} stroke={S3} strokeOpacity={0.55} />
              <Tooltip content={TIP_DISP} />
              <Line type="monotone" dataKey="disp" name={`이격도(MA${ma})`} stroke={S1} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="peakline" name="국면 예상 고점" stroke={S4} strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              {marksFor(marks, 'disp')}
              {pinLine()}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mn-note">TQQQ RSI(14) — 과열 <b style={{ color: S3 }}>{bands.up_rsi}↑</b> / 과매도 <b style={{ color: S2 }}>{bands.dn_rsi}↓</b></p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={view} syncId="mn2" onClick={onClickChart} margin={{ top: 4, right: 18, left: 4, bottom: 5 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <ReferenceArea y1={bands.up_rsi} y2={100} fill={S3} fillOpacity={0.07} />
              <ReferenceArea y1={0} y2={bands.dn_rsi} fill={S2} fillOpacity={0.07} />
              <XAxis {...XA} />
              <YAxis domain={[0, 100]} ticks={[0, bands.dn_rsi, 50, bands.up_rsi, 100]} width={64}
                tick={{ fill: MUTE, fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={50} stroke={MUTE} strokeOpacity={0.4} />
              <Tooltip content={TIP_RSI} />
              <Line type="monotone" dataKey="rsi" name="RSI(14)" stroke={S4} strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="peakline_r" name="국면 예상 고점" stroke={S1} strokeWidth={1.1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              {marksFor(marks, 'rsi')}
              {pinLine()}
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}

      {/* ③ 국면 분석 */}
      {tab === 'regime' && (
        <>
          <div className="mn-finding">
            <div className="fh">발견 — 고점 지표는 절대 수준이 아니라 직전 상승 속도가 정한다</div>
            <p className="mn-note" style={{ margin: '0 0 10px' }}>
              사이클 고점 {fit.pts.length}개를 직전 6개월 QQQ 상승률에 대고 그린 결과입니다.
              <b style={{ color: S4 }}> 이격도는 R²={fit.d.r2}로 강하게</b>, RSI는 R²={fit.r.r2}로 약하게 설명됩니다 —
              RSI는 이미 0~100으로 정규화된 지표라 국면 의존이 덜합니다.
            </p>
            <div className="mn-grid2">
              {['d', 'r'].map(k => (
                <ResponsiveContainer key={k} width="100%" height={250}>
                  <ComposedChart margin={{ top: 20, right: 16, left: 4, bottom: 24 }}>
                    <CartesianGrid stroke={GRID} />
                    <XAxis type="number" dataKey="x" domain={['dataMin-4', 'dataMax+4']}
                      tickFormatter={v => (v > 0 ? '+' : '') + Math.round(v) + '%'}
                      tick={{ fill: MUTE, fontSize: 9.5 }} axisLine={{ stroke: '#1f2b2e' }} tickLine={false}
                      label={{ value: '고점 직전 6개월 QQQ 수익률', position: 'insideBottom', offset: -14, fill: '#556865', fontSize: 9.5 }} />
                    <YAxis type="number" dataKey="y" domain={['dataMin-3', 'dataMax+3']} width={48}
                      tickFormatter={v => (k === 'd' ? sp(v, 0) : v.toFixed(0))}
                      tick={{ fill: MUTE, fontSize: 9.5 }} axisLine={false} tickLine={false} />
                    <ReferenceLine y={k === 'd' ? bands.up_disp : bands.up_rsi} stroke={S3} strokeOpacity={0.5}
                      label={{ value: `매도선 ${k === 'd' ? sp(bands.up_disp, 0) : bands.up_rsi}`, fill: S3, fontSize: 9, position: 'insideTopRight' }} />
                    <Tooltip content={({ active, payload }) => !active || !payload?.length ? null : (
                      <div className="mn-tip">
                        <div className="t">{payload[0].payload.date}</div>
                        <div className="r"><span>직전 6개월</span><span>{payload[0].payload.x}%</span></div>
                        <div className="r"><span>{k === 'd' ? '고점 이격도' : '고점 RSI'}</span><span style={{ color: S1 }}>{payload[0].payload.y}</span></div>
                        {payload[0].payload.mdd != null && <div className="r"><span>이후 낙폭</span><span style={{ color: S3 }}>{payload[0].payload.mdd}%</span></div>}
                      </div>)} />
                    <Line data={[
                      { x: Math.min(...fit.pts.map(p => p.x)) - 4, y: fit[k].a + fit[k].b * (Math.min(...fit.pts.map(p => p.x)) - 4) },
                      { x: Math.max(...fit.pts.map(p => p.x)) + 4, y: fit[k].a + fit[k].b * (Math.max(...fit.pts.map(p => p.x)) + 4) },
                    ]} dataKey="y" stroke={S4} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} legendType="none" />
                    <Scatter name={k === 'd' ? '고점 이격도' : '고점 RSI'}
                      data={fit.pts.map(p => ({ ...p, y: p[k] }))} isAnimationActive={false}>
                      {fit.pts.map((p, i) => <Cell key={i} fill={p.deep ? S3 : S1} r={p.deep ? 6 : 4.5} />)}
                    </Scatter>
                    <Scatter name="현재" data={[{ x: fit.now_r126, y: k === 'd' ? fit.now_disp : fit.now_rsi }]} isAnimationActive={false}>
                      <Cell fill={INK} r={6.5} />
                    </Scatter>
                    <Legend wrapperStyle={{ fontSize: 10.5, color: MUTE }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ))}
            </div>
            <div className="mn-tw" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>국면</th><th>예상 고점 이격도</th><th>예상 고점 RSI</th></tr></thead>
                <tbody>
                  {[[0, '횡보'], [20, '보통'], [40, '급등']].map(([g, l]) => (
                    <tr key={g}><td>{l} (직전 6개월 {g > 0 ? '+' : ''}{g}%)</td>
                      <td style={{ color: S4, fontWeight: 600 }}>{sp(fit.d.a + fit.d.b * g)}</td>
                      <td style={{ color: S1, fontWeight: 600 }}>{(fit.r.a + fit.r.b * g).toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mn-note" style={{ margin: '12px 0 0' }}>
              <b style={{ color: INK }}>지금</b>: 직전 6개월 QQQ {fit.now_r126 > 0 ? '+' : ''}{fit.now_r126}% →
              예상 고점 이격도 <b>{sp(fit.now_pred_d)}</b> / RSI <b>{fit.now_pred_r}</b>.
              현재 {sp(fit.now_disp)}(<b style={{ color: fit.now_disp >= fit.now_pred_d ? S3 : S2 }}>{(fit.now_disp - fit.now_pred_d).toFixed(1)}%p</b>),
              RSI {fit.now_rsi}(<b style={{ color: fit.now_rsi >= fit.now_pred_r ? S3 : S2 }}>{(fit.now_rsi - fit.now_pred_r).toFixed(1)}</b>).
            </p>
          </div>

          <p className="mn-note" style={{ marginTop: 16 }}><b>신호 성능 비교</b> — 효율 = 고점 포착률 ÷ 밴드 체류시간.
            포착은 고점 직전 <b>21거래일</b> 안에 신호가 켜졌는지로 셉니다(7~40일 어디로 잡아도 결과는 같습니다).
            적응형은 선이 시장을 따라 올라가 트리거로는 고정선보다 나빴습니다.</p>
          <div className="mn-tw">
            <table>
              <thead><tr><th>신호</th><th>고점 포착</th><th>밴드 체류</th><th>효율</th></tr></thead>
              <tbody>
                {SIGPERF.map(([n, cap, dw, ef, best]) => (
                  <tr key={n} style={best ? { background: 'rgba(25,158,112,.09)' } : undefined}>
                    <td style={best ? { color: S2, fontWeight: 600 } : undefined}>{best ? '★ ' : ''}{n}</td>
                    <td>{cap}%</td><td>{dw}%</td>
                    <td style={{ fontWeight: 600, color: ef >= 9 ? S2 : ef >= 5 ? TXT : S3 }}>{ef}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mn-note" style={{ marginTop: 16 }}>
            <b style={{ color: S3 }}>-30% 낙폭 사전 경보</b> — 신호는 성격이 정반대입니다.
            전략 매도조건은 꼭지 근처(낙폭 -1.4%)에서 울리지만 13번 중 8번만 잡고,
            -10% 룰은 전부 잡지만 이미 손실 뒤입니다.
          </p>
          <div className="mn-tw">
            <table>
              <thead><tr><th>신호</th><th>경보한 사이클</th><th>평균 리드</th><th>신호 시점 낙폭</th><th>오경보</th></tr></thead>
              <tbody>
                {WARNPERF.map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td>
                    <td style={{ color: S3 }}>{r[3]}</td><td>{r[4]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mn-src">
            완벽한 사전 간파는 불가능합니다. 실측상 MDD를 -81.7%→-55.9%로 줄이려면 CAGR을 43.2%→36.1%로 내주고 최종 자산이 절반 이하가 됩니다.
            현실적 목표는 <b>과열복합에 절반 정리 → 고점대비 -10%에 나머지 정리</b>로 -30%를 -15% 안팎으로 줄이는 것입니다.
            표본이 {bands.n}개뿐이라 수치의 소수점까지 믿을 것은 아닙니다.
          </p>
        </>
      )}

      {/* ④ 장기전망 */}
      {tab === 'outlook' && (
        <>
          <p className="mn-note">
            QQQ 일간수익률×3에서 실측 TQQQ로 역산한 드래그(연 <b>{sim.dragAnnual}%</b>)를 뺀 시뮬레이션을 1999년부터 돌려,
            TQQQ가 겪지 않은 닷컴 버블까지 포함해 봤습니다.
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={simView} margin={{ top: 10, right: 18, left: 4, bottom: 5 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" domain={[1999, 'dataMax']}
                ticks={[2000, 2004, 2008, 2012, 2016, 2020, 2024]} tickFormatter={v => `'${String(v).slice(2)}`}
                tick={{ fill: MUTE, fontSize: 10.5 }} axisLine={{ stroke: '#1f2b2e' }} tickLine={false} />
              <YAxis scale="log" domain={[0.1, 3000]} ticks={[1, 10, 100, 1000]} width={56}
                tick={{ fill: MUTE, fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={100} stroke={MUTE} strokeOpacity={0.4} />
              <Tooltip content={TIP_SIM} />
              <Line type="monotone" dataKey="q1" name="QQQ (1배)" stroke={S2} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="sim" name="3배 시뮬" stroke={S3} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Legend wrapperStyle={{ fontSize: 11, color: MUTE }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mn-warn">
            <b style={{ color: S3 }}>닷컴 고점(2000-03-27)에 샀다면</b><br />
            · 3배 시뮬: <b>-99.97%</b> → 26년이 지난 지금도 <b style={{ color: S3 }}>원금 미회복</b><br />
            · QQQ 1배: <b style={{ color: S2 }}>14.9년</b> 만에 회복 (2015-02-20)<br />
            레버리지는 회복을 못 합니다 — 90% 빠지면 10배가 올라야 본전인데, -99.97%는 약 3,300배가 필요합니다.
          </div>
          <p className="mn-note" style={{ marginTop: 14 }}>롤링 보유수익률 분포 — 겹치는 모든 시작일 기준</p>
          <div className="mn-tw">
            <table>
              <thead><tr><th>구간</th><th>최악</th><th>하위25%</th><th>중앙값</th><th>상위25%</th><th>손실확률</th><th>연환산 중앙</th></tr></thead>
              <tbody>
                {[['실측', rolls.act], ['3x시뮬', rolls.sim]].flatMap(([lbl, arr]) =>
                  arr.filter(Boolean).map(r => (
                    <tr key={lbl + r.n}>
                      <td style={{ color: INK }}>{lbl} {r.n}년</td>
                      <td style={{ color: S3, fontWeight: 600 }}>{r.worst > 0 ? '+' : ''}{r.worst}%</td>
                      <td>{r.p25 > 0 ? '+' : ''}{r.p25}%</td>
                      <td style={{ fontWeight: 600 }}>{r.med > 0 ? '+' : ''}{r.med}%</td>
                      <td>{r.p75 > 0 ? '+' : ''}{r.p75}%</td>
                      <td style={{ color: r.loss > 0 ? S3 : S2, fontWeight: 600 }}>{r.loss}%</td>
                      <td>{r.annmed}%</td>
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
          <p className="mn-src">
            실측 표본({now.years}년)의 손실확률 0%는 측정 구간이 역사상 최고의 강세장이었기 때문이지 TQQQ의 성질이 아닙니다 —
            같은 계산을 1999년부터 하면 5년 보유 손실확률이 {rolls.sim[0]?.loss}%로 뜁니다. 예측이 아니라 분포의 비대칭성을 보는 용도입니다.
          </p>
        </>
      )}

      <div className="mn-tw" style={{ marginTop: 18 }}>
        <table>
          <thead><tr><th>연도</th><th>수익률</th><th>최대낙폭</th><th>이격도 최저</th><th>이격도 최고</th><th>RSI 최저</th><th>RSI 최고</th></tr></thead>
          <tbody>
            {annual.map(r => (
              <tr key={r.y}>
                <td style={{ color: INK }}>{r.y}</td>
                <td style={{ color: r.ret >= 0 ? S2 : S3, fontWeight: 600 }}>{r.ret > 0 ? '+' : ''}{r.ret}%</td>
                <td style={{ color: r.ddMin <= -40 ? S3 : TXT }}>{r.ddMin.toFixed(1)}%</td>
                <td>{isFinite(r.dispMin) ? sp(r.dispMin, 0) : '—'}</td>
                <td>{isFinite(r.dispMax) ? sp(r.dispMax, 0) : '—'}</td>
                <td>{r.rsiMin < 100 ? r.rsiMin.toFixed(0) : '—'}</td>
                <td>{r.rsiMax > 0 ? r.rsiMax.toFixed(0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mn-src" style={{ marginTop: 14 }}>
        <b>데이터</b> Yahoo Finance TQQQ·QQQ 분할·배당 조정 종가. 낙폭·사이클·이격도·RSI·회귀식까지 <b>화면에서 직접 계산</b>하므로,
        데이터가 갱신되면 모든 수치가 자동으로 따라 움직입니다. 검증: 최대낙폭 -81.7%, 2022년 -79.1%, 2018년 -19.8% — 모두 공표치와 일치.
        {' '}<b>이격도</b>는 매도 전략(<code>backtest.js</code>)과 <b>완전히 같은 값</b>입니다 —
        TQQQ 종가가 자기 {ma}일선에서 몇 % 떨어졌는가(0 = 선 위). 그래서 화면의 이격도를 매도 기준 +40%와
        그대로 견주면 됩니다. TQQQ 자체 이동평균이라 상장 +{ma}거래일 전까지는 값이 없고(전략도 그때는 못 팝니다),
        그 탓에 2010-04 고점 하나는 회귀 표본에서 빠집니다.
        {' '}<b>밴드</b> — 과열 쪽 {sp(bands.up_disp, 0)}·RSI {bands.up_rsi}는 전략 매도조건을 그대로 가져온 값이고,
        과매도 쪽 {sp(bands.dn_disp, 0)}·RSI {bands.dn_rsi}는 대응하는 매수 규칙이 없어 사이클 저점 13개 실측에서
        잡았습니다(저점 이격도 중앙 {sp(bands.trough_disp.med)} · 저점 RSI 중앙 {bands.trough_rsi.med}).
        재계산: <code>scripts/calibrate-bands.mjs</code>.
      </p>
    </div>
  )
}
