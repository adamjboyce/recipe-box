# Adam's Recipe Box

The public, read-only copy of Adam's Recipe Box, served by GitHub Pages. Friends can browse every recipe, scale batches, and leave their own ratings and notes without an account.

## How it fits together

- **The private box** is a claude.ai artifact where Adam edits recipes, rates them, keeps a cook log and adds photos. Nothing here edits it.
- **This site** is rebuilt from an export of the private box: `data/recipes.json` plus `photos/`. Cook logs, source chats and internal flags stay private.
- **Friend ratings and notes** live in a Supabase table (`public.notes`). Visitors can read and add notes, but not edit or delete them. Adam moderates in the Supabase dashboard.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The site |
| `config.js` | Supabase project URL and anon key (public by design) |
| `data/recipes.json` | Generated recipe data |
| `photos/` | Generated photo copies, named by asset id |
| `scripts/build.py` | Turns an export of the box into `data/` and `photos/` |

## Sync (run weekly by a scheduled task)

1. Export the box's `recipes` collection to a folder (ArtifactData `list`, `out_dir`).
2. Download every photo asset id those recipes reference into another folder.
3. `python3 scripts/build.py --export <export folder> --assets <photo folder>`
4. Commit and push if anything changed.
