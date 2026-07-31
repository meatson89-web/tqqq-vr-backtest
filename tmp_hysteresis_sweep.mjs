// 부스터 OFF 조건 실험: 현재는 진입조건과 동일한 임계치로 매번 재평가(상태 없음, 깜빡임 가능)
// 대안: 상태(히스테리시스) 방식 — 한번 켜지면 "가격이 60일고점 대비 -exitPct% 이내로 회복"할 때까지 유지
//   exitPct=0  → 완전히 신고점(60일고점) 회복해야 꺼짐 (사용자 제안)
//   exitPct=25 → 진입조건과 동일(현재 방식과 유사, 상태만 sticky)
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
const _rsi=calcRSI(_closes,14), _disp=calcDisparity(_closes,180), _roll60max=calcRollMax(_closes,60);
function isWednesday(d){ return new Date(d+'T00:00:00Z').getUTCDay()===3; }

// mode: 'stateless'(현재 방식) or 'hysteresis'(진입/이탈 분리, sticky)
function runFinalBacktest(startDate, endDate, opt){
  const startIdx=TQQQ_DATA.findIndex(([d])=>d>=startDate);
  const endIdxRaw=TQQQ_DATA.findIndex(([d])=>d>endDate);
  const sliceEnd=endIdxRaw===-1?TQQQ_DATA.length:endIdxRaw;
  let shares=0,avgCost=0,pool=0,totalIn=0,cooldown=0,started=false;
  let boosterOn=false; // 히스테리시스 상태
  const totals=[];
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

      // 부스터 on/off 판정 (매일 갱신, 실제 재투자는 수요일에만 실행)
      if (!isNaN(rollMax)) {
        if (opt.mode === 'hysteresis') {
          if (!boosterOn && priceUSD <= rollMax * (1 - opt.entryFrac)) boosterOn = true;
          else if (boosterOn && priceUSD >= rollMax * (1 - opt.exitFrac)) boosterOn = false;
        } else {
          boosterOn = priceUSD <= rollMax * (1 - opt.entryFrac); // stateless: 매번 재평가
        }
      }

      if(isWednesday(date)){
        let ratio = 0.05;
        if (opt.enabled && boosterOn) ratio = opt.ratio;
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

// 현재 방식(stateless, DD25%/25%)
const currentOpt = { enabled:true, mode:'stateless', entryFrac:0.25, ratio:0.25 };
const curAll = evalSet(cycleDates, currentOpt);
const curKept = evalSet(keptDates, currentOpt);
const curKeptLoss = curKept.rets.filter((v,i)=>v<baseKept.rets[i]).length;
console.log(`[현재 방식: stateless, 진입=이탈=-25%]`);
console.log(`  전체46 수익률 ${curAll.retMean.toFixed(1)}%  CAGR ${curAll.cagrMean.toFixed(2)}%  MDD ${curAll.mddMean.toFixed(1)}%`);
console.log(`  27개(2022제외) 수익률 ${curKept.retMean.toFixed(1)}%  CAGR ${curKept.cagrMean.toFixed(2)}%  MDD ${curKept.mddMean.toFixed(1)}%  패배 ${curKeptLoss}/27\n`);

// 히스테리시스: 진입 -25% 고정, 이탈(exitFrac) 스윕
console.log('='.repeat(100));
console.log('[히스테리시스 방식] 진입 -25% 고정, 이탈(회복) 임계치 스윕 (재투자비율 25% 고정)');
console.log('='.repeat(100));
console.log(`${'이탈조건'.padStart(10)} | ${'전체46수익률'.padStart(11)} ${'전체46CAGR'.padStart(10)} ${'전체46MDD'.padStart(9)} | ${'27개수익률'.padStart(10)} ${'27개CAGR'.padStart(9)} ${'27개MDD'.padStart(9)} ${'27개패배'.padStart(8)}`);
console.log('-'.repeat(100));
const EXIT_FRACS = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25]; // 0.00 = 사용자 제안(완전 신고점 회복)
const hystResults = [];
for (const exitFrac of EXIT_FRACS) {
  const opt = { enabled:true, mode:'hysteresis', entryFrac:0.25, exitFrac, ratio:0.25 };
  const all = evalSet(cycleDates, opt);
  const kept = evalSet(keptDates, opt);
  const keptLoss = kept.rets.filter((v,i)=>v<baseKept.rets[i]).length;
  hystResults.push({ exitFrac, all, kept, keptLoss });
  const label = exitFrac===0 ? '고점회복' : `-${(exitFrac*100).toFixed(0)}%`;
  console.log(
    `${label.padStart(10)} | ${all.retMean.toFixed(1).padStart(10)}% ${all.cagrMean.toFixed(2).padStart(9)}% ${all.mddMean.toFixed(1).padStart(8)}% | ` +
    `${kept.retMean.toFixed(1).padStart(9)}% ${kept.cagrMean.toFixed(2).padStart(8)}% ${kept.mddMean.toFixed(1).padStart(8)}% ${(keptLoss+'/27').padStart(8)}`
  );
}
