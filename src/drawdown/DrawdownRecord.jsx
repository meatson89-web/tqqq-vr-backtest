import { useMemo } from 'react'
import {
  ComposedChart, Area, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import tqqqRaw from '../data/tqqq.json'
import qqqRaw from '../data/qqq.json'
import * as DD from './dd.js'
import '../monitor/monitor.css'
import './drawdown.css'

// 다크 화면용 categorical 1·2번 (QQQ 파랑, TQQQ 주황)
const QC = '#3987e5', TC = '#d95926', GRID = '#1c2528', MUTE = '#7c9490', BAND = 'rgba(57,135,229,0.10)'

const pct = (x, d = 0) => {
  if (x == null || isNaN(x)) return '—'
  const v = Math.abs(x * 100).toFixed(d)
  return (+v === 0 ? '' : x > 0 ? '+' : '−') + v + '%'
}
const mo = x => x == null ? '—' : x.toFixed(1)
const yr = s => +s.slice(0, 4) + (+s.slice(5, 7) - 1) / 12 + (+s.slice(8, 10) - 1) / 365
const rng = (a, f, fmt) => {
  const v = a.map(f).filter(x => x != null)
  if (!v.length) return '—'
  const lo = Math.min(...v), hi = Math.max(...v)
  if (fmt(lo) === fmt(hi)) return fmt(lo)
  return hi <= 0 ? `${fmt(hi)} ~ ${fmt(lo)}` : `${fmt(lo)} ~ ${fmt(hi)}`
}
const mfmt = x => x.toFixed(1) + '개월'
const GROUPS = [
  ['', r => r.q.dd > -0.15], ['', r => r.q.dd <= -0.15 && r.q.dd > -0.2], ['', r => r.q.dd <= -0.2 && r.q.dd > -0.25],
  [' (급락)', r => r.q.dd <= -0.25 && r.q.dd > -0.32], [' (장기 약세장)', r => r.q.dd <= -0.32],
]
const glabel = (a, suf) => rng(a, r => r.q.dd, x => pct(x, 0)) + suf

function DDTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="mn-tip">
      <div className="t">{p.d}</div>
      <div className="r"><span>QQQ</span><span>{p.q.toFixed(1)}%</span></div>
      <div className="r"><span>TQQQ</span><span>{p.t.toFixed(1)}%</span></div>
    </div>
  )
}
function DecayTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="mn-tip">
      <div className="t">{p.name}</div>
      <div className="r"><span>QQQ 최대 하락</span><span>{p.x.toFixed(1)}%</span></div>
      <div className="r"><span>QQQ 복귀일 TQQQ</span><span>{p.y.toFixed(1)}%</span></div>
    </div>
  )
}

