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

function calcSMA(closes, period) {
  const sma = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
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
const _sma20 = calcSMA(_closes, 20);

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

// v4: sell side identical to baseline (single trigger, sell 70%). Buy side
// identical weekly 850k + 5% pool boost, PLUS one extra lever: after a deep,
// sustained drawdown (disp < -30), wait for a confirmed reversal (price
// crosses back above its 20d MA, having been below it the day before) before
// deploying an extra slug of pool cash — rather than v2's mistake of buying
// more the instant it got cheap, which kept averaging down through a crash
// that was not yet over.
const DIP_DISP = -30;
const DIP_BUY_FRAC = 0.25;
const DIP_COOLDOWN_DAYS = 20;

export function runV4Backtest(startDate, endDate) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;
  if (startIdx === -1 || sliceEnd <= startIdx) throw new Error('유효한 날짜 범위가 아닙니다');

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, sellNo = 0, started = false;
  let dipCooldown = 0;
  const daily = [], trades = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD * 1350;
    const rsi = _rsi[i];
    const disp = _disp[i];
    const sma20 = _sma20[i];
    const prevClose = i > 0 ? _closes[i - 1] : NaN;
    const prevSma20 = i > 0 ? _sma20[i - 1] : NaN;

    if (!started) {
      shares = 100_000_000 / price;
      avgCost = price;
      totalIn = 100_000_000;
      started = true;
    } else {
      const ret = avgCost > 0 ? (price - avgCost) / avgCost : 0;
      if (cooldown > 0) {
        cooldown--;
      } else if (!isNaN(rsi) && rsi >= 70 && !isNaN(disp) && disp > 40 && ret >= 0.25) {
        const sellShares = shares * 0.70;
        const sellValue = sellShares * price;
        shares -= sellShares;
        pool += sellValue;
        cooldown = 10;
        sellNo++;
        trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo });
      }

      if (isWednesday(date)) {
        const boost = pool * 0.05;
        const buyAmt = 850_000 + boost;
        const newShares = buyAmt / price;
        avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
        shares += newShares;
        pool -= boost;
        totalIn += 850_000;
      }

      if (dipCooldown > 0) dipCooldown--;
      const crossedUp = !isNaN(sma20) && !isNaN(prevSma20) && !isNaN(prevClose) &&
        priceUSD > sma20 / 1350 && prevClose <= prevSma20;
      if (dipCooldown === 0 && crossedUp && !isNaN(disp) && disp < DIP_DISP && pool > 0) {
        const dipBuy = pool * DIP_BUY_FRAC;
        const newShares = dipBuy / price;
        avgCost = (avgCost * shares + dipBuy) / (shares + newShares);
        shares += newShares;
        pool -= dipBuy;
        dipCooldown = DIP_COOLDOWN_DAYS;
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
