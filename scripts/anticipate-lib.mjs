// 조정예상매도 공용 계산 — 분석 스크립트와 백테스트 변형이 같은 정의를 쓰도록 모아둔다.
//
// 핵심은 "국면선"이다. 사이클 고점의 이격도·RSI는 절대 수준이 아니라 직전 상승
// 속도가 정한다(모니터 ③ 탭의 회귀). 그래서 횡보·저성장 국면에서는 고정 기준
// (이격도>40% AND RSI>=73)에 영영 못 닿은 채로 -30% 하락을 맞는다.
//
// ★ 미래참조 금지 — 회귀는 "그 시점까지 이미 끝난 사이클"로만 적합한다.
//   사이클은 고점 뒤 -30%에 닿아야 비로소 사이클로 식별되므로, 확정 시점을
//   -30% 도달일로 잡는다(그 전에는 존재조차 모른다).

export const RSI_N = 14, DISP_MA = 180, REGIME_N = 126, MDD_TH = -30;

/** backtest.js calcRSI와 동일 (Wilder) */
export function calcRSI(closes, period = RSI_N) {
  const rsi = new Array(closes.length).fill(NaN);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

/** backtest.js calcDisparity와 동일 — (종가-MA)/MA*100 */
export function calcDisparity(closes, period = DISP_MA) {
  const disp = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) { const ma = sum / period; disp[i] = ma > 0 ? ((closes[i] - ma) / ma) * 100 : NaN; }
  }
  return disp;
}

/** 국면 변수 = 직전 REGIME_N거래일 수익률 % (TQQQ 자기 기준) */
export function calcRegime(closes, n = REGIME_N) {
  return closes.map((c, i) => (i < n ? NaN : (c / closes[i - n] - 1) * 100));
}

/** 지표 한 번에 */
export function indicators(data) {
  const closes = data.map(d => d[1]);
  return { closes, rsi: calcRSI(closes), disp: calcDisparity(closes), reg: calcRegime(closes) };
}

/**
 * -30% 이상 하락 사이클을 지그재그로 찾는다.
 *
 * 모니터(compute.js)는 "직전 고점 회복"으로 사이클을 닫는데, 그건 실제 TQQQ처럼
 * 늘 신고가를 내는 계열에서만 통한다. 합성 TQQQ는 닷컴에서 -99.97%를 맞고 26년째
 * 회복을 못 해 2000년 이후 전체가 하나의 열린 하락으로 뭉개진다. 그래서 여기서는
 * 회복을 요구하지 않고 하락 th%·반등 rebound%로 방향을 전환하는 지그재그를 쓴다.
 *
 * confirmIdx = 고점 대비 -th%에 처음 닿은 날. 그 전에는 이 고점이 사이클인지
 * 알 수 없으므로, 워크포워드 회귀는 이 날 이후에만 이 표본을 쓸 수 있다.
 */
export function findCycles(closes, th = -MDD_TH, rebound = 50) {
  const out = [];
  let dir = 'up', ext = closes[0], extIdx = 0;
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i];
    if (dir === 'up') {
      if (c > ext) { ext = c; extIdx = i; }
      else if ((c / ext - 1) * 100 <= -th) {
        out.push({ peakIdx: extIdx, confirmIdx: i, trIdx: null, mdd: null });
        dir = 'down'; ext = c; extIdx = i;
      }
    } else {
      if (c < ext) { ext = c; extIdx = i; }
      else if ((c / ext - 1) * 100 >= rebound) {
        const cur = out[out.length - 1];
        cur.trIdx = extIdx;
        cur.mdd = (closes[extIdx] / closes[cur.peakIdx] - 1) * 100;
        dir = 'up'; ext = c; extIdx = i;
      }
    }
  }
  const last = out[out.length - 1];
  if (last && last.trIdx == null) {
    last.trIdx = extIdx;
    last.mdd = (closes[extIdx] / closes[last.peakIdx] - 1) * 100;
  }
  return out;
}

/** 단순회귀 y = a + b*x */
export function fitLine(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const a = my - b * mx;
  const ss = pts.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0);
  const st = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  return { a, b, r2: st === 0 ? 0 : 1 - ss / st, n, xmin: Math.min(...pts.map(p => p.x)), xmax: Math.max(...pts.map(p => p.x)) };
}

/**
 * 워크포워드 국면선. 각 인덱스 i에서 "i일까지 확정된 사이클"만으로 적합한
 * 예상 고점 이격도/RSI를 돌려준다. minCycles개 미만이면 null(규칙 미작동).
 * 적합 x범위 밖은 잘라 외삽하지 않는다.
 */
export function walkForwardLines(ind, cycles, minCycles = 4) {
  const { rsi, disp, reg } = ind;
  const n = rsi.length;
  const predD = new Array(n).fill(NaN), predR = new Array(n).fill(NaN), nUsed = new Array(n).fill(0);
  // 확정일 순으로 정렬된 표본
  const sample = cycles
    .filter(c => c.confirmIdx != null && !isNaN(reg[c.peakIdx]) && !isNaN(disp[c.peakIdx]) && !isNaN(rsi[c.peakIdx]))
    .map(c => ({ at: c.confirmIdx, x: reg[c.peakIdx], d: disp[c.peakIdx], r: rsi[c.peakIdx] }))
    .sort((a, b) => a.at - b.at);
  let k = 0; const pts = [];
  for (let i = 0; i < n; i++) {
    while (k < sample.length && sample[k].at <= i) { pts.push(sample[k]); k++; }
    nUsed[i] = pts.length;
    if (pts.length < minCycles) continue;
    const fd = fitLine(pts.map(p => ({ x: p.x, y: p.d })));
    const fr = fitLine(pts.map(p => ({ x: p.x, y: p.r })));
    if (!fd || !fr || isNaN(reg[i])) continue;
    const x = Math.min(fd.xmax, Math.max(fd.xmin, reg[i]));
    predD[i] = fd.a + fd.b * x;
    predR[i] = fr.a + fr.b * x;
  }
  return { predD, predR, nUsed };
}
