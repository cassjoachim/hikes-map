# Hikes Map

A small static web page. You sign in with email and password, and it draws all of your hikes on a map.

## How to work with me

- I'm a product manager learning Claude Code. Explain choices in plain language.
- Show me a plan and wait for my OK before writing or changing files.

## Stack

- Plain HTML, CSS and JavaScript. No build step, no npm, no frameworks, no bundler.
- Load libraries from a CDN with `<script>`/`<link>` tags, pinned to exact versions (no `@latest`, no bare `@2`):
  - Supabase JS client v2 (sign-in and data)
  - Leaflet 1.9.x (map), with OpenStreetMap tiles
- The map must show the OpenStreetMap attribution ("© OpenStreetMap contributors"). Their tile usage policy requires it.

## Files

Everything that goes live is in `site/`. Project files (this one, `netlify.toml`, `.gitignore`) stay at the top level and are never published.

- `site/index.html`: page structure (sign-in form, map, sign-out)
- `site/style.css`: styling
- `site/app.js`: sign-in, loading hikes, drawing the map
- `site/config.js`: Supabase project URL and publishable key. Tracked in git on purpose (see Security).
- `netlify.toml`: tells Netlify to publish only `site/`

## Features

- Routes are colored by activity type.
- A legend (top-right) shows each type's color and count, with a checkbox to show or hide that type. Toggling doesn't re-zoom the map.
- Clicking a route opens a popup with the name, activity, date, distance in miles and km, and elevation gain in feet.

## Supabase

- Project URL: `https://lnkttywvyqhgvnpcoasn.supabase.co`
- Auth: email and password (`signInWithPassword`, `signOut`, and restoring the session on page load).
- Data: read from the view `hikes_map`. Read only; the app never writes.

### `hikes_map` columns (confirmed)

| Column             | Type        | Notes                         |
| ------------------ | ----------- | ----------------------------- |
| `id`               | bigint      |                               |
| `name`             | text        |                               |
| `activity_type`    | text        |                               |
| `started_at`       | timestamptz |                               |
| `distance_m`       | numeric     | meters                        |
| `elevation_gain_m` | numeric     | meters                        |
| `geojson`          | json        | route as a GeoJSON LineString |

Known `activity_type` values: `hiking`, `walking`, `trail_running`, `snowshoe`. Each has its own route color (`ACTIVITY_COLORS` in `site/app.js`); any other or missing type is drawn in gray, never dropped.

GeoJSON coordinates are `[longitude, latitude]`, while Leaflet's `L.latLng` expects latitude first. Pass the object to `L.geoJSON(...)`, which handles the order, instead of swapping coordinates by hand.

## Security (non-negotiable)

- Only the **publishable** key goes in the browser, and it lives in `config.js`. It is safe to expose because row level security only lets a signed-in user read their own hikes.
- **Never use, request or store the secret (service role) key**, not in code, config, docs or commits.
- Don't write code that tries to get around row level security. If data is missing, the likely cause is the RLS policy or the sign-in state, not something to patch in the client.

## Run locally

```sh
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000. Use a local server rather than opening `site/index.html` straight from disk (`file://`), where sign-in sessions can misbehave.

## Deploy (Netlify)

- Site: `hikes-map-cassandra`, https://hikes-map-cassandra.netlify.app
- Custom domain: https://hikes.cassjoachim.com points to this site. Use it as the public link.
- Code: public GitHub repo https://github.com/cassjoachim/hikes-map (`main`). Pushing doesn't deploy; deploys are manual with the command below.
- Deploy with the Netlify CLI from the project root: `netlify deploy --prod --dir site`
- Node and the Netlify CLI live in `~/.local/node` (not on the shell PATH), so run commands with `PATH="$HOME/.local/node/bin:$PATH"`.
- Visitor access protection is **off** for this site (the team default is Netlify login required), so the page is public. The Supabase sign-in and row level security protect the data.
- New sign-ups are **disabled** in Supabase Auth, so only existing accounts can sign in. Don't add a sign-up form.
- Netlify injects a comment and a `/.netlify/scripts/hud` script into the served `index.html`. That's expected, not a change to our code.
- This folder is linked to the Hikes Map site only (`.netlify/state.json`, not in git). **Never link, deploy to or change `inspiring-dusk-e93872`**, which serves cassjoachim.com.
