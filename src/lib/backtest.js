import tqqqRaw from '../data/tqqq.json' with { type: 'json' };
// QQQ로 1999년까지 역산한 합성 TQQQ. 실제 TQQQ는 2010-02부터라 닷컴·금융위기가 없다.
// 생성: python scripts/build-sim-tqqq.py (3배 곱이 아니라 차입비용까지 반영)
import tqqqSimRaw from '../data/tqqq_sim.json' with { type: 'json' };
// 200일선 국면 판정용 나스닥100. TQQQ 자신이 아니라 지수를 쓴다 —
// 3배 ETF의 MA는 길이에 따라 결과가 심하게 흔들려 과최적화가 된다.
import qqqRaw from '../data/qqq.json' with { type: 'json' };

// Wilder RSI(period), standard recursive smoothing (TradingView convention)
function calcRSI(closes, period) {
  const rsi = new Array(closes.length).fill(NaN);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// Simple moving average disparity: (close - MA)/MA * 100
function calcDisparity(closes, period) {
  const disp = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) {
      const ma = sum / period;
      disp[i] = ma > 0 ? ((closes[i] - ma) / ma) * 100 : NaN;
    }
  }
  return disp;
}

function calcMDD(series) {
  let peak = -Infinity, mdd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v - peak) / peak * 100;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd;
}

// Rolling max over trailing `period` closes (inclusive of current day)
function calcRollMax(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    const s = Math.max(0, i - period + 1);
    let m = -Infinity;
    for (let j = s; j <= i; j++) if (closes[j] > m) m = closes[j];
    out[i] = m;
  }
  return out;
}

export const TQQQ_DATA = tqqqRaw;
export const SIM_DATA = tqqqSimRaw;
export const DATA_START = TQQQ_DATA[0][0];
export const DATA_END = TQQQ_DATA[TQQQ_DATA.length - 1][0];
export const SIM_START = SIM_DATA[0][0];

