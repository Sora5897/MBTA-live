// ====== MBTA Live Map with Modes, Legend, and Alerts ======

const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn  = document.getElementById("saveKey");
const routeInput  = document.getElementById("routeInput");
const routeList   = document.getElementById("routeList");
const refreshSel  = document.getElementById("refreshMs");
const startBtn    = document.getElementById("startBtn");
const stopBtn     = document.getElementById("stopBtn");
const fitBtn      = document.getElementById("fitBtn");
const statusEl    = document.getElementById("status");
const alertsEl    = document.getElementById("alerts");
const modeBoxes   = Array.from(document.querySelectorAll(".mode"));

// restore saved key
apiKeyInput.value = localStorage.getItem("mbta_api_key") || "";
saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem("mbta_api_key", apiKeyInput.value.trim());
  toast("API key saved locally.");
});

// ---- Leaflet map ----
const map = L.map("map").setView([42.3601, -71.0589], 12); // Boston
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap",
}).addTo(map);

// marker cache by vehicle id
const markers = new Map();
let timer = null;

// small colored circle for vehicles
function mkIcon(color="#0078ff") {
  return L.divIcon({
    className: "veh",
    html: `<div style="width:14px;height:14px;border-radius:50%;
            background:${color};border:2px solid white;
            box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14,14], iconAnchor: [7,7]
  });
}

// color by route id
function colorFor(routeId="") {
  const id = (routeId || "").toLowerCase();
  if (id.startsWith("green") || id.includes("mattapan")) return "#2ecc71"; // light rail
  if (id.includes("red"))     return "#e74c3c";
  if (id.includes("orange"))  return "#e67e22";
  if (id.includes("blue"))    return "#3498db";
  if (id.startsWith("cr-"))   return "#8e44ad"; // commuter rail
  if (id.startsWith("ferry")) return "#16a085";
  return "#555"; // bus/other
}

function headers() {
  const key = apiKeyInput.value.trim();
  return key ? { "x-api-key": key } : {};
}

function selectedRouteTypes(){
  const vals = modeBoxes.filter(b => b.checked).map(b => b.value);
  return vals; // strings of 0..4
}

// ---- Auto-load ALL MBTA routes into dropdown ----
async function loadRoutes() {
  try {
    setStatus("Loading routes…");
    const url = new URL("https://api-v3.mbta.com/routes");
    url.searchParams.set("page[limit]", "500");
    url.searchParams.set("sort", "type,short_name");
    const res = await fetch(url.toString(), { headers: headers() });
    const json = await res.json();
    const routes = json.data || [];

    // Group by GTFS type
    const groups = new Map([
      [0, { label: "Light Rail (Green/Mattapan)", items: [] }],
      [1, { label: "Heavy Rail (Red/Orange/Blue)", items: [] }],
      [3, { label: "Bus", items: [] }],
      [2, { label: "Commuter Rail", items: [] }],
      [4, { label: "Ferry", items: [] }],
    ]);

    routes.forEach(r => {
      const id = r.id;
      const a  = r.attributes || {};
      const name = a.long_name || a.short_name || id;
      const type = a.type;
      if (groups.has(type)) groups.get(type).items.push({ id, name });
    });

    routeList.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "-- All Routes --";
    routeList.appendChild(blank);

    for (const [type, group] of groups.entries()) {
      if (!group.items.length) continue;
      const og = document.createElement("optgroup");
      og.label = group.label;
      group.items.forEach(({ id, name }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${id} -- ${name}`;
        og.appendChild(opt);
      });
      routeList.appendChild(og);
    }
    setStatus("Routes loaded.");
  } catch (e) {
    console.error(e);
    setStatus("Failed to load routes (try saving API key).");
  }
}

// when user picks from dropdown, copy to text field
routeList.addEventListener("change", () => {
  routeInput.value = routeList.value;
});

// ---- Vehicle fetching ----
async function fetchVehicles(route, types) {
  const url = new URL("https://api-v3.mbta.com/vehicles");
  if (route) {
    url.searchParams.set("filter[route]", route);
  } else if (types && types.length && types.length < 5) {
    // Filter by selected GTFS route types if not all selected
    url.searchParams.set("filter[route_type]", types.join(","));
  }
  url.searchParams.set("include", "trip,route");
  url.searchParams.set("page[limit]", "200");

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data; // array
}

