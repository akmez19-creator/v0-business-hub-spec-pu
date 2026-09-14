#!/usr/bin/env python3
"""
Recover a rolled-back sandbox from a Vercel deployment's SOURCE tree.

This has happened three times now (25 Aug, 26 Aug, 4 Sep 2026). Each time
the sandbox filesystem came back at an older state - the last time, at the
last git commit, wiping nine days of work. The deployment still holds every
source file; this script audits and restores from it.

  # 1. list candidates (pick by CONTENT, not timestamp - see audit)
  python3 scripts/recover-from-deployment.py list

  # 2. audit one deployment against disk: identical / divergent / missing.
  #    Zero API calls beyond the tree: the tree's `uid` IS the file's sha1.
  python3 scripts/recover-from-deployment.py audit dpl_xxx

  # 3. fetch divergent+missing files into a staging dir for per-file review
  python3 scripts/recover-from-deployment.py fetch dpl_xxx /tmp/stage

  # 4. apply: copy staged files onto disk. Only files listed in --only, or
  #    everything missing plus everything divergent if --all-divergent.
  python3 scripts/recover-from-deployment.py apply /tmp/stage --missing
  python3 scripts/recover-from-deployment.py apply /tmp/stage --all-divergent

RULES LEARNED THE HARD WAY (v0_memories/user/sandbox-rollback-recovery.md):
- "present" is not "current": hash EVERY file, not just the missing ones.
- Divergence runs both ways. Before --all-divergent, read the audit's
  local-only/deploy-only line counts; a big local-only count means local is
  NEWER and must be kept or merged by hand.
- Include .json (manifest.json versions are the cheapest lineage test).
- THE SANDBOX TOKEN RULE (measured 4 Sep 2026, cost ~1 hour):
    1. VERCEL_TOKEN is injected ONLY into a shell whose command text invokes
       the `vercel` CLI. A command without the word `vercel` gets NO token.
    2. It is FRESH PER SHELL and the previous shell's token is dead: cached
       token -> 401 on /v7 files, this shell's token -> 200, same URL.
    3. ~/.local/share/com.vercel.cli/auth.json is a redacted placeholder.
  So every command that needs the API must contain a `vercel` call (prefix
  `vercel --version >/dev/null;`) and use $VERCEL_TOKEN from THAT shell.
  The "27 consecutive 403s" earlier today were shells with no token.
- Talk HTTP directly (urllib) rather than shelling to `vercel api`: the CLI
  prints a banner before the JSON and makes two extra requests per call.
"""
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PROJECT = "prj_HbNY19ANIVG3kRopqrB3XFAzAQPn"
TEAM = "team_1Mx9I79k0TmoeAGLtHyvCX13"
API = "https://api.vercel.com"
SRC_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".sql", ".md", ".mts", ".py", ".txt", ".svg", ".html"}
SKIP_PREFIX = ("node_modules/", ".next/", ".git/", ".pnpm-store/")
SKIP_FILES = {"pnpm-lock.yaml", "package-lock.json"}


def _token() -> str:
    """See THE SANDBOX TOKEN RULE in the module docstring. Only this shell's
    env var is valid; a token saved from an earlier shell returns 401."""
    t = os.environ.get("VERCEL_TOKEN")
    if t:
        return t
    raise SystemExit(
        "VERCEL_TOKEN is not set in this shell. The sandbox injects it only "
        "into commands that mention the vercel CLI - prefix the command with "
        "`vercel --version >/dev/null;` and run this script in the same shell."
    )


def api(path: str, tries: int = 4, raw: bool = False):
    """GET api.vercel.com with the sandbox token. Returns text (or bytes if raw)."""
    import time
    token = _token()
    sep = "&" if "?" in path else "?"
    url = f"{API}{path}{sep}teamId={TEAM}"
    last = ""
    for i in range(tries):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return body if raw else body.decode("utf-8")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code in (401, 403, 404):
                break  # not transient - do not hammer
        except Exception as e:  # network blip
            last = repr(e)
        time.sleep(2 * (i + 1))
    raise SystemExit(f"GET {path} failed: {last}")


def tree_cached(dpl: str) -> dict:
    """Fetch the tree once per deployment; later runs read it from disk."""
    cache = f"/tmp/dpl-tree-{dpl}.json"
    if os.path.exists(cache):
        return json.load(open(cache))
    T = tree(dpl)
    json.dump(T, open(cache, "w"))
    return T


def api_json(path: str):
    s = api(path)
    i = min([x for x in (s.find("["), s.find("{")) if x >= 0] or [0])
    return json.loads(s[i:])


def list_deployments(limit=20):
    d = api_json(f"/v6/deployments?projectId={PROJECT}&limit={limit}&state=READY")
    import datetime
    for x in d.get("deployments", []):
        t = datetime.datetime.fromtimestamp(x["created"] / 1000, datetime.UTC).strftime("%d %b %H:%M UTC")
        print(f"{x['uid']}  {t}  {x.get('target') or 'preview'}")