// 전략 파라미터 기본값 (전부 UI에서 조정 가능)
//  - 부스터: 60거래일 고점 대비 -25%↓ 시 주간 POOL 재투자 비율을 5%→25%로 상향
//  - initialKRW: 시작일 일시 매수 초기 투입금 (기본 1억)
//  - weeklyKRW: 수요일 정액 적립금 (기본 85만원)
//  - poolCapKRW: 총자산이 이 금액 이하일 때 POOL 비중 10% 캡 적용 기준 (기본 2억)
export const DEFAULT_SETTINGS = {
  // ratioPct 25 → 60: 부스터 강도. 25%는 발동해도 바닥에서 현금이 절반 남았다
  // (2020-03-20 POOL 비중 55.3%). 60%면 18.5%까지 내려간다. 25→100% 전 구간이
  // 단조 개선되는 고원이고, 60% 부근에서 코로나형 급반등 성과가 정점(+6.0%)이다.
  // 100%는 전체구간 수치가 더 좋지만 한 주에 다 써버려 급반등 구간이 -0.8%로 꺾인다.
  enabled: true, lookback: 60, drawdownPct: 30, ratioPct: 60,
  // 부스터 AND 조건(선택). null이면 낙폭만 본다. 값을 주면 "그날 RSI ≤ 이 값"까지
  // 만족해야 부스터가 켜진다 — 낙폭은 컸지만 이미 반등이 시작된 주를 걸러내려는 것.
  boostRsiMax: null,
  initialKRW: 100_000_000, weeklyKRW: 850_000, poolCapKRW: 200_000_000,
  // 수익실현 매도 RSI 임계. 70 → 73으로 올렸다.
  // 71~75가 연속으로 개선되는 "고원"이지 단일 봉우리가 아니다. 70에서만 걸리던
  // 매도 12건 중 7건은 이후 낙폭이 -13% 이내여서 세금만 내고 끝났을 거래였다.
  // POOL 재투입이 주 5%로 느려서, 일찍 팔아 폭락을 피해 번 것보다 반등에 못
  // 올라타 잃은 게 컸다. 23창 재측정: scripts/sweep-sellrsi.mjs
  sellRsi: 73,
  // 완화매도: 마지막 수익실현 매도 후 relaxMonths개월 이상 지나면 RSI/이격도
  // 기준을 낮춰서 매도(수익률 25% 기준은 유지), 매도 비율도 relaxSellFrac로 축소.
  // 46개 롤링 구간 스윕 검증값(평균 총자산 +1.8%, 2018-08 미스 케이스 해결)이 기본값.
  relaxEnabled: true, relaxMonths: 7, relaxRsiDrop: 0, relaxDispDrop: 12, relaxSellFrac: 0.05,
  // 조정예상매도 — 검증 후 기각. 기본 OFF로 두고 근거만 남긴다.
  //
  // 문제의식은 옳았다. 횡보·저성장 국면에서는 고정기준(이격도>40 AND RSI>=73)에
  // 못 닿은 채 -30% 하락을 맞는다. 27년 합성표본 41개 사이클 중 29개가 그런 경우였고
  // (고점 직전 6개월 수익률 평균 -3.5%, 고점 이격도 -5.5%), 그쪽이 오히려 더 깊었다
  // — 평균 MDD -54.2% vs 고정기준이 잡은 12개 -44.0%.
  //
  // 발동조건 — 아래 셋을 모두 만족하는 날.
  //   1) 국면: anticipateRegimeMode/N으로 잰 값 <= anticipateRegimeMax
  //   2) 현금: POOL 비중 <= anticipateCashMax %
  //   3) 지표: 이격도 >= 국면 예상 고점선 AND RSI >= 국면 예상 고점선 (+margin)
  //      국면선 = 사이클 고점의 이격도·RSI를 직전 126일 수익률에 회귀한 것.
  //      회귀는 그 시점까지 -30%에 닿아 확정된 사이클로만 적합한다(미래참조 금지).
  //
  // 기각 사유 — scripts/anticipate-*.mjs (약 115개 조합)
  //  · 요청안 그대로(완화매도 제거 + 조정예상)는 명확히 나빴다.
  //    5년창 23개 -5.5%(7개선/14악화), 10년창 -12.8%, 전체구간 실제 -37.7%.
  //    국면선 체류율이 20%(고정기준 1.8%)라 남발된다.
  //  · 네 곳을 고치면(수익률>=25% 추가, 국면 문턱 20%, 현금조건 해제, 예상선 하한 +20)
  //    5년창 +0.1%·10년창 +1.7%에 MDD +0.7%p까지 올라온다. 여기까진 그럴듯했다.
  //  · 그런데 시대 홀드아웃(합성 1999~2010에서 고르고 실제 2010~에서 검증)으로
  //    국면 정의 45종을 다시 훑으니, 양쪽 다 플러스인 건 ret 126일 <=20% 한 칸뿐이고
  //    그 주변 5x5 격자의 이웃 24칸이 전부 마이너스였다(<=24%면 -7.2%, 113일이면 -11.5%).
  //    고원이 아니라 뾰족한 봉우리다. 실제 발동도 16년에 4건(2018·2019·2025·2026)뿐이라
  //    +1.0%는 근거가 못 된다.
  //  · 재현되는 건 하나뿐이다 — MDD는 확실히 살 수 있지만(검증 +0.9~1.9%p, 격자 전반에서
  //    안정적) 언제나 수익률 -6~-16%를 내주고 산다. 공짜로 보였던 한 칸이 우연이었을 뿐
  //    맞교환 관계 자체는 견고하다. 최적화 문제가 아니라 취향 문제다.
  //  · 결정적으로 원래 목표를 달성하지 못한다. 큰 폭락의 MDD가 어느 설정에서도
  //    꿈쩍하지 않았다 — 실제 -80.4%, 합성 -98.7% 그대로다.
  //
  // 참고: 대안 국면 정의(180일선 기울기, 기간 고점 대비)는 전부 직전 수익률만 못했다.
  // 완화매도를 없애는 것 자체도 손해였다(5년창 -0.6%, 10년창 -0.8%). 그래서 유지한다.
  anticipateEnabled: false,
  anticipateRegimeMax: 40, anticipateCashMax: 20, anticipateMargin: 0,
  // 발동조건1을 재는 방식과 기간. 'ret' | 'maslope' | 'highdist'
  anticipateRegimeMode: 'ret', anticipateRegimeN: 126,
  // 예상 고점선 하한. 국면이 나쁘면 회귀가 "이동평균선 아래에서 고점" 같은 값을
  // 내놓아 아무 반등에나 걸린다(실측: 이격도 +5.4%에서 매도). 고점이라 부를 최소선.
  anticipateDispFloor: 0, anticipateRsiFloor: 0,
  anticipateSellFrac: 0.30, anticipateMinGain: 0, anticipateCooldown: 21,
  anticipateMinCycles: 4,
  // 과열 스로틀: 수요일 POOL 재투자 비율(평상시 5%)을 그날 RSI 구간별로 낮춘다.
  // tiers = [[RSI임계, 재투자%], ...] 오름차순. RSI가 넘긴 임계 중 가장 높은 단이 적용된다.
  // 부스터가 켜진 주(고점 대비 급락)에는 적용하지 않는다 — 조건상 겹치지 않는다.
  //
  // RSI 70 이상에서 POOL 재투자를 완전히 멈춘다. 매도는 RSI 73 부근에서 일어나므로
  // 그 직후 몇 주는 POOL이 크고 RSI는 아직 높다. 이때 평소대로 5%를 사면 방금 판
  // 가격 근처에서 되사서 평단가를 올리고 곧 오는 조정을 그대로 맞는다.
  //   · 세후 롤링 46구간 평균 +2.7%, 블록부트스트랩 95% CI [0.1, 5.2] (0을 포함하지 않음)
  //   · 겹치지 않는 독립 5년 3구간: -0.4% / +7.0% / +2.7%, 전체구간 +10.4%, MDD -0.1%p
  //   · 발동 98/850주(12%). 수요일 정액 적립금은 그대로 들어가고 POOL 부분만 멈춘다.
  // "그냥 덜 사서" 좋아진 게 아니다 — 이 규칙은 총 POOL 재투자액을 오히려 0.9% 늘린다
  // (안 쓴 돈이 POOL에 남아 잔고가 커지고 나중에 그 5%로 더 많이 들어간다). RSI 조건
  // 없이 상시 비율만 낮춘 대조군은 같은 +10%를 얻으려 재투자액을 51% 줄여야 하고
  // 2011~2016 구간을 -17% 망가뜨린다. 부스터를 꺼도 효과가 남는다(전체구간 +2.9%).
  // 임계는 68~72가 평평한 고원이라 단일 봉우리에 맞춘 값이 아니다. 다만 68 아래로
  // 내리면 단조롭게 나빠진다 — RSI 65~70은 과열이 아니라 그냥 강세다.
  throttleEnabled: true, throttleTiers: [[70, 0]],
  // 마켓오프: 이익실현 매도(이격도 40%+RSI)는 하락장에서 구조적으로 발동하지 못해
  // 2000년·2008년 같은 구간을 그대로 맞는다. 그걸 막기 위한 별도 방어 규칙.
  // 가격이 "평단가에 가까워지는" 정도로 판정한다 — 고점 대비 낙폭이 아니라
  // 내 수익 쿠션이 얼마나 남았느냐가 기준이다.
  //   marketOffTiers = [[수익률임계%, 매도비율], ...] 내림차순.
  //     수익률이 임계 이하로 내려오면 보유 주식의 그 비율만큼 팔아 POOL로 옮긴다.
  //     각 단은 한 번만 발동하고, 수익률이 marketOffResetGain 위로 회복하면 재무장한다.
  //   marketOffMinAssets: 총자산이 이 금액 이상일 때만 작동. 그 아래에서는 주간
  //     적립금(연 4400만원)만으로도 평단가를 의미 있게 낮출 수 있어 팔 이유가 없다.
  //   marketOffLockBooster: 마켓오프가 발동한 상태에서는 부스터를 잠근다. 안 그러면
  //     확보한 현금을 부스터가 하락 도중에 도로 쏟아부어 규칙이 상쇄된다.
  //
  // 검증 결과(scripts/sweep-marketoff.mjs) — 기본 OFF로 둔다.
  //  · 이 규칙만 켜면 거의 아무 일도 안 일어난다. 23창 MDD 평균 -69.8% → -68.9%,
  //    총자산 -3.0%. 부스터가 확보한 현금을 하락 도중에 도로 쏟아붓기 때문이다
  //    (2018~2023 창에서 마켓오프 5.30억 매도 vs 부스터 16.35억 재투입).
  //  · marketOffLockBooster를 켜면 실제로 작동한다. 23창 MDD 평균 -65.1%(14창 개선,
  //    악화 0), 전체구간 MDD -80.4% → -69.7%. 2004~2009은 0.66→1.05억(+59%),
  //    2018~2023은 8.32→9.85억(+18%).
  //  · 그런데 대가가 크다. 전체구간 세후 1218억 → 483억(-60%), 23창 평균 -3.0%,
  //    크게 도움 7창 vs 크게 손해 11창(2016~2021은 47.1→29.8억).
  //  · 결정적으로, MDD 1%p를 줄이는 비용이 '부스터를 그냥 끄기'와 같다(69억 vs 66억).
  //    정교한 방어 규칙이 아니라 부스터를 끄는 것과 같은 거래를 복잡하게 한 셈이다.
  //  · 참고: 3억이라는 절대 기준은 자산 규모에 따라 의미가 달라진다. 1억으로 시작하는
  //    5년 창에서는 의도대로지만, 16년 복리 구간에서는 초기에 넘긴 뒤 늘 켜져 있다.
  marketOffEnabled: false, marketOffMinAssets: 300_000_000,
  marketOffTiers: [[10, 0.30], [5, 0.30]], marketOffResetGain: 25, marketOffLockBooster: false,
  // 추세국면(200일선): 나스닥100 전일 종가가 200일선 아래인 동안 POOL 지출을 멈춘다.
  // 매도는 하지 않는다 — 순수하게 매수측 규칙이다. 검증: scripts/sweep-regime.mjs
  //
  // 왜 매도가 아니라 매수측인가:
  //   2019-02~2024-02 창의 총자산 고점(19.97억, 2021-12-27)에서 주식비중은 이미
  //   32.1%였고 현금이 67.9%였다. 그런데도 MDD -79.1%가 났다. 고점부터 저점까지
  //   부스터가 10.61억을 하락장에 재투입했기 때문이다. 팔 주식이 부족한 게 아니라
  //   현금을 하락 도중에 다 쓴 것이므로, 세금 22%를 물고 더 파는 것보다 안 쓰게
  //   막는 쪽이 싸다. (marketOff가 실패한 이유도 같다 — 그쪽 주석 참조)
  //
  // 효과와 비용이 단일 사건 하나로 갈린다. 감추지 말 것:
  //   전체구간 2010-2026  1178.96억/MDD -80.4%  →  1278.74억/MDD -55.1%  (2026-08-28 데이터)
  //   목표창 2019-02~2024-02  15.95억/-79.1%  →  22.25억/-52.6% (IRR 52.9→65.4%)
  //   개선의 거의 전부가 2022-01-26 한 주다. 그날 부스터가 POOL 11.05억의 60%인
  //   6.63억을 하락 초입에 쏟아부었고, 이 규칙은 그걸 막는다.
  //   대가는 코로나형 V자 급락이다. 2015-05~2020-05 창은 12.90 → 10.66억(-17.3%) —
  //   2020-03-18~04-08의 바닥 매수 3.4억이 잠겨서 200일선 복귀 후 더 비싸게 샀다.
  //   200일선은 "V자 급락"과 "장기 하락"을 구분하지 못한다. 같은 규칙이 2022를
  //   구하고 2020을 망친다. 이건 버그가 아니라 이 지표의 한계다.
  //
  // 기본 ON이지만 G4(유의성)는 통과하지 못한다. 켠 근거와 못 넘은 지점을 같이 적는다:
  //   G1 자산하한 통과 / G2 개선 통과(합성 +3.1%, TQQQ +6.6%) / G3 교차검증 통과
  //   G4 블록 부트스트랩 95% CI [-3.4, 11.8] → 0을 포함. 탈락.
  //   27년 표본에서 이 규칙이 활약할 국면(POOL이 큰 상태에서의 장기 하락)이 사실상
  //   2022 한 번뿐이라 표본이 근본적으로 부족하다. 켜고 끄는 건 판단의 영역이다.
  //   켠 이유는 연속 경로 성적이다 — 실제로 겪는 건 5년 창이 아니라 이어지는 한 경로다.
  //     실제 TQQQ 2010-2026  1178.96억/-80.4%  →  1278.74억/-55.1%  (+8.5%)
  //     합성 TQQQ 1999-2026  2233.17억/-98.7%  →  2587.52억/-98.7%  (+15.9%)
  //   반대로 5년 창(1년 슬라이드) 23개로 세면 합계 -2.0%, 중앙값 -0.2%, 7승 12패다.
  //   2022가 없는 창에서는 일관되게 진다(2016-02창 -15.9%, 2017-02창 -15.4%).
  //   평시에 조금씩 내고 10년에 한 번 크게 받는 보험이라고 보는 게 정확하다.
  //   MDD 평균 개선은 TQQQ 46창 +6.9%p, 합성 90창 +3.7%p로 일관되게 플러스다.
  //
  //   regimeMaLen: 지수 이동평균 기간. 200에 맞춰 깎은 값이 아니다 — MDD 개선폭이
  //     100~250 전 구간에서 TQQQ +6.9~8.7%p / 합성 +3.7~4.7%p로 평탄하다(200은 그
  //     고원 안이고 봉우리가 아니다). 300에서 무너지는데, 2022-01-26을 놓치기 때문이다.
  //   regimeDwellDays: 200일선 아래 연속 거래일이 이 값 이상이면 잠금(1=이탈 즉시).
  //     ※ 고원이 없다. 1~4는 평평하지만 5에서 절벽이다(TQQQ 평균 +6.7% → -4.4%).
  //       2022-01-26 매수가 이탈 3거래일째라 D≥5면 그 한 주를 놓치기 때문이다.
  //       "며칠 기다린다"는 아이디어는 데이터가 기각했다. 1로 둘 것.
  //   regimeBoostPct: 잠긴 동안 부스터가 걸린 주의 POOL 재투자 비율(평상시 60%).
  //     0/6/12/20/30/45%가 단조롭게 0%에서 최선이다. 중간값을 쓸 이유가 없다.
  //   regimePoolStop: 잠긴 동안 평상시 5% 재투자도 멈출지. 주간 적립금은 그대로 간다.
  //   regimeAccelWeeks: 200일선 복귀 후 이만큼의 주를 ratioPct로 되돌린다.
  //     ※ 0이 정답이다. 켜면 순손해다(TQQQ 평균 +6.6% → -4.9%). 2022년에만 가짜
  //       복귀가 4번 있었고, 가속은 그때마다 60%로 데드캣 바운스를 사들인다.
  regimeEnabled: true, regimeMaLen: 200, regimeDwellDays: 1,
  regimeBoostPct: 0, regimePoolStop: true, regimeAccelWeeks: 0,
  // 양도세: 일반 해외주식 계좌 기준. 연간 실현손익 합산 → 250만원 기본공제 → 22%(지방세 포함),
  // 이듬해 5월 납부. 매도가 잦은 전략일수록 세후 성과가 크게 달라지므로 기본 ON.
  taxEnabled: true,
};
export const DEFAULT_BOOSTER = DEFAULT_SETTINGS;

