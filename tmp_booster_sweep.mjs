// 부스터 파라미터 그리드서치: 60일고점 드로다운 임계치 x POOL재투자 부스트비율
// 평가: 사이트와 동일한 5년 롤링윈도우(252*5, 63슬라이드) 46사이클
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
    if (peak > 0) { const dd = (v - peak) / peak * 100; if (dd < mdd) mdd = dd; }
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
const _roll60max = calcRollMax(_closes, 60);
function isWednesday(d) { return new Date(d + 'T00:00:00Z').getUTCDay() === 3; }

function runFinalBacktest(startDate, endDate, booster) {
  const startIdx = TQQQ_DATA.findIndex(([d]) => d >= startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d]) => d > endDate);
  const sliceEnd = endIdxRaw === -1 ? TQQQ_DATA.length : endIdxRaw;
  if (startIdx === -1 || sliceEnd <= startIdx) throw new Error('bad range');

  let shares = 0, avgCost = 0, pool = 0, totalIn = 0;
  let cooldown = 0, started = false;
  const totals = [];

  for (let i = startIdx; i < sliceEnd; i++) {
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD * 1350;
    const rsi = _rsi[i], disp = _disp[i], rollMax = _roll60max[i];

    if (!started) {
      shares = 100_000_000 / price; avgCost = price; totalIn = 100_000_000; started = true;
    } else {
      const ret = avgCost > 0 ? (price - avgCost) / avgCost : 0;
      if (cooldown > 0) {
        cooldown--;
      } else if (!isNaN(rsi) && rsi >= 70 && !isNaN(disp) && disp > 40 && ret >= 0.25) {
        const sellShares = shares * 0.70;
        pool += sellShares * price;
        shares -= sellShares;
        cooldown = 10;
      }
      if (isWednesday(date)) {
        let ratio = 0.05;
        if (booster && !isNaN(rollMax) && priceUSD <= rollMax * (1 - booster.drawdown)) {
          ratio = booster.ratio;
        }
        const b = pool * ratio;
        const buyAmt = 850_000 + b;
        const newShares = buyAmt / price;
        avgCost = (avgCost * shares + buyAmt) / (shares + newShares);
        shares += newShares; pool -= b; totalIn += 850_000;

        const total = shares * price + pool;
        if (total <= 200_000_000 && pool > total * 0.10) {
          const excess = pool - total * 0.10;
          const extraShares = excess / price;
          avgCost = (avgCost * shares + excess) / (shares + extraShares);
          shares += extraShares; pool -= excess;
        }
      }
    }
    totals.push(shares * price + pool);
  }
  const last = totals[totals.length - 1];
  const days = totals.length, years = days / 252;
  const returnPct = (last - totalIn) / totalIn * 100;
  const cagr = (Math.pow(last / totalIn, 1 / years) - 1) * 100;
  return { returnPct, cagr, mdd: calcMDD(totals) };
}

function getRollingStats(booster) {
  const WINDOW = 252 * 5, SLIDE = 63;
  const rets = [], cagrs = [], mdds = [];
  for (let start = 0; start + WINDOW <= TQQQ_DATA.length; start += SLIDE) {
    const startDate = TQQQ_DATA[start][0];
    const endDate = TQQQ_DATA[start + WINDOW - 1][0];
    try {
      const r = runFinalBacktest(startDate, endDate, booster);
      rets.push(r.returnPct); cagrs.push(r.cagr); mdds.push(r.mdd);
    } catch (_) {}
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  return { n: rets.length, retMean: mean(rets), cagrMean: mean(cagrs), mddMean: mean(mdds), mddMin: Math.min(...mdds) };
}

// ── 베이스라인 ──
const base = getRollingStats(null);
console.log(`베이스(부스터 없음): 수익률 ${base.retMean.toFixed(1)}%  CAGR ${base.cagrMean.toFixed(1)}%  MDD평균 ${base.mddMean.toFixed(1)}%  MDD최악 ${base.mddMin.toFixed(1)}%  (n=${base.n})\n`);

// ── 그리드서치 ──
const DRAWDOWNS = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65];
const RATIOS = [0.15, 0.175, 0.20, 0.225, 0.25];

