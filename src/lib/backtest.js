import tqqqRaw from '../data/tqqq.json' with { type: 'json' };

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
export const DATA_START = TQQQ_DATA[0][0];
export const DATA_END = TQQQ_DATA[TQQQ_DATA.length - 1][0];

// 전략 파라미터 기본값 (전부 UI에서 조정 가능)
//  - 부스터: 60거래일 고점 대비 -25%↓ 시 주간 POOL 재투자 비율을 5%→25%로 상향
//  - weeklyKRW: 수요일 정액 적립금 (기본 85만원)
//  - poolCapKRW: 총자산이 이 금액 이하일 때 POOL 비중 10% 캡 적용 기준 (기본 2억)
export const DEFAULT_SETTINGS = {
  enabled: true, lookback: 60, drawdownPct: 25, ratioPct: 25,
  weeklyKRW: 850_000, poolCapKRW: 200_000_000,
};
export const DEFAULT_BOOSTER = DEFAULT_SETTINGS;

// Pre-compute indicators once over full dataset so rolling windows are fast
const _closes = TQQQ_DATA.map(([, c]) => c);
const _rsi = calcRSI(_closes, 14);
const _disp = calcDisparity(_closes, 180);
const _roll60max = calcRollMax(_closes, 60);

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

export function runFinalBacktest(startDate, endDate, settings = DEFAULT_SETTINGS) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;

  if (startIdx === -1 || sliceEnd <= startIdx) {
    throw new Error('유효한 날짜 범위가 아닙니다');
  }

  const booster = settings || DEFAULT_SETTINGS;
  const boostActive = !!booster.enabled;
  const boostFrac = boostActive ? booster.ratioPct / 100 : 0;
  const boostDrawdownFrac = boostActive ? booster.drawdownPct / 100 : 0;
  const weeklyKRW = booster.weeklyKRW ?? DEFAULT_SETTINGS.weeklyKRW;
  const poolCapKRW = booster.poolCapKRW ?? DEFAULT_SETTINGS.poolCapKRW;

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, sellNo = 0, started = false;
  let boostedWeeks = 0, totalWeeks = 0;
  const daily = [], trades = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD * 1350;
    const rsi = _rsi[i];
    const disp = _disp[i];
    const rollMax = _roll60max[i];

    if (!started) {
      // Day 0: lump-sum initial buy
      shares = 100_000_000 / price;
      avgCost = price;
      totalIn = 100_000_000;
      started = true;
    } else {
      const ret = avgCost > 0 ? (price - avgCost) / avgCost : 0;
      // Cooldown: decrement or check sell (matches Python if/else structure)
      if (cooldown > 0) {
        cooldown--;
      } else if (
        !isNaN(rsi) && rsi >= 70 &&
        !isNaN(disp) && disp > 40 &&
        ret >= 0.25
      ) {
        const sellShares = shares * 0.70;
        const sellValue = sellShares * price;
        shares -= sellShares;
        pool += sellValue;
        cooldown = 10;
        sellNo++;
        trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo });
      }

      // Weekly buy on Wednesdays: 적립금 + pool * 재투자비율(기본 5%, 부스터 조건 충족 시 상향)
      if (isWednesday(date)) {
        totalWeeks++;
        let poolRatio = 0.05;
        if (boostActive && !isNaN(rollMax) && priceUSD <= rollMax * (1 - boostDrawdownFrac)) {
          poolRatio = boostFrac;
          boostedWeeks++;
        }
        const boost = pool * poolRatio;
        const buyAmt = weeklyKRW + boost;
        const newShares = buyAmt / price;
        avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
        shares += newShares;
        pool -= boost;
        totalIn += weeklyKRW;

        // Pool cap: total <= poolCapKRW and pool > total*10% → reinvest excess
        const total = shares * price + pool;
        if (total <= poolCapKRW && pool > total * 0.10) {
          const excess = pool - total * 0.10;
          const extraShares = excess / price;
          avgCost = (avgCost * shares + excess) / (shares + extraShares);
          shares += extraShares;
          pool -= excess;
        }
      }
    }

    const stockValue = shares * price;
    const total = stockValue + pool;
    const boostCond = boostActive && !isNaN(rollMax) && priceUSD <= rollMax * (1 - boostDrawdownFrac);
    daily.push({ date, priceUSD, rsi, disp, stockValue, pool, total, totalIn, boostCond });
  }

  if (!daily.length) throw new Error('백테스트 데이터가 없습니다');

  const last = daily[daily.length - 1];
  const days = daily.length;
  const years = days / 252;
  const returnPct = (last.total - totalIn) / totalIn * 100;
  const cagr = (Math.pow(last.total / totalIn, 1 / years) - 1) * 100;

  const stats = {
    returnPct,
    cagr,
    mdd: calcMDD(daily.map(d => d.total)),
    finalTotal: last.total,
    finalStock: last.stockValue,
    finalPool: last.pool,
    totalIn,
    sellCount: trades.length,
    days,
    startDate: daily[0].date,
    endDate: last.date,
    boostedWeeks,
    totalWeeks,
  };

  return { daily, trades, stats };
}

// All 5-year windows (252*5 trading days), sliding by 63 days (one quarter)
export function getRollingWindows(settings = DEFAULT_SETTINGS) {
  const WINDOW = 252 * 5;
  const SLIDE = 63;
  const result = [];
  let id = 0;
  for (let start = 0; start + WINDOW <= TQQQ_DATA.length; start += SLIDE) {
    const startDate = TQQQ_DATA[start][0];
    const endDate = TQQQ_DATA[start + WINDOW - 1][0];
    try {
      const { stats } = runFinalBacktest(startDate, endDate, settings);
      result.push({ id: id++, startDate, endDate, stats });
    } catch (_) {
      // skip windows with insufficient data
    }
  }
  return result;
}
