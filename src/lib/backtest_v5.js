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
const _sma200 = calcSMA(_closes, 200);

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

// v5: baseline buy/sell logic UNCHANGED (weekly DCA + 5% pool boost + single
// overbought trigger sells 70%). New lever: a 200d-SMA TREND overlay that is
// independent of the mean-reversion logic. v2/v3/v4 all tried to time
// buy-the-dip better and made drawdowns worse; this instead tries to dodge
// the drawdown itself — de-risk (sell into pool) on a confirmed break below
// the 200d SMA, re-risk (redeploy pool) on a confirmed reclaim, with a
// cooldown so it doesn't whipsaw on every wiggle around the line.
const DERISK_FRAC = 0.40;
const TREND_COOLDOWN_DAYS = 15;

export function runV5Backtest(startDate, endDate) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;
  if (startIdx === -1 || sliceEnd <= startIdx) throw new Error('유효한 날짜 범위가 아닙니다');

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, sellNo = 0, started = false;
  let deRisked = false, trendCooldown = 0;
  const daily = [], trades = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD * 1350;
    const rsi = _rsi[i];
    const disp = _disp[i];
    const sma200 = _sma200[i];
    const prevClose = i > 0 ? _closes[i - 1] : NaN;
    const prevSma200 = i > 0 ? _sma200[i - 1] : NaN;

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
        trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo, kind: 'profit' });
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

      if (trendCooldown > 0) trendCooldown--;
      if (trendCooldown === 0 && !isNaN(sma200) && !isNaN(prevSma200) && !isNaN(prevClose)) {
        const belowNow = priceUSD < sma200;
        const aboveBefore = prevClose >= prevSma200;
        const aboveNow = priceUSD >= sma200;
        const belowBefore = prevClose < prevSma200;

        if (!deRisked && belowNow && aboveBefore) {
          const sellShares = shares * DERISK_FRAC;
          const sellValue = sellShares * price;
          shares -= sellShares;
          pool += sellValue;
          deRisked = true;
          trendCooldown = TREND_COOLDOWN_DAYS;
          sellNo++;
          trades.push({ date, priceUSD, returnPct: ret * 100, rsi, disp, poolAfter: pool, sellNo, kind: 'derisk' });
        } else if (deRisked && aboveNow && belowBefore) {
          const buyAmt = pool;
          const newShares = buyAmt / price;
          avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
          shares += newShares;
          pool -= buyAmt;
          deRisked = false;
          trendCooldown = TREND_COOLDOWN_DAYS;
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
