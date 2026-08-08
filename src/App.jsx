import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, Scatter, ReferenceArea,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  getRollingWindows, runFinalBacktest, DEFAULT_SETTINGS, DATA_START, DATA_END,
  getBoosterStatus, getSellConditionStatus, checkGainCondition,
  throttlePctForRsi, throttleFirstTier,
} from './lib/backtest'
import './App.css'

// 주식 영역 색. 과열 스로틀 구간만 주황으로 갈아끼운다.
// 부스터 세로 음영(#f59e0b, 투명도 0.14)과 구분되도록 더 진한 주황을 쓴다.
const STOCK_COLOR = '#10b981'
const HOT_COLOR = '#f97316'

function fmtPct(v) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}
function fmtB(v) {
  return `${(v / 1e8).toFixed(2)}억`
}
function fmtMonthYear(d) {
  return d.slice(0, 7).replace('-', '.')
}
// 롤링 윈도우의 id는 숫자, 직접 기간 조회는 `custom-...` 문자열이라 타입이 섞인다.
// 두 화면이 같은 판정을 각자 하다가 한쪽이 숫자에 startsWith를 호출해 앱이 죽었다.
function isCustomWindow(win) {
  return String(win.id).startsWith('custom-')
}

const FIXED_RULES = [
  { label: 'MA 기간', value: '180일' },
  { label: '이격도 기준', value: '> 40%' },
  { label: 'RSI(14)', value: '≥ 73' },
  { label: '수익률 기준', value: '≥ 25%' },
  { label: '매도 비율', value: '주식 70%' },
  { label: '매도 쿨다운', value: '10거래일' },
  { label: '과열 스로틀', value: 'RSI ≥ 70 → POOL 0%' },
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
          <b>매도</b> — <i>주가가 180일 이동평균보다 40%를 초과해서 높고</i>, <i>RSI(14)가 73 이상</i>이고,
          <i> 평단가 대비 수익률이 25% 이상</i>인 세 조건을 동시에 만족하면 보유 주식의 70%를 매도합니다.
          매도 직후 10거래일 동안은 재매도하지 않습니다(쿨다운).
          <b> RSI 기준은 70에서 73으로 올렸습니다</b> — 71~75가 연속으로 개선되는 구간이고,
          겹치지 않는 독립 5년 구간 3개에서 모두 세후 총자산이 늘었습니다(+5.9 / +0.5 / +6.8%).
          70에서만 걸리던 매도 12건 중 7건은 이후 낙폭이 -13% 이내라 세금만 내고 끝났을 거래였습니다.
        </p>
        <p>
          <b>POOL 재투자</b> — 매도로 확보한 현금은 POOL에 쌓이고, 매주 수요일 POOL 잔고의 5%가
          정액 적립금과 함께 재투자됩니다(그날 RSI가 70 이상이면 아래 <i>과열 스로틀</i>에 따라 0%).
          단 총자산이 설정한 비중캡 기준 이하일 때 POOL 비중이
          10%를 넘으면, 초과분을 즉시 매수해 현금이 과도하게 쌓이지 않게 합니다.
          <b> 주의</b> — 이 캡은 총자산이 기준 금액을 <i>넘어서는 순간부터 영구히 꺼집니다.</i>
          초기 투입금 1억으로 2010년부터 돌리면 한 번도 발동하지 않습니다(상단 "POOL 비중캡"
          항목에서 실제 발동 횟수를 확인하세요). 자산이 커진 뒤에는 없는 기능이나 마찬가지이므로,
          이 값을 조정해 결과가 바뀐다면 그 구간에서만 유효한 것입니다.
        </p>
        <p>
          <b>양도소득세</b> — 일반 해외주식 계좌 기준으로 연간 실현손익을 합산해 250만원을 공제한
          뒤 22%를 이듬해 5월에 납부하는 것으로 계산합니다. 이 전략은 이익 실현 매도를 반복하므로
          세금 영향이 큽니다. 2010~2026 전체 구간에서 세전 총자산은 매도를 전혀 하지 않는 단순
          적립식(757억)보다 크지만, <b>세후로는 역전됩니다.</b> 세금을 빼고 본 수치는 실제로
          손에 남는 금액이 아닙니다.
        </p>
        <p>
          <b>POOL 부스터</b> — 최근 N거래일(기본 60일) 고점 대비 설정한 낙폭(기본 -30%) 이상
          하락한 주에는, 평소 5%였던 POOL 재투자 비율을 설정한 값(기본 60%)까지 올려서 급락 구간에
          더 공격적으로 재투자합니다.
          <b> 강도를 25%에서 60%로 올렸습니다</b> — 25%로는 발동해도 바닥에서 현금이 절반 남았습니다
          (2020-03-20 저점의 POOL 비중 55.3%). 60%면 18.5%까지 내려갑니다. 25~100% 전 구간이
          단조롭게 개선되는 형태였고, 60% 부근에서 급반등 구간 성과가 정점이었습니다. 100%는 한 주에
          전액을 써버려 바닥 전에 실탄이 떨어집니다.
        </p>
        <p>
          <b>주의 — 재투자 "속도"를 무조건 올리면 안 됩니다.</b> 평상시 재투자율(5%)을 10~15%로
          올리는 실험은 모두 크게 나빠졌습니다. 매도는 RSI가 높은 <i>고점</i>에서 일어나므로, 빨리
          재투입하면 방금 판 가격에 도로 사게 됩니다. 5%의 굼뜸은 과열이 식기를 기다리는 장치입니다.
          부스터가 효과적인 이유는 빠르기 때문이 아니라 <i>이미 크게 빠진 뒤에만</i> 빠르기 때문입니다.
        </p>
        <p>
          <b>과열 스로틀</b> — 수요일 그날의 RSI(14)가 <i>70 이상이면 POOL 재투자를 아예 하지
          않습니다</i>(0%). 정액 적립금은 그대로 들어가고 POOL 부분만 멈춥니다. 부스터가 켜진
          주에는 적용되지 않습니다(고점 대비 -30% 급락 상황이라 RSI가 애초에 낮아 겹치지 않습니다).
          {' '}<b>이유</b> — 매도는 RSI 73 부근에서 일어나므로 매도 직후 몇 주는 POOL이 크고 RSI는
          아직 높습니다. 이때 평소대로 5%를 사면 방금 판 가격 근처에서 되사서 평단가를 올리고,
          곧 오는 조정을 그대로 맞습니다. 전체 850주 중 98주(12%)에서 발동합니다.
        </p>
        <p>
          <b>과열 스로틀 검증</b> — 세후 롤링 46구간 평균 <b>+2.7%</b>, 블록 부트스트랩 95%
          신뢰구간 [0.1, 5.2]로 0을 포함하지 않습니다. 겹치지 않는 독립 5년 3구간은 각각
          -0.4% / +7.0% / +2.7%, 전체 구간 <b>+10.4%</b>(세후 1070.6억 → 1181.9억), MDD는
          -0.1%p로 오히려 소폭 개선입니다.
          {' '}<b>"그냥 덜 사서" 좋아진 게 아닙니다.</b> 이 규칙은 총 POOL 재투자액을 줄이지
          않습니다 — 오히려 0.9% 늘어납니다. 과열 때 안 쓴 돈이 POOL에 남아 잔고가 커지고,
          나중에 그 큰 잔고의 5%로 더 많이 들어가기 때문입니다. 즉 <i>금액이 아니라 타이밍만
          옮긴 것</i>입니다. RSI 조건 없이 상시 재투자율만 낮춘 대조군은 같은 +10%를 얻으려면
          재투자액을 51% 줄여야 하고, 2011~2016 구간을 -17% 망가뜨립니다.
          부스터를 꺼서 "아낀 현금이 바닥에서 쓰이는" 경로를 차단해도 효과가 남습니다(전체 구간 +2.9%).
        </p>
        <p>
          <b>과열 스로틀 — 믿지 말아야 할 부분.</b> 임계값 68~72는 결과가 평평한 고원이라
          단일 봉우리에 맞춘 값은 아닙니다. 다만 <i>68 아래로 내리면 단조롭게 나빠집니다</i> —
          RSI 65~70은 과열이 아니라 그냥 강세여서, 그 구간에서 덜 사는 건 위 대조군과 같은
          행동이 됩니다(65 이상 2.5%를 1단으로 덧붙이면 전체 구간이 +10.4%→+10.1%로 내려가고
          95% 신뢰구간이 0을 포함하게 됩니다). 또한 <b>교차검증은 사실상 무증언입니다</b> —
          QLD -0.1%, 합성 TQQQ(1999~) +1.7%로 반박하지도 확인해주지도 않습니다. 두 데이터는
          매도 발동이 드물어 POOL 자체가 작아 스로틀이 건드릴 게 없습니다. 진짜 표본외 근거는
          없다고 보는 편이 맞습니다. 이익의 약 2/3은 부스터와의 상승효과에서 나오므로 부스터를
          끄면 효과도 함께 줄어듭니다.
        </p>
        <p>
          <b>완화매도(옵션)</b> — 마지막 수익실현 매도로부터 설정한 개월 수(기본 7개월) 이상
          지나면, RSI·이격도 기준을 설정한 폭만큼 낮춰서(수익률 25% 기준은 그대로) 매도를
          시도합니다. 이때는 보유 주식을 70%가 아니라 설정한 작은 비율(기본 5%)만 팔아
          POOL을 조금씩 확보합니다. 46개 롤링 5년 구간 검증 결과 27개 구간에서 개선(평균
          +3.0%), 19개 구간에서 소폭 악화(평균 -1.0%)되어 전체 평균 총자산은 +1.8%였습니다.
          <b> 다만</b> 46개 구간은 인접 구간끼리 데이터가 95% 겹쳐서 독립 표본은 사실상 3개에
          불과합니다. 또한 완화 파라미터를 이웃 값으로 바꿔도 전체 결과가 1.1배 안에서만 움직여
          이 +1.8%는 측정 오차와 구분되지 않습니다. 확정된 개선으로 보지 마세요.
        </p>
        <p>
          <b>이 전략이 막지 못하는 것</b> — 화면의 백테스트는 TQQQ 상장(2010-02) 이후만 씁니다.
          QQQ로 1999년까지 역산한 합성 데이터(<code>scripts/build-sim-tqqq.py</code>, 차입비용 반영,
          실제 TQQQ와 일간 상관 0.9989·MDD -81.5% vs -81.7%로 검증)로 돌려보면 결과가 다릅니다.
          <b> 1999-03~2004-03 구간은 3.18억을 넣고 1.41억(원금의 44%), 2004-03~2009-03 구간은
          3.21억을 넣고 0.66억(원금의 21%)으로 끝납니다.</b> MDD는 -92~-99%입니다.
          매도 조건이 <i>이격도 40% 초과</i>를 요구하는데 하락장에서는 주가가 180일선 위로 그만큼
          올라갈 일이 없어, 5년간 매도가 3~4회에 그칩니다. 매도 규칙이 구조적으로 발동하지 못합니다.
          순수 적립식, MA200 추세필터를 포함해 어떤 규칙도 이 구간을 구하지 못했습니다(추세필터는
          닷컴 구간에서 오히려 1.41억→1.29억으로 나빴습니다). 기초자산이 -99.95% 빠지면 그 자산
          안에서의 매매 규칙으로는 해결되지 않습니다. 이 리스크에 대한 대응은 파라미터가 아니라
          비중 상한·자산배분 차원이어야 합니다.
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

      <div className="param-divider" />

      <label className="param-checkbox">
        <input
          type="checkbox"
          checked={draft.relaxEnabled}
          onChange={e => set('relaxEnabled', e.target.checked)}
        />
        완화매도 사용 (오래 매도 못하면 RSI·이격도 기준 낮춰서 매도)
      </label>
      <div className="param-grid">
        {numField('미매도 기준', draft.relaxMonths, v => set('relaxMonths', v), { min: 1, max: 24, step: 1, unit: '개월', disabled: !draft.relaxEnabled })}
        {numField('RSI 완화폭', draft.relaxRsiDrop, v => set('relaxRsiDrop', v), { min: 0, max: 40, step: 1, unit: 'p', disabled: !draft.relaxEnabled })}
        {numField('이격도 완화폭', draft.relaxDispDrop, v => set('relaxDispDrop', v), { min: 0, max: 40, step: 1, unit: 'p', disabled: !draft.relaxEnabled })}
        {numField('완화매도 비율', draft.relaxSellFrac * 100, v => set('relaxSellFrac', v / 100), { min: 1, max: 70, step: 1, unit: '%', disabled: !draft.relaxEnabled })}
      </div>

      <div className="param-divider" />

      <label className="param-checkbox">
        <input
          type="checkbox"
          checked={draft.taxEnabled}
          onChange={e => set('taxEnabled', e.target.checked)}
        />
        양도소득세 반영 (일반 해외주식 계좌 · 22% · 연 250만원 공제)
      </label>

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
    { id: 'boosterStatus', label: '부스터 상황판' },
    { id: 'sellStatus', label: '매도조건 상황판' },
    { id: 'info', label: '전략 설명 보기' },
  ]
  return (
    <nav className="sidebar">
      <div className="sidebar-title">메뉴</div>
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

function StatusItem({ label, value, tone }) {
  return (
    <div className={`status-item${tone ? ' ' + tone : ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  )
}

// 이번 주 수요일에 실제로 적용될 POOL 재투자 비율을 한 줄로 알려주는 배지.
// 우선순위는 백테스트 로직과 같다: 부스터 > 과열 스로틀 > 기본 5%.
function PoolRatioBadge({ s }) {
  if (s.boosterOn) {
    return <span className="status-badge on">🟠 부스터 ON (POOL 주간 재투자 {s.basePoolPct}% → {s.ratioPct}%)</span>
  }
  if (s.throttleOn) {
    return <span className="status-badge on" style={{ background: '#7c2d12', borderColor: '#f97316', color: '#fdba74' }}>
      🔴 과열 스로틀 ON — RSI {s.rsiNow.toFixed(1)} ≥ {s.throttleRsi} (POOL 주간 재투자 {s.basePoolPct}% → {s.throttlePct}%)
    </span>
  }
  return <span className="status-badge off">⚪ 평상시 (POOL 주간 재투자 {s.basePoolPct}%)</span>
}

function BoosterStatusPanel({ settings }) {
  const s = useMemo(() => getBoosterStatus(settings), [settings])
  if (!s.enabled) {
    return (
      <div className="rules-panel">
        <h3 className="panel-heading">부스터 상황판 <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>(기준일 {s.date})</span></h3>
        <div style={{ marginBottom: 10 }}><PoolRatioBadge s={s} /></div>
        <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'left' }}>
          현재 파라미터 패널에서 POOL 부스터가 꺼져 있습니다. 켜고 "적용"을 누르면 부스터 상황이 표시됩니다.
          {s.throttleEnabled && ` 과열 스로틀은 부스터와 별개로 계속 동작합니다 (현재 RSI ${s.rsiNow.toFixed(1)}).`}
        </p>
      </div>
    )
  }
  return (
    <div className="rules-panel">
      <h3 className="panel-heading">부스터 상황판 <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>(기준일 {s.date}, 매일 자동 갱신)</span></h3>
      <div style={{ marginBottom: 14 }}><PoolRatioBadge s={s} /></div>
      <div className="status-grid">
        <StatusItem label="최신 종가" value={`$${s.price.toFixed(2)}`} />
        <StatusItem label={`${s.lookback}거래일 고점`} value={`$${s.rollMax.toFixed(2)}`} />
        <StatusItem label="고점 발생일" value={s.rollMaxDate} />
        <StatusItem label={`현재 고점대비 (발동 기준 -${s.drawdownPct}%)`} value={`${s.ddNow.toFixed(1)}%`} tone={s.ddNow <= -s.drawdownPct ? 'warn' : undefined} />
        {/* 이 가격은 발동 임계선이다. 부스터가 꺼져 있으면 여기까지 "내려와야" 켜지고,
            켜져 있으면 여기를 "넘어서야" 꺼진다. 상태에 따라 이름이 반대가 된다. */}
        <StatusItem label={s.boosterOn ? 'OFF 전환 가격' : 'ON 전환 가격'} value={`$${s.offPrice.toFixed(2)} (${s.offPct >= 0 ? '+' : ''}${s.offPct.toFixed(1)}%)`} />
        <StatusItem label="고점 경과" value={`${s.daysSincePeak}거래일`} />
        <StatusItem label={`${s.lookback}일 창 이탈까지`} value={`${s.daysUntilRolloff}거래일`} />
        {s.throttleEnabled && (
          <StatusItem
            label={`과열 스로틀 (RSI ≥ ${s.throttleRsi})`}
            value={s.boosterOn
              ? `RSI ${s.rsiNow.toFixed(1)} · 부스터 우선`
              : `RSI ${s.rsiNow.toFixed(1)} · ${s.throttleOn ? `발동 (${s.throttlePct}%)` : '미발동'}`}
            tone={s.throttleOn && !s.boosterOn ? 'warn' : undefined}
          />
        )}
        <StatusItem label="이번 주 실제 재투자 비율" value={`${s.effectivePoolPct}%`} tone={s.effectivePoolPct < s.basePoolPct ? 'warn' : undefined} />
      </div>
      <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'left', marginTop: 10 }}>
        {s.boosterOn
          ? `가격이 $${s.offPrice.toFixed(2)} 이상으로 오르거나, 고점이 ${s.lookback}일 창에서 밀려나 기준 고점 자체가 낮아지면 부스터가 꺼집니다.`
          : `${s.lookback}거래일 고점 대비 -${s.drawdownPct}% 인 $${s.offPrice.toFixed(2)} 이하로 내려가면 부스터가 켜지고, 그 주 수요일부터 POOL 재투자 비율이 ${s.basePoolPct}%에서 ${s.ratioPct}%로 올라갑니다. 다만 ${s.daysUntilRolloff}거래일 뒤 현재 고점($${s.rollMax.toFixed(2)}, ${s.rollMaxDate})이 ${s.lookback}일 창에서 밀려나면 기준 고점이 낮아져 전환 가격도 함께 내려갑니다.`}
      </p>
      {s.throttleEnabled && (
        <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'left', marginTop: 6 }}>
          {s.throttleOn
            ? `RSI(14)가 ${s.rsiNow.toFixed(1)}로 ${s.throttleRsi} 이상이라 이번 주 수요일 POOL 재투자는 ${s.throttlePct}%입니다. 정액 적립금은 그대로 들어갑니다. RSI가 ${s.throttleRsi} 아래로 내려오면 기본 ${s.basePoolPct}%로 돌아갑니다.`
            : `RSI(14)가 ${s.rsiNow.toFixed(1)}로 ${s.throttleRsi} 미만이라 과열 스로틀은 꺼져 있습니다. ${s.throttleRsi} 이상으로 올라가면 그 주 POOL 재투자가 ${s.throttleFirstPct}%로 줄어듭니다(정액 적립금은 유지). 부스터가 켜진 주에는 스로틀보다 부스터가 우선합니다.`}
        </p>
      )}
    </div>
  )
}

function SellStatusPanel() {
  const s = useMemo(() => getSellConditionStatus(), [])
  const [avgCostInput, setAvgCostInput] = useState('')
  const [gain, setGain] = useState(null)

  const calc = () => {
    const v = Number(avgCostInput)
    if (!v || v <= 0) return
    setGain(checkGainCondition(v))
  }

  const allMet = s.rsiMet && s.dispMet && gain?.meets

  return (
    <div className="rules-panel">
      <h3 className="panel-heading">매도조건 상황판 <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>(기준일 {s.date}, 매일 자동 갱신)</span></h3>
      <div className="status-grid">
        <StatusItem label="TQQQ 현재가" value={`$${s.priceUSD.toFixed(2)}`} />
        <StatusItem label="RSI(14)" value={s.rsiNow.toFixed(1)} tone={s.rsiMet ? 'ok' : undefined} />
        <StatusItem label="180일 이격도" value={`${s.dispNow.toFixed(1)}%`} tone={s.dispMet ? 'ok' : undefined} />
        <StatusItem label="이격도 40% 도달가" value={`$${s.targetPrice.toFixed(2)} (+${s.neededPct.toFixed(1)}%)`} />
      </div>

      <div className="sub-heading" style={{ color: '#9ca3af' }}>목표가 도달 기간별 예상 RSI</div>
      <table className="sell-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>도달 기간</th>
            <th>일평균 상승률</th>
            <th>예상 RSI</th>
            <th>RSI조건</th>
          </tr>
        </thead>
        <tbody>
          {s.scenarios.map(sc => (
            <tr key={sc.days}>
              <td style={{ textAlign: 'left' }}>{sc.days}거래일</td>
              <td>+{sc.dailyPct.toFixed(2)}%/일</td>
              <td>{sc.projectedRsi.toFixed(1)}</td>
              <td style={{ color: sc.meets ? '#10b981' : '#ef4444' }}>{sc.meets ? '충족' : '미달'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="param-divider" />
      <div style={{ textAlign: 'left', fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>
        세 번째 조건(평단가 대비 수익률 25%↑)은 보유 포지션의 평단가를 입력해야 계산됩니다.
      </div>
      <div className="gain-form">
        <label style={{ fontSize: 13, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8 }}>
          평단가(USD)
          <input type="number" min={0} step={0.01} value={avgCostInput}
            onChange={e => setAvgCostInput(e.target.value)} placeholder="예: 55.00" />
        </label>
        <button type="button" className="run-btn" style={{ marginTop: 0, padding: '8px 20px', fontSize: 13 }} onClick={calc}>
          계산
        </button>
      </div>

      {gain && (
        <div style={{ marginTop: 14 }}>
          <div className="status-grid">
            <StatusItem label="현재 수익률" value={`${gain.gainPct >= 0 ? '+' : ''}${gain.gainPct.toFixed(1)}%`} tone={gain.meets ? 'ok' : undefined} />
            <StatusItem label="25% 도달가" value={`$${gain.targetPriceFor25.toFixed(2)} (${gain.neededPct >= 0 ? '+' : ''}${gain.neededPct.toFixed(1)}%)`} />
          </div>
          <div style={{ marginTop: 10 }}>
            <span className={`status-badge ${allMet ? 'triggered' : 'off'}`}>
              {allMet ? '🔴 지금 매도조건 전부 충족!' : `아직 미충족 (RSI ${s.rsiMet ? 'O' : 'X'} / 이격도 ${s.dispMet ? 'O' : 'X'} / 수익률 ${gain.meets ? 'O' : 'X'})`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function WindowGrid({ windows, selected, onSelect }) {
  return (
    <div className="window-grid">
      {windows.map(w => {
        const returnPct = w.stats.returnAfterTaxPct
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
              수익률 {fmtPct(returnPct)}&nbsp;&nbsp;IRR {w.stats.irr.toFixed(0)}%
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

function SellDot({ cx, cy, payload }) {
  if (!cx || !cy) return null
  return (
    <polygon
      points={`${cx},${cy + 2} ${cx - 5},${cy - 7} ${cx + 5},${cy - 7}`}
      fill={payload?.sellRelaxed ? '#f59e0b' : '#ef4444'}
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
      {d.hot && <p style={{ color: HOT_COLOR, margin: '2px 0' }}>과열 스로틀 발동 — POOL 재투자 중단</p>}
      <p style={{ color: '#e2e8f0', margin: '6px 0 2px' }}>총자산: {(total / 1e8).toFixed(2)}억</p>
      <p style={{ color: d.hot ? HOT_COLOR : STOCK_COLOR, margin: '2px 0' }}>주식: {((d.stock || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#3b82f6', margin: '2px 0' }}>POOL: {((d.pool || 0) / 1e8).toFixed(2)}억</p>
      <p style={{ color: '#9ca3af', margin: '2px 0' }}>투입: {((d.totalIn || 0) / 1e8).toFixed(2)}억</p>
    </div>
  )
}

function BacktestDetail({ window: win, settings }) {
  const { daily, trades, boostTrades, stats } = useMemo(
    () => runFinalBacktest(win.startDate, win.endDate, settings),
    [win.startDate, win.endDate, settings]
  )

  const sellDates = useMemo(() => new Set(trades.map(t => t.date)), [trades])
  const relaxedSellDates = useMemo(() => new Set(trades.filter(t => t.relaxed).map(t => t.date)), [trades])
  const throttleRsi = throttleFirstTier(settings)?.[0] ?? null

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

  // 과열 스로틀이 걸리는 날(=RSI가 임계 이상)의 경계일. 차트를 5일 간격으로 솎아내므로
  // 경계일을 따로 남겨두지 않으면 음영/색 전환 지점이 최대 5일씩 밀린다.
  const hotBoundaryDates = useMemo(() => {
    const set = new Set()
    let prev = false
    for (let i = 0; i < daily.length; i++) {
      const hot = throttlePctForRsi(daily[i].rsi, settings) !== null
      if (hot !== prev) {
        set.add(daily[i].date)
        if (i > 0) set.add(daily[i - 1].date)
      }
      prev = hot
    }
    return set
  }, [daily, settings])

  const chartData = useMemo(() => {
    return daily
      .filter((d, i) => i % 5 === 0 || sellDates.has(d.date) || boostBoundaryDates.has(d.date) || hotBoundaryDates.has(d.date))
      .map(d => ({
        date: d.date,
        pool: d.pool,
        stock: d.stockValue,
        totalIn: d.totalIn,
        priceUSD: d.priceUSD,
        rsi: d.rsi,
        disp: d.disp,
        hot: throttlePctForRsi(d.rsi, settings) !== null,
        sell: sellDates.has(d.date) ? d.total : null,
        sellRelaxed: relaxedSellDates.has(d.date),
      }))
  }, [daily, sellDates, relaxedSellDates, boostBoundaryDates, hotBoundaryDates, settings])

  // 주식 영역을 구간별로 다른 색으로 칠하기 위한 가로 그라디언트 stop 목록.
  // 전환 지점마다 같은 offset에 stop을 두 개 찍어 색이 그라데이션 없이 딱 끊기게 한다.
  // (Recharts의 Area는 하나의 path라서 색을 나누려면 이 방법뿐이다.)
  const stockStops = useMemo(() => {
    const n = chartData.length
    if (!n) return []
    if (n === 1) return [{ offset: 0, hot: !!chartData[0].hot }, { offset: 1, hot: !!chartData[0].hot }]
    const stops = [{ offset: 0, hot: !!chartData[0].hot }]
    let prev = !!chartData[0].hot
    for (let i = 1; i < n; i++) {
      const hot = !!chartData[i].hot
      if (hot !== prev) {
        const off = i / (n - 1)
        stops.push({ offset: off, hot: prev }, { offset: off, hot })
        prev = hot
      }
    }
    stops.push({ offset: 1, hot: prev })
    return stops
  }, [chartData])
  const hasHot = useMemo(() => stockStops.some(s => s.hot), [stockStops])

  // 부스터/완화매도 on-off 4가지 조합을 한번에 비교 (체크박스 일일이 바꿔가며
  // 재조회하지 않아도 되도록). '세팅값'은 현재 파라미터 패널에 적용된 그대로.
  const compareRows = useMemo(() => {
    const variants = [
      { label: '세팅값', enabled: settings.enabled, relaxEnabled: settings.relaxEnabled, isCurrent: true },
      { label: '부스터 적용', enabled: true, relaxEnabled: false },
      { label: '완화매도 적용', enabled: false, relaxEnabled: true },
      { label: '완화매도+부스터 적용', enabled: true, relaxEnabled: true },
    ]
    return variants.map(v => {
      const { stats: vStats } = runFinalBacktest(win.startDate, win.endDate, {
        ...settings, enabled: v.enabled, relaxEnabled: v.relaxEnabled,
      })
      return { label: v.label, isCurrent: !!v.isCurrent, stats: vStats }
    })
  }, [win.startDate, win.endDate, settings])

  return (
    <section style={{ marginTop: 20 }}>
      <div className="stats-bar">
        <div className="stat-item">
          <span className="label">기간</span>
          <span className="value" style={{ fontSize: 13 }}>{stats.startDate} ~ {stats.endDate}</span>
        </div>
        <div className="stat-item">
          <span className="label">{stats.taxEnabled ? '총자산 (세후)' : '총자산'}</span>
          <span className="value">{fmtB(stats.finalAfterTax)}</span>
        </div>
        <div className="stat-item">
          <span className="label">{stats.taxEnabled ? '수익률 (세후)' : '수익률'}</span>
          <span className="value">{fmtPct(stats.returnAfterTaxPct)}</span>
        </div>
        <div className="stat-item">
          <span className="label">IRR</span>
          <span className="value">{fmtPct(stats.irr)}</span>
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
        {stats.taxEnabled && (
          <div className="stat-item">
            <span className="label">납부세액</span>
            <span className="value">{fmtB(stats.taxPaid)}</span>
          </div>
        )}
        <div className="stat-item">
          <span className="label">POOL 비중캡</span>
          <span className="value" style={stats.capApplied === 0 ? { color: '#f59e0b' } : undefined}>
            {stats.capApplied === 0 ? '미발동' : `${stats.capApplied}회`}
          </span>
        </div>
        {settings.enabled && (
          <div className="stat-item">
            <span className="label">부스터 발동</span>
            <span className="value">{stats.boostedWeeks}/{stats.totalWeeks}주</span>
          </div>
        )}
        {settings.relaxEnabled && (
          <div className="stat-item">
            <span className="label">완화매도 발동</span>
            <span className="value">{stats.relaxedSellCount}/{stats.sellCount}회</span>
          </div>
        )}
      </div>

      <div className="sub-heading">설정별 비교 (동일 기간, 나머지 파라미터 동일)</div>
      <table className="sell-table compare-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>구분</th>
            <th>총자산</th>
            <th>납부세액</th>
            <th>IRR</th>
            <th>MDD</th>
            <th>매도횟수</th>
          </tr>
        </thead>
        <tbody>
          {compareRows.map(r => (
            <tr key={r.label} className={r.isCurrent ? 'row-current' : undefined}>
              <td style={{ textAlign: 'left' }}>{r.label}{r.isCurrent ? ' (현재)' : ''}</td>
              <td>{fmtB(r.stats.finalAfterTax)}</td>
              <td>{fmtB(r.stats.taxPaid)}</td>
              <td>{fmtPct(r.stats.irr)}</td>
              <td>{r.stats.mdd.toFixed(1)}%</td>
              <td>{r.stats.sellCount}회</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData}>
          <defs>
            <linearGradient id="stockSplit" x1="0" y1="0" x2="1" y2="0">
              {stockStops.map((st, i) => (
                <stop key={i} offset={`${(st.offset * 100).toFixed(4)}%`} stopColor={st.hot ? HOT_COLOR : STOCK_COLOR} />
              ))}
            </linearGradient>
          </defs>
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
            fill="url(#stockSplit)" fillOpacity={0.6} stroke="url(#stockSplit)" strokeWidth={1}
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
      {(hasHot || (settings.enabled && boostRanges.length > 0)) && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: -18, marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {settings.enabled && boostRanges.length > 0 && (
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#f59e0b', opacity: 0.4, marginRight: 6, verticalAlign: 'middle' }} />
              세로 음영 = POOL 부스터 발동 중 (고점 대비 -{settings.drawdownPct}% 이상 하락)
            </span>
          )}
          {hasHot && (
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: HOT_COLOR, opacity: 0.75, marginRight: 6, verticalAlign: 'middle' }} />
              주식 영역이 주황색 = RSI(14) {throttleRsi} 이상 과열 스로틀 구간 (그 주 POOL 재투자 중단, 정액 적립은 유지)
            </span>
          )}
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
            {settings.relaxEnabled && <th>구분</th>}
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
              {settings.relaxEnabled && (
                <td style={{ color: t.relaxed ? '#f59e0b' : '#9ca3af' }}>{t.relaxed ? '완화' : '기본'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {settings.enabled && (
        <>
          <div className="sub-heading">부스터 매수 내역 ({boostTrades.length}회)</div>
          <table className="sell-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>날짜</th>
                <th>가격$</th>
                <th>POOL(전)</th>
                <th>비율</th>
                <th>매수금액</th>
                <th>POOL(후)</th>
              </tr>
            </thead>
            <tbody>
              {boostTrades.map((b, i) => (
                <tr key={`${b.date}-${i}`}>
                  <td>{i + 1}</td>
                  <td style={{ textAlign: 'left' }}>{b.date}</td>
                  <td>${b.priceUSD.toFixed(2)}</td>
                  <td>{fmtB(b.poolBefore)}</td>
                  <td>{b.ratioPct.toFixed(0)}%</td>
                  <td>{fmtB(b.buyAmt)}</td>
                  <td>{fmtB(b.poolAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
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
          {view === 'boosterStatus' && <BoosterStatusPanel settings={settings} />}
          {view === 'sellStatus' && <SellStatusPanel />}

          {view === 'custom' && (
            <>
              <CustomRangeForm onRun={setSel} />
              {sel && isCustomWindow(sel) && <BacktestDetail window={sel} settings={settings} />}
            </>
          )}

          {view === 'rolling' && (
            <>
              <section className="section-title">5년 롤링 윈도우 (분기별)</section>
              <WindowGrid windows={windows} selected={sel} onSelect={setSel} />
              {sel && !isCustomWindow(sel) && <BacktestDetail window={sel} settings={settings} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
