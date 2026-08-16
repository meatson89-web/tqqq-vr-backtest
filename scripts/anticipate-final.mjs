// 조정예상매도 — 4단계: 최종안 상세 검증
//
//   A 기존           완화매도 ON,  조정예상 OFF
//   B 완화만 제거      완화매도 OFF, 조정예상 OFF
//   C 요청안 그대로     완화매도 OFF, 조정예상 ON (국면40·현금20·매도30·수익0)
//   D 보정안(교체)     완화매도 OFF, 조정예상 ON (국면20·현금해제·매도30·수익25)
//   E 보정안(병행)     완화매도 ON,  조정예상 ON (같은 보정 파라미터)
//
// 보정 3곳의 근거는 scripts/anticipate-sweep.mjs (약 58개 조합 스윕):
//   · 수익률≥25% 추가 — 없으면 하락 도중에 손실 상태로 팔아 수익률을 크게 깎는다
//   · 국면 문턱 40→20% — 40%면 강세장에서도 발동한다
//   · 발동조건2(현금≤20%) 해제 — 이 조건이 오히려 해로웠다
//
// 실행: node scripts/anticipate-final.mjs

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';
import { buildWindows, run } from './anticipate-compare.mjs';

const YR = 252;
const FIX = { anticipateEnabled: true, anticipateRegimeMax: 20, anticipateCashMax: 100,
              anticipateSellFrac: 0.30, anticipateMinGain: 0.25, anticipateCooldown: 21,
              anticipateDispFloor: 20 };
const S = {
  A: { ...DEFAULT_SETTINGS },
  B: { ...DEFAULT_SETTINGS, relaxEnabled: false },
  C: { ...DEFAULT_SETTINGS, relaxEnabled: false, anticipateEnabled: true },
  D: { ...DEFAULT_SETTINGS, relaxEnabled: false, ...FIX },
  E: { ...DEFAULT_SETTINGS, ...FIX },
};
const KEYS = ['A', 'B', 'C', 'D', 'E'];
const LBL = { A: 'A 기존', B: 'B 완화만제거', C: 'C 요청안그대로', D: 'D 보정안(교체)', E: 'E 보정안(병행)' };

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

function summary(years) {
  const wins = buildWindows(Math.round(YR * years));
  const res = wins.map(w => { const o = { w }; for (const k of KEYS) o[k] = run(w, S[k]); return o; });
  console.log(`\n${'='.repeat(104)}`);
  console.log(`${years}년 롤링 창 ${wins.length}개 — 기존(A) 대비 (세후 납입대비 배수)`);
  console.log('='.repeat(104));
  console.log('안'.padEnd(18) + '총자산Δ평균'.padStart(11) + '  중앙'.padStart(9) + '  개선/악화'.padStart(11) +
    '  최악창'.padStart(9) + '   MDDΔ'.padStart(9) + '  개선/악화'.padStart(11) + '  발동/창'.padStart(9));
  console.log('─'.repeat(104));
  for (const k of KEYS.slice(1)) {
    const d = res.map(r => (r[k].mult / r.A.mult - 1) * 100);
    const m = res.map(r => r[k].mdd - r.A.mdd);
    console.log(LBL[k].padEnd(18) + f(mean(d)).padStart(10) + '%' + f(med(d)).padStart(8) + '%' +
      `${d.filter(x => x > 0.5).length}/${d.filter(x => x < -0.5).length}`.padStart(11) +
      f(Math.min(...d)).padStart(8) + '%' + f(mean(m)).padStart(8) + 'p' +
      `${m.filter(x => x > 0.5).length}/${m.filter(x => x < -0.5).length}`.padStart(11) +
      mean(res.map(r => r[k].ant)).toFixed(1).padStart(9));
  }
  const ind = res.filter(r => r.w.independent);
  console.log(`\n겹치지 않는 독립 창 ${ind.length}개 (D 보정안):`);
  for (const r of ind) {
    console.log(`  ${r.w.startDate}~${r.w.endDate}  배수 ${r.A.mult.toFixed(2)} → ${r.D.mult.toFixed(2)}` +
      ` (${f((r.D.mult / r.A.mult - 1) * 100)}%)  MDD ${r.A.mdd.toFixed(1)}% → ${r.D.mdd.toFixed(1)}%` +
      ` (${f(r.D.mdd - r.A.mdd)}p)  발동 ${r.D.ant}회`);
  }
  return res;
}

function full() {
  console.log(`\n${'='.repeat(104)}`);
  console.log('전체 구간');
  console.log('='.repeat(104));
  for (const [lbl, data] of [['합성 1999~2026', SIM_DATA], ['실제 2010~2026', TQQQ_DATA]]) {
    const w = { startDate: data[0][0], endDate: data[data.length - 1][0], data };
    console.log(`\n${lbl}`);
    const a = run(w, S.A);
    for (const k of KEYS) {
      const r = run(w, S[k]);
      console.log(`  ${LBL[k].padEnd(16)} 세후 ${(r.final / 1e8).toFixed(1).padStart(7)}억  배수 ${r.mult.toFixed(2).padStart(6)}` +
        `  MDD ${r.mdd.toFixed(1)}%  IRR ${r.irr.toFixed(1)}%  매도 ${String(r.sells).padStart(3)}회  조정예상 ${String(r.ant).padStart(3)}회` +
        (k === 'A' ? '' : `   vs A ${f((r.mult / a.mult - 1) * 100)}% · MDD ${f(r.mdd - a.mdd)}p`));
    }
  }
}

// 실제 발동 내역 — 언제 무슨 값에서 팔았는지 눈으로 확인
function trades() {
  console.log(`\n${'='.repeat(104)}`);
  console.log('D 보정안 — 실제 TQQQ 전체구간 조정예상매도 발동 내역');
  console.log('='.repeat(104));
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA[TQQQ_DATA.length - 1][0], S.D, TQQQ_DATA);
  console.log('일자          이격도   예상선   RSI   예상선  국면(6M)  수익률   현금%   매도액');
  for (const t of r.antTrades) {
    console.log(`${t.date}  ${f(t.disp).padStart(6)}%  ${f(t.predD).padStart(6)}%  ${t.rsi.toFixed(1).padStart(5)}` +
      `  ${t.predR.toFixed(1).padStart(5)}  ${f(t.regime).padStart(7)}%  ${f(t.returnPct).padStart(6)}%` +
      `  ${t.cashPct.toFixed(1).padStart(5)}%  ${(t.soldKRW / 1e8).toFixed(2).padStart(6)}억`);
  }
  console.log(`총 ${r.antTrades.length}회`);
}

full();
summary(5);
summary(10);
trades();
