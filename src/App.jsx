import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, Scatter, ReferenceArea,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  getRollingWindows, runFinalBacktest, DEFAULT_SETTINGS, DATA_START, DATA_END,
  SIM_START, dataForSource,
  getBoosterStatus, getSellConditionStatus, checkGainCondition, getRegimeStatus,
  throttlePctForRsi, throttleFirstTier,
} from './lib/backtest'
import Monitor from './monitor/Monitor.jsx'
import './App.css'

// 주식 영역 색. 과열 스로틀 구간만 주황으로 갈아끼운다.
// 부스터 세로 음영(#f59e0b, 투명도 0.14)과 구분되도록 더 진한 주황을 쓴다.
const STOCK_COLOR = '#10b981'
const HOT_COLOR = '#f97316'
// 나스닥100이 200일선 아래인 구간(POOL 지출 정지) 음영.
// 부스터 주황과 반대 의미라 대비되는 청회색을 쓴다.
const REGIME_COLOR = '#64748b'

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

// 매도 RSI만 파라미터 패널에서 조정 가능하므로 settings에서 읽는다.
const rulesOf = settings => [
  { label: 'MA 기간', value: '180일' },
  { label: '이격도 기준', value: '> 40%' },
  { label: 'RSI(14)', value: `≥ ${settings.sellRsi}` },
  { label: '수익률 기준', value: '≥ 25%' },
  { label: '매도 비율', value: '주식 70%' },
  { label: '매도 쿨다운', value: '10거래일' },
  { label: '과열 스로틀', value: 'RSI ≥ 70 → POOL 0%' },
  { label: '추세국면', value: settings.regimeEnabled ? `QQQ < ${settings.regimeMaLen}일선 → POOL 정지` : '사용 안 함' },
]

