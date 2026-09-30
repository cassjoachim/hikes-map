// Hikes Map: sign in with Supabase, then draw every hike route on a Leaflet map.

const { supabaseUrl, supabasePublishableKey } = window.HIKES_CONFIG;
const client = supabase.createClient(supabaseUrl, supabasePublishableKey);

// Supabase returns at most this many rows per request, so we fetch in pages.
const PAGE_SIZE = 1000;

// One color per activity type. The order here is the legend order.
const ACTIVITY_COLORS = {
  hiking: "#d9480f", // orange-red
  walking: "#7048e8", // purple
  trail_running: "#c2255c", // magenta
  snowshoe: "#0b7285", // dark teal
};
// Any other or missing activity type is drawn in gray so it never disappears.
const OTHER_COLOR = "#868e96";

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

const signinView = document.getElementById("signin-view");
const signinForm = document.getElementById("signin-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signinButton = document.getElementById("signin-button");
const signinError = document.getElementById("signin-error");
const mapView = document.getElementById("map-view");
const statusText = document.getElementById("status");
const userEmail = document.getElementById("user-email");
const signoutButton = document.getElementById("signout-button");

let map = null;
// Holds one sub-layer per activity type; unticking a type in the legend
// removes that sub-layer from here.
let routesLayer = null;
let legend = null;
// Whose hikes are on the map, so a token refresh doesn't reload them.
let shownUserId = null;

// ---------- Screens ----------

function showSignIn() {
  shownUserId = null;
  if (routesLayer) routesLayer.clearLayers();
  if (legend) legend.getContainer().replaceChildren();
  mapView.hidden = true;
  signinView.hidden = false;
  emailInput.focus();
}

function showMap(user) {
  signinView.hidden = true;
  mapView.hidden = false;
  userEmail.textContent = user.email;
  ensureMap();
  // The map was hidden, so Leaflet needs to re-measure its container.
  map.invalidateSize();

  if (shownUserId !== user.id) {
    shownUserId = user.id;
    loadAndDrawHikes();
  }
}

function ensureMap() {
  if (map) return;
  map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  routesLayer = L.featureGroup().addTo(map);

  legend = L.control({ position: "topright" });
  legend.onAdd = () => {
    const box = L.DomUtil.create("div", "legend");
    // Clicking or scrolling the legend shouldn't pan or zoom the map.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  };
  legend.addTo(map);
}

// ---------- Auth ----------

// Fires once on page load (restoring a saved session) and on every sign-in/out.
client.auth.onAuthStateChange((event, session) => {
  // Supabase advises not to call it again from inside this callback,
  // so hand off to the next tick.
  setTimeout(() => {
    if (session) showMap(session.user);
    else showSignIn();
  }, 0);
});

signinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signinError.hidden = true;
  signinButton.disabled = true;
  signinButton.textContent = "Signing in…";

  const { error } = await client.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });

  signinButton.disabled = false;
  signinButton.textContent = "Sign in";

  if (error) {
    signinError.textContent = error.message;
    signinError.hidden = false;
    return;
  }
  passwordInput.value = "";
});

signoutButton.addEventListener("click", async () => {
  signoutButton.disabled = true;
  await client.auth.signOut();
  signoutButton.disabled = false;
});

// ---------- Data ----------

async function fetchAllHikes() {
  const hikes = [];
  // Keep asking for the next page until one comes back empty. Starting each
  // page from what we actually received also works if the project caps rows
  // per request below PAGE_SIZE.
  while (true) {
    const from = hikes.length;
    const { data, error } = await client
      .from("hikes_map")
      .select("id, name, activity_type, started_at, distance_m, elevation_gain_m, geojson")
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (data.length === 0) break;
    hikes.push(...data);
  }
  return hikes;
}

