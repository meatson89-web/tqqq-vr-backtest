import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import barsRaw from '../data/soxl_1h.json'
import soxRaw from '../data/sox.json'
import { DEF, simulate, priceForRsi, nyParts, nyDate } from './soxl.js'
import '../monitor/monitor.css'
import '../drawdown/drawdown.css'
import './soxl.css'

const KEY = 'soxlHolding'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* 저장 불가 환경은 무시 */ } }
const RANGES = [['1개월', 21 * 7], ['3개월', 63 * 7], ['1년', 252 * 7], ['전체', Infinity]]

const usd = (x, d = 2) => x == null || isNaN(x) ? '—' : '$' + x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (x, d = 1) => x == null || isNaN(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d) + '%'
const cls = x => x == null ? '' : x >= 0 ? 'pos' : 'neg'
// 1시간봉은 시작 시각으로 저장돼 있다 → 판정 시점인 마감 시각(마지막 봉은 16:00)으로 보여 준다
const ny = iso => { const p = nyParts(new Date(new Date(iso).getTime() + 36e5).toISOString()); return `${p.date} ${p.time > '16:00' ? '16:00' : p.time}` }

function PriceTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="mn-tip">
      <div className="t">{ny(r.t)} (뉴욕)</div>
      <div className="r"><span>SOXL</span><span>{usd(r.c)}</span></div>
      {r.rsi != null && <div className="r"><span>RSI(12)</span><span>{r.rsi.toFixed(1)}</span></div>}
    </div>
  )
}

