// 실제 src/lib/backtest.js 로직을 정확히 재현 + 60일고점 -30%↓ 시 POOL재투자 5%→7.5% 부스터 비교
// 최신 데이터(tqqq_fresh.json, ~2026-07-30)로 실행
import fs from 'node:fs';

const TQQQ_DATA = JSON.parse(fs.readFileSync(new URL('./src/data/tqqq_fresh.json', import.meta.url)));

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

const _closes = TQQQ_DATA.map(([, c]) => c);
const _rsi = calcRSI(_closes, 14);
const _disp = calcDisparity(_closes, 180);
const _roll60max = calcRollMax(_closes, 60); // 부스터 조건용 (원가 아님, 종가 기준)

function isWednesday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 3;
}

// booster: null=비활성, or {lookback, drawdown, ratio}
function runFinalBacktest(startDate, endDate, booster = null) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;
  if (startIdx === -1 || sliceEnd <= startIdx) throw new Error('유효한 날짜 범위가 아닙니다');

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
        totalWeeks++;
        let ratio = 0.05;
        if (booster && !isNaN(rollMax) && priceUSD <= rollMax * (1 - booster.drawdown)) {
          ratio = booster.ratio;
          boostedWeeks++;
        }
        const boost = pool * ratio;
        const buyAmt = 850_000 + boost;
        const newShares = buyAmt / price;
        avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
        shares += newShares;
        pool -= boost;
        totalIn += 850_000;

        const total = shares * price + pool;
        if (total <= 200_000_000 && pool > total * 0.10) {
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
    daily.push({ date, priceUSD, rsi, disp, stockValue, pool, total, totalIn });
  }

  if (!daily.length) throw new Error('백테스트 데이터가 없습니다');
  const last = daily[daily.length - 1];
  const days = daily.length;
  const years = days / 252;
  const returnPct = (last.total - totalIn) / totalIn * 100;
  const cagr = (Math.pow(last.total / totalIn, 1 / years) - 1) * 100;

  return {
    stats: {
      returnPct, cagr, mdd: calcMDD(daily.map(d => d.total)),
      finalTotal: last.total, totalIn, sellCount: trades.length, days,
      startDate: daily[0].date, endDate: last.date,
      boostedWeeks, totalWeeks,
    },
  };
}

function getRollingWindows(booster) {
  const WINDOW = 252 * 5, SLIDE = 63;
  const result = [];
  for (let start = 0; start + WINDOW <= TQQQ_DATA.length; start += SLIDE) {
    const startDate = TQQQ_DATA[start][0];
    const endDate = TQQQ_DATA[start + WINDOW - 1][0];
    try {
      const { stats } = runFinalBacktest(startDate, endDate, booster);
      result.push({ startDate, endDate, stats });
    } catch (_) { /* skip */ }
  }
  return result;
}

const BOOST = { lookback: 60, drawdown: 0.25, ratio: 0.25 };
const DATA_START = TQQQ_DATA[0][0];
const DATA_END = TQQQ_DATA[TQQQ_DATA.length - 1][0];

console.log('='.repeat(78));
console.log(`[1] 전체기간 단일 백테스트  (${DATA_START} ~ ${DATA_END})`);
console.log('='.repeat(78));
const base = runFinalBacktest(DATA_START, DATA_END, null);
const boost = runFinalBacktest(DATA_START, DATA_END, BOOST);
const K = 1e8;
for (const [label, r] of [['베이스(원본)', base], ['부스터 적용', boost]]) {
  const s = r.stats;
  console.log(`\n[${label}]`);
  console.log(`  총투입    : ${(s.totalIn / K).toFixed(2)}억`);
  console.log(`  최종자산  : ${(s.finalTotal / K).toFixed(2)}억`);
  console.log(`  총수익률  : ${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(1)}%`);
  console.log(`  CAGR      : ${s.cagr >= 0 ? '+' : ''}${s.cagr.toFixed(1)}%`);
  console.log(`  MDD       : ${s.mdd.toFixed(1)}%`);
  console.log(`  매도횟수  : ${s.sellCount}회`);
  console.log(`  부스터발동: ${s.boostedWeeks}주 / 전체 ${s.totalWeeks}주`);
}
console.log(`\n[차이] 총수익률 ${(boost.stats.returnPct - base.stats.returnPct).toFixed(1)}%p, ` +
  `CAGR ${(boost.stats.cagr - base.stats.cagr).toFixed(2)}%p, ` +
  `MDD ${(boost.stats.mdd - base.stats.mdd).toFixed(1)}%p`);

