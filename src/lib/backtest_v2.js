import tqqqRaw from '../data/tqqq.json' with { type: 'json' };

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

const TQQQ_DATA = tqqqRaw;
const _closes = TQQQ_DATA.map(([, c]) => c);
const _rsi = calcRSI(_closes, 14);
const _disp = calcDisparity(_closes, 180);

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Adaptive Pool Deployment + Tiered Profit-Taking
// Same lump-sum + weekly contribution schedule as the baseline MA180 strategy,
// so totalIn is identical for a given window. What differs:
//  1. Weekly cash doesn't buy shares immediately — it queues in the pool, and
//     the pool is deployed into shares at a pace that scales with how cheap
//     price is vs its 180d MA (buy faster when cheap, slower when expensive).
//  2. Selling is tiered (3 stages) instead of one all-or-nothing trigger, so
//     partial profits lock in progressively through an uptrend.
const TIERS = [
  { disp: 25, rsi: 60, ret: 0.15, sellFrac: 0.15 },
  { disp: 40, rsi: 68, ret: 0.30, sellFrac: 0.25 },
  { disp: 55, rsi: 73, ret: 0.50, sellFrac: 0.30 },
];
const TIER_RESET_RET = 0.05;
const BASE_WEEKLY = 850_000;
const DIP_ACCEL_DISP = -25;
const DIP_ACCEL_FRAC = 0.15;

export function runV2Backtest(startDate, endDate) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;
  if (startIdx === -1 || sliceEnd <= startIdx) throw new Error('유효한 날짜 범위가 아닙니다');

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, sellNo = 0, started = false, tierState = 0;
  const daily = [], trades = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD * 1350;
    const rsi = _rsi[i];
    const disp = _disp[i];

    if (!started) {
      shares = 100_000_000 / price;
      avgCost = price;
      totalIn = 100_000_000;
      started = true;
    } else {
      const ret = avgCost > 0 ? (price - avgCost) / avgCost : 0;

      if (ret < TIER_RESET_RET) tierState = 0;

      if (cooldown > 0) {
        cooldown--;
      } else if (!isNaN(rsi) && !isNaN(disp)) {
        for (let t = TIERS.length - 1; t >= 0; t--) {
          const tier = TIERS[t];
          if (tierState <= t && disp > tier.disp && rsi >= tier.rsi && ret >= tier.ret) {
            const sellShares = shares * tier.sellFrac;
            const sellValue = sellShares * price;
            shares -= sellShares;
            pool += sellValue;
            cooldown = 10;
            tierState = t + 1;
            sellNo++;
            trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo, tier: t + 1 });
            break;
          }
        }
      }

      if (isWednesday(date)) {
        pool += BASE_WEEKLY;
        totalIn += BASE_WEEKLY;
      }

      if (!isNaN(disp)) {
        const buyMultiplier = clamp(1 - disp / 40, 0.2, 3.0);
        let deployAmt = Math.min(pool, BASE_WEEKLY * buyMultiplier / 5); // spread across ~5 trading days/week
        if (disp < DIP_ACCEL_DISP) {
          deployAmt += pool * DIP_ACCEL_FRAC;
        }
        deployAmt = Math.min(deployAmt, pool);
        if (deployAmt > 0) {
          const newShares = deployAmt / price;
          avgCost = (avgCost * shares + deployAmt) / (shares + newShares);
          shares += newShares;
          pool -= deployAmt;
        }
      }

      const total = shares * price + pool;
      if (total <= 200_000_000 && pool > total * 0.10) {
        const excess = pool - total * 0.10;
        const extraShares = excess / price;
        avgCost = (avgCost * shares + excess) / (shares + extraShares);
        shares += extraShares;
        pool -= excess;
      }
    }

    const stockValue = shares * price;
    const total = stockValue + pool;
    daily.push({ date, priceUSD, rsi, disp, stockValue, pool, total, totalIn });
  }

  if (!daily.length) throw new Error('백테스트 데이터가 없습니다');

  const last = daily[daily.length - 1];
  const days = daily.length;
  const years = days / 252;
  const returnPct = (last.total - totalIn) / totalIn * 100;
  const cagr = (Math.pow(last.total / totalIn, 1 / years) - 1) * 100;

  const stats = {
    returnPct, cagr,
    mdd: calcMDD(daily.map(d => d.total)),
    finalTotal: last.total,
    finalStock: last.stockValue,
    finalPool: last.pool,
    totalIn,
    sellCount: trades.length,
    days,
    startDate: daily[0].date,
    endDate: last.date,
  };

  return { daily, trades, stats };
}
