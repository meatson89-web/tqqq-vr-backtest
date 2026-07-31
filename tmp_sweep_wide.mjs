// 재투자비율 25~50% 확장 그리드서치, 2022 약세장(2021-11~2022-12) 겹치는 사이클 분리 집계
import fs from 'node:fs';
const TQQQ_DATA = JSON.parse(fs.readFileSync(new URL('./src/data/tqqq_fresh.json', import.meta.url)));

function calcRSI(closes, period) {
  const rsi = new Array(closes.length).fill(NaN);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) { const d=closes[i]-closes[i-1]; if(d>0) gainSum+=d; else lossSum-=d; }
  let avgGain=gainSum/period, avgLoss=lossSum/period;
  rsi[period]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1]; const g=d>0?d:0,l=d<0?-d:0;
    avgGain=(avgGain*(period-1)+g)/period; avgLoss=(avgLoss*(period-1)+l)/period;
    rsi[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return rsi;
}
function calcDisparity(closes, period) {
  const disp=new Array(closes.length).fill(NaN); let sum=0;
  for(let i=0;i<closes.length;i++){ sum+=closes[i]; if(i>=period) sum-=closes[i-period];
    if(i>=period-1){ const ma=sum/period; disp[i]=ma>0?((closes[i]-ma)/ma)*100:NaN; } }
  return disp;
}
function calcRollMax(closes, period){
  const out=new Array(closes.length).fill(NaN);
  for(let i=0;i<closes.length;i++){ const s=Math.max(0,i-period+1); let m=-Infinity;
    for(let j=s;j<=i;j++) if(closes[j]>m) m=closes[j]; out[i]=m; }
  return out;
}
function calcMDD(series){ let peak=-Infinity, mdd=0; for(const v of series){ if(v>peak) peak=v; if(peak>0){const dd=(v-peak)/peak*100; if(dd<mdd) mdd=dd;} } return mdd; }
const _closes=TQQQ_DATA.map(([,c])=>c);
const _rsi=calcRSI(_closes,14), _disp=calcDisparity(_closes,180), _roll60max=calcRollMax(_closes,60);
function isWednesday(d){ return new Date(d+'T00:00:00Z').getUTCDay()===3; }

function runFinalBacktest(startDate, endDate, booster){
  const startIdx=TQQQ_DATA.findIndex(([d])=>d>=startDate);
  const endIdxRaw=TQQQ_DATA.findIndex(([d])=>d>endDate);
  const sliceEnd=endIdxRaw===-1?TQQQ_DATA.length:endIdxRaw;
  let shares=0,avgCost=0,pool=0,totalIn=0,cooldown=0,started=false; const totals=[];
  for(let i=startIdx;i<sliceEnd;i++){
    const [date,priceUSD]=TQQQ_DATA[i]; const price=priceUSD*1350;
    const rsi=_rsi[i],disp=_disp[i],rollMax=_roll60max[i];
    if(!started){ shares=100_000_000/price; avgCost=price; totalIn=100_000_000; started=true; }
    else{
      const ret=avgCost>0?(price-avgCost)/avgCost:0;
      if(cooldown>0) cooldown--;
      else if(!isNaN(rsi)&&rsi>=70&&!isNaN(disp)&&disp>40&&ret>=0.25){
        const sellShares=shares*0.70; pool+=sellShares*price; shares-=sellShares; cooldown=10;
      }
      if(isWednesday(date)){
        let ratio=0.05;
        if(booster&&!isNaN(rollMax)&&priceUSD<=rollMax*(1-booster.drawdown)) ratio=booster.ratio;
        const b=pool*ratio; const buyAmt=850_000+b; const newSh=buyAmt/price;
        avgCost=(avgCost*shares+buyAmt)/(shares+newSh); shares+=newSh; pool-=b; totalIn+=850_000;
        const total=shares*price+pool;
        if(total<=200_000_000&&pool>total*0.10){
          const excess=pool-total*0.10; const extraSh=excess/price;
          avgCost=(avgCost*shares+excess)/(shares+extraSh); shares+=extraSh; pool-=excess;
        }
      }
    }
    totals.push(shares*price+pool);
  }
  const last=totals[totals.length-1]; const days=totals.length, years=days/252;
  const returnPct=(last-totalIn)/totalIn*100;
  const cagr=(Math.pow(last/totalIn,1/years)-1)*100;
  return { returnPct, cagr, mdd: calcMDD(totals) };
}

const WINDOW=252*5, SLIDE=63;
const BEAR_START='2021-11-01', BEAR_END='2022-12-31';
function overlaps(s,e){ return !(e<BEAR_START || s>BEAR_END); }

