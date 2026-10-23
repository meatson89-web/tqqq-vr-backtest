// SOXL 추천C — 1시간봉 RSI 눌림 매수 + SOX 200일선 필터 + 조건부 트레일링 (Pine 'SOXL C 최종'과 같은 순서)
//   진입: RSI(12) ≤ 문턱 AND 전일 SOX 종가 > SOX 200일 SMA
//   청산: +10% 도달 후 보유 중 고점 대비 -3% / 발동 전 진입가 -30%. 모두 종가 판정.
export const DEF = { rsiLen: 12, rsiTh: 25, arm: 10, trail: 3, hard: 30, maLen: 200, fee: 0.0005 }

// Wilder RSI (TradingView ta.rsi와 같은 RMA). 마지막 평균 상승·하락폭도 돌려준다.
export function rsiSeries(c, n) {
  const r = new Array(c.length).fill(null)
  let g = 0, l = 0
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0)
    if (i <= n) { g += up / n; l += dn / n } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n }
    if (i >= n) r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return { r, g, l }
}

// 다음 1시간봉 종가가 이 가격 이하면 RSI가 문턱 이하가 된다
export function priceForRsi(last, g, l, n, th) {
  const g2 = g * (n - 1) / n
  const l2 = g2 * (100 - th) / th
  const d = n * l2 - l * (n - 1)
  return d <= 0 ? last : last - d
}

// SOX 일봉 → 날짜별 { close, sma, bull }
export function soxRegime(sox, maLen) {
  const out = new Map(); let s = 0
  for (let i = 0; i < sox.length; i++) {
    s += sox[i][1]; if (i >= maLen) s -= sox[i - maLen][1]
    const sma = i >= maLen - 1 ? s / maLen : null
    out.set(sox[i][0], { close: sox[i][1], sma, bull: sma != null && sox[i][1] > sma })
  }
  return out
}

// bars: [[ISO시각(UTC), 종가], ...] 정규장 1시간봉. sox: [[YYYY-MM-DD, 종가], ...]
export function simulate(bars, sox, p = DEF) {
  const c = bars.map(b => b[1])
  const { r, g, l } = rsiSeries(c, p.rsiLen)
  const reg = soxRegime(sox, p.maLen)
  const soxDates = sox.map(x => x[0])
  // 각 봉의 '전일' SOX 판정 (봉 날짜보다 앞선 마지막 SOX 거래일)
  const day = bars.map(b => nyDate(b[0]))
  const bull = new Array(bars.length)
  let j = 0
  for (let i = 0; i < bars.length; i++) {
    while (j < soxDates.length && soxDates[j] < day[i]) j++
    const prev = j > 0 ? reg.get(soxDates[j - 1]) : null
    bull[i] = !!prev?.bull
  }
  let cash = 10000, sh = 0, inPos = false, armed = false, entry = 0, peak = 0, ei = -1
  const trades = [], eq = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const px = c[i]
    if (inPos) {
      peak = Math.max(peak, px)
      if (!armed && px / entry - 1 >= p.arm / 100) armed = true
      const stop = armed ? peak * (1 - p.trail / 100) : entry * (1 - p.hard / 100)
      if (px <= stop) {
        cash = sh * px * (1 - p.fee); sh = 0
        trades.push({ i0: ei, i1: i, t0: bars[ei][0], t1: bars[i][0], p0: entry, p1: px, ret: px / entry - 1, why: armed ? '트레일링' : '하드스탑' })
        inPos = false; armed = false
      }
    }
    if (!inPos && r[i] != null && r[i] <= p.rsiTh && bull[i]) {
      sh = cash * (1 - p.fee) / px; cash = 0
      inPos = true; armed = false; entry = px; peak = px; ei = i
    }
    eq[i] = cash + sh * px
  }
  const open = inPos ? { i0: ei, t0: bars[ei][0], p0: entry, peak, armed } : null
  return { rsi: r, g, l, bull, trades, open, eq, reg }
}

// UTC ISO → 뉴욕 현지 날짜/시각 문자열
const fmtNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export function nyParts(iso) {
  const o = Object.fromEntries(fmtNY.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour === '24' ? '00' : o.hour}:${o.minute}` }
}
export const nyDate = iso => nyParts(iso).date