// Pre-compute indicators once per dataset so rolling windows are fast.
// 데이터셋별로 캐시 — 교차검증(scripts/validate.mjs)에서 QLD 등 다른 시계열을
// 같은 엔진으로 돌려보기 위해 데이터셋을 인자로 받을 수 있게 해 둔다.
const _indCache = new Map();
function getIndicators(data) {
  let ind = _indCache.get(data);
  if (!ind) {
    const closes = data.map(([, c]) => c);
    ind = { closes, rsi: calcRSI(closes, 14), disp: calcDisparity(closes, 180), rollMax: {}, regime: {} };
    _indCache.set(data, ind);
  }
  return ind;
}

// ── 조정예상매도용 국면선 ────────────────────────────────────────────────
// 고정 매도기준(이격도>40 AND RSI>=73)은 횡보·저성장 국면에서 영영 안 걸린다.
// 사이클 고점의 이격도·RSI는 절대 수준이 아니라 직전 상승 속도가 정하기 때문이다.
// 그래서 "직전 126거래일 수익률"에 대고 회귀한 예상 고점선을 기준으로 쓴다.
//
// ★ 회귀는 그 시점까지 -30%에 닿아 이미 확정된 사이클로만 적합한다(미래참조 금지).
//   고점은 -30%를 맞기 전에는 사이클인지 알 수조차 없다.
const REGIME_N = 126;

function calcRegimeArr(closes, n = REGIME_N) {
  return closes.map((c, i) => (i < n ? NaN : (c / closes[i - n] - 1) * 100));
}

