#!/usr/bin/env python3
"""Save a copy of the public recipes to data/recipes.json.

The site reads recipes live from Supabase. This copy is only what it falls back to if Supabase
can't be reached, so it holds exactly what the public already sees: no drafts, no private fields.

  python3 scripts/snapshot.py
"""
import datetime, json, pathlib, re, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
cfg = (ROOT / "config.js").read_text()
URL = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1).rstrip("/")
KEY = re.search(r'supabaseKey:\s*"([^"]+)"', cfg).group(1)


def get(path):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={"apikey": KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


recipes = get("recipes_public?select=*&order=title")
aliases = {a["alias"]: a["id"] for a in get("recipe_aliases?select=alias,id")}
if len(recipes) < 10:
    raise SystemExit(f"only {len(recipes)} recipes came back; not overwriting the saved copy")
out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "recipes": recipes, "aliases": aliases}
(ROOT / "data").mkdir(exist_ok=True)
(ROOT / "data" / "recipes.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(f"saved {len(recipes)} recipes, {len(aliases)} aliases")
