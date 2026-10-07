// Hikes Map: sign in with Supabase, then draw every hike route on a Google map.

const { supabaseUrl, supabasePublishableKey, mapStyles } = window.HIKES_CONFIG;
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

// Hidden hikes (owner view only) are drawn as a faded dashed gray line.
const HIDDEN_ICON = {
  icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeColor: OTHER_COLOR, scale: 3 },
  offset: "0",
  repeat: "12px",
};

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

// The Style menu: Google's default look first, then the styles in config.js.
const STYLE_OPTIONS = [{ name: "Google default", mapId: null }, ...(mapStyles || [])];
// The chosen style is remembered in this browser only.
const STYLE_STORAGE_KEY = "hikes-map-style";

const signinView = document.getElementById("signin-view");
const signinForm = document.getElementById("signin-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signinButton = document.getElementById("signin-button");
const signinError = document.getElementById("signin-error");
const mapView = document.getElementById("map-view");
const mapContainer = document.getElementById("map");
const statusText = document.getElementById("status");
const styleSelect = document.getElementById("style-select");
const userEmail = document.getElementById("user-email");
const signoutButton = document.getElementById("signout-button");

let map = null;
let infoWindow = null;
// The legend box, shown as a map control in the top-right corner.
const legendBox = document.createElement("div");
legendBox.className = "legend";
// One group per activity type: its hikes and whether the type is ticked.
// type -> { entries: { hike, line: google.maps.Polyline }[], visible: boolean }
let routeGroups = new Map();
// Owner-only: also draw the hikes marked hidden (faded, dashed) so they can be un-hidden.
let showHidden = false;
// How many hikes had no usable route.
let skippedCount = 0;
// How many hikes came back from Supabase.
let totalHikes = 0;
// Whose hikes are on the map, so a token refresh doesn't reload them.
let shownUserId = null;
// Loads the Google Maps libraries once; every later call reuses the result.
let mapsReady = null;
// Creates the map once, even if sign-in and sign-out both ask for it at the same time.
let mapCreated = null;

// The world view shown behind the sign-in form, and where the map starts.
const WORLD_VIEW = { center: { lat: 20, lng: 0 }, zoom: 2 };

// ---------- Screens ----------

// Signed out: the map stays on screen but blurred and locked behind the
// sign-in form. It shows only Google's base map, never any hikes.
async function showSignIn() {
  shownUserId = null;
  clearRoutes();
  statusText.textContent = "";
  lockMap(true);
  mapView.hidden = false;
  signinView.hidden = false;
  emailInput.focus();

  try {
    await ensureMap();
  } catch (error) {
    // Without Google Maps the form still works over a plain background.
    console.error(error);
    return;
  }
  // Zoom back out so the blurred map doesn't hint at where the last hikes were.
  if (document.body.classList.contains("locked")) {
    map.setCenter(WORLD_VIEW.center);
    map.setZoom(WORLD_VIEW.zoom);
  }
}

// Locked: blurred by the sign-in overlay (see style.css), and unreachable by
// mouse, touch or keyboard ("inert").
function lockMap(locked) {
  document.body.classList.toggle("locked", locked);
  mapContainer.inert = locked;
  if (map) map.setOptions(controlOptions(locked));
}

// Signed out, hide Google's buttons so only its logo and attribution show.
function controlOptions(locked) {
  return {
    disableDefaultUI: locked,
    keyboardShortcuts: !locked,
    // Map / Satellite switch (with a Terrain option) in the top-left.
    mapTypeControl: !locked,
    streetViewControl: false,
  };
}

// The blur targets the map imagery layer inside Google's map. If that layer
// isn't where we expect, fall back to frosting the whole screen instead.
function checkBlurTarget() {
  const pane = mapContainer.querySelector(".gm-style > div:first-child");
  const found = Boolean(pane && pane.querySelector("canvas, img"));
  document.body.classList.toggle("blur-fallback", !found);
}

async function showMap(user) {
  signinView.hidden = true;
  lockMap(false);
  mapView.hidden = false;
  userEmail.textContent = user.email;

  try {
    await ensureMap();
  } catch (error) {
    console.error(error);
    statusText.textContent = "Couldn't load Google Maps. Try refreshing the page.";
    return;
  }

  if (shownUserId !== user.id) {
    shownUserId = user.id;
    loadAndDrawHikes();
  }
}

// ---------- Map ----------

function loadMapsLibraries() {
  if (!mapsReady) {
    mapsReady = Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("core"),
    ]);
  }
  return mapsReady;
}

function ensureMap() {
  if (!mapCreated) {
    mapCreated = (async () => {
      await loadMapsLibraries();
      setUpStyleMenu();
      createMap(savedStyleIndex(), WORLD_VIEW);
    })();
    // If loading failed, let the next call try again.
    mapCreated.catch(() => {
      mapCreated = null;
      mapsReady = null;
    });
  }
  return mapCreated;
}

