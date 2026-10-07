# Hikes Map

A small static web page. You sign in with email and password, and it draws all of your hikes on a map.

## How to work with me

- I'm a product manager learning Claude Code. Explain choices in plain language.
- Show me a plan and wait for my OK before writing or changing files.

## Stack

- Plain HTML, CSS and JavaScript. No build step, no npm, no frameworks, no bundler.
- Load libraries from a CDN with `<script>`/`<link>` tags, pinned to exact versions (no `@latest`, no bare `@2`):
  - Supabase JS client v2 (sign-in and data)
- Google Maps JavaScript API (map), loaded by Google's own loader in `site/maps-loader.js` on the `quarterly` channel. This is the one exception to exact version pins: Google retires numbered versions, and `quarterly` is their stable channel.
- Keep Google's logo, attribution and Terms links visible on the map. Their terms require it.
- Font: Karla from Google Fonts (same sans-serif as cassjoachim.com), with system fonts as fallback.
- The page and app are titled "Travel Map" (tab, top bar, sign-in card). The repo and Netlify site keep the name hikes-map.

## Files

Everything that goes live is in `site/`. Project files (this one, `netlify.toml`, `.gitignore`) stay at the top level and are never published.

- `site/index.html`: page structure (sign-in form, map, sign-out)
- `site/style.css`: styling
- `site/app.js`: sign-in, loading hikes, drawing the map, Style menu
- `site/favicon.svg`: browser tab icon
- `site/maps-loader.js`: Google's loader for the Maps JavaScript API (copied from Google's docs)
- `site/config.js`: Supabase URL and publishable key, Google Maps browser key, and the list of map styles. Tracked in git on purpose (see Security).
- `netlify.toml`: tells Netlify to publish only `site/`

## Features

- Routes are colored by activity type.
- A legend (top-right) shows each type's color and count, with a checkbox to show or hide that type. Toggling doesn't re-zoom the map.
- Clicking a route opens a popup with the name, activity, date, distance in miles and km, and elevation gain in feet.
- Hikes with `show_on_map = false` are left off the map and out of the legend counts. This is filtering in the browser only, to keep the map tidy; it is not a privacy feature.
- Owner-only editing: if a hike's `user_id` is the signed-in user, its popup also has a "Show on map" checkbox, a notes box and a Save button (saved with supabase-js to the `hikes` table). Everyone else sees the notes as read-only text and no controls. The owner check only decides what to show; the RLS update policy is what enforces it. RLS blocks a write by changing zero rows without an error, so `saveHike` treats an empty result as a failure.
- Owner-only "Hidden hikes (n)" checkbox in the legend draws hidden hikes as faded dashed gray lines so they can be found and un-hidden. Unticked by default.
- A Style menu in the top bar switches between "Google default" and the styles listed in `mapStyles` in `config.js` (each is a name plus a Google Map ID). The choice is remembered in the browser. A Map ID can only be set when a map is created, so switching styles rebuilds the map and moves the routes onto it.
- Google's Map / Satellite switch (with Terrain) is in the top-left.
- Signed out, the sign-in card ("Travel Map", "Please sign in") floats over the real map, which is locked (`inert`, no clicks or keyboard) with Google's buttons hidden. Only the map imagery is blurred, via CSS on Google's first layer inside `.gm-style`, so Google's logo and attribution stay sharp on top (Google's terms require them visible). If that layer isn't found, `checkBlurTarget` switches to a fallback that frosts the screen except a 32px strip at the bottom. The map shows only Google's base map in the last-chosen style, never hikes. On sign-out the routes are removed and the map resets to the world view.
- Favicon: `site/favicon.svg`, the same CJ icon as cassjoachim.com. Replace that file to change it.

## Map styles (Google Cloud)

- Styles are designed in Google Cloud: Google Maps Platform > Map Styles. Each style is attached to a Map ID (Map Management > Create Map ID, type JavaScript).
- To add one to the menu, add `{ name: "...", mapId: "..." }` to `mapStyles` in `config.js`.

## Supabase

- Project URL: `https://lnkttywvyqhgvnpcoasn.supabase.co`
- Auth: email and password (`signInWithPassword`, `signOut`, and restoring the session on page load).
- Data: read from the view `hikes_map` (`security_invoker = true`). The only writes are the owner editing `show_on_map` and `notes` on the `hikes` table; an RLS policy lets only the owner update their own hikes.

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
| `show_on_map`      | boolean     | false = hidden from the map   |
| `notes`            | text        | owner's notes, may be null    |
| `user_id`          | uuid        | owner; compared to the signed-in user |

Known `activity_type` values: `hiking`, `walking`, `trail_running`, `snowshoe`. Each has its own route color (`ACTIVITY_COLORS` in `site/app.js`); any other or missing type is drawn in gray, never dropped.

GeoJSON coordinates are `[longitude, latitude]`, while Google Maps wants `{ lat, lng }`. `loadAndDrawHikes` converts them when it builds each route line.

## Security (non-negotiable)

- Only the **publishable** key goes in the browser, and it lives in `config.js`. It is safe to expose because row level security only lets a signed-in user read their own hikes.
- **Never use, request or store the secret (service role) key**, not in code, config, docs or commits.
- The Google Maps key in `config.js` is a **browser key** and public by design. It's protected in Google Cloud by a website restriction (hikes.cassjoachim.com, hikes-map-cassandra.netlify.app, localhost:8000) and an API restriction. Don't add server-side Google APIs to this key; those need a separate key kept out of the browser (for example in a Supabase Edge Function secret).
- Google billing has a $5 monthly budget alert. The billing account is a free trial that ends Dec 18, 2026; upgrade it before then or the map stops loading.
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
