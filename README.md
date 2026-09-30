# Hikes Map

Every hike I've recorded in Strava, on one map, behind my own login.

Live: https://hikes.cassjoachim.com (sign-in required, and new sign-ups are off)

I built it with [Claude Code](https://claude.com/claude-code).

## Stack

- **Supabase Auth** for email and password sign-in
- **Postgres with PostGIS** to store the routes
- **Row level security** so each user can read only their own rows
- **The Supabase Data API**, called from the browser with `supabase-js`
- **Leaflet** with OpenStreetMap tiles to draw the map
- **Netlify** to host it

It's plain HTML, CSS and JavaScript with no build step. Everything that goes live is in `site/`.

## How the data is protected

- The Supabase **publishable key** in `site/config.js` is public by design. It only identifies the project; it doesn't grant access on its own.
- **Row level security** limits reads to the owner of the hikes. Without signing in, the API returns nothing.
- **Sign-ups are disabled**, so nobody else can create an account.

## What I noticed building it

- Supabase prompted me to enable row level security when I created the table.
- The dashboard CSV import stalled at 14% with no error, and the table showed as empty even though 20 rows had loaded.
- New-user sign-up was on by default in Supabase Auth.
- Netlify applied a team-wide login requirement to the new site.

## Run it locally

```sh
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000.

## License

MIT. See [LICENSE](LICENSE).