// 사이클 날짜 목록 미리 생성
const cycleDates = [];
for (let start=0; start+WINDOW<=TQQQ_DATA.length; start+=SLIDE) {
  cycleDates.push([TQQQ_DATA[start][0], TQQQ_DATA[start+WINDOW-1][0]]);
}
const keptDates = cycleDates.filter(([s,e]) => !overlaps(s,e));
const excludedDates = cycleDates.filter(([s,e]) => overlaps(s,e));
console.log(`전체 ${cycleDates.length}개 사이클 중 2022약세장 겹침 ${excludedDates.length}개, 제외후 ${keptDates.length}개\n`);

// 베이스라인 (booster null)
function evalSet(dates, booster) {
  const rets=[], cagrs=[], mdds=[];
  for (const [s,e] of dates) {
    const r = runFinalBacktest(s,e,booster);
    rets.push(r.returnPct); cagrs.push(r.cagr); mdds.push(r.mdd);
  }
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  return { retMean: mean(rets), cagrMean: mean(cagrs), mddMean: mean(mdds), rets };
}
const baseKept = evalSet(keptDates, null);
const baseAll  = evalSet(cycleDates, null);
console.log(`베이스(전체46): 수익률 ${baseAll.retMean.toFixed(1)}%  CAGR ${baseAll.cagrMean.toFixed(1)}%  MDD ${baseAll.mddMean.toFixed(1)}%`);
console.log(`베이스(27,2022제외): 수익률 ${baseKept.retMean.toFixed(1)}%  CAGR ${baseKept.cagrMean.toFixed(1)}%  MDD ${baseKept.mddMean.toFixed(1)}%\n`);

const DRAWDOWNS = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
const RATIOS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50];

const results = [];
for (const dd of DRAWDOWNS) {
  for (const ratio of RATIOS) {
    const booster = { lookback:60, drawdown: dd, ratio };
    const keptR = evalSet(keptDates, booster);
    const allR  = evalSet(cycleDates, booster);
    const keptLosses = keptR.rets.filter((v,i) => v < baseKept.rets[i]).length;
    const allWins = allR.rets.filter((v,i) => v > baseAll.rets[i]).length;
    results.push({ dd, ratio, allRet: allR.retMean, allCagr: allR.cagrMean, allMdd: allR.mddMean,
                    keptRet: keptR.retMean, keptCagr: keptR.cagrMean, keptMdd: keptR.mddMean,
                    keptLosses, allWins });
  }
}

console.log('='.repeat(115));
console.log('전체 46사이클 vs 2022제외 27사이클 비교 (재투자 25~50%)');
console.log('='.repeat(115));
console.log(`${'DD'.padStart(5)} ${'재투자'.padStart(6)} | ${'전체46 수익률'.padStart(12)} ${'전체46승'.padStart(8)} | ${'27개 수익률'.padStart(11)} ${'27개CAGR'.padStart(9)} ${'27개MDD'.padStart(9)} ${'27개내패배'.padStart(9)}`);
console.log('-'.repeat(115));
for (const r of results) {
  console.log(
    `${(-r.dd*100).toFixed(0).padStart(4)}% ${(r.ratio*100).toFixed(0).padStart(5)}% | ` +
    `${r.allRet.toFixed(1).padStart(11)}% ${(r.allWins+'/46').padStart(8)} | ` +
    `${r.keptRet.toFixed(1).padStart(10)}% ${r.keptCagr.toFixed(2).padStart(8)}% ${r.keptMdd.toFixed(1).padStart(8)}% ${(r.keptLosses+'/27').padStart(9)}`
  );
}

console.log('\n' + '='.repeat(115));
console.log('[27개(2022제외) 세트에서 패배 0건인 조합 중 수익률 TOP 10]');
console.log('='.repeat(115));
const zeroLoss = results.filter(r => r.keptLosses === 0).sort((a,b)=>b.keptRet-a.keptRet);
for (const r of zeroLoss.slice(0,10)) {
  console.log(`  DD -${(r.dd*100).toFixed(0)}% / 재투자 ${(r.ratio*100).toFixed(0)}%  →  27개 수익률 ${r.keptRet.toFixed(1)}%  CAGR ${r.keptCagr.toFixed(2)}%  MDD ${r.keptMdd.toFixed(1)}%  (전체46 ${r.allWins}/46승)`);
}

console.log('\n[각 DD별 재투자비율에 따른 수익률 추이 (정점 확인용, 27개세트 기준)]');
for (const dd of DRAWDOWNS) {
  const row = results.filter(r => r.dd === dd).sort((a,b)=>a.ratio-b.ratio);
  const s = row.map(r => `${(r.ratio*100).toFixed(0)}%:${r.keptRet.toFixed(1)}%`).join('  ');
  console.log(`  DD -${(dd*100).toFixed(0)}%:  ${s}`);
}
