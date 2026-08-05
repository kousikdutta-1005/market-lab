#!/usr/bin/env python
"""market-lab CLI — read-only research over Indian MFs and equities.

Examples:
    python cli.py mf search "parag parikh flexi direct growth"
    python cli.py mf stats 122639
    python cli.py mf compare 122639 120503 --benchmark nifty50
    python cli.py eq quote RELIANCE.NS
    python cli.py eq stats nifty50 --range 10y
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd
import requests

from marketlab import equity, metrics, mf


def _pct(x, digits: int = 2) -> str:
    return "n/a" if x is None or pd.isna(x) else f"{x * 100:.{digits}f}%"


def _print_summary(label: str, series) -> None:
    s = metrics.summary(series)
    print(f"\n{label}")
    print("-" * len(label))
    print(f"  period          {s['start']} -> {s['end']}  ({s['points']} {s['sampling']} points)")
    print(f"  CAGR            {_pct(s['cagr'])}")
    print(f"  volatility      {_pct(s['volatility'])}")
    print(f"  sharpe          {s['sharpe']:.2f}" if pd.notna(s["sharpe"]) else "  sharpe          n/a")
    print(f"  max drawdown    {_pct(s['max_drawdown'])}  (trough {s['max_dd_trough']}, recovered {s['recovered'] or 'not yet'})")
    if pd.notna(s["roll3y_median"]):
        print(f"  3y rolling      median {_pct(s['roll3y_median'])} | worst {_pct(s['roll3y_worst'])} | negative {_pct(s['roll3y_pct_negative'], 1)} of windows")

    tr = metrics.trailing_returns(series)
    if not tr.empty:
        print("  trailing        " + "  ".join(f"{k}:{_pct(v, 1)}" for k, v in tr.items()))


def cmd_mf_search(args) -> int:
    df = mf.search(args.query, direct_only=args.direct, growth_only=args.growth)
    if df.empty:
        print("No schemes matched.")
        return 1
    with pd.option_context("display.max_colwidth", 70, "display.width", 200):
        print(df.head(args.limit).to_string(index=False))
    print(f"\n{len(df)} match(es); showing {min(args.limit, len(df))}.")
    return 0


def cmd_mf_stats(args) -> int:
    hist = mf.nav_history(args.code)
    meta = hist.attrs.get("meta", {})
    label = meta.get("scheme_name", f"scheme {args.code}")
    print(f"{label}\n{meta.get('fund_house', '')} | {meta.get('scheme_category', '')}")
    _print_summary(f"NAV stats ({args.code})", hist)
    return 0


def cmd_mf_compare(args) -> int:
    for code in args.codes:
        try:
            hist = mf.nav_history(code)
        except Exception as exc:
            print(f"\n{code}: failed ({exc})", file=sys.stderr)
            continue
        name = hist.attrs.get("meta", {}).get("scheme_name", str(code))
        _print_summary(f"{name} [{code}]", hist)

    if args.benchmark:
        try:
            _print_summary(f"BENCHMARK: {args.benchmark}", equity.history(args.benchmark, range_="max"))
        except Exception as exc:
            print(f"\nbenchmark {args.benchmark}: failed ({exc})", file=sys.stderr)
    return 0


def cmd_eq_quote(args) -> int:
    q = equity.quote(args.symbol)
    prev, price = q.get("previous_close"), q.get("price")
    print(f"{q['symbol']}  ({q['exchange']})")
    print(f"  price           {price} {q['currency']}")
    if prev and price:
        print(f"  change          {price - prev:+.2f} ({(price / prev - 1) * 100:+.2f}%)")
    print(f"  day range       {q['day_low']} - {q['day_high']}")
    print(f"  52w range       {q['fifty_two_week_low']} - {q['fifty_two_week_high']}")
    print(f"  as of           {q['time']}")
    return 0


def cmd_eq_stats(args) -> int:
    hist = equity.history(args.symbol, range_=args.range)
    _print_summary(f"{hist.attrs.get('meta', {}).get('symbol', args.symbol)} ({args.range})", hist)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="market-lab", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="domain", required=True)

    m = sub.add_parser("mf", help="mutual funds").add_subparsers(dest="action", required=True)

    s = m.add_parser("search", help="find schemes by name")
    s.add_argument("query")
    s.add_argument("--direct", action="store_true", help="direct plans only")
    s.add_argument("--growth", action="store_true", help="growth option only")
    s.add_argument("--limit", type=int, default=25)
    s.set_defaults(func=cmd_mf_search)

    s = m.add_parser("stats", help="risk/return profile for a scheme code")
    s.add_argument("code", type=int)
    s.set_defaults(func=cmd_mf_stats)

    s = m.add_parser("compare", help="compare several scheme codes")
    s.add_argument("codes", type=int, nargs="+")
    s.add_argument("--benchmark", help="e.g. nifty50")
    s.set_defaults(func=cmd_mf_compare)

    e = sub.add_parser("eq", help="equities and indices").add_subparsers(dest="action", required=True)

    s = e.add_parser("quote", help="latest delayed quote")
    s.add_argument("symbol")
    s.set_defaults(func=cmd_eq_quote)

    s = e.add_parser("stats", help="risk/return profile for a symbol")
    s.add_argument("symbol")
    s.add_argument("--range", default="5y", help="1y, 5y, 10y, max")
    s.set_defaults(func=cmd_eq_stats)

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "?"
        if code == 404:
            print("error: symbol or scheme not found upstream.", file=sys.stderr)
        elif code == 429:
            print("error: rate limited by the data source. Wait a bit and retry.", file=sys.stderr)
        else:
            print(f"error: data source returned HTTP {code}.", file=sys.stderr)
        return 1
    except requests.RequestException:
        print("error: could not reach the data source. Check your connection.", file=sys.stderr)
        return 1
    except (ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