/**
 * 발동조건1("횡보·저성장")을 재는 방식. 무엇이 국면을 가장 잘 가르는지는
 * 실측으로 정할 문제라 세 가지를 두고 고를 수 있게 했다.
 *   ret      직전 n거래일 수익률 %            — 단순하지만 점대점이라 노이즈가 있다
 *   maslope  180일선 자신의 n거래일 기울기 %   — 추세만 남기고 일간 노이즈를 지운다
 *   highdist 직전 n거래일 고점 대비 위치 %     — 신고가 행진이면 0, 눌리면 음수
 * 셋 다 "값이 낮을수록 횡보·약세"라서 게이트는 항상 <= 로 건다.
 */
function calcRegimeGate(closes, mode, n) {
  if (mode === 'maslope') {
    const ma = new Array(closes.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= 180) sum -= closes[i - 180];
      if (i >= 179) ma[i] = sum / 180;
    }
    return ma.map((v, i) => (i < 179 + n || isNaN(ma[i - n]) ? NaN : (v / ma[i - n] - 1) * 100));
  }
  if (mode === 'highdist') {
    const out = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i++) {
      if (i < n) continue;
      let m = -Infinity;
      for (let j = i - n; j <= i; j++) if (closes[j] > m) m = closes[j];
      out[i] = (closes[i] / m - 1) * 100;
    }
    return out;
  }
  return calcRegimeArr(closes, n);   // 'ret'
}

/** 하락 th%·반등 rebound%로 방향을 트는 지그재그. 회복을 요구하지 않는다 —
 *  합성 TQQQ는 닷컴 이후 신고가를 못 내서 회복 기준으로는 사이클이 안 잡힌다. */
function calcZigzagPeaks(closes, th = 30, rebound = 50) {
  const out = [];
  let dir = 'up', ext = closes[0], extIdx = 0;
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i];
    if (dir === 'up') {
      if (c > ext) { ext = c; extIdx = i; }
      else if ((c / ext - 1) * 100 <= -th) { out.push({ peakIdx: extIdx, confirmIdx: i }); dir = 'down'; ext = c; extIdx = i; }
    } else if (c < ext) { ext = c; extIdx = i; }
    else if ((c / ext - 1) * 100 >= rebound) { dir = 'up'; ext = c; extIdx = i; }
  }
  return out;
}

function fitLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  return { a: my - b * mx, b, xmin: Math.min(...pts.map(p => p.x)), xmax: Math.max(...pts.map(p => p.x)) };
}

/** 인덱스별 워크포워드 예상 고점 이격도·RSI. 확정 사이클이 minCycles 미만이면 NaN. */
function getRegimeGateArr(data, mode, n) {
  const ind = getIndicators(data);
  const key = `gate:${mode}:${n}`;
  if (!ind.regime[key]) ind.regime[key] = calcRegimeGate(ind.closes, mode, n);
  return ind.regime[key];
}

function getRegimeLines(data, minCycles) {
  const ind = getIndicators(data);
  const key = 'wf' + minCycles;
  if (ind.regime[key]) return ind.regime[key];
  const { closes, rsi, disp } = ind;
  const reg = calcRegimeArr(closes);
  const n = closes.length;
  const predD = new Array(n).fill(NaN), predR = new Array(n).fill(NaN);
  const sample = calcZigzagPeaks(closes)
    .filter(c => !isNaN(reg[c.peakIdx]) && !isNaN(disp[c.peakIdx]) && !isNaN(rsi[c.peakIdx]))
    .map(c => ({ at: c.confirmIdx, x: reg[c.peakIdx], d: disp[c.peakIdx], r: rsi[c.peakIdx] }))
    .sort((a, b) => a.at - b.at);
  let k = 0; const pts = [];
  let fd = null, fr = null;
  for (let i = 0; i < n; i++) {
    let dirty = false;
    while (k < sample.length && sample[k].at <= i) { pts.push(sample[k]); k++; dirty = true; }
    if (pts.length < minCycles) continue;
    if (dirty || !fd) {
      fd = fitLine(pts.map(p => ({ x: p.x, y: p.d })));
      fr = fitLine(pts.map(p => ({ x: p.x, y: p.r })));
    }
    if (!fd || !fr || isNaN(reg[i])) continue;
    const x = Math.min(fd.xmax, Math.max(fd.xmin, reg[i]));   // 적합 범위 밖은 외삽하지 않는다
    predD[i] = fd.a + fd.b * x;
    predR[i] = fr.a + fr.b * x;
  }
  ind.regime[key] = { reg, predD, predR };
  return ind.regime[key];
}

const _closes = getIndicators(TQQQ_DATA).closes;
const _rsi = getIndicators(TQQQ_DATA).rsi;
const _disp = getIndicators(TQQQ_DATA).disp;

// 부스터 lookback은 UI에서 바뀔 수 있으므로 값별로 캐시해서 재사용
function getRollMaxArr(lookback, data = TQQQ_DATA) {
  const ind = getIndicators(data);
  if (!ind.rollMax[lookback]) ind.rollMax[lookback] = calcRollMax(ind.closes, lookback);
  return ind.rollMax[lookback];
}

// 날짜별 "나스닥100이 200일선 아래에 연속으로 며칠 있었나".
// 전일 확정 종가로만 판정한다 — 당일 종가로 그날 매매를 정하면 미래를 쓰는 셈이다.
// 위로 올라오면 0으로 리셋된다.
const _dwellCache = new Map();
function getDwellByDate(maLen) {
  const hit = _dwellCache.get(maLen);
  if (hit) return hit;
  const closes = qqqRaw.map(([, p]) => p);
  const ma = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= maLen) sum -= closes[i - maLen];
    if (i >= maLen - 1) ma[i] = sum / maLen;
  }
  const m = new Map();
  let run = 0;
  for (let i = 1; i < qqqRaw.length; i++) {
    if (isNaN(ma[i - 1])) continue;
    run = closes[i - 1] < ma[i - 1] ? run + 1 : 0;
    m.set(qqqRaw[i][0], run);
  }
  _dwellCache.set(maLen, m);
  return m;
}

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

const TRADING_DAYS_PER_MONTH = 21;

// 수익실현 매도 임계. settings.sellRsi로 옮겨 화면·검증 스크립트에서 조정 가능하다.
// (DEFAULT_SETTINGS.sellRsi = 73. 근거는 그쪽 주석에.)
const SELL_DISP = 40;

// 평상시 주간 POOL 재투자 비율. 부스터 조건을 만족한 주에만 settings.ratioPct로 올라간다.
// 이 값 자체를 올리는 실험은 모두 나빴다 — 매도는 RSI가 높은 고점에서 일어나므로
// 빨리 재투입하면 방금 판 가격에 도로 산다. 굼뜬 게 과열이 식기를 기다리는 역할을 한다.
const BASE_POOL_RATIO = 0.05;

// 해외주식 양도소득세: 지방소득세 포함 22%, 연 250만원 기본공제
const TAX_RATE = 0.22;
const TAX_DEDUCTION = 2_500_000;

