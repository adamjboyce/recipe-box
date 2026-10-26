#!/usr/bin/env python3
"""Build the public site data from an export of the private recipe box.

Usage:
  python3 scripts/build.py --export EXPORT_DIR [--assets ASSETS_DIR]

EXPORT_DIR holds one JSON file per recipe document (the box's `recipes`
collection, as saved by an ArtifactData list with out_dir), either directly
or under EXPORT_DIR/recipes/. ASSETS_DIR holds downloaded photo assets named
<asset id>.<ext>. Writes data/recipes.json and photos/ next to this script's
parent folder, and lists any photo ids it could not find.
"""
import argparse, json, os, shutil, sys, datetime, pathlib

PUBLIC = ["id", "title", "category", "cuisine", "tags", "yield", "developed",
          "groups", "steps", "notes", "rating", "keeper", "traits", "diet"]
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--assets", default=None)
    a = ap.parse_args()

    site = pathlib.Path(__file__).resolve().parent.parent
    src = pathlib.Path(a.export)
    if (src / "recipes").is_dir():
        src = src / "recipes"
    files = sorted(src.glob("*.json"))
    if not files:
        sys.exit(f"no recipe files in {src}")

    assets = {}
    if a.assets and os.path.isdir(a.assets):
        for p in pathlib.Path(a.assets).rglob("*"):
            if p.is_file() and p.suffix.lower() in IMG_EXT:
                assets[p.stem] = p

    photos_dir = site / "photos"
    photos_dir.mkdir(exist_ok=True)
    keep, missing, out = set(), [], []
    for f in files:
        doc = json.load(open(f, encoding="utf-8"))
        doc = doc.get("data", doc)  # tolerate {id, data, version} wrappers
        doc.setdefault("id", f.stem)
        r = {k: doc[k] for k in PUBLIC if k in doc}
        r["rating"] = int(r.get("rating") or 0)
        r["keeper"] = bool(r.get("keeper"))
        names = []
        for pid in doc.get("photos") or []:
            existing = next(iter(photos_dir.glob(pid + ".*")), None)
            if pid in assets:
                dest = photos_dir / (pid + assets[pid].suffix.lower())
                shutil.copyfile(assets[pid], dest)
                names.append(dest.name)
            elif existing:
                names.append(existing.name)
            else:
                missing.append(pid)
        keep.update(names)
        if names:
            r["photos"] = names
        out.append(r)

    for p in photos_dir.glob("*"):
        if p.is_file() and p.name not in keep and p.name != ".gitkeep":
            p.unlink()

    out.sort(key=lambda r: r["title"].lower())
    data = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "recipes": out}
    (site / "data").mkdir(exist_ok=True)
    with open(site / "data" / "recipes.json", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"{len(out)} recipes, {len(keep)} photos")
    if missing:
        print("MISSING PHOTOS: " + " ".join(missing))

if __name__ == "__main__":
    main()