async function refreshOnce() {
  const route = routeInput.value.trim();
  const types = selectedRouteTypes();
  setStatus(`Loading ${route || (types.length && types.length<5 ? `types ${types.join(",")}` : "all")}…`);
  try {
    const vehicles = await fetchVehicles(route, types);
    let bounds = [];

    vehicles.forEach(v => {
      const id = v.id;
      const a  = v.attributes || {};
      if (a.latitude == null || a.longitude == null) return;

      const latlng = [a.latitude, a.longitude];
      bounds.push(latlng);

      const routeRel = (v.relationships && v.relationships.route && v.relationships.route.data && v.relationships.route.data.id) || route || "";
      const color = colorFor(routeRel);

      const text = `
        <b>Vehicle:</b> ${id}<br/>
        <b>Route:</b> ${routeRel}<br/>
        <b>Status:</b> ${a.current_status || "--"}<br/>
        <b>Speed:</b> ${a.speed != null ? a.speed.toFixed(1) + " m/s" : "--"}<br/>
        <b>Updated:</b> ${a.updated_at || "--"}
      `;

      if (markers.has(id)) {
        markers.get(id).setLatLng(latlng).setIcon(mkIcon(color)).setPopupContent(text);
      } else {
        const m = L.marker(latlng, { icon: mkIcon(color), title: id }).addTo(map);
        m.bindPopup(text);
        markers.set(id, m);
      }
    });

    // remove stale markers
    for (const [id, m] of [...markers.entries()]) {
      const still = vehicles.find(v => v.id === id);
      if (!still) { map.removeLayer(m); markers.delete(id); }
    }

    setStatus(`Showing ${vehicles.length} vehicles${route ? " on " + route : ""}.`);
    return bounds;
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
    return [];
  }
}

// ---- Alerts ----
async function fetchAlerts(route, types){
  const url = new URL("https://api-v3.mbta.com/alerts");
  url.searchParams.set("page[limit]","50");
  url.searchParams.set("sort","-updated_at");
  // filter by route or types (if user limited modes)
  if (route) {
    url.searchParams.set("filter[route]", route);
  } else if (types && types.length && types.length < 5) {
    url.searchParams.set("filter[route_type]", types.join(","));
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

async function refreshAlerts(){
  const route = routeInput.value.trim();
  const types = selectedRouteTypes();
  try{
    const items = await fetchAlerts(route, types);
    if (!items.length){ alertsEl.innerHTML = `<div class="alert">No active alerts.</div>`; return; }
    alertsEl.innerHTML = items.slice(0,12).map(a=>{
      const at = a.attributes || {};
      const h  = (at.header || "Service alert").replace(/\n/g," ");
      const desc = (at.short_header || at.description || "").toString().slice(0,200);
      const sev = at.severity != null ? `Severity ${at.severity}` : "";
      const when = at.updated_at ? new Date(at.updated_at).toLocaleString() : "";
      return `<div class="alert"><strong>${h}</strong><small>${sev}${sev&&when?" • ":""}${when}</small>${desc ? `<div>${desc}</div>`:""}</div>`;
    }).join("");
  }catch(e){
    console.error(e);
    alertsEl.innerHTML = `<div class="alert">Failed to load alerts.</div>`;
  }
}

// ---- Controls ----
startBtn.addEventListener("click", async () => {
  const ms = parseInt(refreshSel.value, 10) || 10000;
  await Promise.all([refreshOnce(), refreshAlerts()]);
  if (timer) clearInterval(timer);
  timer = setInterval(()=>{ refreshOnce(); refreshAlerts(); }, ms);
  toast(`Auto-refresh every ${ms/1000}s`);
});

stopBtn.addEventListener("click", () => {
  if (timer) clearInterval(timer);
  timer = null;
  setStatus("Auto-refresh stopped.");
});

fitBtn.addEventListener("click", async () => {
  const bounds = await refreshOnce();
  if (bounds.length) map.fitBounds(bounds, { padding: [30,30] });
});

// change filters -> refresh once
modeBoxes.forEach(b => b.addEventListener("change", ()=>{ refreshOnce(); refreshAlerts(); }));
routeInput.addEventListener("change", ()=>{ refreshOnce(); refreshAlerts(); });
routeList.addEventListener("change", ()=>{ refreshOnce(); refreshAlerts(); });

function setStatus(msg){ statusEl.textContent = msg; }
function toast(msg){ setStatus(msg); }

// init
routeInput.value ||= "1";
loadRoutes().then(()=>{ refreshOnce(); refreshAlerts(); });