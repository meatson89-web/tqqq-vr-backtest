// 조정예상매도 — 1단계: 문제 실증과 포착 기준 분석
//
// 가설(사용자) — TQQQ가 횡보·저성장이면 이격도·RSI가 전체적으로 낮아져
//   고정 매도기준(이격도>40% AND RSI>=73)에 걸리지 않은 채 -30% 하락을 맞는다.
// 여기서는 그 가설이 실제로 맞는지부터 확인하고, 국면선이 그 구멍을 메우는지 본다.
//
// 실행: node scripts/anticipate-analyze.mjs

import { TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';
import { indicators, findCycles, walkForwardLines, fitLine } from './anticipate-lib.mjs';

const SELL_DISP = 40, SELL_RSI = 73;
// 고점 직전 이 거래일 안에 신호가 켜져야 "그 꼭지를 잡았다"고 본다 (63일 ≈ 3개월).
const NEAR = +(process.env.NEAR ?? 63);
const f1 = (v, s = false) => (v == null || isNaN(v) ? '  —  ' : ((s && v > 0 ? '+' : '') + v.toFixed(1)));

function analyze(label, data) {
  const ind = indicators(data);
  const { closes, rsi, disp, reg } = ind;
  const cycles = findCycles(closes);
  const wf = walkForwardLines(ind, cycles);

  console.log(`\n${'='.repeat(118)}`);
  console.log(`${label} — ${data[0][0]} ~ ${data[data.length - 1][0]}, -30% 이상 하락 사이클 ${cycles.length}개`);
  console.log('='.repeat(118));
  console.log('고점일         국면(직전6M)  고점이격도  고점RSI   이후MDD  | 고정기준 발동?  발동일(고점대비)  | 국면선 발동?  발동일');
  console.log('─'.repeat(118));

  const rows = [];
  for (let k = 0; k < cycles.length; k++) {
    const c = cycles[k];
    // 고점 직전 NEAR거래일 안에서만 본다. 직전 저점까지 넓히면 "2015-07 고점을
    // 2013-12에 잡았다" 같은 무의미한 판정이 나온다 — 다른 상승장 얘기다.
    const from = Math.max(0, c.peakIdx - NEAR);
    // 고정 기준이 상승 구간 중 한 번이라도 켜졌는가
    let fixIdx = null;
    for (let i = from; i <= c.peakIdx; i++) {
      if (!isNaN(rsi[i]) && !isNaN(disp[i]) && disp[i] > SELL_DISP && rsi[i] >= SELL_RSI) { fixIdx = i; break; }
    }
    // 국면선(워크포워드) 기준이 켜졌는가
    let regIdx = null;
    for (let i = from; i <= c.peakIdx; i++) {
      if (!isNaN(wf.predD[i]) && disp[i] >= wf.predD[i] && rsi[i] >= wf.predR[i]) { regIdx = i; break; }
    }
    const r = {
      k, peak: data[c.peakIdx][0], x: reg[c.peakIdx], d: disp[c.peakIdx], r: rsi[c.peakIdx], mdd: c.mdd,
      fixIdx, regIdx, peakIdx: c.peakIdx,
      fixLead: fixIdx == null ? null : c.peakIdx - fixIdx,
      regLead: regIdx == null ? null : c.peakIdx - regIdx,
    };
    rows.push(r);
    console.log(
      `${r.peak}    ${f1(r.x, true).padStart(8)}%   ${f1(r.d, true).padStart(7)}%  ${f1(r.r).padStart(6)}  ${f1(r.mdd).padStart(7)}%  |` +
      `   ${fixIdx == null ? '✗ 미발동    ' : '○ 발동      '}  ${fixIdx == null ? '   —      ' : (data[fixIdx][0] + ' (-' + r.fixLead + '일)')}` +
      `  |  ${regIdx == null ? '✗ 미발동  ' : '○ 발동    '}  ${regIdx == null ? '   —' : data[regIdx][0] + ' (-' + r.regLead + '일)'}`);
  }

  const miss = rows.filter(r => r.fixIdx == null);
  const hit = rows.filter(r => r.fixIdx != null);
  const mean = (a) => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s, y) => s + y, 0) / v.length : NaN; };

  console.log('\n[가설 검정] 고정기준을 놓친 사이클은 정말 "횡보·저성장 국면"인가');
  console.log(`  발동한 사이클  ${hit.length}개 — 고점 시점 직전 6개월 수익률 평균 ${f1(mean(hit.map(r => r.x)), true)}%` +
              ` · 고점 이격도 평균 ${f1(mean(hit.map(r => r.d)), true)}% · 고점 RSI 평균 ${f1(mean(hit.map(r => r.r)))}`);
  console.log(`  놓친 사이클    ${miss.length}개 — 고점 시점 직전 6개월 수익률 평균 ${f1(mean(miss.map(r => r.x)), true)}%` +
              ` · 고점 이격도 평균 ${f1(mean(miss.map(r => r.d)), true)}% · 고점 RSI 평균 ${f1(mean(miss.map(r => r.r)))}`);
  console.log(`  놓친 사이클 평균 MDD ${f1(mean(miss.map(r => r.mdd)))}% (발동 ${f1(mean(hit.map(r => r.mdd)))}%)`);

  const regCovered = miss.filter(r => r.regIdx != null);
  console.log(`\n[국면선 효과] 고정기준이 놓친 ${miss.length}개 중 국면선이 잡은 것: ${regCovered.length}개` +
              (regCovered.length ? ` (평균 ${Math.round(mean(regCovered.map(r => r.regLead)))}거래일 전)` : ''));
  const bothMiss = miss.filter(r => r.regIdx == null);
  if (bothMiss.length) console.log(`  둘 다 놓친 사이클: ${bothMiss.map(r => r.peak).join(', ')}`);
  const extra = rows.filter(r => r.fixIdx != null && r.regIdx != null && r.regLead > r.fixLead);
  console.log(`  고정기준도 잡았지만 국면선이 더 일찍 잡은 사이클: ${extra.length}개`);

  // 전량 표본 회귀 (참고용 — 실제 규칙은 워크포워드)
  const pts = cycles.filter(c => !isNaN(reg[c.peakIdx]) && !isNaN(disp[c.peakIdx]));
  const fd = fitLine(pts.map(c => ({ x: reg[c.peakIdx], y: disp[c.peakIdx] })));
  const fr = fitLine(pts.map(c => ({ x: reg[c.peakIdx], y: rsi[c.peakIdx] })));
  console.log(`\n[전량표본 회귀 · 참고] 예상고점 이격도 = ${fd.a.toFixed(1)} + ${fd.b.toFixed(3)}·x (R²=${fd.r2.toFixed(3)}, n=${fd.n})`);
  console.log(`                       예상고점 RSI    = ${fr.a.toFixed(1)} + ${fr.b.toFixed(3)}·x (R²=${fr.r2.toFixed(3)})`);
  console.log(`  x = 직전 126거래일 TQQQ 수익률%, 적합 범위 ${fd.xmin.toFixed(1)} ~ ${fd.xmax.toFixed(1)}%`);

  // 신호가 얼마나 자주 켜지나 (체류율) — 과매도 남발 위험 점검
  const valid = closes.map((_, i) => i).filter(i => !isNaN(wf.predD[i]) && !isNaN(disp[i]));
  const onFix = valid.filter(i => disp[i] > SELL_DISP && rsi[i] >= SELL_RSI).length;
  const onReg = valid.filter(i => disp[i] >= wf.predD[i] && rsi[i] >= wf.predR[i]).length;
  console.log(`\n[체류율] 국면선 작동 가능 구간 ${valid.length}일 중 — 고정기준 ${(onFix / valid.length * 100).toFixed(1)}%` +
              ` · 국면선 ${(onReg / valid.length * 100).toFixed(1)}%`);
  console.log(`  국면선이 처음 작동하는 날: ${data[valid[0]]?.[0]} (그 전에는 확정 사이클이 4개 미만이라 규칙 미작동)`);

  return { rows, ind, cycles, wf };
}

console.log(`포착 판정 창 = 고점 직전 ${NEAR}거래일 (NEAR 환경변수로 변경 가능)`);
analyze('합성 TQQQ (1999~, 닷컴·금융위기 포함)', SIM_DATA);
analyze('실제 TQQQ (2010~)', TQQQ_DATA);