// 적립식 현금흐름을 반영한 실제 수익률(IRR). 이분법으로 NPV=0인 할인율을 찾는다.
// (총자산/총납입)^(1/연)-1 방식은 나중에 넣은 돈도 처음부터 복리한 것으로 계산해
// 실제보다 12~15%p 낮게 나오므로 사용하지 않는다.
function calcIRR(cashflows) {
  let lo = -0.99, hi = 5;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    let npv = 0;
    for (const { t, amt } of cashflows) npv += amt / Math.pow(1 + mid, t);
    if (npv > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// data 인자는 교차검증용. 생략하면 TQQQ.
export function runFinalBacktest(startDate, endDate, settings = DEFAULT_SETTINGS, data = TQQQ_DATA) {
  const { rsi: _rsiArr, disp: _dispArr } = getIndicators(data);
  const startIdx = data.findIndex(([d]) => d >= startDate);
  const endIdxRaw = data.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? data.length : endIdxRaw;

  if (startIdx === -1 || sliceEnd <= startIdx) {
    throw new Error('유효한 날짜 범위가 아닙니다');
  }

  const booster = settings || DEFAULT_SETTINGS;
  const boostActive = !!booster.enabled;
  const boostFrac = boostActive ? booster.ratioPct / 100 : 0;
  const boostDrawdownFrac = boostActive ? booster.drawdownPct / 100 : 0;
  const weeklyKRW = booster.weeklyKRW ?? DEFAULT_SETTINGS.weeklyKRW;
  const poolCapKRW = booster.poolCapKRW ?? DEFAULT_SETTINGS.poolCapKRW;
  const initialKRW = booster.initialKRW ?? DEFAULT_SETTINGS.initialKRW;
  const lookback = booster.lookback ?? DEFAULT_SETTINGS.lookback;
  const rollMaxArr = boostActive ? getRollMaxArr(lookback, data) : null;
  const boostRsiMax = booster.boostRsiMax ?? DEFAULT_SETTINGS.boostRsiMax;
  // 낙폭 조건 + (선택) RSI 상한. 둘 다 만족해야 부스터가 켜진다.
  // moFired(마켓오프 발동 상태)는 아래에서 선언하지만, 이 함수는 루프 안에서만
  // 호출되므로 그때는 이미 초기화돼 있다.
  const boostFires = (priceUSD, rollMax, rsi) =>
    boostActive && !isNaN(rollMax) && priceUSD <= rollMax * (1 - boostDrawdownFrac) &&
    (boostRsiMax == null || (!isNaN(rsi) && rsi <= boostRsiMax)) &&
    !(marketOffLockBooster && moFired.some(Boolean));

  const relaxEnabled = !!booster.relaxEnabled;
  const relaxMonths = booster.relaxMonths ?? DEFAULT_SETTINGS.relaxMonths;
  const relaxRsiDrop = booster.relaxRsiDrop ?? DEFAULT_SETTINGS.relaxRsiDrop;
  const relaxDispDrop = booster.relaxDispDrop ?? DEFAULT_SETTINGS.relaxDispDrop;
  const relaxSellFrac = booster.relaxSellFrac ?? DEFAULT_SETTINGS.relaxSellFrac;
  const relaxDays = relaxMonths * TRADING_DAYS_PER_MONTH;

  const taxEnabled = booster.taxEnabled ?? DEFAULT_SETTINGS.taxEnabled;
  const SELL_RSI = booster.sellRsi ?? DEFAULT_SETTINGS.sellRsi;

  const marketOffTiers = booster.marketOffEnabled
    ? [...(booster.marketOffTiers ?? DEFAULT_SETTINGS.marketOffTiers)].sort((a, b) => b[0] - a[0])
    : null;
  const marketOffMinAssets = booster.marketOffMinAssets ?? DEFAULT_SETTINGS.marketOffMinAssets;
  const marketOffResetGain = booster.marketOffResetGain ?? DEFAULT_SETTINGS.marketOffResetGain;
  const marketOffLockBooster = !!booster.marketOffLockBooster;
  // 마켓오프 각 단이 발동했는지. 재무장되면 전부 false로 돌아간다.
  const moFired = new Array(marketOffTiers ? marketOffTiers.length : 0).fill(false);

  const antEnabled = !!booster.anticipateEnabled;
  const antRegimeMax = booster.anticipateRegimeMax ?? DEFAULT_SETTINGS.anticipateRegimeMax;
  const antCashMax = booster.anticipateCashMax ?? DEFAULT_SETTINGS.anticipateCashMax;
  const antMargin = booster.anticipateMargin ?? DEFAULT_SETTINGS.anticipateMargin;
  const antSellFrac = booster.anticipateSellFrac ?? DEFAULT_SETTINGS.anticipateSellFrac;
  const antMinGain = booster.anticipateMinGain ?? DEFAULT_SETTINGS.anticipateMinGain;
  const antCooldown = booster.anticipateCooldown ?? DEFAULT_SETTINGS.anticipateCooldown;
  const antMinCycles = booster.anticipateMinCycles ?? DEFAULT_SETTINGS.anticipateMinCycles;
  const antDispFloor = booster.anticipateDispFloor ?? DEFAULT_SETTINGS.anticipateDispFloor;
  const antRsiFloor = booster.anticipateRsiFloor ?? DEFAULT_SETTINGS.anticipateRsiFloor;
  const antRegimeMode = booster.anticipateRegimeMode ?? DEFAULT_SETTINGS.anticipateRegimeMode;
  const antRegimeN = booster.anticipateRegimeN ?? DEFAULT_SETTINGS.anticipateRegimeN;
  const antLines = antEnabled ? getRegimeLines(data, antMinCycles) : null;
  const antGate = antEnabled ? getRegimeGateArr(data, antRegimeMode, antRegimeN) : null;

  const throttleTiers = booster.throttleEnabled
    ? [...(booster.throttleTiers ?? DEFAULT_SETTINGS.throttleTiers)].sort((a, b) => a[0] - b[0])
    : null;

  const regimeEnabled = !!booster.regimeEnabled;
  const dwellByDate = regimeEnabled
    ? getDwellByDate(booster.regimeMaLen ?? DEFAULT_SETTINGS.regimeMaLen) : null;
  const regimeDwellDays = booster.regimeDwellDays ?? DEFAULT_SETTINGS.regimeDwellDays;
  const regimeBoostFrac = (booster.regimeBoostPct ?? DEFAULT_SETTINGS.regimeBoostPct) / 100;
  const regimePoolStop = booster.regimePoolStop ?? DEFAULT_SETTINGS.regimePoolStop;
  const regimeAccelWeeks = booster.regimeAccelWeeks ?? DEFAULT_SETTINGS.regimeAccelWeeks;
  // 가속 재진입 비율은 부스터 on/off와 무관하게 ratioPct를 쓴다.
  const accelFrac = (booster.ratioPct ?? DEFAULT_SETTINGS.ratioPct) / 100;
  let dwell = 0, wasLocked = false, accelLeft = 0, lockedWeeks = 0, accelWeeks = 0;

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, sellNo = 0, started = false;
  let boostedWeeks = 0, totalWeeks = 0, throttledWeeks = 0;
  let lastSellIdx = startIdx;
  // 양도세 누적: 당해 실현손익 → 연말에 세액 확정 → 이듬해 5월 납부
  let realizedGain = 0, taxPaid = 0, taxDue = 0, taxDueYear = -1;
  let capApplied = 0;           // POOL 비중캡이 실제로 발동한 횟수
  const cashflows = [];         // IRR 계산용 (납입 -, 최종평가 +)
  const daily = [], trades = [], boostTrades = [], marketOffTrades = [], antTrades = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = data[i];
    const price = priceUSD * 1350;
    const rsi = _rsiArr[i];
    const disp = _dispArr[i];
    const rollMax = rollMaxArr ? rollMaxArr[i] : NaN;

    // QQQ 휴장일 등으로 날짜가 안 맞으면 직전 값을 이어 쓴다.
    if (dwellByDate) dwell = dwellByDate.get(date) ?? dwell;
    const locked = regimeEnabled && dwell >= regimeDwellDays;
    if (regimeEnabled) {
      if (wasLocked && !locked) accelLeft = regimeAccelWeeks;
      wasLocked = locked;
    }

    if (!started) {
      // Day 0: lump-sum initial buy
      shares = initialKRW / price;
      avgCost = price;
      totalIn = initialKRW;
      started = true;
      lastSellIdx = i;
      cashflows.push({ t: 0, amt: -initialKRW });
    } else {
      // 이듬해 5월: 확정된 세액 납부. POOL이 모자라면 주식을 팔아 충당한다.
      if (taxEnabled && taxDueYear >= 0 && +date.slice(0, 4) === taxDueYear && +date.slice(5, 7) >= 5) {
        const fromPool = Math.min(taxDue, pool);
        pool -= fromPool;
        if (taxDue > fromPool) {
          const sellShares = Math.min(shares, (taxDue - fromPool) / price);
          realizedGain += sellShares * (price - avgCost);
          shares -= sellShares;
        }
        taxPaid += taxDue;
        taxDue = 0;
        taxDueYear = -1;
      }
      // 연말(또는 백테스트 종료일)에 당해 실현손익으로 세액 확정
      const isYearEnd = i + 1 >= sliceEnd || data[i + 1][0].slice(0, 4) !== date.slice(0, 4);
      if (taxEnabled && isYearEnd) {
        taxDue += Math.max(0, realizedGain - TAX_DEDUCTION) * TAX_RATE;
        taxDueYear = +date.slice(0, 4) + 1;
        realizedGain = 0;
      }

      const ret = avgCost > 0 ? (price - avgCost) / avgCost : 0;
      const relaxActive = relaxEnabled && (i - lastSellIdx >= relaxDays);
      const effRsi = relaxActive ? SELL_RSI - relaxRsiDrop : SELL_RSI;
      const effDisp = relaxActive ? 40 - relaxDispDrop : 40;
      // Cooldown: decrement or check sell (matches Python if/else structure)
      if (cooldown > 0) {
        cooldown--;
      } else if (
        !isNaN(rsi) && rsi >= effRsi &&
        !isNaN(disp) && disp > effDisp &&
        ret >= 0.25
      ) {
        // A sell that would have fired at the normal RSI/이격도 bar anyway keeps
        // the normal 70% sell size; only a sell that needed the relaxed bar
        // uses the smaller relaxSellFrac.
        const normalFire = rsi >= SELL_RSI && disp > SELL_DISP;
        const sellFrac = normalFire ? 0.70 : relaxSellFrac;
        const sellShares = shares * sellFrac;
        const sellValue = sellShares * price;
        realizedGain += sellShares * (price - avgCost);
        shares -= sellShares;
        pool += sellValue;
        cooldown = 10;
        sellNo++;
        lastSellIdx = i;
        trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo, relaxed: !normalFire });
      } else if (antEnabled && shares > 0) {
        // 조정예상매도 — 고정기준이 안 걸리는 횡보·저성장 국면에서만 작동한다.
        // 위 else-if 자리이므로 정상 매도가 걸린 날/쿨다운 중에는 아예 검사하지 않는다.
        const totalNow = shares * price + pool;
        const cashPct = totalNow > 0 ? (pool / totalNow) * 100 : 0;
        const pd = Math.max(antLines.predD[i], antDispFloor);
        const pr = Math.max(antLines.predR[i], antRsiFloor);
        if (
          !isNaN(antGate[i]) && antGate[i] <= antRegimeMax &&
          cashPct <= antCashMax &&
          !isNaN(pd) && !isNaN(pr) &&
          !isNaN(disp) && disp >= pd + antMargin &&
          !isNaN(rsi) && rsi >= pr + antMargin &&
          ret >= antMinGain
        ) {
          const sellShares = shares * antSellFrac;
          const sellValue = sellShares * price;
          realizedGain += sellShares * (price - avgCost);
          shares -= sellShares;
          pool += sellValue;
          cooldown = antCooldown;
          sellNo++;
          lastSellIdx = i;
          antTrades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, predD: pd, predR: pr,
            regime: antLines.reg[i], gate: antGate[i], cashPct, soldKRW: sellValue, poolAfter: pool });
        }
      }

      // 마켓오프: 수익 쿠션이 얇아지면 단계별로 팔아 POOL로 옮긴다.
      // 이익실현 매도와 독립이며 쿨다운을 공유하지 않는다 — 이쪽은 고점 과열이 아니라
      // 하락을 방어하는 규칙이라 같은 날 둘 다 걸릴 일이 사실상 없다.
      // 매도는 avgCost를 바꾸지 않으므로 팔았다고 해서 다음 단이 자동으로 당겨지지 않는다.
      if (marketOffTiers) {
        const totalNow = shares * price + pool;
        if (ret * 100 >= marketOffResetGain) {
          moFired.fill(false);          // 쿠션이 회복되면 전 단 재무장
        } else if (totalNow >= marketOffMinAssets) {
          for (let t = 0; t < marketOffTiers.length; t++) {
            const [thr, frac] = marketOffTiers[t];
            if (moFired[t] || ret * 100 > thr) continue;
            moFired[t] = true;
            const sellShares = shares * frac;
            if (sellShares <= 0) continue;
            const sellValue = sellShares * price;
            realizedGain += sellShares * (price - avgCost);
            shares -= sellShares;
            pool += sellValue;
            sellNo++;
            marketOffTrades.push({
              date, priceUSD, gainPct: ret * 100, tier: thr, frac,
              soldKRW: sellValue, totalBefore: totalNow, poolAfter: pool,
            });
          }
        }
      }

      // Weekly buy on Wednesdays: 적립금 + pool * 재투자비율(기본 5%, 부스터 조건 충족 시 상향)
      if (isWednesday(date)) {
        totalWeeks++;
        let poolRatio = BASE_POOL_RATIO;
        let wasBoosted = false;
        if (boostFires(priceUSD, rollMax, rsi)) {
          poolRatio = boostFrac;
          boostedWeeks++;
          wasBoosted = true;
        } else if (throttleTiers && !isNaN(rsi)) {
          for (const [thr, pct] of throttleTiers) if (rsi >= thr) poolRatio = pct / 100;
          if (poolRatio < BASE_POOL_RATIO) throttledWeeks++;
        }
        // 200일선 장기 이탈 중: POOL 소진 속도를 낮춘다. 주간 적립금은 그대로 들어간다.
        // 해제 직후 regimeAccelWeeks 동안은 눌러둔 POOL을 부스터 비율로 되돌린다.
        if (locked) {
          poolRatio = wasBoosted ? Math.min(poolRatio, regimeBoostFrac)
            : regimePoolStop ? 0 : poolRatio;
          lockedWeeks++;
        } else if (accelLeft > 0) {
          poolRatio = Math.max(poolRatio, accelFrac);
          accelLeft--;
          accelWeeks++;
        }

        const boost = pool * poolRatio;
        if (wasBoosted && boost > 0) {
          boostTrades.push({
            date, priceUSD, poolBefore: pool, ratioPct: poolRatio * 100,
            buyAmt: boost, poolAfter: pool - boost,
          });
        }
        const buyAmt = weeklyKRW + boost;
        const newShares = buyAmt / price;
        avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
        shares += newShares;
        pool -= boost;
        totalIn += weeklyKRW;
        cashflows.push({ t: (i - startIdx) / 252, amt: -weeklyKRW });

        // Pool cap: total <= poolCapKRW and pool > total*10% → reinvest excess
        const total = shares * price + pool;
        if (total <= poolCapKRW && pool > total * 0.10) {
          const excess = pool - total * 0.10;
          const extraShares = excess / price;
          avgCost = (avgCost * shares + excess) / (shares + extraShares);
          shares += extraShares;
          pool -= excess;
          capApplied++;
        }
      }
    }

    const stockValue = shares * price;
    const total = stockValue + pool;
    const boostCond = boostFires(priceUSD, rollMax, rsi);
    // avgCost/gainPct는 원화 평단가와 그 대비 수익률. 마켓오프 규칙과 툴팁이 쓴다.
    const gainPct = avgCost > 0 ? (price - avgCost) / avgCost * 100 : NaN;
    daily.push({ date, priceUSD, rsi, disp, stockValue, pool, total, totalIn, boostCond, avgCost, gainPct, regimeLocked: locked });
  }

  if (!daily.length) throw new Error('백테스트 데이터가 없습니다');

  const last = daily[daily.length - 1];
  const days = daily.length;
  const years = days / 252;
  const returnPct = (last.total - totalIn) / totalIn * 100;
  // 주의: taxEnabled면 last.total은 이미 "세금을 내면서 굴린 경로"의 평가액이므로 세전 금액이 아니다.
  // 세금이 없었을 때의 값을 보려면 taxEnabled:false로 다시 돌려야 한다.
  // finalAfterTax는 여기서 아직 안 낸 당해 확정분(taxDue)까지 뺀 최종 실수령 기준 자산.
  const finalAfterTax = last.total - taxDue;
  cashflows.push({ t: years, amt: finalAfterTax });
  const irr = calcIRR(cashflows) * 100;

  const stats = {
    returnPct,
    returnAfterTaxPct: (finalAfterTax - totalIn) / totalIn * 100,
    irr,
    mdd: calcMDD(daily.map(d => d.total)),
    finalTotal: last.total,
    finalAfterTax,
    taxPaid: taxPaid + taxDue,
    taxEnabled,
    capApplied,
    finalStock: last.stockValue,
    finalPool: last.pool,
    totalIn,
    sellCount: trades.length,
    marketOffCount: marketOffTrades.length,
    marketOffSoldKRW: marketOffTrades.reduce((a, t) => a + t.soldKRW, 0),
    relaxedSellCount: trades.filter(t => t.relaxed).length,
    antCount: antTrades.length,
    antSoldKRW: antTrades.reduce((a, t) => a + t.soldKRW, 0),
    days,
    startDate: daily[0].date,
    endDate: last.date,
    boostedWeeks,
    throttledWeeks,
    totalWeeks,
    lockedWeeks,
    accelWeeks,
  };

  return { daily, trades, boostTrades, marketOffTrades, antTrades, stats };
}

