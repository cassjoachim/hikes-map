// Connection settings. Everything in this file is public by design.
window.HIKES_CONFIG = {
  // Supabase. The publishable key is safe in the browser: row level security
  // only lets a signed-in user read their own hikes. Never put the secret key here.
  supabaseUrl: "https://lnkttywvyqhgvnpcoasn.supabase.co",
  supabasePublishableKey: "sb_publishable_fzZgPwq0j-cSPQKxNkyRyQ_tSEvuljo",

  // Google Maps. This browser key is public too. It's protected by its
  // restrictions in Google Cloud: it only works on the sites listed there
  // (hikes.cassjoachim.com, hikes-map-cassandra.netlify.app, localhost:8000)
  // and only for the APIs selected there.
  googleMapsApiKey: "AIzaSyDwRfHmlyKXivSy4WalzE18Ri7jIDkslLw",

  // Map styles for the Style menu. Create a style in Google Cloud
  // (Google Maps Platform > Map Styles), attach it to a Map ID
  // (Map Management > Create Map ID, type JavaScript), then add a line here:
  //   { name: "Muted terrain", mapId: "abc123def456" },
  // "Google default" is always in the menu, so this list can stay empty.
  mapStyles: [
    { name: "hikes-map", mapId: "a10c3ba7316f6893b80e2f02" },
  ],
};
