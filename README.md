# Ark's Vibes & Vittles

Adam's recipe site: https://adamjboyce.github.io/recipe-box/

## How it fits together

- **Supabase** (`ircylcyyykabotzwgtxa`) holds everything: recipes, private details (where and why each was made, source chats, markers), the cook and change log, friends' notes, ratings, photos and recipe submissions, and Adam's login.
- **This repo** is the static site on GitHub Pages: `index.html`, `style.css`, `app.js`, `config.js` and `admin.js` (the admin panel, loaded only on `#admin`).
- The site reads recipes live from the `recipes_public` and `recipe_aliases` views. Drafts and private fields never leave the database.
- `data/recipes.json` is a saved copy of the public recipes. The site uses it only if Supabase can't be reached. A Sunday scheduled task refreshes it with `scripts/snapshot.py`.
- A nightly job on the homelab backs the whole project up to the NAS. That setup lives on the homelab, not here.

## Editing

- **Adam:** sign in at `#admin` with the Supabase Auth account listed in `rb_admins`.
- **Claude sessions:** use `scripts/rb.py` with an agent key.
  1. `python3 scripts/rb.py key-new` makes a key on the machine and prints a fingerprint.
  2. Adam pastes the fingerprint into **Admin → Agent keys**.
  3. Then use `rb list`, `rb get ID`, `rb save FILE --why "..."`, `rb log ID "note" --rating 5`, `rb draft ID on|off`, `rb rename OLD NEW` and `rb export DIR`. Run `rb -h` for the rest.

  The key never leaves the machine that made it. Revoke it in the admin panel.

## Database

- `scripts/supabase-v2.sql`: tables, public views and the `rb_*` API. Every write goes through these functions, and each one checks for an admin login or a valid agent key.
- Earlier setup files: `scripts/friend-recipes.sql` and `scripts/note-moderation.sql`.
- `scripts/migrate_box.py` did the one-time move from the old claude.ai recipe box. It renamed event-named ids, and the old ids still work as aliases.

## Recipe conventions

- Weights in grams, with counts for whole items. Campsite recipes are volume-first.
- Every ingredient gets a starting amount.
- Salt at about 1.75% of the dish (1.25% for brothy soups). MSG at about 0.3% in savory dishes.
- One dish per recipe. Components worth making get their own recipe, linked as `[label](id)`.
- Store-bought options are named for mixes and condiments.
- Titles name the dish only.
- No em dashes and no Oxford commas.