const results = [];
for (const dd of DRAWDOWNS) {
  for (const ratio of RATIOS) {
    const s = getRollingStats({ lookback: 60, drawdown: dd, ratio });
    results.push({ dd, ratio, ...s });
  }
}

console.log('='.repeat(100));
console.log('그리드서치 결과 (5년 롤링 46사이클 평균, 부스터 없음 대비 개선폭)');
console.log('='.repeat(100));
console.log(`${'DD임계'.padStart(7)} ${'재투자%'.padStart(8)} | ${'수익률평균'.padStart(10)} ${'수익률Δ'.padStart(9)} | ${'CAGR평균'.padStart(9)} ${'CAGRΔ'.padStart(7)} | ${'MDD평균'.padStart(8)} ${'MDDΔ'.padStart(7)} | ${'MDD최악'.padStart(8)}`);
console.log('-'.repeat(100));
for (const r of results) {
  const retDiff = r.retMean - base.retMean;
  const cagrDiff = r.cagrMean - base.cagrMean;
  const mddDiff = r.mddMean - base.mddMean;
  console.log(
    `${(-r.dd * 100).toFixed(0).padStart(6)}% ${(r.ratio * 100).toFixed(1).padStart(7)}% | ` +
    `${r.retMean.toFixed(1).padStart(10)}% ${(retDiff >= 0 ? '+' : '') + retDiff.toFixed(1).padStart(8)}% | ` +
    `${r.cagrMean.toFixed(2).padStart(9)}% ${(cagrDiff >= 0 ? '+' : '') + cagrDiff.toFixed(2).padStart(6)}% | ` +
    `${r.mddMean.toFixed(1).padStart(8)}% ${(mddDiff >= 0 ? '+' : '') + mddDiff.toFixed(1).padStart(6)}% | ` +
    `${r.mddMin.toFixed(1).padStart(8)}%`
  );
}

// ── 랭킹 ──
console.log('\n' + '='.repeat(100));
console.log('[랭킹 1] 평균 수익률 최고 TOP5');
console.log('='.repeat(100));
const byRet = [...results].sort((a, b) => b.retMean - a.retMean);
for (const r of byRet.slice(0, 5)) {
  console.log(`  DD -${(r.dd*100).toFixed(0)}% / 재투자 ${(r.ratio*100).toFixed(1)}%  →  수익률 ${r.retMean.toFixed(1)}%  CAGR ${r.cagrMean.toFixed(2)}%  MDD ${r.mddMean.toFixed(1)}%`);
}

console.log('\n[랭킹 2] Calmar 비율(CAGR/|MDD평균|) 최고 TOP5 (위험조정 수익)');
const byCalmar = [...results].map(r => ({...r, calmar: r.cagrMean / Math.abs(r.mddMean)})).sort((a,b)=>b.calmar-a.calmar);
for (const r of byCalmar.slice(0, 5)) {
  console.log(`  DD -${(r.dd*100).toFixed(0)}% / 재투자 ${(r.ratio*100).toFixed(1)}%  →  Calmar ${r.calmar.toFixed(3)}  (CAGR ${r.cagrMean.toFixed(2)}% / MDD ${r.mddMean.toFixed(1)}%)`);
}

console.log('\n[랭킹 3] MDD 평균 가장 덜 악화(=가장 좋은) TOP5');
const byMdd = [...results].sort((a, b) => b.mddMean - a.mddMean);
for (const r of byMdd.slice(0, 5)) {
  console.log(`  DD -${(r.dd*100).toFixed(0)}% / 재투자 ${(r.ratio*100).toFixed(1)}%  →  MDD ${r.mddMean.toFixed(1)}%  (수익률 ${r.retMean.toFixed(1)}%)`);
}