// A Map ID can only be set when a map is created, so changing the style
// builds a new map in the same place and moves the routes onto it.
function createMap(styleIndex, view) {
  const style = STYLE_OPTIONS[styleIndex];

  // A fresh element for each map, so the old map is fully removed.
  const element = document.createElement("div");
  element.className = "map-canvas";
  mapContainer.replaceChildren(element);

  const options = {
    center: view.center,
    zoom: view.zoom,
    mapTypeId: view.mapTypeId || "roadmap",
    ...controlOptions(document.body.classList.contains("locked")),
    // Don't open Google's place popups when clicking shops, parks, etc.
    clickableIcons: false,
    // Scroll to zoom without holding a key; this page is all map.
    gestureHandling: "greedy",
  };
  if (style.mapId) options.mapId = style.mapId;

  map = new google.maps.Map(element, options);
  google.maps.event.addListenerOnce(map, "tilesloaded", checkBlurTarget);
  infoWindow = new google.maps.InfoWindow();
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(legendBox);

  // Put any routes already loaded onto the new map, keeping hidden ones hidden.
  refreshAllLines();
}

// ---------- Style menu ----------

function setUpStyleMenu() {
  styleSelect.replaceChildren();
  STYLE_OPTIONS.forEach((style, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = style.name;
    styleSelect.appendChild(option);
  });
  styleSelect.value = String(savedStyleIndex());
}

styleSelect.addEventListener("change", () => {
  const index = Number(styleSelect.value);
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, STYLE_OPTIONS[index].name);
  } catch {
    // Storage can be blocked (private windows); the menu still works.
  }
  if (!map) return;
  createMap(index, {
    center: map.getCenter(),
    zoom: map.getZoom(),
    mapTypeId: map.getMapTypeId(),
  });
});

// The style picked last time in this browser, or Google default.
function savedStyleIndex() {
  let name = null;
  try {
    name = localStorage.getItem(STYLE_STORAGE_KEY);
  } catch {
    return 0;
  }
  const index = STYLE_OPTIONS.findIndex((style) => style.name === name);
  return index === -1 ? 0 : index;
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
      .select(
        "id, name, activity_type, started_at, distance_m, elevation_gain_m, geojson, show_on_map, notes, user_id",
      )
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (data.length === 0) break;
    hikes.push(...data);
  }
  return hikes;
}

function clearRoutes() {
  for (const group of routeGroups.values()) {
    for (const { line } of group.entries) line.setMap(null);
  }
  routeGroups = new Map();
  showHidden = false;
  skippedCount = 0;
  if (infoWindow) infoWindow.close();
  legendBox.replaceChildren();
}

async function loadAndDrawHikes() {
  const userId = shownUserId;
  clearRoutes();
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

  // One group per activity type, so the legend can show or hide each type.
  const bounds = new google.maps.LatLngBounds();
  for (const hike of hikes) {
    const route = parseRoute(hike.geojson);
    if (!route) {
      skippedCount++;
      continue;
    }
    const type = hike.activity_type || "";
    if (!routeGroups.has(type)) {
      routeGroups.set(type, { entries: [], visible: true });
    }

    // GeoJSON stores [longitude, latitude]; Google wants {lat, lng}.
    const path = route.coordinates.map(([lng, lat]) => ({ lat, lng }));
    // Hidden hikes still count for the map's starting view, so it doesn't
    // jump around when you hide or un-hide one.
    for (const point of path) bounds.extend(point);

    const line = new google.maps.Polyline({ path, map: null });
    const entry = { hike, line };
    line.addListener("click", (event) => {
      infoWindow.setContent(buildPopup(entry));
      infoWindow.setPosition(event.latLng);
      infoWindow.open({ map });
    });
    routeGroups.get(type).entries.push(entry);
  }
  refreshAllLines();
  renderLegend();
  totalHikes = hikes.length;
  updateStatus();

  if (hikes.length > skippedCount) {
    map.fitBounds(bounds, 24);
  }
}

// ---------- Hidden hikes ----------

// Only the hike's owner can edit it. This just decides what to show;
// the real rule is the row level security policy in Supabase.
function isOwner(hike) {
  return shownUserId !== null && hike.user_id === shownUserId;
}

function isHidden(hike) {
  return hike.show_on_map === false;
}

// Normal hikes follow their type's legend checkbox. Hidden hikes are drawn
// (faded and dashed) only for their owner, and only while the
// "Hidden hikes" box is ticked.
function refreshLine(entry, group) {
  const { hike, line } = entry;
  if (isHidden(hike)) {
    line.setOptions({
      strokeColor: OTHER_COLOR,
      strokeOpacity: 0,
      strokeWeight: 3,
      icons: [HIDDEN_ICON],
    });
    line.setMap(showHidden && isOwner(hike) ? map : null);
  } else {
    line.setOptions({
      strokeColor: activityColor(hike.activity_type || ""),
      strokeOpacity: 0.8,
      strokeWeight: 4,
      icons: [],
    });
    line.setMap(group.visible ? map : null);
  }
}

function refreshAllLines() {
  for (const group of routeGroups.values()) {
    for (const entry of group.entries) refreshLine(entry, group);
  }
}

function shownCount(group) {
  return group.entries.filter((entry) => !isHidden(entry.hike)).length;
}