export default function DrawdownRecord() {
  const m = useMemo(() => {
    const data = DD.buildData(tqqqRaw, qqqRaw)
    const { D, Q, T } = data
    const E = DD.findEvents(D, Q, T)
    const R = DD.recordRows(D, Q, T, E)
    const S = DD.drawdownSeries(D, Q, T).map(r => ({ ...r, x: yr(r.d) }))
    return { D, E, R, S, asof: D.at(-1), start: D[0], qNow: S.at(-1).q / 100, tNow: S.at(-1).t / 100 }
  }, [])
  const { R, S } = m
  const last = R.at(-1)
  const years = (Date.parse(m.asof) - Date.parse(m.start)) / 864e5 / 365.25
  const ticks = []
  for (let y = +m.start.slice(0, 4) + 1; y <= +m.asof.slice(0, 4); y++) ticks.push(y)
  const big = R.find(r => r.q.dd <= -0.32) // 가장 깊은 장기 약세장
  const cov = R.find(r => r.name === '코로나')
  const small = R.filter(r => r.q.dd > -0.15)
  const decayPts = R.filter(r => r.tAtQrec != null).map(r => ({ name: r.name, x: r.q.dd * 100, y: r.tAtQrec * 100 }))

  return (
    <div className="monitor dd">
      <div className="mn-head">
        <h2>하락장 기록 — QQQ 10% 이상 하락 때 TQQQ</h2>
        <span className="mn-sub">TQQQ 상장 {m.start} ~ {m.asof} · 일별 수정종가 · 데이터 갱신 시 자동 재계산</span>
      </div>
      <p className="dd-lead">
        TQQQ 상장 이후 QQQ가 전고점에서 10% 이상 빠진 일은 <b>{R.length}번</b>이었고, 그때마다 TQQQ는 약 30% 이상 빠졌습니다.
        하락장이 오면 아래 첫 표에서 지금 QQQ 하락폭에 해당하는 줄을 보세요.
      </p>

      <div className="mn-rail">
        <div className="mn-tile"><div className="k">QQQ 최고가 대비 ({m.asof})</div><div className="v">{pct(m.qNow, 1)}</div>
          <div className="n">{last.open ? `${last.name} 진행 중` : `직전 하락(${last.name}) ${last.q.rec} 회복`}</div></div>
        <div className="mn-tile"><div className="k">TQQQ 최고가 대비</div><div className="v">{pct(m.tNow, 1)}</div>
          <div className="n">{last.tOpen ? `직전 하락 고점 ${last.t.pk} 아직 회복 전` : `직전 하락 ${last.t.rec} 회복`}</div></div>
        <div className="mn-tile"><div className="k">상장 이후 QQQ 10%+ 하락</div><div className="v">{R.length}<small>번</small></div>
          <div className="n">평균 약 {(years * 12 / R.length).toFixed(0)}개월에 한 번 · TQQQ 최대 {pct(Math.min(...R.map(r => r.t.dd)), 0)}</div></div>
      </div>

      <h3 className="dd-h">하락장에서 볼 표</h3>
      <div className="mn-tw">
        <table>
          <thead><tr><th>QQQ 하락폭 (사례)</th><th>TQQQ 하락폭</th><th>QQQ 전고점 회복</th><th>TQQQ 전고점 회복</th><th>QQQ 복귀일 TQQQ</th><th>TQQQ 회복에 필요했던 QQQ</th></tr></thead>
          <tbody>
            {GROUPS.map(([suf, f], gi) => {
              const a = R.filter(f)
              if (!a.length) return null
              const open = a.filter(r => r.tOpen).length
              return (
                <tr key={gi}>
                  <td className="dd-wrap"><b>{glabel(a, suf)}</b><div className="dd-cases">{a.map(r => r.name).join(', ')}</div></td>
                  <td className="neg">{rng(a, r => r.t.dd, x => pct(x, 0))}</td>
                  <td>{rng(a, r => r.q.recM, mfmt)}</td>
                  <td>{rng(a, r => r.t.recM, mfmt)}{open ? <span className="dim"> ({open}건 회복 전)</span> : null}</td>
                  <td className="neg">{rng(a, r => r.tAtQrec, x => pct(x, 0))}</td>
                  <td>{rng(a, r => r.qAtTrec, x => pct(x, 0))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mn-note">기간은 각자의 고점에서부터 센 개월 수. "QQQ 복귀일 TQQQ" = QQQ가 전고점을 되찾은 날 TQQQ가 QQQ 고점일 대비 어디 있었나. "TQQQ 회복에 필요했던 QQQ" = TQQQ가 자기 고점을 되찾은 날 QQQ가 그 고점일 대비 몇 % 위였나.</p>

      <h3 className="dd-h">상장 이후 하락폭</h3>
      <div className="legend-row">
        <span><i style={{ background: QC }} />QQQ</span><span><i style={{ background: TC }} />TQQQ</span>
        <span><i className="box" style={{ background: BAND }} />QQQ 10%+ 하락 → 회복 구간</span>
      </div>
      {[['q', QC, [-40, 0], 'QQQ', [0, -10, -20, -30, -40]], ['t', TC, [-90, 0], 'TQQQ', [0, -20, -40, -60, -80]]].map(([k, c, dom, lab, yt]) => (
        <ResponsiveContainer key={k} width="100%" height={k === 'q' ? 190 : 210}>
          <ComposedChart data={S} syncId="dd" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tick={{ fill: MUTE, fontSize: 11 }} tickFormatter={v => String(v)} />
            <YAxis domain={dom} ticks={yt} tick={{ fill: MUTE, fontSize: 11 }} tickFormatter={v => v + '%'} width={44} />
            {R.map((r, i) => <ReferenceArea key={i} x1={yr(r.q.pk)} x2={yr(r.q.rec ?? m.asof)} fill={BAND} stroke="none" ifOverflow="hidden" />)}
            <Tooltip content={<DDTip />} />
            <Area dataKey={k} stroke={c} fill={c} fillOpacity={0.15} strokeWidth={1.4} dot={false} isAnimationActive={false} name={lab} />
          </ComposedChart>
        </ResponsiveContainer>
      ))}

      <h3 className="dd-h">이벤트별 기록</h3>
      <p className="mn-note">TQQQ 고점은 그 하락 직전 TQQQ가 가장 높았던 날이라 QQQ 고점보다 이를 수 있습니다. +10%·+20% = 전고점을 뚫고 그만큼 더 오른 날. 기간 단위는 개월이고 모두 고점에서부터 셉니다. "—"는 아직 도달 전입니다.</p>
      <div className="mn-tw">
        <table className="dd-ev">
          <thead><tr><th>이벤트</th><th>종목</th><th>고점</th><th>바닥</th><th>하락률</th><th>하락 기간</th><th>전고점 회복</th><th>+10%</th><th>+20%</th></tr></thead>
          <tbody>
            {R.map((r, i) => [['QQQ', r.q, QC], ['TQQQ', r.t, TC]].map(([k, o, c], j) => (
              <tr key={i + k} className={j === 0 ? 'grp' : ''}>
                {j === 0 && <td rowSpan={2} className="dd-name">{r.name}</td>}
                <td style={{ color: c }}>{k}</td><td>{o.pk}</td><td>{o.tr}</td>
                <td className="neg">{pct(o.dd, 1)}</td><td>{mo(o.fall)}</td><td>{mo(o.recM)}</td><td>{mo(o.p10M)}</td><td>{mo(o.p20M)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <h3 className="dd-h">변동성 감쇠는 어떻게 작용했나</h3>
      <p className="mn-note">같은 QQQ 날짜 구간을 ① 하락(QQQ 고점→바닥) ② 반등(바닥→QQQ 전고점) ③ 한 바퀴(QQQ 고점→전고점 복귀)로 나눴습니다. "비용 없는 3배" = QQQ 일간 수익률×3을 매일 복리로 쌓은 값. 이것과 실제 TQQQ의 차이가 운용보수·차입 비용입니다.</p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart margin={{ top: 10, right: 16, left: 0, bottom: 18 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="x" type="number" domain={[-37, -8]} ticks={[-10, -15, -20, -25, -30, -35]} reversed tick={{ fill: MUTE, fontSize: 11 }} tickFormatter={v => v + '%'}
            label={{ value: '그 이벤트의 QQQ 최대 하락폭', position: 'insideBottom', offset: -10, fill: MUTE, fontSize: 11 }} />
          <YAxis dataKey="y" type="number" domain={[-50, 5]} ticks={[0, -10, -20, -30, -40, -50]} tick={{ fill: MUTE, fontSize: 11 }} tickFormatter={v => v + '%'} width={44} />
          <ReferenceLine y={0} stroke={MUTE} strokeDasharray="4 3" />
          <Tooltip content={<DecayTip />} />
          <Scatter data={decayPts} fill={TC} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mn-note">점 하나 = 이벤트 하나. 세로축 = QQQ가 전고점에 돌아온 날 TQQQ가 QQQ 고점일 대비 어디 있었나. 0%면 TQQQ도 같이 원위치.</p>
      <div className="mn-tw">
        <table>
          <thead>
            <tr><th rowSpan={2}>이벤트</th><th colSpan={3} className="c">① 하락</th><th colSpan={3} className="c">② 반등</th><th colSpan={3} className="c">③ 한 바퀴</th></tr>
            <tr><th>QQQ</th><th>단순 3배</th><th>TQQQ</th><th>QQQ</th><th>단순 3배</th><th>TQQQ</th><th>QQQ</th><th>비용 없는 3배</th><th>TQQQ</th></tr>
          </thead>
          <tbody>
            {R.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>{pct(r.down.q)}</td><td className="dim">{pct(3 * r.down.q)}</td><td className="neg">{pct(r.down.t)}</td>
                <td>{pct(r.up?.q)}</td><td className="dim">{r.up ? pct(3 * r.up.q) : '—'}</td><td className="pos">{pct(r.up?.t)}</td>
                <td>{pct(r.cycle?.q)}</td><td className="dim">{pct(r.cycle?.s)}</td><td className="neg">{pct(r.cycle?.t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {big && cov && (
        <ul className="dd-list">
          <li><b>① 하락 구간에서는 3배보다 덜 빠졌습니다.</b> {big.name} QQQ {pct(big.down.q)}에 단순 3배는 {pct(3 * big.down.q)}이지만 TQQQ는 {pct(big.down.t)}였습니다. 빠질수록 남은 금액이 줄어 다음 하락의 3배가 작은 금액에 걸리기 때문입니다.</li>
          <li><b>② 반등 구간에서는 3배보다 더 올랐습니다(양의 복리).</b> {big.name} 바닥에서 QQQ {pct(big.up?.q)}일 때 TQQQ는 {pct(big.up?.t)}, 코로나 반등도 QQQ {pct(cov.up?.q)}에 TQQQ {pct(cov.up?.t)}였습니다.</li>
          <li><b>③ 그래도 한 바퀴를 돌면 TQQQ가 손해입니다.</b> −80%를 메우려면 +400%가 필요합니다. QQQ가 제자리로 돌아왔을 때 TQQQ는 10~14% 하락에서 {rng(small, r => r.tAtQrec, x => pct(x, 0))}, {big.name}에는 {pct(big.tAtQrec)}였습니다.</li>
          <li><b>손해 중 변동성 몫과 비용 몫.</b> {big.name} 한 바퀴에서 비용 없는 3배도 {pct(big.cycle?.s)}였고, 나머지 약 {Math.round(((big.cycle?.s ?? 0) - (big.cycle?.t ?? 0)) * 100)}%p가 운용보수·차입 비용입니다.</li>
        </ul>
      )}

      <h3 className="dd-h">버틸 때 기억할 것</h3>
      <ul className="dd-list">
        {GROUPS.map(([suf, f], gi) => {
          const a = R.filter(f)
          if (!a.length) return null
          const slow = a.filter(r => r.t.recM != null).sort((x, y) => y.t.recM - x.t.recM)[0]
          const open = a.filter(r => r.tOpen).length
          return (
            <li key={gi}><b>QQQ {glabel(a, suf)}면 TQQQ는 {rng(a, r => r.t.dd, x => pct(x, 0))}.</b> {a.length}번 있었고, TQQQ는 고점에서 {rng(a, r => r.t.recM, mfmt)} 만에 전고점을 되찾았습니다{open ? ` (${open}건은 아직 회복 전)` : ''}. QQQ가 전고점에 돌아왔을 때 TQQQ는 {rng(a, r => r.tAtQrec, x => pct(x, 0))}였습니다.{a.length > 1 && slow ? ` 가장 오래 걸린 것은 ${slow.name}(${mo(slow.t.recM)}개월)입니다.` : ''}</li>
          )
        })}
        <li><b>"QQQ가 회복했다 = TQQQ도 회복했다"가 아닙니다.</b> QQQ 전고점 돌파 뉴스가 나와도 TQQQ는 첫 표의 "QQQ 복귀일 TQQQ" 수준에 있다고 예상하세요. TQQQ가 회복하기 전에 다음 하락이 겹치면(2015년 8월 → 2016년 초) 회복이 1년 넘게 밀리기도 했습니다.</li>
        <li><b>모든 이벤트가 결국 전고점을 넘었지만, 나스닥이 계속 오른 기간의 기록입니다.</b> 2000~2002년처럼 QQQ가 −83% 빠지면 TQQQ는 거의 0이 됩니다(합성 TQQQ 기준 −99%). 이 표에는 그런 하락이 없습니다.</li>
      </ul>

      <div className="mn-src">
        <b>자료</b> src/data/tqqq.json · qqq.json (Yahoo 수정종가, 매일 자동 갱신). 최고가는 TQQQ 상장일부터 셉니다. 그래서 QQQ의 2000년 고점은 기준이 아닙니다.
        이벤트 = QQQ가 최고가에서 10% 이상 내려간 뒤 최고가를 되찾을 때까지. 그 안의 작은 반등·재하락(2023년 8~10월 등)은 같은 이벤트로 셉니다.
        이름이 없는 새 이벤트는 고점 연월로 표시됩니다.
      </div>
    </div>
  )
}
