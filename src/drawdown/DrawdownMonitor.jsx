import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import tqqqRaw from '../data/tqqq.json'
import qqqRaw from '../data/qqq.json'
import * as DD from './dd.js'
import '../monitor/monitor.css'
import './drawdown.css'

// 다크 categorical 8색 (순서 고정). 사례 색은 그 판정 결과 안의 순위를 따른다.
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const NOW = '#dfe8e6', GRID = '#1c2528', MUTE = '#7c9490'
const DEFAULT_ON = 5
const XA = -260, XB = 252

const pct = (x, d = 0) => {
  if (x == null || isNaN(x)) return '—'
  const v = Math.abs(x * 100).toFixed(d)
  return (+v === 0 ? '' : x > 0 ? '+' : '−') + v + '%'
}
const span = n => n == null ? '—' : n < 45 ? `${Math.round(n)}일` : `${(n / 30.44).toFixed(1)}개월`
const mean = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const PH = { A: '정상', B: 'QQQ 하락 중', C: 'QQQ는 회복, TQQQ는 회복 전' }

function PathTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="mn-tip">
      <div className="t">{label === 0 ? '지금 (닮은 날)' : `${label > 0 ? '+' : '−'}${Math.abs(label)}거래일`}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div className="r" key={p.dataKey}><span style={{ color: p.stroke }}>{p.name}</span><span>{p.value.toFixed(0)}%</span></div>
      ))}
    </div>
  )
}