function hiddenOwnCount() {
  let count = 0;
  for (const group of routeGroups.values()) {
    for (const { hike } of group.entries) if (isHidden(hike) && isOwner(hike)) count++;
  }
  return count;
}

// "12 hikes", counting only hikes that are on the map.
function updateStatus() {
  const total = totalHikes;
  let drawn = 0;
  for (const group of routeGroups.values()) drawn += shownCount(group);
  if (total === 0) {
    statusText.textContent = "No hikes yet.";
    return;
  }
  statusText.textContent =
    `${drawn} ${drawn === 1 ? "hike" : "hikes"}` +
    (skippedCount ? ` (${skippedCount} without a route skipped)` : "");
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
function renderLegend() {
  legendBox.replaceChildren();
  if (routeGroups.size === 0) return;

  // Known types in their fixed order first, then any others alphabetically.
  const known = Object.keys(ACTIVITY_COLORS);
  const types = [...routeGroups.keys()].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b);
  });

  for (const type of types) {
    const group = routeGroups.get(type);
    // A type whose hikes are all hidden has nothing to toggle.
    if (shownCount(group) === 0) continue;

    const row = document.createElement("label");
    row.className = "legend-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = group.visible;
    checkbox.addEventListener("change", () => {
      group.visible = checkbox.checked;
      for (const entry of group.entries) refreshLine(entry, group);
      // Close the popup if it belongs to a route that just disappeared.
      if (!group.visible) infoWindow.close();
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = activityColor(type);

    const text = document.createElement("span");
    text.textContent = `${activityLabel(type)} (${shownCount(group)})`;

    row.append(checkbox, swatch, text);
    legendBox.appendChild(row);
  }

  // Owner-only way to find hidden hikes again, so they can be un-hidden.
  const hiddenCount = hiddenOwnCount();
  if (hiddenCount > 0) {
    const row = document.createElement("label");
    row.className = "legend-row legend-hidden";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = showHidden;
    checkbox.addEventListener("change", () => {
      showHidden = checkbox.checked;
      refreshAllLines();
      if (!showHidden) infoWindow.close();
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch legend-swatch-hidden";

    const text = document.createElement("span");
    text.textContent = `Hidden hikes (${hiddenCount})`;

    row.append(checkbox, swatch, text);
    legendBox.appendChild(row);
  }
}

// ---------- Popup ----------

// Built with textContent, never innerHTML, so hike names can't inject HTML.
function buildPopup(entry) {
  const { hike } = entry;
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

  if (isOwner(hike)) {
    box.appendChild(buildEditForm(entry));
  } else if (hike.notes) {
    const notes = document.createElement("p");
    notes.className = "hike-notes";
    notes.textContent = hike.notes;
    box.appendChild(notes);
  }
  return box;
}

// The owner's controls: show on map, notes, and a Save button.
function buildEditForm(entry) {
  const { hike } = entry;
  const form = document.createElement("form");
  form.className = "hike-edit";

  const showRow = document.createElement("label");
  showRow.className = "hike-edit-row";
  const showBox = document.createElement("input");
  showBox.type = "checkbox";
  showBox.checked = !isHidden(hike);
  const showText = document.createElement("span");
  showText.textContent = "Show on map";
  showRow.append(showBox, showText);

  const notesLabel = document.createElement("label");
  notesLabel.className = "hike-edit-notes";
  const notesText = document.createElement("span");
  notesText.textContent = "Notes";
  const notesBox = document.createElement("textarea");
  notesBox.rows = 3;
  notesBox.value = hike.notes || "";
  notesLabel.append(notesText, notesBox);

  const actions = document.createElement("div");
  actions.className = "hike-edit-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  const result = document.createElement("span");
  result.className = "hike-edit-result";
  result.setAttribute("role", "status");
  actions.append(saveButton, result);

  // Typing again clears an old "Saved" message.
  form.addEventListener("input", () => {
    result.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    result.className = "hike-edit-result";
    result.textContent = "Saving…";
    const ok = await saveHike(entry, showBox.checked, notesBox.value);
    saveButton.disabled = false;
    result.className = "hike-edit-result" + (ok ? "" : " error");
    result.textContent = ok ? "Saved" : "Couldn't save. Try again.";
  });

  form.append(showRow, notesLabel, actions);
  return form;
}

// Writes to the hikes table (not the view). Row level security lets only the
// owner update; when it blocks a write it changes zero rows without an error,
// so an empty result counts as a failure too.
async function saveHike(entry, showOnMap, notes) {
  const { hike } = entry;
  const values = { show_on_map: showOnMap, notes: notes.trim() === "" ? null : notes };

  const { data, error } = await client
    .from("hikes")
    .update(values)
    .eq("id", hike.id)
    .select("id");
  if (error || !data || data.length === 0) {
    if (error) console.error(error);
    return false;
  }

  hike.show_on_map = values.show_on_map;
  hike.notes = values.notes;
  // Update the line, legend and count in place: no reload, no re-zoom.
  const group = routeGroups.get(hike.activity_type || "");
  if (group) refreshLine(entry, group);
  renderLegend();
  updateStatus();
  return true;
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
