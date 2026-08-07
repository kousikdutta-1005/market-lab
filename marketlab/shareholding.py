"""Named shareholders from NSE's quarterly shareholding-pattern XBRL.

WHY THIS FILE EXISTS
The SAST feed says who *crossed a threshold*. It cannot say what anyone actually owns, so
an investor sitting on a long-held 3% stake is invisible there. The quarterly shareholding
pattern is the opposite: every company files a full XBRL listing its promoters and every
public shareholder above 1%, by name, with exact holdings. Pivoted by name, that is a real
portfolio — the dataset behind every "superstar investor" page.

It is public and free. The only reason it is not widely used is that it takes work:
one filing per company per quarter, each around half a megabyte of XBRL.

READING THE XBRL
Facts are tied together by context id, and a shareholder's identity and holdings live in
two *different* contexts that differ only by a `D_` prefix:

    <NameOfTheShareholder contextRef="D_IndividualsOrHUF_Context15">Mukesh D Ambani
    <NumberOfShares       contextRef="IndividualsOrHUF_Context15">16104040
    <ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="IndividualsOrHUF_Context15">0.0012

So the join key is the group + index suffix, not the raw context string.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE_DIR = DATA / "shareholding"
HOLDERS = DATA / "shareholders.pkl"
# The committed, durable copy of the same table.
#
# The per-company pickles under data/shareholding/ are a fetch cache: 15MB of a
# version-fragile format that has no business in git. But they cannot simply be thrown
# away either — a cold CI runner would crawl 150 companies per run against a universe of
# 1,600 and take a fortnight to populate the Investors page, and actions/cache is evicted
# after seven days of no access, so it might never converge at all. The first CI run
# proved it: 84 filers and zero portfolios.
#
# Parquet is the right middle ground: one file, 1.1MB, columnar, stable across pandas
# versions, and a lossless round-trip of the same frame.
HOLDERS_PARQUET = DATA / "shareholders.parquet"
MISSES = DATA / "shareholding_misses.json"

# How long to leave a symbol alone after it returned nothing. Most misses are companies
# that have never filed in this format, so a week is generous; a genuine outage recovers
# on the next weekly attempt without anyone intervening.
MISS_BACKOFF_DAYS = 7

MASTER_URL = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol={sym}"
HOME = "https://www.nseindia.com"
REFERER = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": REFERER,
}

# NSE throttles aggressively. This is a background enrichment, not a blocking path, so it
# is better to crawl politely over many runs than to get the IP blocked once.
PAUSE_S = 0.6

NAME_RE = re.compile(r'<in-bse-shp:NameOfTheShareholder\s+contextRef="D_([^"]+)"[^>]*>([^<]+)<')
FACT_RE = re.compile(r'<in-bse-shp:(NumberOfShares|ShareholdingAsAPercentageOfTotalNumberOfShares)\s+contextRef="([^"]+)"[^>]*>([^<]+)<')

# Contexts are named after the shareholder category, which is how promoters are told apart
# from public holders without a separate lookup.
PROMOTER_HINTS = ("IndividualsOrHUF", "BodiesCorporate", "OthersIndianShareholders", "Promoter", "Foreign")
PUBLIC_HINTS = ("Public", "Institution", "MutualFund", "ForeignPortfolio", "Individual")


def _session() -> requests.Session:
    s = requests.Session()
    s.get(HOME, headers=HEADERS, timeout=15)
    s.get(REFERER, headers=HEADERS, timeout=15)
    return s


# Companies file the same institution under wildly different spellings: "LIFE INSURANCE
# CORPORATION OF INDIA", "Life Insurance Corporation Of India" and "Life Insurance
# Corporation of India" are one holder split three ways, which understates its reach by a
# factor of three. Normalising is what turns rows into portfolios.
_SUFFIXES = re.compile(
    r"\b(limited|ltd|private|pvt|company|co|corporation|corp|incorporated|inc|"
    r"llp|plc|the)\b\.?",
    re.I,
)
_PUNCT = re.compile(r"[^a-z0-9& ]+")

# The XBRL also carries category rows — regulatory buckets, not shareholders. Left in,
# "Qualified Institutional Buyer" looks like an investor holding nine companies, which is
# both meaningless and would outrank the real names people came to find.
_NOT_A_HOLDER = re.compile(
    r"^(qualified institutional buyer|association of persons|escrow account|custodian|"
    r"office bearers|fdi.?nri.*|clearing member|bodies corporate|non.?resident indian|"
    r"any other.*|others?|public|resident individual.*|trusts?|huf|nbfc.*|"
    r"foreign (national|company|portfolio investor)|overseas corporate bod(y|ies).*|"
    r"investor education and protection fund.*|unclaimed.*|ipo escrow.*)$",
    re.I,
)


def is_real_holder(name: str) -> bool:
    """Whether a parsed name is an actual shareholder rather than a category label."""
    n = re.sub(r"\s+", " ", html.unescape(str(name or ""))).strip()
    return bool(n) and not _NOT_A_HOLDER.match(n)


def canonical_name(name: str) -> str:
    """Collapse spelling variants of the same holder onto one key."""
    n = html.unescape(str(name or ""))
    n = n.lower().strip()
    n = _PUNCT.sub(" ", n)
    n = _SUFFIXES.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def display_name(name: str) -> str:
    """Human-facing form: entities decoded, spacing tidied, ALL-CAPS title-cased."""
    n = re.sub(r"\s+", " ", html.unescape(str(name or ""))).strip()
    return n.title() if n.isupper() else n


# The filing states each holder's regulatory category in its context name, which is far
# more reliable than inferring from spelling. Only the generic PAC_Public rows — where the
# named individuals and one-off entities live — need a name-based fallback.
_GROUP_CATEGORY = [
    ("MutualFund", "mutual_fund"),
    ("AlternativeInvestmentFund", "aif"),
    ("ForeignPortfolio", "fii"),
    ("ForeignInstitutional", "fii"),
    ("OverseasDepositories", "fii"),
    ("ForeignVentureCapital", "fii"),
    ("InsuranceCompanies", "dii"),
    ("ProvidentFundsOrPensionFunds", "dii"),
    ("IndianFinancialInstitutionsOrBanks", "dii"),
    ("SovereignWealthFunds", "dii"),
    ("NBFCs", "dii"),
    ("AssetReconstruction", "dii"),
    ("OtherInstitutionsDomestic", "dii"),
    ("SharesHeldByBanks", "dii"),
    ("OtherFinancialInstitutions", "dii"),
    ("CentralGovernment", "government"),
    ("StateGovernment", "government"),
    ("PresidentOfIndia", "government"),
    ("NonResidentIndian", "individual"),
    ("ResidentIndividual", "individual"),
    ("DirectorsAndDirectorsRelatives", "individual"),
    ("KeyManagerialPersonnel", "individual"),
    ("EmployeeBenefitsTrusts", "trust"),
]

_FII_NAME = re.compile(r"\b(fpi|foreign|mauritius|singapore|luxembourg|ireland|cayman|"
                       r"offshore|global|international|pte|plc|inc|llc|sa|nv|gmbh)\b", re.I)
_MF_NAME = re.compile(r"(\bmutual fund\b|\bamc\b|asset management|\betf\b|\bnifty\b|"
                      r"\bsensex\b|\bfund\b|flexi ?cap|blue ?chip|advantage|opportunit)", re.I)
_DII_NAME = re.compile(r"\b(insurance|bank|pension|provident|financial services|nbfc)\b", re.I)
_CORPORATE = re.compile(r"\b(limited|ltd|llp|private|pvt|corporation|holdings|enterprises|"
                        r"capital|securities|investments?|trust|foundation|ventures?)\b", re.I)


def classify(group: str, name: str) -> str:
    """Regulatory category first, name only where the filing is generic."""
    g = str(group or "")
    for token, cat in _GROUP_CATEGORY:
        if token.lower() in g.lower():
            return cat
    n = str(name or "")
    if _MF_NAME.search(n):
        return "mutual_fund"
    if _FII_NAME.search(n):
        return "fii"
    if _DII_NAME.search(n):
        return "dii"
    if _CORPORATE.search(n):
        return "corporate"
    # Two or three plain words with no corporate marker is a person.
    return "individual" if 1 < len(n.split()) <= 4 else "other"


def parse_xbrl(text: str) -> pd.DataFrame:
    """Extract every named shareholder with their holding from one filing."""
    facts: dict[str, dict[str, str]] = {}
    for tag, ctx, val in FACT_RE.findall(text):
        facts.setdefault(ctx, {})[tag] = val

    rows = []
    for ctx, name in NAME_RE.findall(text):
        f = facts.get(ctx, {})
        shares = f.get("NumberOfShares")
        pct = f.get("ShareholdingAsAPercentageOfTotalNumberOfShares")
        if shares is None and pct is None:
            continue
        name = display_name(name)
        if not name or name.startswith("*") or not is_real_holder(name):
            continue
        group = ctx.split("_Context")[0]
        rows.append(
            {
                "holder": name,
                "holder_key": canonical_name(name),
                "group": group,
                "shares": pd.to_numeric(shares, errors="coerce"),
                "pct_raw": pd.to_numeric(pct, errors="coerce"),
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    # The percentage field is sometimes a fraction (0.0012) and sometimes already a
    # percent (0.12). Infer from the total rather than assuming, because guessing wrong
    # silently shifts every holding by two orders of magnitude.
    total = df["pct_raw"].sum(skipna=True)
    df["pct"] = df["pct_raw"] * (100.0 if total <= 1.5 else 1.0)
    df["is_promoter"] = df["group"].str.contains("|".join(PROMOTER_HINTS), case=False, regex=True)
    df["category"] = [classify(g, n) for g, n in zip(df["group"], df["holder"])]
    return df.drop(columns=["pct_raw"])


def fetch_symbol(symbol: str, session: requests.Session | None = None, timeout: int = 30) -> pd.DataFrame:
    """Latest shareholding filing for one symbol, cached by filing id."""
    s = session or _session()
    try:
        payload = s.get(MASTER_URL.format(sym=symbol), headers=HEADERS, timeout=timeout).json()
    except Exception:
        return pd.DataFrame()
    rows = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not rows:
        return pd.DataFrame()

    latest = rows[0]
    xbrl = latest.get("xbrl")
    if not xbrl:
        return pd.DataFrame()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"{symbol}_{latest.get('recordId', 'x')}.pkl"
    if cache.exists():
        return pd.read_pickle(cache)

    try:
        text = s.get(xbrl, headers=HEADERS, timeout=timeout).text
    except Exception:
        return pd.DataFrame()

    df = parse_xbrl(text)
    if df.empty:
        return df
    df["symbol"] = symbol.upper()
    df["as_of"] = latest.get("date")
    df.to_pickle(cache)
    return df


def _load_misses() -> dict[str, str]:
    """Symbols that returned nothing, and the day we last tried."""
    if not MISSES.exists():
        return {}
    try:
        return {str(k): str(v) for k, v in json.loads(MISSES.read_text()).items()}
    except Exception:
        return {}


def _save_misses(misses: dict[str, str]) -> None:
    MISSES.parent.mkdir(parents=True, exist_ok=True)
    MISSES.write_text(json.dumps(misses, sort_keys=True))


def _recently_missed(last: str | None) -> bool:
    if not last:
        return False
    try:
        when = dt.date.fromisoformat(last)
    except ValueError:
        return False
    return (dt.date.today() - when).days < MISS_BACKOFF_DAYS


def refresh(
    symbols,
    limit: int | None = None,
    on_log=print,
    budget_s: float | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Crawl shareholding filings, resuming from cache.

    Deliberately incremental: `limit` caps how many *new* filings one run fetches, so a
    daily job fills the universe in over a week without ever hammering NSE.

    Two guards keep a slow source from becoming a slow refresh. `budget_s` stops the crawl
    on wall clock, because this is enrichment and nothing downstream waits on it. And a
    symbol that returns nothing is remembered, because a company that has simply never
    filed will fail identically on every run — retrying it several times a day, forever,
    is pure waste against a source that rate-limits.
    """
    session = _session()
    frames: list[pd.DataFrame] = []
    fetched = failed = cached = skipped = 0
    started = time.monotonic()
    misses = _load_misses()
    today = dt.date.today().isoformat()
    out_of_time = False

    for sym in symbols:
        sym = str(sym).upper()
        existing = sorted(CACHE_DIR.glob(f"{sym}_*.pkl")) if CACHE_DIR.exists() else []
        if existing:
            try:
                frames.append(pd.read_pickle(existing[-1]))
                cached += 1
                continue
            except Exception:
                pass
        if limit is not None and fetched >= limit:
            continue
        if _recently_missed(misses.get(sym)):
            skipped += 1
            continue
        if budget_s is not None and time.monotonic() - started > budget_s:
            out_of_time = True
            continue
        df = fetch_symbol(sym, session)
        if df.empty:
            failed += 1
            misses[sym] = today
        else:
            frames.append(df)
            fetched += 1
            misses.pop(sym, None)
        time.sleep(PAUSE_S)

    _save_misses(misses)
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not combined.empty:
        _write_store(combined)
    detail = f"shareholding: {cached} cached, {fetched} fetched, {failed} unavailable"
    if skipped:
        detail += f", {skipped} backed off"
    if out_of_time:
        detail += f", stopped at {budget_s:.0f}s budget"
    on_log(detail)
    return combined, {
        "shp_status": "ok" if len(combined) else "empty",
        "shp_symbols": int(combined["symbol"].nunique()) if not combined.empty else 0,
        "shp_holders": int(len(combined)),
        "shp_fetched": fetched,
        "shp_updated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def rebuild_store(on_log=print) -> pd.DataFrame:
    """Rebuild the consolidated store from every cached filing.

    refresh() writes the store from whatever it processed in that call, which is correct
    for a single pass over the universe but wrong when it is called in batches: each batch
    replaced the previous one, so a chunked full crawl left 1,596 cached filings behind a
    store containing only the last chunk. Reading the cache directory is authoritative.
    """
    if not CACHE_DIR.exists():
        return pd.DataFrame()
    frames = []
    for f in sorted(CACHE_DIR.glob("*.pkl")):
        try:
            frames.append(pd.read_pickle(f))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    _write_store(df)
    on_log(f"shareholding store: {df['symbol'].nunique()} companies, {len(df)} holder rows")
    return df


def _write_store(df: pd.DataFrame) -> None:
    """Write both copies: the local pickle and the committed parquet."""
    HOLDERS.parent.mkdir(parents=True, exist_ok=True)
    df.to_pickle(HOLDERS)
    try:
        df.to_parquet(HOLDERS_PARQUET, index=False, compression="zstd")
    except Exception as e:
        # Not fatal — the pickle still exists and the run can finish. But this file is
        # what a cold CI runner loads, so failing quietly here would mean the Investors
        # page silently emptying out in production. Say so.
        print(f"warning: could not write {HOLDERS_PARQUET.name}: {type(e).__name__}: {e}")


def load() -> pd.DataFrame:
    """Consolidated holders.

    Prefers whichever copy covers the most companies. On a developer machine that is
    usually the local pickle or the fetch cache; on a fresh CI runner, where the cache
    starts empty, it is the committed parquet — which is the whole reason that file
    exists.
    """
    cached_files = len(list(CACHE_DIR.glob("*.pkl"))) if CACHE_DIR.exists() else 0

    best = pd.DataFrame()
    for path, reader in ((HOLDERS, pd.read_pickle), (HOLDERS_PARQUET, pd.read_parquet)):
        if not path.exists():
            continue
        try:
            df = reader(path)
        except Exception:
            continue
        if not df.empty and df["symbol"].nunique() > best_coverage(best):
            best = df

    # A store covering far fewer companies than the fetch cache holds was written by a
    # partial pass, so the cache is the more complete source.
    if best_coverage(best) >= cached_files * 0.9 and not best.empty:
        return best
    rebuilt = rebuild_store(on_log=lambda *_: None)
    return rebuilt if best_coverage(rebuilt) >= best_coverage(best) else best


def best_coverage(df: pd.DataFrame) -> int:
    return 0 if df is None or df.empty else int(df["symbol"].nunique())