function RulesPanel({ settings }) {
  return (
    <div className="rules-panel">
      <div className="rules-grid">
        {rulesOf(settings).map(r => (
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
          <b>이 페이지의 수치를 어떻게 읽어야 하나</b> — 아래 검증 수치는 전부 <i>세후</i>이고,
          왼쪽 "5년 롤링 윈도우" 화면과 같은 창 23개(합성 11 + 실제 12, 5년 창을 1년씩 슬라이드)
          기준입니다. <b>창 23개는 검증 23회가 아닙니다.</b> 이웃끼리 4년씩 겹치므로 실질 독립
          표본은 전체 27.4년 ÷ 창 5년 = 5개(카키색 카드)뿐입니다. 그래서 신뢰구간은 겹치는
          만큼을 한 덩어리로 묶는 블록 부트스트랩으로 냅니다 — 23개를 독립 표본처럼 세면
          구간이 실제보다 좁게 나옵니다.
          {' '}<b>창을 왜 이렇게 잘랐나</b> — 예전에는 분기 슬라이드 46개를 썼는데, 이웃끼리 95%가
          겹쳐 신뢰구간이 2.6배 좁게 나왔습니다(1년 슬라이드는 1.3배). 반대로 아예 안 겹치게
          3등분하면 자르는 위치에 휘둘립니다 — 368가지 절단 위치를 전수로 돌리니 같은 규칙의
          평균 개선폭이 +0.16%~+4.08%로 3.91%p 흔들렸습니다(1년 슬라이드는 2.49%p).
          1년 슬라이드가 그 둘 사이의 절충입니다. (<code>scripts/window-design.mjs</code>)
        </p>
        <p>
          <b>매수</b> — 시작일에 초기 투입금을 일시 매수하고, 이후 매주 수요일마다 정액을 적립매수합니다.
        </p>
        <p>
          <b>매도</b> — <i>주가가 180일 이동평균보다 40%를 초과해서 높고</i>, <i>RSI(14)가 매도 임계 이상</i>이고,
          <i> 평단가 대비 수익률이 25% 이상</i>인 세 조건을 동시에 만족하면 보유 주식의 70%를 매도합니다.
          매도 직후 10거래일 동안은 재매도하지 않습니다(쿨다운).
          매도 RSI 임계는 상단 파라미터 패널에서 조정할 수 있고 기본값은 73입니다.
        </p>
        <p>
          <b>매도 RSI 임계 — 23창 재측정</b> (73 대비 세후 총자산 차이). 아래로 내리는 건 확실히
          나쁘고, 올리는 건 평균은 좋아지지만 신뢰구간이 벌어집니다.
        </p>
        <table className="sell-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>매도 RSI</th>
              <th>23창 평균</th><th>개선</th><th>블록 95% CI</th>
              <th>독립 5창</th><th>QLD</th><th>전체구간 세후</th><th>매도수</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['70', '-6.1%', '7/23', '[-12.7, -0.6]', '-4.2% (1/5)', '-0.9%', '850.4억', '33회'],
              ['72', '-2.5%', '1/23', '[-5.5, -0.3]', '-1.5% (0/5)', '+0.0%', '1086.1억', '28회'],
              ['73 (현재)', '—', '—', '—', '—', '—', '1218.0억', '26회'],
              ['74', '+1.7%', '17/23', '[0.1, 3.7]', '+4.9% (4/5)', '+0.4%', '1300.6억', '25회'],
              ['76', '+3.7%', '13/23', '[-1.7, 11.0]', '+5.0% (4/5)', '+0.5%', '1476.1억', '19회'],
              ['80', '+6.1%', '13/23', '—', '+12.6%', '—', '1265.4억', '12회'],
              ['85', '-1.9%', '10/23', '—', '+10.5%', '—', '692.8억', '2회'],
              ['90+ (사실상 매도 없음)', '-1.1%', '10/23', '—', '+11.4%', '—', '753.6억', '0회'],
            ].map(r => (
              <tr key={r[0]} className={r[0].startsWith('73') ? 'row-current' : undefined}>
                {r.map((c, i) => <td key={i} style={i === 0 ? { textAlign: 'left' } : undefined}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>확실한 것</b> — <i>72 이하로 내리면 안 됩니다.</i> 70은 23창 평균 -6.1%, 독립 5창에서 1/5,
          QLD에서도 -0.9%로 세 데이터가 모두 같은 방향입니다. 자주 팔면 세금만 내고 반등에 못 올라탑니다.
          {' '}<i>82 이상도 안 됩니다.</i> 매도가 8회 이하로 줄면서 전체 구간이 1476억 → 747억으로
          무너지고, 90 이상은 매도가 아예 안 걸려 순수 적립식(753.6억)과 같아집니다.
          즉 <b>내부 최적점이 실제로 존재하며 대략 74~80 사이</b>입니다.
        </p>
        <p>
          <b>불확실한 것 — 그 안에서 어디인지.</b> 지표마다 봉우리가 다릅니다: 전체 구간은 76(1476억),
          23창 평균은 80(+6.1%), 독립 5창은 82(+13.4%)에서 정점입니다. 게다가 74를 넘으면
          <b> 신뢰구간이 0을 포함하기 시작합니다</b>(76은 [-1.7, 11.0]). 평균을 끌어올리는 건 소수의 창,
          특히 합성 2009-03~2014-03 한 창입니다(74에서 +19.7%, 78에서 +52.9%).
          {' '}<b>기본값을 73으로 두는 이유</b> — 74가 유일하게 신뢰구간이 0을 벗어나고(+1.7%, [0.1, 3.7])
          승률도 17/23으로 가장 높지만, 개선폭이 작고 이미 한 번 최적화한 파라미터를 같은 데이터로
          또 옮기는 것이라 과최적화 위험이 누적됩니다. 74~76으로 올리고 싶다면 파라미터 패널에서
          직접 바꿔 확인해 보세요 — 이 구간 안에서는 어느 값이든 크게 틀리지 않습니다.
          (<code>scripts/sweep-sellrsi.mjs</code>)
        </p>
        <p>
          <b>POOL 재투자</b> — 매도로 확보한 현금은 POOL에 쌓이고, 매주 수요일 POOL 잔고의 5%가
          정액 적립금과 함께 재투자됩니다(그날 RSI가 70 이상이면 아래 <i>과열 스로틀</i>에 따라 0%).
          단 총자산이 설정한 비중캡 기준 이하일 때 POOL 비중이
          10%를 넘으면, 초과분을 즉시 매수해 현금이 과도하게 쌓이지 않게 합니다.
          <b> 주의</b> — 이 캡은 총자산이 기준 금액을 <i>넘어서는 순간부터 영구히 꺼집니다.</i>{' '}
          초기 투입금 1억으로 2010년부터 돌리면 한 번도 발동하지 않습니다(상단 "POOL 비중캡"
          항목에서 실제 발동 횟수를 확인하세요). 자산이 커진 뒤에는 없는 기능이나 마찬가지이므로,
          이 값을 조정해 결과가 바뀐다면 그 구간에서만 유효한 것입니다.
        </p>
        <p>
          <b>양도소득세</b> — 일반 해외주식 계좌 기준으로 연간 실현손익을 합산해 250만원을 공제한
          뒤 22%를 이듬해 5월에 납부하는 것으로 계산합니다. 이 전략은 이익 실현 매도를 반복하므로
          세금 영향이 큽니다. 2010~2026 전체 구간(납입 8.22억) 기준으로,
          매도를 전혀 하지 않는 단순 적립식은 <b>753.6억</b>인데
          이 전략은 세금이 없다고 가정하면 <b>2760.7억(3.66배)</b>, 실제로 세금을 내고 굴리면
          {' '}<b>1218.0억(1.62배)</b>입니다. 누적 납세액이 265.3억입니다.
          <b> 세금이 우위를 3.66배에서 1.62배로 깎지만 역전시키지는 않습니다.</b>{' '}
          (예전 설명에 "세후로는 역전된다"고 적혀 있었으나 현재 설정에서는 사실이 아니라 바로잡았습니다.)
          그래도 세금을 빼고 본 수치는 실제로 손에 남는 금액이 아니므로, 이 페이지의 모든 판정은 세후로 합니다.
        </p>
        <p>
          <b>POOL 부스터</b> — 최근 N거래일(기본 60일) 고점 대비 설정한 낙폭(기본 -30%) 이상
          하락한 주에는, 평소 5%였던 POOL 재투자 비율을 설정한 값(기본 60%)까지 올려서 급락 구간에
          더 공격적으로 재투자합니다.
          <b> 강도를 25%에서 60%로 올렸습니다</b> — 25%로는 발동해도 바닥에서 현금이 절반 남았습니다
          (2020-03-20 저점의 POOL 비중 55.3%). 60%면 18.5%까지 내려갑니다. 25~100% 전 구간이
          단조롭게 개선되는 형태였고, 60% 부근에서 급반등 구간 성과가 정점이었습니다. 100%는 한 주에
          전액을 써버려 바닥 전에 실탄이 떨어집니다.
          {' '}<b>검증(23창 기준)</b> — 끄기 대비 평균 <b>+11.4%</b>, 블록 95% 신뢰구간 [1.9, 24.5],
          23창 중 15개 개선. 전체 구간은 695.4억 → 1218.0억(+75.1%)로 이 화면에서 가장 효과가 큰 옵션입니다.
          <b> 다만 대가가 분명합니다</b> — MDD가 -72.6%에서 <b>-80.4%로 나빠집니다.</b> 바닥에서 현금을
          쏟아붓는 규칙이니 당연한 결과입니다. 그리고 국면을 심하게 탑니다: 실제 12창은 11개 개선인데
          합성 11창은 4개뿐이고, 독립 5창에서는 3/5입니다(닷컴 -0.6%, 금융위기 -0.8%, 2009~2014 +18.7%).
          {' '}<i>급락 뒤 빠른 반등</i>이 오는 국면에서만 값을 합니다.
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
          <b>과열 스로틀 검증(23창 기준)</b> — 끄기 대비 평균 <b>+1.4%</b>, 중앙 +0.1%,
          블록 부트스트랩 95% 신뢰구간 [0.2, 3.0]으로 0을 포함하지 않고, 23창 중 16개에서 개선됩니다.
          실제 12창만 보면 +2.2%(8개 개선), 합성 11창은 +0.6%(8개 개선)입니다.
          전체 구간은 <b>1104.0억 → 1218.0억(+10.3%)</b>이고 MDD는 -80.4%로 변화가 없습니다.
          {' '}<b>"그냥 덜 사서" 좋아진 게 아닙니다.</b> 이 규칙은 총 POOL 재투자액을 줄이지
          않습니다 — 오히려 0.9% 늘어납니다. 과열 때 안 쓴 돈이 POOL에 남아 잔고가 커지고,
          나중에 그 큰 잔고의 5%로 더 많이 들어가기 때문입니다. 즉 <i>금액이 아니라 타이밍만
          옮긴 것</i>입니다. RSI 조건 없이 상시 2.5%로 낮추기만 한 대조군은 같은 23창에서 평균
          +1.1%지만 <b>신뢰구간이 [-3.0, 4.9]로 0을 포함</b>하고, 독립 5창 평균이 +0.1%에 그치며
          2015~2020 구간을 -4.8% 망가뜨립니다. RSI 조건이 하는 일은 이익을 키우는 것보다
          {' '}<i>분산을 줄이는 것</i>에 가깝습니다.
          부스터를 꺼서 "아낀 현금이 바닥에서 쓰이는" 경로를 차단해도 효과가 남습니다(전체 구간 +2.9%).
        </p>
        <p>
          <b>과열 스로틀 — 믿지 말아야 할 부분.</b> 임계값 68~72는 결과가 평평한 고원이라
          단일 봉우리에 맞춘 값은 아닙니다. 다만 <i>68 아래로 내리면 단조롭게 나빠집니다</i> —
          RSI 65~70은 과열이 아니라 그냥 강세여서, 그 구간에서 덜 사는 건 위 대조군과 같은
          행동이 됩니다(65 이상 2.5%를 1단으로 덧붙이면 전체 구간이 +10.4%→+10.1%로 내려가고
          신뢰구간이 0을 포함하게 됩니다).
          {' '}<b>독립 5창으로 좁히면 평균이 +0.4%로 줄고 그중 하나(2015-02~2020-02)는 -1.2%입니다.</b>{' '}
          국면 의존적인 규칙이지 보편적 개선이 아닙니다 — 실제 12창 중 악화된 4개는 전부
          2012-02~2015-02 시작창(저변동 우상향 국면)에 몰려 있고 최대 손실이 -1.2%인 반면,
          2016-02~2019-02 시작창은 +5.5~+7.1%입니다. 작고 잦은 손실과 크고 드문 이익을
          맞바꾸는 보험에 가깝습니다.
          {' '}<b>표본외 근거는 절반만 있습니다</b> — 합성 데이터가 실제와 겹치는 구간에서
          기준선 총자산은 1~4%, 개선폭은 0.0~0.2%p 오차로 재현되므로 합성 자체는 믿을 만합니다.
          그런데 실제 데이터가 아예 없는 1999~2005 시작창 24개에서는 결과가 정확히 <b>±0.0%</b>입니다.
          그 국면은 5년간 매도가 중앙값 2회에 그치고 POOL이 총자산의 6%까지밖에 안 쌓여서
          스로틀이 건드릴 대상이 없습니다 — 반증이 아니라 <i>무효과</i>입니다. 반면 금융위기를
          지나는 2005~2010 시작창 20개는 20개 전부 개선(+1.4%)됐습니다. 즉 <b>POOL이 의미 있는
          크기로 쌓이는 국면에서만 검증됐고, 그렇지 않은 국면에서는 아무 일도 일어나지 않습니다.</b>{' '}
          이익의 약 2/3은 부스터와의 상승효과에서 나오므로 부스터를 끄면 효과도 함께 줄어듭니다.
        </p>
        <p>
          <b>완화매도(옵션)</b> — 마지막 수익실현 매도로부터 설정한 개월 수(기본 7개월) 이상
          지나면, RSI·이격도 기준을 설정한 폭만큼 낮춰서(수익률 25% 기준은 그대로) 매도를
          시도합니다. 이때는 보유 주식을 70%가 아니라 설정한 작은 비율(기본 5%)만 팔아
          POOL을 조금씩 확보합니다.
          {' '}<b>검증(23창 기준)</b> — 끄기 대비 평균 <b>+0.6%</b>, 중앙 +0.5%, 블록 95% 신뢰구간
          [0.2, 1.0], 23창 중 15개 개선. 전체 구간은 1146.2억 → 1218.0억(+6.3%)이고 MDD 변화는 없습니다.
          <b> 다만 독립 5창에서는 3/5에 그칩니다</b>(닷컴 +0.0%, 금융위기 +0.6%, 2009~2014 <b>-1.1%</b>,
          2015~2020 +1.3%, 2020~2025 +2.1%). 효과의 크기가 다른 옵션에 비해 작고, 완화 파라미터를
          이웃 값으로 바꿔도 전체 결과가 1.1배 안에서만 움직입니다. 확정된 개선으로 보지 마세요.
        </p>
        <p>
          <b>추세국면 필터 (신규)</b> — 나스닥100(QQQ)의 <i>전일</i> 종가가 200일선 아래인
          동안 <b>부스터와 POOL 재투자를 모두 멈춥니다</b>. 주간 정액 적립금은 그대로
          들어가고, <b>매도는 전혀 하지 않는 순수 매수측 규칙</b>입니다. 선 위로 돌아오면
          즉시 해제되며 복귀 후 가속 매수도 하지 않습니다. 차트의 청회색 세로 음영이 이 구간입니다.
        </p>
        <p>
          <b>왜 매도가 아니라 매수를 막는가</b> — 2019-02~2024-02 창의 총자산 고점(19.97억,
          2021-12-27)에서 <b>주식비중은 이미 32.1%였고 현금이 67.9%였습니다.</b> 그런데도 MDD가
          -79.1%였습니다. 고점부터 저점까지 <b>부스터가 10.61억을 하락장에 재투입</b>했기 때문입니다.
          팔 주식이 부족한 게 아니라 <i>현금을 하락 도중에 다 쓴 것</i>이므로, 세금 22%를 물고
          더 파는 것보다 안 쓰게 막는 쪽이 쌉니다. 실제로 2022-01-26 하루에 POOL 11.05억의 60%인
          <b>6.63억이 하락 초입에 투입</b>됐고, 이 규칙은 바로 그걸 막습니다.
        </p>
        <p>
          <b>성과 — 연속 경로에서는 이기고, 5년 창에서는 집니다.</b> 둘 다 사실이라 같이 적습니다.
          연속 경로(실제로 겪는 모습)는 실제 TQQQ 2010-2026 기준 <b>1178.96억/MDD -80.4% → 1278.74억/MDD -55.1%</b>,
          합성 1999-2026 기준 2233.17억 → 2587.52억(+15.9%)입니다. 반면 5년 창 23개로 세면
          <b>합계 -2.0%, 중앙값 -0.2%, 7승 12패</b>입니다. 2022가 없는 창에서는 일관되게 집니다
          (2016-02창 -15.9%, 2017-02창 -15.4%, 2009-03창 -11.2%). 창이 매번 1억으로 새로 시작해서
          2022를 피한 이득이 창 밖으로 못 넘어가기 때문입니다. <b>평시에 조금씩 내고 10년에 한 번
          크게 받는 보험</b>으로 보는 게 정확합니다.
        </p>
        <p>
          <b>추세국면 — 믿지 말아야 할 부분.</b> 개선의 거의 전부가 <b>2022-01-26 단 한 주</b>에서 나옵니다.
          이탈 후 며칠까지 기다렸다가 잠그는 방식을 시험해 보면 4일까지는 평탄하지만 5일부터 절벽입니다
          (TQQQ 평균 +6.7% → -4.4%). 그 매수가 이탈 3거래일째에 일어나기 때문이며, 이는
          <b>단일 사건 의존이라는 뜻</b>입니다. 반면 MA 기간은 100~250 전 구간에서 MDD 개선이
          TQQQ +6.9~8.7%p로 평탄해 200은 봉우리가 아니라 고원 안입니다 — 이쪽은 과최적화가 아닙니다.
          검증 규격상 <b>G4(유의성)는 통과하지 못합니다</b> — 블록 부트스트랩 95% 신뢰구간이
          [-3.9, 12.8]로 0을 포함합니다. 27년 표본에서 이 규칙이 활약할 국면(POOL이 큰 상태에서의
          장기 하락)이 사실상 2022 한 번뿐이라 표본이 근본적으로 부족합니다.
        </p>
        <p>
          <b>추세국면 — 비용과 무효 구간.</b> 비용은 코로나형 V자 급락입니다. 2015-05~2020-05 창은
          12.90억 → <b>10.66억(-17.3%)</b>이 됩니다 — 2020-03-18~04-08의 바닥 매수 3.4억이 잠겨서
          200일선 복귀 후 더 비싼 가격에 사게 되기 때문입니다. 200일선은 <i>V자 급락</i>과
          <i>장기 하락</i>을 구분하지 못합니다. 같은 규칙이 2022를 구하고 2020을 망칩니다.
          그리고 <b>닷컴·금융위기에는 아예 무효합니다</b>(닷컴 1.41억 → 1.41억, MDD -98.7% 그대로).
          POOL은 수익실현 매도로만 채워지는데 장기 약세장에는 매도가 안 나와 <i>지킬 현금 자체가
          없기</i> 때문입니다. 이 규칙을 켜도 그런 국면은 못 피합니다.
        </p>
        <p>
          <b>이 전략이 막지 못하는 것</b> — 실제 TQQQ는 2010-02 상장이라 닷컴버블도 금융위기도
          없습니다. 그래서 QQQ로 1999년까지 역산한 합성 데이터(<code>scripts/build-sim-tqqq.py</code>,
          차입비용 반영, 실제 TQQQ와 일간 상관 0.9989·MDD -81.5% vs -81.7%로 검증)를
          {' '}<b>롤링 윈도우 화면 앞쪽 11개 창(점선 카드)으로 이미 넣어 두었습니다.</b> 직접 클릭해 보세요.
          <b> 1999-03~2004-03 구간은 3.18억을 넣고 1.41억(원금의 44%), 2004-03~2009-03 구간은
          3.21억을 넣고 0.66억(원금의 20%)으로 끝납니다.</b> MDD는 -92~-99%입니다.
          매도 조건이 <i>이격도 40% 초과</i>를 요구하는데 하락장에서는 주가가 180일선 위로 그만큼
          올라갈 일이 없어, 5년간 매도가 2~3회에 그칩니다. 매도 규칙이 구조적으로 발동하지 못합니다.
          독립 표본 5개(카키색) 중 2개가 이 구간이라는 점을 기억하세요 — 초록색 카드만 보면
          이 전략이 안전해 보이지만, 겹치는 창을 걷어내고 보면 <b>5개 중 2개가 원금의 절반 이하로 끝납니다.</b>{' '}
          순수 적립식을 포함해 어떤 규칙도 이 구간을 구하지 못했습니다. 위에 넣은
          <b>추세국면 필터도 닷컴에는 1.41억 → 1.41억으로 아무 변화가 없습니다</b>
          (금융위기 0.66→0.69억). 잠금이 100주 넘게 걸려도 쓸 POOL 자체가 없어 발동할 대상이 없기 때문입니다. 기초자산이 -99.95% 빠지면 그 자산
          안에서의 매매 규칙으로는 해결되지 않습니다. 이 리스크에 대한 대응은 파라미터가 아니라
          비중 상한·자산배분 차원이어야 합니다.
        </p>
        <p>
          <b>파라미터</b> — 초기 투입금, 수요일 적립금, POOL 비중캡 기준, 부스터 조건은 상단
          파라미터 패널에서 직접 바꾸고 "적용"을 누르면 모든 백테스트(롤링 윈도우 + 직접 기간 설정)에
          한번에 반영됩니다. 매도 RSI 임계도 파라미터로 열어 두었습니다.
          나머지 매도 조건(이격도 40%·수익률 25%·매도비율 70%·쿨다운 10일)과
          과열 스로틀(RSI 70 → POOL 0%)은 화면에서 조정할 수 없는 고정 상수입니다.
          추세국면 필터는 사용 여부와 MA 기간만 열어 두었습니다 — 대기일수(1일)와 복귀 후
          가속 재투자(0주)는 스윕에서 기각된 값이라 고정했습니다.
        </p>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>
          위 검증 수치를 다시 뽑는 스크립트: <code>scripts/restate-evidence.mjs</code>(옵션별 23창 재측정),{' '}
          <code>scripts/sweep-sellrsi.mjs</code>(매도 RSI 스윕), <code>scripts/window-design.mjs</code>(슬라이드 간격 비교),{' '}
          <code>scripts/opt-rsi-throttle6.mjs</code>(합성 90창), <code>scripts/validate.mjs</code>(변경안 게이트),{' '}
          <code>scripts/sweep-regime.mjs</code>(추세국면 스윕 — 대기일수·부스터비율·가속주수).
          마지막 갱신: 2026-08-29 (추세국면 필터 추가 · 기본 ON).
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
      {/* preset = [공격형(현재 기본값), 보수형(D)] 값 표기. 표기만 하고 자동 적용은 안 한다. */}
      {opts.preset && (
        <span className="param-preset">
          공격 <b>{opts.preset[0]}</b> · 보수 <b className={opts.preset[0] === opts.preset[1] ? '' : 'diff'}>{opts.preset[1]}</b>
        </span>
      )}
    </label>
  )
}

function ParametersPanel({ draft, onDraftChange, onApply, dirty }) {
  const set = (field, value) => onDraftChange({ ...draft, [field]: value })
  return (
    <div className="rules-panel param-panel">
      <h3 className="panel-heading">파라미터 설정</h3>
      {/* 각 칸 아래의 "공격 / 보수"는 표기일 뿐 자동 적용되지 않는다. 직접 입력하고 적용을 누른다.
          보수형 근거: scripts/design-defensive3.mjs(3,815설정 전수), scripts/compare-D.mjs(23창 비교) */}
      <p className="param-preset-note">
        각 칸 아래 <b>공격</b>은 현재 기본값, <b>보수</b>는 낙폭을 줄인 방어형 설정입니다. 표기만 되며 자동 적용되지 않으니
        직접 입력하고 <b>적용</b>을 누르세요. 보수형은 23창 기준 총자산 MDD 평균 -69.8% → -65.9%(개선 15창·악화 0창),
        총자산이 5억을 넘긴 뒤의 MDD는 평균 -49.3% → -36.4%로 줄고 반토막(-50%) 넘는 창이 8/16 → 3/16이 됩니다.
        대가는 총자산 중앙 0.90배(실제 12창 0.83배)입니다.
      </p>
      <div className="param-grid">
        {numField('초기 투입금', draft.initialKRW / 1e8, v => set('initialKRW', v * 1e8), { step: 0.1, unit: '억원' })}
        {numField('수요일 적립금', draft.weeklyKRW / 10000, v => set('weeklyKRW', v * 10000), { step: 5, unit: '만원' })}
        {numField('POOL 비중캡 기준', draft.poolCapKRW / 1e8, v => set('poolCapKRW', v * 1e8), { step: 0.1, unit: '억원' })}
        {numField('매도 RSI 임계', draft.sellRsi, v => set('sellRsi', v), { min: 50, max: 100, step: 1, unit: 'RSI', preset: [73, 70] })}
      </div>
      <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'left', margin: '4px 0 0' }}>
        매도 RSI를 올리면 덜 팔고, 내리면 자주 팝니다. 90 이상이면 매도가 아예 안 걸려 순수 적립식이 됩니다.
        72 이하는 23창 전부에서 나빠집니다. 나머지 매도 조건(이격도 40%·수익률 25%·매도비율 70%·쿨다운 10일)과
        과열 스로틀(RSI 70 → POOL 0%)은 고정입니다.
      </p>

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
        {numField('기준 고점 기간', draft.lookback, v => set('lookback', v), { min: 5, max: 250, step: 5, unit: '거래일', disabled: !draft.enabled, preset: [60, 120] })}
        {numField('하락 임계치', draft.drawdownPct, v => set('drawdownPct', v), { min: 5, max: 70, step: 1, unit: '%', disabled: !draft.enabled, preset: [30, 50] })}
        {numField('재투자 비율', draft.ratioPct, v => set('ratioPct', v), { min: 5, max: 200, step: 1, unit: '%', disabled: !draft.enabled, preset: [60, 60] })}
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
        {numField('미매도 기준', draft.relaxMonths, v => set('relaxMonths', v), { min: 1, max: 24, step: 1, unit: '개월', disabled: !draft.relaxEnabled, preset: [7, 5] })}
        {numField('RSI 완화폭', draft.relaxRsiDrop, v => set('relaxRsiDrop', v), { min: 0, max: 40, step: 1, unit: 'p', disabled: !draft.relaxEnabled, preset: [0, 0] })}
        {numField('이격도 완화폭', draft.relaxDispDrop, v => set('relaxDispDrop', v), { min: 0, max: 40, step: 1, unit: 'p', disabled: !draft.relaxEnabled, preset: [12, 20] })}
        {numField('완화매도 비율', draft.relaxSellFrac * 100, v => set('relaxSellFrac', v / 100), { min: 1, max: 70, step: 1, unit: '%', disabled: !draft.relaxEnabled, preset: [5, 40] })}
      </div>

      <div className="param-divider" />

      <label className="param-checkbox">
        <input
          type="checkbox"
          checked={draft.regimeEnabled}
          onChange={e => set('regimeEnabled', e.target.checked)}
        />
        추세국면 필터 사용 (나스닥100이 200일선 아래면 POOL 지출 정지)
      </label>
      <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'left', margin: '4px 0 0' }}>
        나스닥100(QQQ) <b>전일</b> 종가가 200일선 아래인 동안 부스터와 POOL 재투자를 모두 멈춥니다.
        주간 정액 적립금은 그대로 들어가고 <b>매도는 하지 않습니다</b>. MA 기간은 100~250 전 구간에서
        결과가 평탄해 200에 맞춰 깎은 값이 아닙니다. 대기일수·복귀 후 가속 재투자는 데이터가 기각해
        각각 1일·0주로 고정했습니다(전략 설명 참조).
      </p>
      <div className="param-grid">
        {numField('국면 MA 기간', draft.regimeMaLen, v => set('regimeMaLen', v), { min: 50, max: 300, step: 10, unit: '일', disabled: !draft.regimeEnabled, preset: [200, 200] })}
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

function Sidebar({ view, onSelect, collapsed, onToggle }) {
  const items = [
    { id: 'rolling', label: '5년 롤링 윈도우' },
    { id: 'custom', label: '직접 기간 설정' },
    { id: 'boosterStatus', label: '부스터 상황판' },
    { id: 'sellStatus', label: '매도조건 상황판' },
    { id: 'monitor', label: 'TQQQ 모니터링' },
    { id: 'info', label: '전략 설명 보기' },
  ]
  const cur = items.find(it => it.id === view)
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        {!collapsed && <span className="sidebar-title">메뉴</span>}
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      {/* 항목은 항상 DOM에 두고 접힘은 CSS로 처리 — 모바일(가로배치)에서 메뉴가 사라지지 않도록 */}
      <div className="sidebar-current" title={cur?.label}>{cur?.label ?? ''}</div>
      <div className="sidebar-items">
        {items.map(it => (
          <button
            key={it.id}
            className={`sidebar-item${view === it.id ? ' active' : ''}`}
            onClick={() => onSelect(it.id)}
          >
            {it.label}
          </button>
        ))}
      </div>
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
  const rg = useMemo(() => getRegimeStatus(settings), [settings])
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
        {rg.enabled && (
          <StatusItem
            label={`추세국면 (나스닥100 ${rg.dwellDays === 1 ? '' : `${rg.dwellDays}일 `}${settings.regimeMaLen}일선)`}
            value={rg.locked
              ? `이탈 ${rg.dwell}일째 · POOL 지출 정지`
              : `선 위 ${rg.gapPct >= 0 ? '+' : ''}${rg.gapPct.toFixed(1)}% · 정상`}
            tone={rg.locked ? 'warn' : undefined}
          />
        )}
      </div>
      {rg.enabled && (
        <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'left', marginTop: 10 }}>
          {rg.locked
            ? `나스닥100(QQQ) 전일 종가 ${rg.close.toFixed(2)}가 ${settings.regimeMaLen}일선 ${rg.ma.toFixed(2)} 아래라 부스터와 POOL 재투자가 모두 정지된 상태입니다. 주간 정액 적립금은 그대로 들어갑니다. 종가가 ${settings.regimeMaLen}일선 위로 돌아오는 즉시 해제되며, 복귀 후 가속 매수는 하지 않습니다.`
            : `나스닥100(QQQ) 전일 종가 ${rg.close.toFixed(2)}가 ${settings.regimeMaLen}일선 ${rg.ma.toFixed(2)}보다 ${rg.gapPct.toFixed(1)}% 위라 국면 필터는 잠자입니다. 종가가 ${rg.ma.toFixed(2)} 아래로 내려가면 다음 날부터 부스터와 POOL 재투자가 멈춥니다(매도는 하지 않음).`}
        </p>
      )}
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

function SellStatusPanel({ settings }) {
  const s = useMemo(() => getSellConditionStatus(settings), [settings])
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
        <StatusItem label={`RSI(14) — 기준 ≥ ${s.sellRsi}`} value={s.rsiNow.toFixed(1)} tone={s.rsiMet ? 'ok' : undefined} />
        <StatusItem label="180일 이격도" value={`${s.dispNow.toFixed(1)}%`} tone={s.dispMet ? 'ok' : undefined} />
        <StatusItem label="이격도 40% 도달가" value={`$${s.targetPrice.toFixed(2)} (+${s.neededPct.toFixed(1)}%)`} />
      </div>

      <div className="sub-heading" style={{ color: '#9ca3af' }}>목표가 도달 기간별 예상 RSI (기준 ≥ {s.sellRsi})</div>
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
            className={`window-card ${colorClass}${isSelected ? ' selected' : ''}${w.independent ? ' independent' : ''}`}
            onClick={() => onSelect(w)}
            style={w.source === 'sim' ? { borderStyle: 'dashed' } : undefined}
          >
            {/* 합성·독립 배지까지 한 줄에 들어가야 카드 높이가 들쭉날쭉해지지 않는다 */}
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, whiteSpace: 'nowrap' }}>
              {fmtMonthYear(w.startDate)}~{fmtMonthYear(w.endDate)}
              {w.source === 'sim' && <span style={{ fontSize: 10, color: '#a78bfa', marginLeft: 4 }}>합성</span>}
              {w.independent && <span style={{ fontSize: 10, color: '#d4d47a', marginLeft: 4 }}>독립</span>}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
              {fmtB(w.stats.finalAfterTax)}
              <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>
                / 납입 {fmtB(w.stats.totalIn)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 3 }}>
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

// 합성 창을 열었을 때의 경고. 이 화면의 숫자는 실제 체결 가능했던 값이 아니다.
function SimNotice({ win }) {
  return (
    <div className="rules-panel" style={{ borderColor: '#7c3aed', marginTop: 16 }}>
      <p style={{ color: '#c4b5fd', fontSize: 13, textAlign: 'left', margin: 0 }}>
        <b>합성 데이터 구간입니다 ({fmtMonthYear(win.startDate)}~{fmtMonthYear(win.endDate)}).</b>{' '}
        TQQQ는 2010-02 상장이라 이 기간에는 존재하지 않았습니다. QQQ 일간수익률을 3배로 키우고
        차입비용(2 × 단기금리 + 스프레드)과 운용보수를 뺀 값이며, 스프레드는 2010년 이후 실제
        TQQQ의 누적수익률에 맞춰 보정했습니다. 겹치는 기간에서 실제와 대조하면 기준선 총자산은
        1~4%, 전략 개선폭은 0.0~0.2%p 차이로 재현됩니다. 그래도 <i>실제로 체결 가능했던 값은
        아닙니다</i> — 국면이 어떤 모양이었는지 보는 용도로만 쓰세요.
      </p>
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
  // 합성 창이면 합성 시계열로 다시 돌려야 한다. 안 그러면 카드의 숫자와
  // 상세 화면의 숫자가 어긋난다(합성 창 기간엔 실제 데이터가 아예 없다).
  const data = useMemo(() => dataForSource(win.source), [win.source])
  const { daily, trades, boostTrades, stats } = useMemo(
    () => runFinalBacktest(win.startDate, win.endDate, settings, data),
    [win.startDate, win.endDate, settings, data]
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

  // 200일선 아래로 잠긴 구간. 차트 음영용으로 연속 구간으로 묶는다.
  const regimeRanges = useMemo(() => {
    if (!settings.regimeEnabled) return []
    const ranges = []
    let start = null
    for (let i = 0; i < daily.length; i++) {
      if (daily[i].regimeLocked && start === null) start = daily[i].date
      if (!daily[i].regimeLocked && start !== null) {
        ranges.push([start, daily[i - 1].date])
        start = null
      }
    }
    if (start !== null) ranges.push([start, daily[daily.length - 1].date])
    return ranges
  }, [daily, settings.regimeEnabled])
  const regimeBoundaryDates = useMemo(() => new Set(regimeRanges.flat()), [regimeRanges])

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
      .filter((d, i) => i % 5 === 0 || sellDates.has(d.date) || boostBoundaryDates.has(d.date) || hotBoundaryDates.has(d.date) || regimeBoundaryDates.has(d.date))
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
  }, [daily, sellDates, relaxedSellDates, boostBoundaryDates, hotBoundaryDates, regimeBoundaryDates, settings])

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
    const R = settings.regimeEnabled
    const variants = [
      { label: '세팅값', enabled: settings.enabled, relaxEnabled: settings.relaxEnabled, regimeEnabled: R, isCurrent: true },
      { label: R ? '추세국면 끄기' : '추세국면 켜기', enabled: settings.enabled, relaxEnabled: settings.relaxEnabled, regimeEnabled: !R },
      { label: '부스터 적용', enabled: true, relaxEnabled: false, regimeEnabled: R },
      { label: '완화매도 적용', enabled: false, relaxEnabled: true, regimeEnabled: R },
      { label: '완화매도+부스터 적용', enabled: true, relaxEnabled: true, regimeEnabled: R },
    ]
    return variants.map(v => {
      const { stats: vStats } = runFinalBacktest(win.startDate, win.endDate, {
        ...settings, enabled: v.enabled, relaxEnabled: v.relaxEnabled, regimeEnabled: v.regimeEnabled,
      }, data)
      return { label: v.label, isCurrent: !!v.isCurrent, stats: vStats }
    })
  }, [win.startDate, win.endDate, settings, data])

  return (
    <section style={{ marginTop: 20 }}>
      {win.source === 'sim' && <SimNotice win={win} />}
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
        {settings.regimeEnabled && (
          <div className="stat-item">
            <span className="label">국면 잠금</span>
            <span className="value">{stats.lockedWeeks}/{stats.totalWeeks}주</span>
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
          {regimeRanges.map(([s, e]) => (
            <ReferenceArea key={`rg-${s}-${e}`} x1={s} x2={e} fill={REGIME_COLOR} fillOpacity={0.22} strokeOpacity={0} ifOverflow="visible" />
          ))}
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
      {(hasHot || regimeRanges.length > 0 || (settings.enabled && boostRanges.length > 0)) && (
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
          {regimeRanges.length > 0 && (
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: REGIME_COLOR, opacity: 0.6, marginRight: 6, verticalAlign: 'middle' }} />
              세로 청회색 음영 = 나스닥100이 {settings.regimeMaLen}일선 아래 (POOL 지출 정지, 정액 적립은 유지)
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
  const realCount = windows.filter(w => w.source === 'real').length
  const simCount = windows.length - realCount
  const indepCount = windows.filter(w => w.independent).length
  const [sel, setSel] = useState(null)
  const [view, setView] = useState('rolling')
  // 메뉴 접힘 상태는 새로고침해도 유지
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem('navCollapsed') === '1')
  const toggleNav = () => setNavCollapsed(v => {
    localStorage.setItem('navCollapsed', v ? '0' : '1')
    return !v
  })

  const applySettings = () => setSettings(draft)

  return (
    <div className="page">
      <header>
        <h1>TQQQ MA180 전략 대시보드</h1>
        <div className="sub">데이터 최신일: {DATA_END} (매일 자동 갱신)</div>
      </header>
      <RulesPanel settings={settings} />
      <ParametersPanel draft={draft} onDraftChange={setDraft} onApply={applySettings} dirty={dirty} />

      <div className="layout">
        <Sidebar
          view={view}
          onSelect={id => { setView(id); if (id !== 'custom') setSel(null) }}
          collapsed={navCollapsed}
          onToggle={toggleNav}
        />
        <div className="main-content">
          {view === 'info' && <StrategyInfo />}
          {view === 'boosterStatus' && <BoosterStatusPanel settings={settings} />}
          {view === 'sellStatus' && <SellStatusPanel settings={settings} />}
          {view === 'monitor' && <Monitor />}

          {view === 'custom' && (
            <>
              <CustomRangeForm onRun={setSel} />
              {sel && isCustomWindow(sel) && <BacktestDetail window={sel} settings={settings} />}
            </>
          )}

          {view === 'rolling' && (
            <>
              <section className="section-title">
                5년 롤링 윈도우 (1년씩 슬라이드) — 합성 {simCount}개 + 실제 {realCount}개 = {windows.length}개 (독립 표본 {indepCount}개)
              </section>
              <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'left', margin: '-8px 0 12px' }}>
                오래된 순. 앞쪽 {simCount}개는 실제 데이터가 없는 {SIM_START.slice(0, 7)}~{DATA_START.slice(0, 7)} 구간을
                합성 TQQQ로 채운 것이고(점선 카드), 뒤쪽 {realCount}개가 실제 TQQQ {DATA_START.slice(0, 7)}~{DATA_END.slice(0, 7)}입니다.
                5년 창을 1년씩 밀었습니다. 합성 창 중 2010-02 이후 시작분은 실제 창과 같은 기간이라 뺐습니다.
              </p>
              <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'left', margin: '0 0 12px' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#3a3a24', border: '1px solid #a3a34d', marginRight: 6, verticalAlign: 'middle' }} />
                <b>카키색 {indepCount}개 = 실질 독립 표본.</b> 가장 오래된 창부터 서로 겹치지 않게 이어 붙인 사슬입니다
                (전체 27.4년 ÷ 창 5년 = 5.5개가 상한). <b>창 {windows.length}개가 검증 {windows.length}회는 아닙니다</b> —
                나머지 {windows.length - indepCount}개는 이 {indepCount}개와 데이터를 4년씩 나눠 쓰는 것이라 별도 표본이 아닙니다.
                겹치는 창을 독립인 양 세면 신뢰구간이 실제보다 좁게 나옵니다.
              </p>
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
