# -*- coding: utf-8 -*-
"""QQQ로 TQQQ를 1999년까지 역산해 합성한다.  →  src/data/tqqq_sim.json

    python scripts/build-sim-tqqq.py       (필요: yfinance, pandas, numpy)

실제 TQQQ 데이터는 2010-02부터라 닷컴버블(2000-2002)과 금융위기(2008)가 없다.
이 두 구간은 전략 검증에 결정적이므로 QQQ로 합성해 채운다.

3배 단순곱은 쓰지 않는다. 3배 ETF는 자산의 2배를 빌려 굴리므로 차입비용이 붙고,
2000년 기준금리는 6.5%였다. 이를 빼먹으면 2000년대가 실제보다 크게 좋게 나온다.

    일간수익 = 3 × QQQ일간수익 − (운용보수 + 2 × (단기금리 + 스프레드)) / 252

스프레드는 실제 TQQQ(2010~)의 누적수익률과 일치하도록 보정한다. 보정 후
최대낙폭·연도별 수익률이 따로 맞아떨어지는지로 신뢰성을 판정한다(보정 대상이
아니므로 독립 검증이다).
"""
import sys, json, pathlib
sys.stdout.reconfigure(encoding="utf-8")
import yfinance as yf
import pandas as pd
import numpy as np

ER = 0.0095            # TQQQ 운용보수 (상장 초기 기준)
LEVERAGE = 3.0
OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "data" / "tqqq_sim.json"


def close_series(ticker, start):
    raw = yf.download(ticker, start=start, progress=False, auto_adjust=True)
    s = raw["Close"]
    if isinstance(s, pd.DataFrame):
        s = s.iloc[:, 0]
    s = s.dropna()
    s.index = pd.to_datetime(s.index).tz_localize(None)
    return s


print("데이터 다운로드 중...")
qqq = close_series("QQQ", "1999-03-01")
tqqq = close_series("TQQQ", "2010-02-09")
irx = close_series("^IRX", "1999-01-01")          # 13주 국채 수익률(연율 %)

qret = qqq.pct_change().dropna()
rate = (irx / 100.0).reindex(qret.index).ffill().bfill()


def simulate(spread):
    drag = (ER + 2.0 * (rate + spread)) / 252.0
    return (1.0 + (LEVERAGE * qret - drag).clip(lower=-0.99)).cumprod()


# ── 스프레드 보정 ──
ov = tqqq.index.intersection(qret.index)
ov = ov[ov >= "2010-02-11"]
target = float(tqqq.loc[ov[-1]] / tqqq.loc[ov[0]])
lo, hi = -0.02, 0.05
for _ in range(80):
    mid = (lo + hi) / 2
    g = simulate(mid)
    if float(g.loc[ov[-1]] / g.loc[ov[0]]) > target:
        lo = mid
    else:
        hi = mid
spread = (lo + hi) / 2
sim = simulate(spread)

print(f"차입 스프레드 보정값: +{spread*100:.2f}%p")
print(f"연 총비용: 2000년 {(ER+2*(float(rate['2000'].mean())+spread))*100:.1f}%  /  "
      f"2021년 {(ER+2*(float(rate['2021'].mean())+spread))*100:.1f}%")

# ── 검증 (보정하지 않은 항목으로 확인) ──
a, b = tqqq.loc[ov], sim.loc[ov]
ar, br = a.pct_change().dropna(), b.pct_change().dropna()
j = ar.index.intersection(br.index)
print(f"\n[검증] 실제 TQQQ vs 합성, {ov[0].date()} ~ {ov[-1].date()}")
print(f"  누적수익   {target:.1f}배 vs {float(b.iloc[-1]/b.iloc[0]):.1f}배   (보정 대상)")
print(f"  일간 상관  {np.corrcoef(ar[j], br[j])[0,1]:.4f}")
print(f"  추적오차   {float((ar[j]-br[j]).std())*100:.3f}%p/일")
print(f"  최대낙폭   {float((a/a.cummax()-1).min())*100:.1f}% vs "
      f"{float((b/b.cummax()-1).min())*100:.1f}%   (독립 검증)")

OUT.write_text(json.dumps([[d.strftime("%Y-%m-%d"), round(float(v), 6)] for d, v in sim.items()]))
print(f"\n저장: {OUT}  ({sim.index[0].date()} ~ {sim.index[-1].date()}, {len(sim)}거래일)")
for lbl, s0, s1 in [("닷컴버블", "2000-03-24", "2002-10-09"), ("금융위기", "2007-10-31", "2009-03-09")]:
    seg = sim.loc[s0:s1]
    print(f"  {lbl} {s0}~{s1}: {float(seg.iloc[-1]/seg.iloc[0]-1)*100:.2f}%")
