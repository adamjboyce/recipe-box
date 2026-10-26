#!/usr/bin/env python3
"""rb: command-line access to Ark's Vibes & Vittles in Supabase (for Claude sessions and scripts).

Auth is an agent key. `rb key-new` makes one locally and prints only its sha256 fingerprint;
Adam authorizes that fingerprint in the admin panel (Agent keys) and the key works until it
expires or is revoked. The key itself never leaves this machine.

  rb key-new [--label TEXT]        make a key, save it to ~/.config/rb/key, print the fingerprint
  rb whoami                        check the key works
  rb list                          id, title, draft, rating for every recipe (drafts included)
  rb get ID                        full recipe JSON with private fields and log
  rb save FILE.json [--why TEXT]   create or update (only keys in the file change); --why logs a change
  rb log ID TEXT [--rating N] [--date YYYY-MM-DD] [--change]
  rb draft ID on|off
  rb rename OLD NEW                old id keeps working as an alias; links and friend notes follow
  rb delete ID
  rb queue                         pending friend recipes and notes
  rb export DIR                    one JSON file per recipe (full, with logs)
  rb import DIR                    load files made by migrate_box.py ({"recipe":..., "log":[...]})

Config: RB_URL / RB_ANON default to the site's config.js values; RB_KEY or ~/.config/rb/key holds the key.
"""
import argparse, hashlib, json, os, pathlib, re, secrets, sys, urllib.error, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
KEYFILE = pathlib.Path(os.environ.get("RB_KEYFILE", pathlib.Path.home() / ".config" / "rb" / "key"))


def site_config():
    cfg = (HERE.parent / "config.js").read_text()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1)
    anon = re.search(r'supabaseKey:\s*"([^"]+)"', cfg).group(1)
    return os.environ.get("RB_URL", url).rstrip("/"), os.environ.get("RB_ANON", anon)


def key():
    k = os.environ.get("RB_KEY") or (KEYFILE.read_text().strip() if KEYFILE.exists() else "")
    if not k:
        sys.exit("no agent key: run `rb key-new` and have Adam authorize the fingerprint")
    return k


def rpc(fn, **args):
    url, anon = site_config()
    args.setdefault("p_token", key())
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
                                 headers={"apikey": anon, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:400]
        sys.exit(f"{fn} failed ({e.code}): {msg}")


def cmd_key_new(a):
    KEYFILE.parent.mkdir(parents=True, exist_ok=True)
    k = "rbk_" + secrets.token_urlsafe(36)
    KEYFILE.write_text(k + "\n")
    os.chmod(KEYFILE, 0o600)
    fp = hashlib.sha256(k.encode()).hexdigest()
    print(f"Key saved to {KEYFILE}. Fingerprint for Adam to authorize (label: {a.label}):\n{fp}")


def cmd_whoami(a):
    rows = rpc("rb_list")
    print(f"ok: key works, {len(rows)} recipes visible")


def cmd_list(a):
    for r in rpc("rb_list"):
        print(f"{r['id']:<44} {'DRAFT ' if r['draft'] else '      '}{'★' * (r['rating'] or 0):<5} {r['title']}")


def cmd_get(a):
    print(json.dumps(rpc("rb_get", p_id=a.id), ensure_ascii=False, indent=1))


def cmd_save(a):
    rec = json.loads(pathlib.Path(a.file).read_text())
    out = rpc("rb_save", p_recipe=rec, p_why=a.why)
    print(f"saved {out['id']}")


def cmd_log(a):
    rpc("rb_log", p_id=a.id, p_note=a.text, p_kind="change" if a.change else "cook", p_date=a.date, p_rating=a.rating)
    print("logged")


def cmd_draft(a):
    rpc("rb_save", p_recipe={"id": a.id, "draft": a.state == "on"})
    print(f"{a.id}: {'unfinished, hidden from the site' if a.state == 'on' else 'finished, on the site'}")


def cmd_rename(a):
    rpc("rb_rename", p_old=a.old, p_new=a.new)
    print(f"renamed {a.old} -> {a.new}")


def cmd_delete(a):
    rpc("rb_delete", p_id=a.id)
    print(f"deleted {a.id}")


def cmd_queue(a):
    print(json.dumps(rpc("rb_queue"), ensure_ascii=False, indent=1))


def cmd_export(a):
    d = pathlib.Path(a.dir); d.mkdir(parents=True, exist_ok=True)
    rows = rpc("rb_list")
    for r in rows:
        full = rpc("rb_get", p_id=r["id"])
        (d / f"{r['id']}.json").write_text(json.dumps(full, ensure_ascii=False, indent=1))
    print(f"exported {len(rows)} recipes to {d}")


def cmd_import(a):
    files = sorted(pathlib.Path(a.dir).glob("*.json"))
    n = logs = 0
    for f in files:
        doc = json.loads(f.read_text())
        rpc("rb_save", p_recipe=doc["recipe"])
        if doc.get("log"):
            existing = rpc("rb_get", p_id=doc["recipe"]["id"]).get("log") or []
            if not existing:
                logs += rpc("rb_log_import", p_id=doc["recipe"]["id"], p_entries=doc["log"]) or 0
        n += 1
        print(f"  {doc['recipe']['id']}", file=sys.stderr)
    print(f"imported {n} recipes, {logs} log entries")


def main():
    ap = argparse.ArgumentParser(prog="rb", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("key-new"); p.add_argument("--label", default="Claude session"); p.set_defaults(f=cmd_key_new)
    sp.add_parser("whoami").set_defaults(f=cmd_whoami)
    sp.add_parser("list").set_defaults(f=cmd_list)
    p = sp.add_parser("get"); p.add_argument("id"); p.set_defaults(f=cmd_get)
    p = sp.add_parser("save"); p.add_argument("file"); p.add_argument("--why"); p.set_defaults(f=cmd_save)
    p = sp.add_parser("log"); p.add_argument("id"); p.add_argument("text"); p.add_argument("--rating", type=int)
    p.add_argument("--date"); p.add_argument("--change", action="store_true"); p.set_defaults(f=cmd_log)
    p = sp.add_parser("draft"); p.add_argument("id"); p.add_argument("state", choices=["on", "off"]); p.set_defaults(f=cmd_draft)
    p = sp.add_parser("rename"); p.add_argument("old"); p.add_argument("new"); p.set_defaults(f=cmd_rename)
    p = sp.add_parser("delete"); p.add_argument("id"); p.set_defaults(f=cmd_delete)
    sp.add_parser("queue").set_defaults(f=cmd_queue)
    p = sp.add_parser("export"); p.add_argument("dir"); p.set_defaults(f=cmd_export)
    p = sp.add_parser("import"); p.add_argument("dir"); p.set_defaults(f=cmd_import)
    a = ap.parse_args(); a.f(a)


if __name__ == "__main__":
    main()