export default function SoxlBoard() {
  const [saved] = useState(load)
  const [th, setTh] = useState(saved.th ?? DEF.rsiTh)
  const [h, setH] = useState({ avg: saved.avg ?? '', qty: saved.qty ?? '', date: saved.date ?? '', peak: saved.peak ?? '', px: '' })
  const [range, setRange] = useState(63 * 7)
  const upd = (k, v) => { const n = { ...h, [k]: v }; setH(n); save({ ...n, px: undefined, th }) }
  const updTh = v => { setTh(v); save({ ...h, px: undefined, th: v }) }

  const p = useMemo(() => ({ ...DEF, rsiTh: th }), [th])
  const sim = useMemo(() => simulate(barsRaw, soxRaw, p), [p])
  const n = barsRaw.length - 1
  const last = barsRaw[n]
  const rsi = sim.rsi[n]
  const trig = priceForRsi(last[1], sim.g, sim.l, p.rsiLen, th)

  // SOX 국면: 최신 종가가 다음 거래일 진입 허용 여부를 정한다
  const soxLast = soxRaw.at(-1)
  const soxReg = sim.reg.get(soxLast[0])
  const nextBull = soxReg.bull
  const soxDist = soxLast[1] / soxReg.sma - 1

  // 감시 기준 (이 데이터 기간 안의 모델 매매)
  const tr = sim.trades
  const winRate = tr.length ? tr.filter(t => t.ret > 0).length / tr.length : null
  const yearAgo = new Date(new Date(last[0]).getTime() - 365 * 864e5).toISOString()
  const hard12 = tr.filter(t => t.why === '하드스탑' && t.t1 >= yearAgo).length

  // 내 보유
  const avg = +h.avg, qty = +h.qty
  const has = avg > 0
  const px = +h.px > 0 ? +h.px : last[1]
  const autoPeak = useMemo(() => {
    if (!h.date) return null
    let m = null
    for (const b of barsRaw) if (nyDate(b[0]) >= h.date) m = Math.max(m ?? 0, b[1])
    return m
  }, [h.date])
  const peak = Math.max(+h.peak > 0 ? +h.peak : (autoPeak ?? 0), px, has ? avg : 0)
  const armPx = avg * (1 + p.arm / 100)
  const armed = has && peak >= armPx
  const stop = armed ? peak * (1 - p.trail / 100) : avg * (1 - p.hard / 100)
  const ret = has ? px / avg - 1 : null
  const exit = has && px <= stop

  // 차트
  const data = useMemo(() => barsRaw.map((b, i) => ({ i, t: b[0], c: b[1], rsi: sim.rsi[i] })), [sim])
  const lo = Math.max(0, data.length - range)
  const shown = data.slice(lo)
  const marks = tr.filter(t => t.i1 >= lo || t.i0 >= lo)
  const tickFmt = i => { const d = data[i]; return d ? nyDate(d.t).slice(range > 63 * 7 ? 0 : 5, range > 63 * 7 ? 7 : 10) : '' }
  const yDom = useMemo(() => {
    let a = Infinity, b = -Infinity
    for (const r of shown) { a = Math.min(a, r.c); b = Math.max(b, r.c) }
    if (has && range <= 252 * 7) for (const v of [avg, stop]) { a = Math.min(a, v); b = Math.max(b, v) }
    return [Math.floor(a * 0.95), Math.ceil(b * 1.03)]
  }, [shown, has, avg, stop, range])

  const signalNow = rsi != null && rsi <= th && sim.bull[n]
  return (
    <div className="monitor dd sx">
      <div className="mn-head">
        <h2>SOXL 투자 현황판 — 추천C</h2>
        <span className="mn-sub">1시간봉 {ny(last[0])} (뉴욕, 봉 마감)까지 · SOX {soxLast[0]}까지 · 매일 자동 갱신 (야후)</span>
      </div>

      <div className="mn-rail">
        <div className="mn-tile">
          <div className="k">SOX 추세 필터 (다음 거래일)</div>
          <div className={`v ${nextBull ? 'pos' : 'neg'}`}>{nextBull ? '진입 허용' : '진입 차단'}</div>
          <div className="n">SOX {soxLast[1].toFixed(0)} / 200일선 {soxReg.sma.toFixed(0)} ({pct(soxDist)})</div>
        </div>
        <div className="mn-tile">
          <div className="k">RSI(12) 1시간봉</div>
          <div className={`v ${rsi <= th ? 'neg' : ''}`}>{rsi?.toFixed(1)}<small> / 문턱 {th}</small></div>
          <div className="n">{rsi <= th
            ? `이미 문턱 이하로 마감 (종가 ${usd(last[1])})`
            : <>다음 1시간봉 종가 <b>{usd(trig)}</b> 이하면 RSI ≤ {th} (지금 {usd(last[1])}, {pct(trig / last[1] - 1)})</>}</div>
        </div>
        <div className="mn-tile">
          <div className="k">모델 포지션 (규칙대로 매매했다면)</div>
          {sim.open ? <>
            <div className="v">{sim.open.armed ? '보유 · 트레일' : '보유 · 발동 전'}</div>
            <div className="n">진입 {ny(sim.open.t0)} @ {usd(sim.open.p0)} · 평가 {pct(last[1] / sim.open.p0 - 1)}</div>
          </> : <>
            <div className="v">{signalNow ? '진입 신호' : '현금'}</div>
            <div className="n">{tr.length ? `마지막 청산 ${ny(tr.at(-1).t1)} ${tr.at(-1).why} ${pct(tr.at(-1).ret)}` : '데이터 기간 내 매매 없음'}</div>
          </>}
        </div>
        <div className="mn-tile">
          <div className="k">감시 기준 (데이터 기간 {nyDate(barsRaw[0][0]).slice(0, 7)}~)</div>
          <div className={`v ${winRate < 0.76 || hard12 >= 3 ? 'neg' : ''}`}>{pct(winRate, 0).replace('+', '')}<small> 승률 · 12개월 손절 {hard12}건</small></div>
          <div className="n">승률 76% 아래 또는 12개월 손절 3건 이상이면 경고 · 모델 {tr.length}매매</div>
        </div>
      </div>

      <div className="dd-h">내 보유</div>
      <div className="mn-ctl dd-form">
        <label>평균 매수가 ($)<input type="number" step="0.01" value={h.avg} onChange={e => upd('avg', e.target.value)} placeholder="예: 85.20" /></label>
        <label>수량 (주)<input type="number" step="1" value={h.qty} onChange={e => upd('qty', e.target.value)} placeholder="선택" /></label>
        <label>매수일 (뉴욕)<input type="date" value={h.date} onChange={e => upd('date', e.target.value)} /></label>
        <label>보유 중 최고 종가 ($)<input type="number" step="0.01" value={h.peak} onChange={e => upd('peak', e.target.value)} placeholder={autoPeak ? `자동 ${autoPeak.toFixed(2)}` : '선택'} /></label>
        <label>현재가 직접 입력 ($)<input type="number" step="0.01" value={h.px} onChange={e => setH({ ...h, px: e.target.value })} placeholder={`자동 ${last[1].toFixed(2)}`} /></label>
        <label>RSI 문턱<select value={th} onChange={e => updTh(+e.target.value)} style={{ width: 130 }}>
          <option value={25}>25 (점검 기준)</option><option value={25.5}>25.5 (v3 파인)</option></select></label>
        {has && <button className="mn-tab" onClick={() => { const n = { avg: '', qty: '', date: '', peak: '', px: '' }; setH(n); save({ th }) }}>지우기</button>}
        <span className="dd-msg">입력값은 이 브라우저에만 저장됩니다. 최고 종가를 비우면 매수일 이후 1시간봉 종가의 최고값을 씁니다(매수일 당일 매수 전 시간이 섞일 수 있음).</span>
      </div>

      {has ? (
        <div className={`dd-state ${exit ? 'B' : armed ? 'A' : 'C'}`}>
          <span className={`dd-pill ${exit ? 'B' : armed ? 'A' : 'C'}`}>{exit ? '청산 신호' : armed ? '보유 · 트레일링 작동' : '보유 · 발동 전'}</span>
          <p>{exit
            ? `현재가 ${usd(px)}가 ${armed ? '트레일 스탑' : '하드스탑'} ${usd(stop)} 이하입니다. 1시간봉 종가 기준이면 규칙상 전량 청산입니다.`
            : armed
              ? `+${p.arm}%를 넘어 트레일링이 켜졌습니다. 1시간봉 종가가 ${usd(stop)} (최고 ${usd(peak)} −${p.trail}%) 이하로 마감하면 청산.`
              : `아직 +${p.arm}% (${usd(armPx)})에 닿지 않았습니다. 1시간봉 종가가 ${usd(stop)} (−${p.hard}%) 이하로 마감하면 손절, ${usd(armPx)} 이상이면 트레일링이 켜집니다.`}</p>
          <div className="dd-kv">
            <div><span>평가 수익률</span><b className={cls(ret)}>{pct(ret, 2)}</b></div>
            {qty > 0 && <div><span>평가 손익</span><b className={cls(ret)}>{usd((px - avg) * qty, 0)}</b></div>}
            {qty > 0 && <div><span>평가 금액</span><b>{usd(px * qty, 0)}</b></div>}
            <div><span>지금 스탑선</span><b>{usd(stop)}</b></div>
            <div><span>스탑까지</span><b className="neg">{pct(stop / px - 1)}</b></div>
            <div><span>트레일 발동가 (+{p.arm}%)</span><b>{usd(armPx)}</b></div>
            <div><span>보유 중 최고 종가</span><b>{usd(peak)}</b></div>
            {qty > 0 && <div><span>스탑 시 손익</span><b className={cls(stop - avg)}>{usd((stop - avg) * qty, 0)}</b></div>}
          </div>
        </div>
      ) : (
        <p className="mn-note">평균 매수가를 넣으면 스탑선·발동가·청산 여부를 계산합니다. 미보유 상태라면 위 RSI 칸의 가격이 다음 진입 신호 가격입니다
          {nextBull ? '' : ' — 단, 지금은 SOX가 200일선 아래라 신호가 나와도 진입하지 않습니다'}.</p>
      )}

      <div className="dd-h">SOXL 1시간봉 종가와 모델 매매</div>
      <div className="mn-tabs">
        {RANGES.map(([l, v]) => <button key={l} className={`mn-tab sm${range === v ? ' on' : ''}`} onClick={() => setRange(v)}>{l}</button>)}
      </div>
      <div className="legend-row">
        <span><i style={{ background: '#dfe8e6' }} />SOXL 종가</span>
        <span><i style={{ background: '#4cc38a', height: 10, width: 10, borderRadius: 5 }} />모델 진입</span>
        <span><i style={{ background: '#e66767', height: 10, width: 10, borderRadius: 5 }} />모델 청산</span>
        {has && <span><i style={{ background: '#3987e5' }} />내 평단</span>}
        {has && <span><i style={{ background: '#e8a33d' }} />내 스탑선</span>}
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={shown} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1c2528" vertical={false} />
            <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt} stroke="#7c9490" fontSize={11} tickCount={7} />
            <YAxis domain={yDom} stroke="#7c9490" fontSize={11} width={48} tickFormatter={v => '$' + v} />
            <Tooltip content={<PriceTip />} />
            <Line dataKey="c" stroke="#dfe8e6" dot={false} strokeWidth={1.3} isAnimationActive={false} />
            {has && <ReferenceLine y={avg} stroke="#3987e5" strokeDasharray="4 3" />}
            {has && <ReferenceLine y={stop} stroke="#e8a33d" strokeDasharray="4 3" />}
            {marks.map(t => t.i0 >= lo && <ReferenceDot key={'e' + t.i0} x={t.i0} y={t.p0} r={4} fill="#4cc38a" stroke="none" />)}
            {marks.map(t => t.i1 >= lo && <ReferenceDot key={'x' + t.i1} x={t.i1} y={t.p1} r={4} fill="#e66767" stroke="none" />)}
            {sim.open && sim.open.i0 >= lo && <ReferenceDot x={sim.open.i0} y={sim.open.p0} r={4} fill="#4cc38a" stroke="#dfe8e6" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ width: '100%', height: 110 }}>
        <ResponsiveContainer>
          <ComposedChart data={shown} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1c2528" vertical={false} />
            <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} hide />
            <YAxis domain={[0, 100]} ticks={[th, 50, 70]} stroke="#7c9490" fontSize={11} width={48} />
            <Tooltip content={<PriceTip />} />
            <ReferenceLine y={th} stroke="#4cc38a" strokeDasharray="4 3" />
            <Line dataKey="rsi" stroke="#9085e9" dot={false} strokeWidth={1} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mn-note">아래는 RSI(12), 초록 점선이 진입 문턱. 모델 진입은 RSI가 문턱 이하로 마감하고 그날 기준 전일 SOX가 200일선 위일 때만 찍힌다.</p>

      <div className="dd-h">모델 매매 기록 (최근 순, 데이터 기간 안)</div>
      <div className="mn-tw"><table>
        <thead><tr><th style={{ textAlign: 'left' }}>진입 (뉴욕, 봉 마감)</th><th>진입가</th><th style={{ textAlign: 'left' }}>청산 (뉴욕)</th><th>청산가</th><th>손익</th><th className="c">사유</th></tr></thead>
        <tbody>
          {sim.open && <tr><td style={{ textAlign: 'left' }}>{ny(sim.open.t0)}</td><td>{usd(sim.open.p0)}</td><td style={{ textAlign: 'left' }} className="dim">보유 중</td><td>{usd(last[1])}</td><td className={cls(last[1] / sim.open.p0 - 1)}>{pct(last[1] / sim.open.p0 - 1)}</td><td className="c dim">—</td></tr>}
          {tr.slice().reverse().map(t => (
            <tr key={t.i0} className={t.why === '하드스탑' ? 'sx-lose' : ''}>
              <td style={{ textAlign: 'left' }}>{ny(t.t0)}</td><td>{usd(t.p0)}</td><td style={{ textAlign: 'left' }}>{ny(t.t1)}</td><td>{usd(t.p1)}</td>
              <td className={cls(t.ret)}>{pct(t.ret)}</td><td className="c">{t.why}</td></tr>
          ))}
        </tbody>
      </table></div>
      <p className="mn-note">야후 1시간봉(2023-11~)으로 계산. 2023-12~2026-08 구간을 점검에 쓴 Polygon 시간봉과 비교하면 27건 중 24건이 같고, 3건은 진입 시각·손익이 조금 다르며 야후에만 1건이 더 있다.
        RSI가 문턱에 걸치는 봉은 데이터 출처에 따라 신호가 갈릴 수 있으니, 실제 진입은 증권사 차트의 1시간봉 종가로 확인할 것. 수수료 편도 0.05%, 세금 제외.</p>
    </div>
  )
}