async function loadAndDrawHikes() {
  const userId = shownUserId;
  routesLayer.clearLayers();
  statusText.textContent = "Loading your hikes…";

  let hikes;
  try {
    hikes = await fetchAllHikes();
  } catch (error) {
    console.error(error);
    if (shownUserId === userId) {
      statusText.textContent = "Couldn't load your hikes. Try refreshing the page.";
    }
    return;
  }
  // The user signed out (or switched) while we were loading.
  if (shownUserId !== userId) return;

  // One layer per activity type, so the legend can show or hide each type.
  const layersByType = new Map();
  let skipped = 0;
  for (const hike of hikes) {
    const route = parseRoute(hike.geojson);
    if (!route) {
      skipped++;
      continue;
    }
    const type = hike.activity_type || "";
    if (!layersByType.has(type)) {
      layersByType.set(type, L.featureGroup().addTo(routesLayer));
    }
    L.geoJSON(route, { style: { color: activityColor(type), weight: 4, opacity: 0.8 } })
      .bindPopup(() => buildPopup(hike))
      .addTo(layersByType.get(type));
  }
  renderLegend(layersByType);

  const drawn = hikes.length - skipped;
  if (hikes.length === 0) {
    statusText.textContent = "No hikes yet.";
  } else {
    statusText.textContent =
      `${drawn} ${drawn === 1 ? "hike" : "hikes"}` +
      (skipped ? ` (${skipped} without a route skipped)` : "");
  }

  if (drawn > 0) {
    map.fitBounds(routesLayer.getBounds(), { padding: [24, 24] });
  }
}

// Returns a usable GeoJSON LineString, or null if the route is missing or broken.
function parseRoute(geojson) {
  let route = geojson;
  if (typeof route === "string") {
    try {
      route = JSON.parse(route);
    } catch {
      return null;
    }
  }
  if (
    !route ||
    route.type !== "LineString" ||
    !Array.isArray(route.coordinates) ||
    route.coordinates.length < 2
  ) {
    return null;
  }
  return route;
}

// ---------- Activity types ----------

function activityColor(type) {
  return ACTIVITY_COLORS[type] || OTHER_COLOR;
}

// "trail_running" -> "Trail running"
function activityLabel(type) {
  if (!type) return "No activity type";
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------- Legend ----------

// Built with textContent, never innerHTML, so type names can't inject HTML.
function renderLegend(layersByType) {
  const box = legend.getContainer();
  box.replaceChildren();
  if (layersByType.size === 0) return;

  // Known types in their fixed order first, then any others alphabetically.
  const known = Object.keys(ACTIVITY_COLORS);
  const types = [...layersByType.keys()].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b);
  });

  for (const type of types) {
    const layer = layersByType.get(type);

    const row = document.createElement("label");
    row.className = "legend-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) routesLayer.addLayer(layer);
      else routesLayer.removeLayer(layer);
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = activityColor(type);

    const text = document.createElement("span");
    text.textContent = `${activityLabel(type)} (${layer.getLayers().length})`;

    row.append(checkbox, swatch, text);
    box.appendChild(row);
  }
}

// ---------- Popup ----------

// Built with textContent, never innerHTML, so hike names can't inject HTML.
function buildPopup(hike) {
  const box = document.createElement("div");
  box.className = "hike-popup";

  const title = document.createElement("h3");
  title.textContent = hike.name || "Untitled hike";
  box.appendChild(title);

  const lines = [
    activityLabel(hike.activity_type),
    formatDate(hike.started_at),
    formatDistance(hike.distance_m),
    formatElevation(hike.elevation_gain_m),
  ];
  for (const text of lines) {
    if (!text) continue;
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
  }
  return box;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date)) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// 13520 -> "8.4 mi (13.5 km)"
function formatDistance(meters) {
  if (meters == null) return null;
  const miles = (meters / METERS_PER_MILE).toFixed(1);
  const km = (meters / 1000).toFixed(1);
  return `${miles} mi (${km} km)`;
}

// 564 -> "1,850 ft elevation gain"
function formatElevation(meters) {
  if (meters == null) return null;
  const feet = Math.round(meters * FEET_PER_METER).toLocaleString("en-US");
  return `${feet} ft elevation gain`;
}