def tree(dpl: str) -> dict:
    """repo-relative path -> {uid, size}. Strips the leading src/."""
    t = api_json(f"/v6/deployments/{dpl}/files")
    out = {}

    def walk(nodes, prefix=""):
        for n in nodes:
            q = f"{prefix}/{n['name']}" if prefix else n["name"]
            if n.get("type") == "directory":
                walk(n.get("children", []), q)
            else:
                out[q] = {"uid": n["uid"], "size": n.get("size") or 0}

    walk(t)
    return {(k[4:] if k.startswith("src/") else k): v for k, v in out.items()}


def is_source(path: str) -> bool:
    if path.startswith(SKIP_PREFIX) or os.path.basename(path) in SKIP_FILES:
        return False
    return os.path.splitext(path)[1] in SRC_EXT


def audit(dpl: str, quiet=False):
    T = tree_cached(dpl)
    ident, diverg, missing = [], [], []
    for rel, node in T.items():
        if not is_source(rel):
            continue
        if not os.path.exists(rel):
            missing.append(rel)
            continue
        with open(rel, "rb") as f:
            if hashlib.sha1(f.read()).hexdigest() == node["uid"]:
                ident.append(rel)
            else:
                diverg.append(rel)
    if not quiet:
        print(f"deployment {dpl}: {len(T)} nodes, {len(ident)+len(diverg)+len(missing)} source files")
        print(f"  identical {len(ident)}   divergent {len(diverg)}   missing {len(missing)}")
        if missing:
            print("\n=== MISSING locally ===")
            for r in sorted(missing):
                print(f"  {r}")
        if diverg:
            print("\n=== DIVERGENT (deploy size -> local size) ===")
            for r in sorted(diverg):
                print(f"  {r:70} {T[r]['size']:>7} -> {os.path.getsize(r):>7}")
    return T, ident, diverg, missing


def fetch_one(dpl: str, uid: str) -> bytes:
    """v7 returns {"data": "<base64>"}; some responses are the raw bytes.
    The caller verifies sha1(result) == uid, so a wrong decode cannot land."""
    body = api(f"/v7/deployments/{dpl}/files/{uid}", raw=True)
    try:
        d = json.loads(body)
        if isinstance(d, dict) and "data" in d:
            return base64.b64decode(d["data"])
    except Exception:
        pass
    return body


def fetch(dpl: str, stage: str):
    T, ident, diverg, missing = audit(dpl, quiet=True)
    todo = sorted(diverg + missing)
    os.makedirs(stage, exist_ok=True)
    print(f"fetching {len(todo)} files ({len(missing)} missing, {len(diverg)} divergent) into {stage}")

    def job(rel):
        b = fetch_one(dpl, T[rel]["uid"])
        if hashlib.sha1(b).hexdigest() != T[rel]["uid"]:
            return rel, f"SHA MISMATCH ({len(b)}B) - refetch"
        dst = os.path.join(stage, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(b)
        return rel, "ok"

    with ThreadPoolExecutor(max_workers=8) as ex:
        for rel, st in ex.map(job, todo):
            if st != "ok":
                print(f"  {st}  {rel}")
    manifest = {"dpl": dpl, "missing": sorted(missing), "divergent": sorted(diverg)}
    with open(os.path.join(stage, ".manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    # Per-file divergence report so the merge decision is informed.
    import difflib
    print(f"\n{'file':66} {'deploy-only':>11} {'local-only':>10}  hint")
    for rel in sorted(diverg):
        try:
            A = open(os.path.join(stage, rel), encoding="utf-8").read().splitlines()
            B = open(rel, encoding="utf-8").read().splitlines()
        except Exception:
            print(f"{rel:66} {'binary':>11}")
            continue
        d = list(difflib.unified_diff(B, A, lineterm="", n=0))
        dep_only = sum(1 for l in d if l.startswith("+") and not l.startswith("+++"))
        loc_only = sum(1 for l in d if l.startswith("-") and not l.startswith("---"))
        if loc_only > 3 * dep_only and loc_only > 40:
            hint = "LOCAL NEWER - keep/merge by hand"
        elif dep_only > 40 and loc_only > 40:
            hint = "both ways - read it"
        else:
            hint = "deploy newer"
        print(f"{rel:66} {dep_only:>11} {loc_only:>10}  {hint}")
    print(f"\nstaged. review, then: apply {stage} --missing | --all-divergent | --only a,b,c")


def apply(stage: str, mode: str, only=None):
    m = json.load(open(os.path.join(stage, ".manifest.json")))
    if mode == "--missing":
        todo = m["missing"]
    elif mode == "--all-divergent":
        todo = m["missing"] + m["divergent"]
    elif mode == "--only":
        todo = only
    else:
        raise SystemExit("mode must be --missing, --all-divergent or --only a,b,c")
    n = 0
    for rel in todo:
        src = os.path.join(stage, rel)
        if not os.path.exists(src):
            print(f"  not staged: {rel}")
            continue
        os.makedirs(os.path.dirname(rel) or ".", exist_ok=True)
        with open(src, "rb") as f, open(rel, "wb") as g:
            g.write(f.read())
        n += 1
    print(f"applied {n} files from {m['dpl']}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "list":
        list_deployments(int(a[1]) if len(a) > 1 else 20)
    elif a[0] == "audit":
        audit(a[1])
    elif a[0] == "fetch":
        fetch(a[1], a[2])
    elif a[0] == "apply":
        apply(a[1], a[2], a[3].split(",") if len(a) > 3 else None)
    else:
        print(__doc__)
