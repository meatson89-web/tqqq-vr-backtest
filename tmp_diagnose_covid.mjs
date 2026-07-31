// 2020년 코로나 사이클(2020-02-18~2025-02-20)에서 부스터가 손해나는 원인 진단
// 베이스 vs 부스터(-25%/25%)의 매도 시점/평단가/이후 자산배분을 비교
import fs from 'node:fs';
const TQQQ_DATA = JSON.parse(fs.readFileSync(new URL('./src/data/tqqq_fresh.json', import.meta.url)));

function calcRSI(closes, period) {
  const rsi = new Array(closes.length).fill(NaN);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i]-closes[i-1]; if (d>0) gainSum+=d; else lossSum-=d; }
  let avgGain = gainSum/period, avgLoss = lossSum/period;
  rsi[period] = avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for (let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1]; const g=d>0?d:0, l=d<0?-d:0;
    avgGain=(avgGain*(period-1)+g)/period; avgLoss=(avgLoss*(period-1)+l)/period;
    rsi[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return rsi;
}
function calcDisparity(closes, period) {
  const disp = new Array(closes.length).fill(NaN); let sum=0;
  for (let i=0;i<closes.length;i++){ sum+=closes[i]; if(i>=period) sum-=closes[i-period];
    if(i>=period-1){ const ma=sum/period; disp[i]=ma>0?((closes[i]-ma)/ma)*100:NaN; } }
  return disp;
}
function calcRollMax(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  for (let i=0;i<closes.length;i++){ const s=Math.max(0,i-period+1); let m=-Infinity;
    for(let j=s;j<=i;j++) if(closes[j]>m) m=closes[j]; out[i]=m; }
  return out;
}
const _closes = TQQQ_DATA.map(([,c])=>c);
const _rsi = calcRSI(_closes,14);
const _disp = calcDisparity(_closes,180);
const _roll60max = calcRollMax(_closes,60);
function isWednesday(d){ return new Date(d+'T00:00:00Z').getUTCDay()===3; }

function simulate(startDate, endDate, booster) {
  const startIdx = TQQQ_DATA.findIndex(([d])=>d>=startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d])=>d>endDate);
  const sliceEnd = endIdxRaw===-1?TQQQ_DATA.length:endIdxRaw;
  let shares=0, avgCost=0, pool=0, totalIn=0, cooldown=0, started=false;
  const trades=[], daily=[];
  for (let i=startIdx;i<sliceEnd;i++){
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD*1350;
    const rsi=_rsi[i], disp=_disp[i], rollMax=_roll60max[i];
    if (!started){ shares=100_000_000/price; avgCost=price; totalIn=100_000_000; started=true; }
    else {
      const ret = avgCost>0?(price-avgCost)/avgCost:0;
      if (cooldown>0) cooldown--;
      else if (!isNaN(rsi)&&rsi>=70&&!isNaN(disp)&&disp>40&&ret>=0.25){
        const sellShares=shares*0.70;
        trades.push({date, priceUSD, avgCostKRW:avgCost, ret:ret*100, sharesSold:sellShares,
                      soldValue:sellShares*price, poolBefore:pool});
        pool += sellShares*price; shares -= sellShares; cooldown=10;
      }
      if (isWednesday(date)){
        let ratio=0.05;
        if (booster && !isNaN(rollMax) && priceUSD<=rollMax*(1-booster.drawdown)) ratio=booster.ratio;
        const b=pool*ratio; const buyAmt=850_000+b; const newSh=buyAmt/price;
        avgCost=(avgCost*shares+buyAmt)/(shares+newSh); shares+=newSh; pool-=b; totalIn+=850_000;
        const total=shares*price+pool;
        if (total<=200_000_000 && pool>total*0.10){
          const excess=pool-total*0.10; const extraSh=excess/price;
          avgCost=(avgCost*shares+excess)/(shares+extraSh); shares+=extraSh; pool-=excess;
        }
      }
    }
    daily.push({date, price, shares, avgCost, pool, stockValue: shares*price, total: shares*price+pool});
  }
  return { trades, daily, final: daily[daily.length-1], totalIn };
}

const START='2020-02-18', END='2025-02-20';
const BOOST={lookback:60, drawdown:0.25, ratio:0.25};
const base = simulate(START, END, null);
const boosted = simulate(START, END, BOOST);

console.log(`=== ${START} ~ ${END} 사이클 ===\n`);
console.log('[베이스 매도 이력]');
for (const t of base.trades) {
  console.log(`  ${t.date}  가격 $${t.priceUSD.toFixed(2)}  평단(KRW) ${(t.avgCostKRW/1000).toFixed(0)}천  수익률 ${t.ret.toFixed(1)}%  매도액 ${(t.soldValue/1e8).toFixed(2)}억  매도전POOL ${(t.poolBefore/1e8).toFixed(2)}억`);
}
console.log('\n[부스터 매도 이력]');
for (const t of boosted.trades) {
  console.log(`  ${t.date}  가격 $${t.priceUSD.toFixed(2)}  평단(KRW) ${(t.avgCostKRW/1000).toFixed(0)}천  수익률 ${t.ret.toFixed(1)}%  매도액 ${(t.soldValue/1e8).toFixed(2)}억  매도전POOL ${(t.poolBefore/1e8).toFixed(2)}억`);
}

console.log(`\n[최종 결과]`);
console.log(`  베이스  : 주식 ${(base.final.stockValue/1e8).toFixed(2)}억 + POOL ${(base.final.pool/1e8).toFixed(2)}억 = 총 ${(base.final.total/1e8).toFixed(2)}억`);
console.log(`  부스터  : 주식 ${(boosted.final.stockValue/1e8).toFixed(2)}억 + POOL ${(boosted.final.pool/1e8).toFixed(2)}억 = 총 ${(boosted.final.total/1e8).toFixed(2)}억`);

// 특정 시점 스냅샷 비교 (2020년 저점 직후, 그리고 2020년말 랠리 시점)
console.log('\n[시점별 배분 비교]');
for (const snapDate of ['2020-03-23','2020-06-30','2020-12-31','2021-06-30','2021-11-19','2023-01-01','2025-02-20']) {
  const db = base.daily.find(d=>d.date>=snapDate);
  const dt = boosted.daily.find(d=>d.date>=snapDate);
  if (!db||!dt) continue;
  console.log(`  ${snapDate} 근처(${db.date}):  베이스 주식${(db.stockValue/1e8).toFixed(1)}억/POOL${(db.pool/1e8).toFixed(1)}억(합${(db.total/1e8).toFixed(1)}억)  vs  부스터 주식${(dt.stockValue/1e8).toFixed(1)}억/POOL${(dt.pool/1e8).toFixed(1)}억(합${(dt.total/1e8).toFixed(1)}억)`);
}
