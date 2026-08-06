#!/usr/bin/env python3
"""Command-line connectivity check.

Reuses the exact probes the UI shows at /api/sources, so the terminal and the browser
can never disagree about whether a source is up.
"""

from __future__ import annotations

import sys

from server import sources


def main() -> int:
    result = sources()
    width = max(len(s["name"]) for s in result["sources"])
    failed = 0
    for s in result["sources"]:
        mark = "OK  " if s["ok"] else "FAIL"
        if not s["ok"]:
            failed += 1
        print(f"{mark} {s['name']:<{width}}  {s['detail']}  ({s['ms']} ms)")
        if s["note"]:
            print(f"     {s['note']}")
    print()
    print(f"{len(result['sources']) - failed}/{len(result['sources'])} reachable")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