export default function DrawdownMonitor() {
  const base = useMemo(() => DD.buildData(tqqqRaw, qqqRaw), [])
  const baseE = useMemo(() => DD.findEvents(base.D, base.Q, base.T), [base])
  const asof = base.D.at(-1)

  const [mode, setMode] = useState('real')
  const [extra, setExtra] = useState(null)
  const [form, setForm] = useState({ date: asof, q: base.Q.at(-1).toFixed(2), t: base.T.at(-1).toFixed(2) })
  const [msg, setMsg] = useState('')
  const [w, setW] = useState({ phase: 'B', qdd: -15, qmin: -18, days: 60, tdd: -8, depth: -12, since: 20 })

  // 판정 + 유사 사례
  const res = useMemo(() => {
    if (mode === 'real') {
      const s = DD.withExtra(base, extra)
      const E = DD.findEvents(s.D, s.Q, s.T)
      const st = DD.currentState(s.D, s.Q, s.T, E)
      const excl = st.last ? baseE.find(e => e.pk === st.last.pk) : null
      const M = st.phase === 'A' ? [] : DD.matchAnalogs(base.D, base.Q, base.T, baseE, st.phase, st.f, excl)
      let cur = null
      if (st.phase !== 'A') {
        const e = st.last; cur = []
        for (let k = Math.max(e.tp, st.n + XA); k <= st.n; k++) cur.push([k - st.n, (s.T[k] / s.T[e.tp] - 1) * 100])
      }
      return { st, M, cur, s, what: false }
    }
    const f = w.phase === 'B'
      ? { qdd: w.qdd / 100, qmin: Math.min(w.qmin, w.qdd) / 100, days: w.days }
      : { tdd: w.tdd / 100, depth: w.depth / 100, since: w.since }
    return { st: { phase: w.phase, f }, M: DD.matchAnalogs(base.D, base.Q, base.T, baseE, w.phase, f, null), cur: null, what: true }
  }, [mode, extra, w, base, baseE])

  // 체크박스: 결과가 바뀌면 상위 5개를 다시 켠다
  const sig = res.M.map(m => m.e.pk + ':' + m.i).join(',')
  const [chk, setChk] = useState({ sig, on: res.M.map((_, k) => k < DEFAULT_ON) })
  if (chk.sig !== sig) setChk({ sig, on: res.M.map((_, k) => k < DEFAULT_ON) })
  const on = chk.sig === sig ? chk.on : res.M.map((_, k) => k < DEFAULT_ON)
  const toggle = k => setChk(c => ({ ...c, on: c.on.map((v, j) => j === k ? !v : v) }))
  const sel = res.M.filter((_, k) => on[k])

  const chart = useMemo(() => {
    const rows = []
    for (let x = XA; x <= XB; x++) rows.push({ x })
    res.M.forEach((m, k) => {
      const tp = base.T[m.e.tp]
      for (let j = Math.max(m.e.tp, m.i + XA); j <= Math.min(base.T.length - 1, m.i + XB); j++) rows[j - m.i - XA]['c' + k] = (base.T[j] / tp - 1) * 100
    })
    if (res.cur) for (const [x, v] of res.cur) rows[x - XA].now = v
    return rows
  }, [res, base])
  // 켜진 선만으로 세로축 범위를 잡는다 (20%p 또는 40%p 눈금)
  const yAxis = useMemo(() => {
    const keys = res.M.map((_, k) => 'c' + k).filter((_, k) => on[k]).concat(res.cur ? ['now'] : [])
    let lo = 0, hi = 0
    for (const r of chart) for (const k of keys) if (r[k] != null) { lo = Math.min(lo, r[k]); hi = Math.max(hi, r[k]) }
    const step = hi - lo > 160 ? 40 : 20
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
    const ticks = []
    for (let v = lo; v <= hi; v += step) ticks.push(v)
    return { domain: [lo, hi], ticks }
  }, [chart, on, res])

  const submit = () => {
    const v = { date: form.date, q: +form.q, t: +form.t }
    if (!v.date || !(v.q > 0) || !(v.t > 0)) { setMsg('날짜와 두 가격을 모두 넣어 주세요.'); return }
    if (v.date < base.D[0]) { setMsg(`${base.D[0]} 이후 날짜를 넣어 주세요.`); return }
    setExtra(v); setMsg(`자동 갱신 데이터(${asof}까지)에 ${v.date} 가격을 붙여 판정했습니다.`)
  }
  const reset = () => { setExtra(null); setForm({ date: asof, q: base.Q.at(-1).toFixed(2), t: base.T.at(-1).toFixed(2) }); setMsg('') }

  const { st, M } = res
  const ph = st.phase
  const avg = {
    tdd: mean(sel.map(m => base.T[m.i] / base.T[m.e.tp] - 1)),
    tFurther: mean(sel.map(m => m.o.tFurther)),
    tRec: mean(sel.map(m => m.o.tRec)), tRecN: sel.filter(m => m.o.tRec != null).length,
    qRec: mean(sel.map(m => m.o.qRec)),
    r3: mean(sel.map(m => m.o.r3)), r6: mean(sel.map(m => m.o.r6)), r12: mean(sel.map(m => m.o.r12)),
  }
  const cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg'

  return (
    <div className="monitor dd">
      <div className="mn-head">
        <h2>하락장 모니터 — 지금과 닮은 과거 하락</h2>
        <span className="mn-sub">데이터 {asof}까지 · 매일 자동 갱신 · 비교 대상 = TQQQ 상장 이후 QQQ 10%+ 하락 {baseE.length}건</span>
      </div>

      <div className="mn-tabs">
        <button className={`mn-tab${mode === 'real' ? ' on' : ''}`} onClick={() => setMode('real')}>지금 상태</button>
        <button className={`mn-tab${mode === 'what' ? ' on' : ''}`} onClick={() => setMode('what')}>가정해 보기</button>
      </div>

      {mode === 'real' ? (
        <div className="mn-ctl dd-form">
          <span className="ck">장중·미반영 가격 직접 입력 (선택)</span>
          <label>날짜<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
          <label>QQQ<input type="number" step="0.01" value={form.q} onChange={e => setForm({ ...form, q: e.target.value })} /></label>
          <label>TQQQ<input type="number" step="0.01" value={form.t} onChange={e => setForm({ ...form, t: e.target.value })} /></label>
          <button className="mn-tab on" onClick={submit}>판정하기</button>
          {extra && <button className="mn-tab" onClick={reset}>자동 데이터로 되돌리기</button>}
          {msg && <span className="dd-msg">{msg}</span>}
        </div>
      ) : (
        <div className="mn-ctl dd-form">
          <label>상황<select value={w.phase} onChange={e => setW({ ...w, phase: e.target.value })}>
            <option value="B">QQQ 하락 중 (전고점 회복 전)</option><option value="C">QQQ는 회복, TQQQ는 회복 전</option></select></label>
          {w.phase === 'B' ? <>
            <label>QQQ 지금 위치 <b>{w.qdd}%</b><input type="range" min={-40} max={-1} value={w.qdd} onChange={e => setW({ ...w, qdd: +e.target.value })} /></label>
            <label>이번 하락 QQQ 최저 <b>{Math.min(w.qmin, w.qdd)}%</b><input type="range" min={-40} max={-10} value={w.qmin} onChange={e => setW({ ...w, qmin: +e.target.value })} /></label>
            <label>고점 후 <b>{span(w.days)}</b><input type="range" min={7} max={700} value={w.days} onChange={e => setW({ ...w, days: +e.target.value })} /></label>
          </> : <>
            <label>TQQQ 지금 위치 <b>{w.tdd}%</b><input type="range" min={-60} max={-1} value={w.tdd} onChange={e => setW({ ...w, tdd: +e.target.value })} /></label>
            <label>그 하락 QQQ 최저 <b>{w.depth}%</b><input type="range" min={-40} max={-10} value={w.depth} onChange={e => setW({ ...w, depth: +e.target.value })} /></label>
            <label>QQQ 회복 후 <b>{span(w.since)}</b><input type="range" min={1} max={400} value={w.since} onChange={e => setW({ ...w, since: +e.target.value })} /></label>
          </>}
        </div>
      )}

      <div className={`dd-state ${ph}`}>
        <span className={`dd-pill ${ph}`}>{res.what ? '가정: ' : ''}{PH[ph]}</span>
        {res.what ? (
          <p>{ph === 'B'
            ? `QQQ 고점 대비 ${w.qdd}% (이번 하락 최저 ${Math.min(w.qmin, w.qdd)}%), 고점 후 ${span(w.days)}인 상황을 가정했습니다.`
            : `QQQ ${w.depth}% 하락 뒤 QQQ는 회복했고, TQQQ는 아직 고점 대비 ${w.tdd}%, QQQ 회복 후 ${span(w.since)}인 상황을 가정했습니다.`}</p>
        ) : ph === 'A' ? (
          <p>QQQ는 최고가 대비 {pct(st.qddATH, 1)}입니다. 10% 이상 하락 중이 아니고, 직전 하락에서 TQQQ도 회복했습니다. 비교할 하락이 없어 아래는 비워 둡니다. 미리 보려면 "가정해 보기"를 쓰세요.</p>
        ) : (() => {
          const e = st.last, s = res.s, n = st.n
          return <>
            <p>{ph === 'B'
              ? `QQQ가 ${s.D[e.pk]} 고점에서 ${pct(st.f.qmin, 1)}까지 빠졌고, 지금은 고점 대비 ${pct(st.f.qdd, 1)}입니다. 고점 후 ${span(st.f.days)} 지났습니다.`
              : `QQQ는 ${s.D[e.rec]}에 전고점을 되찾았지만, TQQQ는 하락 직전 고점(${s.D[e.tp]}) 대비 아직 ${pct(st.f.tdd, 1)}입니다. QQQ 회복 후 ${span(st.f.since)} 지났습니다.`}</p>
            <div className="dd-kv">
              <div><span>기준일</span><b>{s.D[n]}</b></div>
              <div><span>QQQ 고점 대비</span><b>{pct(s.Q[n] / s.Q[e.pk] - 1, 1)}</b></div>
              <div><span>TQQQ 하락 직전 고점 대비</span><b>{pct(s.T[n] / s.T[e.tp] - 1, 1)}</b></div>
              <div><span>이번 하락 최저 QQQ / TQQQ</span><b>{pct(e.qmax)} / {pct(e.tmax)}</b></div>
            </div>
          </>
        })()}
      </div>

      {M.length > 0 && <>
        <h3 className="dd-h">{ph === 'B' ? 'QQQ 하락 중이던 과거 시점' : 'QQQ 회복 후 TQQQ가 아직 못 돌아왔던 과거 시점'} — 닮은 순 {M.length}곳</h3>
        <p className="mn-note">{ph === 'B'
          ? 'QQQ 지금 위치(3%p) · 이번 하락 최저점(4%p) · 고점 후 지난 날(약 1.6배)을 같은 무게로 비교합니다.'
          : 'TQQQ 지금 위치(4%p) · 그 하락의 QQQ 최저점(6%p) · QQQ 회복 후 지난 날(약 1.8배)을 같은 무게로 비교합니다.'}
          {' '}체크한 사례만 차트와 평균에 들어갑니다. 처음에는 가까운 {DEFAULT_ON}곳이 켜져 있습니다.</p>

        <div className="mn-rail">
          <div className="mn-tile"><div className="k">TQQQ 전고점까지 (평균)</div><div className="v">{span(avg.tRec)}</div>
            <div className="n">체크한 {sel.length}곳 중 {avg.tRecN}곳 회복 기준</div></div>
          <div className="mn-tile"><div className="k">그 뒤 TQQQ 추가 하락 (평균)</div><div className="v">{pct(avg.tFurther)}</div>
            <div className="n">가장 깊었던 곳 {sel.length ? pct(Math.min(...sel.map(m => m.o.tFurther))) : '—'}</div></div>
          <div className="mn-tile"><div className="k">TQQQ 6개월 뒤 (평균)</div><div className="v">{pct(avg.r6)}</div>
            <div className="n">1년 뒤 평균 {pct(avg.r12)}</div></div>
        </div>

        <div className="legend-row">
          {res.cur && <span><i style={{ background: NOW, height: 4 }} />지금 (TQQQ)</span>}
          {M.map((m, k) => on[k] && <span key={k}><i style={{ background: COLORS[k] }} />{m.e.name}</span>)}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="x" type="number" domain={[XA, XB]} ticks={[-252, -126, 0, 126, 252]}
              tickFormatter={v => v === 0 ? '지금' : `${v > 0 ? '+' : '−'}${Math.abs(v / 21).toFixed(0)}개월`} tick={{ fill: MUTE, fontSize: 11 }} />
            <YAxis domain={yAxis.domain} ticks={yAxis.ticks} tick={{ fill: MUTE, fontSize: 11 }} tickFormatter={v => v + '%'} width={48} />
            <ReferenceLine y={0} stroke={MUTE} strokeDasharray="4 3" label={{ value: '하락 직전 TQQQ 고점', position: 'insideTopLeft', fill: MUTE, fontSize: 11 }} />
            <ReferenceLine x={0} stroke={NOW} />
            <Tooltip content={<PathTip />} />
            {M.map((m, k) => on[k] && <Line key={k} dataKey={'c' + k} name={m.e.name} stroke={COLORS[k]} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />)}
            {res.cur && <Line dataKey="now" name="지금" stroke={NOW} strokeWidth={2.6} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mn-note">세로선 = 지금(과거 사례는 지금과 닮았던 날). 오른쪽은 그 사례에서 이후 252거래일 동안 TQQQ가 실제로 간 길입니다.</p>

        <div className="mn-tw">
          <table className="dd-ana">
            <thead><tr><th>사용</th><th>사례</th><th>닮은 날</th><th>그날 TQQQ</th><th>그 뒤 TQQQ 추가 최저</th><th>TQQQ 전고점까지</th><th>QQQ 전고점까지</th><th>TQQQ 3개월 뒤</th><th>6개월 뒤</th><th>1년 뒤</th></tr></thead>
            <tbody>
              {M.map((m, k) => (
                <tr key={k} className={on[k] ? '' : 'off'}>
                  <td><input type="checkbox" checked={!!on[k]} onChange={() => toggle(k)} aria-label={`${m.e.name} 포함`} /></td>
                  <td><span className="dd-sw" style={{ background: COLORS[k] }} />{m.e.name}</td>
                  <td>{base.D[m.i]}</td>
                  <td>{pct(base.T[m.i] / base.T[m.e.tp] - 1)}</td>
                  <td className={m.o.tFurther < -0.005 ? 'neg' : ''}>{pct(m.o.tFurther)}</td>
                  <td>{m.o.tRec == null ? '아직' : span(m.o.tRec)}</td>
                  <td>{ph === 'B' ? span(m.o.qRec) : '이미 회복'}</td>
                  <td className={cls(m.o.r3)}>{pct(m.o.r3)}</td><td className={cls(m.o.r6)}>{pct(m.o.r6)}</td><td className={cls(m.o.r12)}>{pct(m.o.r12)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>평균 (체크 {sel.length}곳)</td>
                <td />
                <td>{pct(avg.tdd)}</td>
                <td className={avg.tFurther != null && avg.tFurther < -0.005 ? 'neg' : ''}>{pct(avg.tFurther)}</td>
                <td>{span(avg.tRec)}{avg.tRecN < sel.length ? <span className="dim"> ({avg.tRecN}곳)</span> : null}</td>
                <td>{ph === 'B' ? span(avg.qRec) : '—'}</td>
                <td className={cls(avg.r3)}>{pct(avg.r3)}</td><td className={cls(avg.r6)}>{pct(avg.r6)}</td><td className={cls(avg.r12)}>{pct(avg.r12)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mn-note">"그날 TQQQ" = 그 사례의 하락 직전 TQQQ 고점 대비 위치. 기간은 닮은 날부터 셉니다. 3개월·6개월·1년 = 63·126·252거래일 뒤. 평균은 체크한 사례의 단순 평균이고, 아직 값이 없는 칸은 빼고 계산합니다.</p>
      </>}

      <div className="mn-warn">
        <b>예측이 아닙니다.</b> 비교 대상은 2010년 이후 하락 {baseE.length}건뿐이고, 모두 결국 회복한 기록입니다. 2000~2002년처럼 회복까지 15년 걸린 하락은 들어 있지 않습니다. "과거에는 이런 범위였다"로만 보세요.
      </div>
      <div className="mn-src">
        <b>판정</b> 정상 = QQQ 10%+ 하락 중이 아니고 직전 하락에서 TQQQ도 회복 · QQQ 하락 중 = QQQ가 최고가 대비 10% 이상 빠진 뒤 아직 최고가 회복 전 · TQQQ 회복 전 = QQQ는 최고가를 넘었지만 TQQQ는 하락 직전 고점 아래.
        직접 넣은 가격은 자동 갱신 데이터 끝에 붙여서 계산하며 저장하지 않습니다.
      </div>
    </div>
  )
}
