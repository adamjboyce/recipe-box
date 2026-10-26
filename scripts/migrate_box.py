#!/usr/bin/env python3
"""One-time move out of the claude.ai recipe box: box export JSON -> rb import files.

  python3 migrate_box.py EXPORT_DIR OUT_DIR

Renames ids that carried event or tag words (old ids become aliases), rewrites [label](id) links,
moves where-and-why details into `private`, keeps event tags private, turns the cook and change
log into recipe_log entries and marks unfinished recipes as drafts.
"""
import json, pathlib, re, sys

RENAME = {
    "ldw-potato-salad": "dill-pickle-potato-salad",
    "ldw-cocktail-sauce": "cocktail-sauce",
    "ldw-remoulade": "remoulade",
    "ldw-dill-pickle-jar": "dill-pickles",
    "ldw-escabeche-pickle-jar": "escabeche-pickles",
    "make-ahead-breakfast-burritos-bacon-sausage-mushroom": "breakfast-burritos",
    "camp-breakfast-burritos-cheesy-sausage": "cheesy-sausage-breakfast-burritos",
    "camp-hot-chocolate-ganache": "hot-chocolate-ganache",
    "camp-hot-chocolate-swiss-miss": "hot-chocolate-swiss-miss",
    "camp-cheesesteaks-chuck-eye": "camp-cheesesteaks",
    "growler-toasted-almond-revolver": "toasted-almond-revolver",
    "red-beans-camp": "thick-red-beans",
    "beer-battered-walleye-and-chips": "beer-battered-walleye",
    "papas-arrugadas-mojo-verde": "papas-arrugadas",
    "kofta-spice-blend-weighed": "kofta-spice-blend",
    "kofta-beef-lamb-logs": "kofta",
    "split-buttermilk-pancakes-ham-cheddar": "split-buttermilk-pancakes",
    "san-marzano-tomato-soup": "tomato-soup",
    "mild-chili-toasted-dried-chiles": "mild-chili",
    "teds-72-hour-pizza-dough": "72-hour-pizza-dough",
    "barbacoa-crockpot": "barbacoa",
}
# Tags that repeat a trait or diet, or are too vague to help; they're dropped from public tags.
REDUNDANT = {"make-ahead", "camping", "freezer", "frozen", "large-batch", "slow-cooker", "vegetarian", "vegan",
             "gluten-free", "dairy-free", "pescatarian", "quick", "crowd", "long-cook", "shelf-stable", "outdoor"}
# Tags that name an event or season we cooked for; kept privately.
def is_event(t): return "weekend" in t or t.startswith("ldw") or t in {"fall", "party"}

LINK = re.compile(r"\]\(([a-z0-9-]+)\)")
def relink(x):
    if isinstance(x, str):
        return LINK.sub(lambda m: "](" + RENAME.get(m.group(1), m.group(1)) + ")", x)
    if isinstance(x, list): return [relink(v) for v in x]
    if isinstance(x, dict): return {k: relink(v) for k, v in x.items()}
    return x


def main(src, dst):
    src, dst = pathlib.Path(src), pathlib.Path(dst)
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(src.glob("*.json")):
        d = json.loads(f.read_text())
        d = d.get("data", d)
        old = d["id"]; new = RENAME.get(old, old)
        tags = d.get("tags") or []
        flags = [x for x in (d.get("flags") or []) if x != "incomplete"]
        private = {k: v for k, v in {
            "occasion": d.get("occasion") or None,
            "source_title": d.get("source_title") or None,
            "source_url": d.get("source_url") or None,
            "flags": flags or None,
            "event_tags": [t for t in tags if is_event(t)] or None,
            "box_id": old,
        }.items() if v is not None}
        rec = {
            "id": new, "title": d["title"], "category": d.get("category") or "Mains",
            "cuisine": d.get("cuisine") or "", "yield": d.get("yield") or "",
            "tags": [t for t in tags if t not in REDUNDANT and not is_event(t)],
            "traits": d.get("traits") or [], "diet": d.get("diet") or [],
            "groups": relink(d.get("groups") or []), "steps": relink(d.get("steps") or []),
            "notes": relink(d.get("notes") or ""), "nutrition": d.get("nutrition"),
            "rating": int(d.get("rating") or 0),
            "draft": bool(d.get("draft") or "incomplete" in (d.get("flags") or [])),
            "developed": d.get("developed") or None,
            "private": private,
            "aliases": [old] if new != old else [],
        }
        log = []
        for e in d.get("log") or []:
            entry = {"kind": "change" if e.get("type") == "change" else "cook", "date": e.get("date"),
                     "note": e.get("note") or "", "rating": e.get("rating")}
            if e.get("before"):
                entry["before"] = relink(e["before"])
            log.append(entry)
        (dst / f"{new}.json").write_text(json.dumps({"recipe": rec, "log": log}, ensure_ascii=False, indent=1))
    print(f"wrote {len(list(dst.glob('*.json')))} files to {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