console.log('\n' + '='.repeat(78));
console.log('[2] 5년 롤링 윈도우 (사이트와 동일 방식: 252*5봉 윈도우, 63봉 슬라이드)');
console.log('='.repeat(78));
const winsBase = getRollingWindows(null);
const winsBoost = getRollingWindows(BOOST);
console.log(`사이클 수: ${winsBase.length}개\n`);

function stat(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...arr), max = Math.max(...arr);
  return { mean, min, max };
}
const retB = winsBase.map(w => w.stats.returnPct), retT = winsBoost.map(w => w.stats.returnPct);
const cagrB = winsBase.map(w => w.stats.cagr), cagrT = winsBoost.map(w => w.stats.cagr);
const mddB = winsBase.map(w => w.stats.mdd), mddT = winsBoost.map(w => w.stats.mdd);

function row(label, b, t) {
  const sb = stat(b), st = stat(t);
  console.log(
    `${label.padEnd(12)} 베이스 평균 ${sb.mean.toFixed(1).padStart(8)}  최솟 ${sb.min.toFixed(1).padStart(8)}  최댓 ${sb.max.toFixed(1).padStart(8)}  |  ` +
    `부스터 평균 ${st.mean.toFixed(1).padStart(8)}  최솟 ${st.min.toFixed(1).padStart(8)}  최댓 ${st.max.toFixed(1).padStart(8)}`
  );
}
row('총수익률(%)', retB, retT);
row('CAGR(%)', cagrB, cagrT);
row('MDD(%)', mddB, mddT);

const retDiff = retT.map((v, i) => v - retB[i]);
const mddDiff = mddT.map((v, i) => v - mddB[i]);
const winRate = retDiff.filter(v => v > 0).length / retDiff.length * 100;
const mddWinRate = mddDiff.filter(v => v > 0).length / mddDiff.length * 100;
const avgRetDiff = retDiff.reduce((a, b) => a + b, 0) / retDiff.length;
const avgMddDiff = mddDiff.reduce((a, b) => a + b, 0) / mddDiff.length;
console.log(`\n부스터가 수익률 개선한 사이클: ${winRate.toFixed(1)}%  (평균 개선폭 ${avgRetDiff >= 0 ? '+' : ''}${avgRetDiff.toFixed(2)}%p)`);
console.log(`부스터가 MDD 개선(완화)한 사이클: ${mddWinRate.toFixed(1)}%  (평균 변화 ${avgMddDiff >= 0 ? '+' : ''}${avgMddDiff.toFixed(2)}%p)`);

const idxSorted = retDiff.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
console.log('\n[수익률 차이(부스터-베이스) 상위 5개 사이클]');
for (const [d, i] of idxSorted.slice(0, 5)) {
  console.log(`  ${winsBase[i].startDate} ~ ${winsBase[i].endDate} : 베이스 ${retB[i].toFixed(1)}% -> 부스터 ${retT[i].toFixed(1)}%  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%p)`);
}
console.log('[수익률 차이(부스터-베이스) 하위 5개 사이클]');
for (const [d, i] of idxSorted.slice(-5)) {
  console.log(`  ${winsBase[i].startDate} ~ ${winsBase[i].endDate} : 베이스 ${retB[i].toFixed(1)}% -> 부스터 ${retT[i].toFixed(1)}%  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%p)`);
}

// 가장 최근(현재 진행중) 윈도우 별도 표시
const lastB = winsBase[winsBase.length - 1], lastT = winsBoost[winsBoost.length - 1];
console.log('\n[가장 최근 5년 윈도우]');
console.log(`  ${lastB.startDate} ~ ${lastB.endDate}`);
console.log(`  베이스 : 수익률 ${lastB.stats.returnPct.toFixed(1)}%  CAGR ${lastB.stats.cagr.toFixed(1)}%  MDD ${lastB.stats.mdd.toFixed(1)}%`);
console.log(`  부스터 : 수익률 ${lastT.stats.returnPct.toFixed(1)}%  CAGR ${lastT.stats.cagr.toFixed(1)}%  MDD ${lastT.stats.mdd.toFixed(1)}%`);