// 5년(252*5거래일) 창을 1년(252거래일)씩 밀며 만든다.
//
// 슬라이드를 분기(63일)에서 1년으로 늘렸다. 창을 잘게 썰수록 개수는 늘지만
// 정보는 늘지 않는다 — 실질 독립 표본은 (전체기간 / 창길이)로 고정이고, 분기
// 슬라이드는 이웃끼리 95%가 겹쳐서 46개를 독립 표본처럼 세면 신뢰구간이 실제보다
// 2.6배 좁게 나온다(1년 슬라이드는 1.3배). 반대로 아예 안 겹치게 3등분하면
// 자르는 위치에 결과가 휘둘린다 — 368가지 절단 위치를 전수로 돌려보면 평균
// 개선폭이 +0.16%~+4.08%로 3.91%p 흔들렸다(1년 슬라이드는 2.49%p).
// 1년 슬라이드가 그 둘 사이의 절충이다. 검증: scripts/window-design.mjs
const WINDOW = 252 * 5;
const SLIDE = 252;

// 합성 창은 실제 데이터가 없는 기간만 쓴다. 시작일이 2010-02 이후인 합성 창은
// 실제 창과 같은 기간을 다시 보여주는 것이라(개선폭 차이 0.0~0.2%p) 제외한다.
// 카드 수만 늘고 정보는 안 늘면서 "그만큼 많이 검증했다"는 착시를 만든다.
export function getRollingWindows(settings = DEFAULT_SETTINGS) {
  const result = [];
  const push = (data, source, filter) => {
    for (let start = 0; start + WINDOW <= data.length; start += SLIDE) {
      const startDate = data[start][0];
      const endDate = data[start + WINDOW - 1][0];
      if (filter && !filter(startDate)) continue;
      try {
        const { stats } = runFinalBacktest(startDate, endDate, settings, data);
        result.push({ id: `${source}-${startDate}`, startDate, endDate, stats, source });
      } catch {
        // skip windows with insufficient data
      }
    }
  };
  // 합성이 앞 기간이므로 먼저 넣어 시간순으로 배열한다.
  push(SIM_DATA, 'sim', d => d < DATA_START);
  push(TQQQ_DATA, 'real');

  // 실질 독립 표본에 해당하는 창을 표시한다. 가장 오래된 창부터 시작해서
  // "앞 창이 끝난 뒤에 시작하는" 창만 탐욕적으로 이어 붙이면 서로 겹치지 않는
  // 사슬이 나온다. 전체 27.4년 / 창 5년 = 5.5개가 이론적 상한이고 실제로 5개가
  // 잡힌다. 나머지 18개는 이 5개와 데이터를 나눠 쓰는 것이라 별도 표본이 아니다.
  // (사슬은 어디서 시작하느냐에 따라 달라진다. 여기서는 닷컴 구간을 포함하도록
  //  가장 오래된 창을 기점으로 잡았다.)
  let chainEnd = '';
  for (const w of result) {
    if (w.startDate >= chainEnd) {
      w.independent = true;
      chainEnd = w.endDate;
    }
  }
  return result;
}

