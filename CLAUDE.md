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

- `index.html`: page structure (sign-in form, map, sign-out)
- `style.css`: styling
- `app.js`: sign-in, loading hikes, drawing the map
- `config.js`: Supabase project URL and publishable key. Tracked in git on purpose (see Security).

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

Known `activity_type` values: `hiking`, `walking`, `trail_running`, `snowshoe`. Each has its own route color (`ACTIVITY_COLORS` in `app.js`); any other or missing type is drawn in gray, never dropped.

GeoJSON coordinates are `[longitude, latitude]`, while Leaflet's `L.latLng` expects latitude first. Pass the object to `L.geoJSON(...)`, which handles the order, instead of swapping coordinates by hand.

## Security (non-negotiable)

- Only the **publishable** key goes in the browser, and it lives in `config.js`. It is safe to expose because row level security only lets a signed-in user read their own hikes.
- **Never use, request or store the secret (service role) key**, not in code, config, docs or commits.
- Don't write code that tries to get around row level security. If data is missing, the likely cause is the RLS policy or the sign-in state, not something to patch in the client.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. Use a local server rather than opening `index.html` straight from disk (`file://`), where sign-in sessions can misbehave.
