// 부스터 기준 고점 lookback 비교: 30일 / 60일 / 120일
// 1) 동일 파라미터(DD-25%/재투자25%)로 lookback만 바꿔 순수 효과 비교
// 2) 각 lookback별로 DD x 재투자비율 그리드서치해서 각자의 최적점 비교
import fs from 'node:fs';
const TQQQ_DATA = JSON.parse(fs.readFileSync(new URL('./src/data/tqqq.json', import.meta.url)));

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
const _rsi=calcRSI(_closes,14), _disp=calcDisparity(_closes,180);
const rollMaxCache = {};
function getRollMax(lookback) {
  if (!rollMaxCache[lookback]) rollMaxCache[lookback] = calcRollMax(_closes, lookback);
  return rollMaxCache[lookback];
}
function isWednesday(d){ return new Date(d+'T00:00:00Z').getUTCDay()===3; }

function runFinalBacktest(startDate, endDate, opt){
  const startIdx=TQQQ_DATA.findIndex(([d])=>d>=startDate);
  const endIdxRaw=TQQQ_DATA.findIndex(([d])=>d>endDate);
  const sliceEnd=endIdxRaw===-1?TQQQ_DATA.length:endIdxRaw;
  const rollMaxArr = opt.enabled ? getRollMax(opt.lookback) : null;
  let shares=0,avgCost=0,pool=0,totalIn=0,cooldown=0,started=false;
  const totals=[];
  for(let i=startIdx;i<sliceEnd;i++){
    const [date,priceUSD]=TQQQ_DATA[i]; const price=priceUSD*1350;
    const rsi=_rsi[i],disp=_disp[i];
    const rollMax = rollMaxArr ? rollMaxArr[i] : NaN;
    if(!started){ shares=100_000_000/price; avgCost=price; totalIn=100_000_000; started=true; }
    else{
      const ret=avgCost>0?(price-avgCost)/avgCost:0;
      if(cooldown>0) cooldown--;
      else if(!isNaN(rsi)&&rsi>=70&&!isNaN(disp)&&disp>40&&ret>=0.25){
        const sellShares=shares*0.70; pool+=sellShares*price; shares-=sellShares; cooldown=10;
      }
      if(isWednesday(date)){
        let ratio=0.05;
        if(opt.enabled && !isNaN(rollMax) && priceUSD<=rollMax*(1-opt.drawdown)) ratio=opt.ratio;
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
const cycleDates = [];
for (let start=0; start+WINDOW<=TQQQ_DATA.length; start+=SLIDE) cycleDates.push([TQQQ_DATA[start][0], TQQQ_DATA[start+WINDOW-1][0]]);
const keptDates = cycleDates.filter(([s,e]) => !overlaps(s,e));

function evalSet(dates, opt) {
  const rets=[], cagrs=[], mdds=[];
  for (const [s,e] of dates) { const r = runFinalBacktest(s,e,opt); rets.push(r.returnPct); cagrs.push(r.cagr); mdds.push(r.mdd); }
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  return { retMean: mean(rets), cagrMean: mean(cagrs), mddMean: mean(mdds), rets };
}

const base = evalSet(cycleDates, { enabled:false });
const baseKept = evalSet(keptDates, { enabled:false });
console.log(`베이스(부스터없음) 전체46: 수익률 ${base.retMean.toFixed(1)}%  CAGR ${base.cagrMean.toFixed(1)}%  MDD ${base.mddMean.toFixed(1)}%`);
console.log(`베이스(부스터없음) 27개(2022제외): 수익률 ${baseKept.retMean.toFixed(1)}%  CAGR ${baseKept.cagrMean.toFixed(1)}%  MDD ${baseKept.mddMean.toFixed(1)}%\n`);

console.log('='.repeat(100));
console.log('[1] 동일 파라미터(DD -25% / 재투자 25%)로 lookback만 비교');
console.log('='.repeat(100));
for (const lookback of [30, 60, 120]) {
  const opt = { enabled:true, lookback, drawdown:0.25, ratio:0.25 };
  const all = evalSet(cycleDates, opt);
  const kept = evalSet(keptDates, opt);
  const keptLoss = kept.rets.filter((v,i)=>v<baseKept.rets[i]).length;
  console.log(`${lookback}일고점 | 전체46 수익률 ${all.retMean.toFixed(1)}% CAGR ${all.cagrMean.toFixed(2)}% MDD ${all.mddMean.toFixed(1)}% | 27개 수익률 ${kept.retMean.toFixed(1)}% CAGR ${kept.cagrMean.toFixed(2)}% MDD ${kept.mddMean.toFixed(1)}% 패배 ${keptLoss}/27`);
}

console.log('\n' + '='.repeat(100));
console.log('[2] lookback별 DD x 재투자비율 그리드서치 (각자의 최적점 탐색)');
console.log('='.repeat(100));
const DRAWDOWNS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
const RATIOS = [0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

for (const lookback of [30, 60, 120]) {
  let best = null;
  const allCombos = [];
  for (const dd of DRAWDOWNS) {
    for (const ratio of RATIOS) {
      const opt = { enabled:true, lookback, drawdown:dd, ratio };
      const kept = evalSet(keptDates, opt);
      const keptLoss = kept.rets.filter((v,i)=>v<baseKept.rets[i]).length;
      const rec = { dd, ratio, retMean: kept.retMean, cagrMean: kept.cagrMean, mddMean: kept.mddMean, keptLoss };
      allCombos.push(rec);
      if (keptLoss === 0 && (!best || rec.retMean > best.retMean)) best = rec;
    }
  }
  console.log(`\n[${lookback}일고점] 27개(2022제외)세트에서 패배 0건인 조합 중 최고 수익률:`);
  if (best) {
    const allOpt = { enabled:true, lookback, drawdown:best.dd, ratio:best.ratio };
    const allR = evalSet(cycleDates, allOpt);
    console.log(`  DD -${(best.dd*100).toFixed(0)}% / 재투자 ${(best.ratio*100).toFixed(0)}%  →  27개수익률 ${best.retMean.toFixed(1)}%  CAGR ${best.cagrMean.toFixed(2)}%  MDD ${best.mddMean.toFixed(1)}%  (전체46 수익률 ${allR.retMean.toFixed(1)}%)`);
  } else {
    console.log('  패배 0건 조합 없음 (조건 완화 필요)');
  }
}