// 창의 source에 맞는 시계열. 화면에서 상세 백테스트를 다시 돌릴 때 쓴다.
export function dataForSource(source) {
  return source === 'sim' ? SIM_DATA : TQQQ_DATA;
}

// 그날 RSI에 적용될 과열 스로틀 재투자 비율(%). 스로틀이 걸리지 않으면 null.
// 백테스트 내부 로직과 화면(상황판·차트 음영)이 같은 판정을 쓰도록 여기서 한 번만 정의한다.
export function throttlePctForRsi(rsi, settings = DEFAULT_SETTINGS) {
  if (!settings.throttleEnabled || isNaN(rsi)) return null;
  const tiers = [...(settings.throttleTiers ?? DEFAULT_SETTINGS.throttleTiers)].sort((a, b) => a[0] - b[0]);
  let pct = null;
  for (const [thr, p] of tiers) if (rsi >= thr) pct = p;
  return pct !== null && pct < BASE_POOL_RATIO * 100 ? pct : null;
}

// 스로틀이 걸리기 시작하는 첫 단 [RSI임계, 재투자%] (화면 문구·차트 범례용)
export function throttleFirstTier(settings = DEFAULT_SETTINGS) {
  if (!settings.throttleEnabled) return null;
  const tiers = [...(settings.throttleTiers ?? DEFAULT_SETTINGS.throttleTiers)].sort((a, b) => a[0] - b[0]);
  return tiers[0] ?? null;
}

// ── 추세국면 상황판: 최신 QQQ 기준 현재 200일선 위/아래 ──────────────────────
// 백테스트와 같은 판정을 쓴다 — 전일 확정 종가, 같은 dwell 카운터.
export function getRegimeStatus(settings = DEFAULT_SETTINGS) {
  const maLen = settings.regimeMaLen ?? DEFAULT_SETTINGS.regimeMaLen;
  const dwellDays = settings.regimeDwellDays ?? DEFAULT_SETTINGS.regimeDwellDays;
  const m = getDwellByDate(maLen);
  const last = qqqRaw[qqqRaw.length - 1];
  const closes = qqqRaw.map(([, p]) => p);
  let sum = 0;
  for (let i = closes.length - maLen; i < closes.length; i++) sum += closes[i];
  const ma = sum / maLen;
  const dwell = m.get(last[0]) ?? 0;
  return {
    enabled: !!settings.regimeEnabled,
    date: last[0], close: last[1], ma,
    gapPct: (last[1] / ma - 1) * 100,
    above: last[1] > ma,
    dwell, dwellDays,
    locked: !!settings.regimeEnabled && dwell >= dwellDays,
  };
}

// ── 부스터 상황판: 최신 데이터 기준 현재 부스터 on/off 상태 ──────────────────
export function getBoosterStatus(settings = DEFAULT_SETTINGS) {
  const lookback = settings.lookback ?? DEFAULT_SETTINGS.lookback;
  const drawdownPct = settings.drawdownPct ?? DEFAULT_SETTINGS.drawdownPct;
  const ratioPct = settings.ratioPct ?? DEFAULT_SETTINGS.ratioPct;
  const rollArr = getRollMaxArr(lookback);
  const n = TQQQ_DATA.length;
  const lastIdx = n - 1;
  const price = _closes[lastIdx];
  const rollMax = rollArr[lastIdx];

  let hiIdx = lastIdx;
  for (let j = Math.max(0, lastIdx - lookback + 1); j <= lastIdx; j++) {
    if (_closes[j] === rollMax) { hiIdx = j; break; }
  }

  const drawdownFrac = drawdownPct / 100;
  const offPrice = rollMax * (1 - drawdownFrac);
  const ddNow = (price / rollMax - 1) * 100;
  const boosterOn = !!settings.enabled && price <= offPrice;
  const daysSincePeak = lastIdx - hiIdx;
  const daysUntilRolloff = Math.max(0, lookback - daysSincePeak - 1);

  // 과열 스로틀. 부스터가 켜져 있으면 스로틀은 적용되지 않으므로(백테스트 로직과 동일)
  // 실제 이번 주 수요일에 적용될 재투자 비율은 부스터 > 스로틀 > 기본 5% 순으로 결정된다.
  const rsiNow = _rsi[lastIdx];
  const firstTier = throttleFirstTier(settings);
  const throttlePct = throttlePctForRsi(rsiNow, settings);
  const throttleOn = !boosterOn && throttlePct !== null;
  const effectivePoolPct = boosterOn ? ratioPct : (throttleOn ? throttlePct : BASE_POOL_RATIO * 100);

  return {
    date: TQQQ_DATA[lastIdx][0], price, lookback, drawdownPct,
    ratioPct, basePoolPct: BASE_POOL_RATIO * 100,
    rollMax, rollMaxDate: TQQQ_DATA[hiIdx][0],
    ddNow, boosterOn, offPrice, offPct: (offPrice / price - 1) * 100,
    daysSincePeak, daysUntilRolloff, enabled: !!settings.enabled,
    rsiNow, throttleOn, throttlePct, effectivePoolPct,
    throttleEnabled: !!settings.throttleEnabled,
    throttleRsi: firstTier ? firstTier[0] : null,
    throttleFirstPct: firstTier ? firstTier[1] : null,
  };
}

// ── 매도조건 상황판: RSI/이격도 현재값 + 목표가 도달 시나리오 ────────────────
export function getSellConditionStatus(settings = DEFAULT_SETTINGS) {
  const SELL_RSI = settings.sellRsi ?? DEFAULT_SETTINGS.sellRsi;
  const n = TQQQ_DATA.length;
  const lastIdx = n - 1;
  const priceUSD = _closes[lastIdx];
  const rsiNow = _rsi[lastIdx];
  const dispNow = _disp[lastIdx];
  const ma180 = priceUSD / (1 + dispNow / 100);
  const targetPrice = ma180 * (1 + SELL_DISP / 100);
  const neededPct = (targetPrice / priceUSD - 1) * 100;

  const scenarios = [3, 5, 7, 10, 15, 20, 30].map(days => {
    const dailyMult = Math.pow(targetPrice / priceUSD, 1 / days);
    const sim = _closes.slice(0, n);
    for (let k = 1; k <= days; k++) sim.push(sim[sim.length - 1] * dailyMult);
    const simRsi = calcRSI(sim, 14);
    const projectedRsi = simRsi[sim.length - 1];
    return { days, dailyPct: (dailyMult - 1) * 100, projectedRsi, meets: projectedRsi >= SELL_RSI };
  });

  return {
    date: TQQQ_DATA[lastIdx][0], priceUSD, rsiNow, dispNow, ma180,
    targetPrice, neededPct,
    rsiMet: rsiNow >= SELL_RSI, dispMet: dispNow > SELL_DISP,
    sellRsi: SELL_RSI, sellDisp: SELL_DISP,
    scenarios,
  };
}

// 사용자가 입력한 평단가(USD) 기준 수익률 조건 판정
export function checkGainCondition(avgCostUSD) {
  const n = TQQQ_DATA.length;
  const priceUSD = _closes[n - 1];
  const gainPct = (priceUSD - avgCostUSD) / avgCostUSD * 100;
  const targetPriceFor25 = avgCostUSD * 1.25;
  return {
    priceUSD, gainPct, meets: gainPct >= 25,
    targetPriceFor25, neededPct: (targetPriceFor25 / priceUSD - 1) * 100,
  };
}
