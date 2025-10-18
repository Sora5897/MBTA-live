// ====== MBTA Live Map: tooltips, multi-route, stop search ======

const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn  = document.getElementById("saveKey");
const routeInput  = document.getElementById("routeInput");
const routeList   = document.getElementById("routeList");
const multiRoutes = document.getElementById("multiRoutes");
const refreshSel  = document.getElementById("refreshMs");
const startBtn    = document.getElementById("startBtn");
const stopBtn     = document.getElementById("stopBtn");
const fitBtn      = document.getElementById("fitBtn");
const statusEl    = document.getElementById("status");
const alertsEl    = document.getElementById("alerts");
const modeBoxes   = Array.from(document.querySelectorAll(".mode"));

const stopQuery   = document.getElementById("stopQuery");
const searchStopsBtn = document.getElementById("searchStops");
const stopResults = document.getElementById("stopResults");
const showStopsChk = document.getElementById("showStops");

// restore saved key
apiKeyInput.value = localStorage.getItem("mbta_api_key") || "";
saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem("mbta_api_key", apiKeyInput.value.trim());
  toast("API key saved locally.");
});

// map
const map = L.map("map").setView([42.3601, -71.0589], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap",
}).addTo(map);

// markers
const markers = new Map();           // vehicle markers
const stopLayer = L.layerGroup().addTo(map); // stop markers
let timer = null;

// icons
function mkIcon(color="#0078ff") {
  return L.divIcon({
    className: "veh",
    html: `<div style="width:14px;height:14px;border-radius:50%;
            background:${color};border:2px solid white;
            box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14,14], iconAnchor: [7,7]
  });
}
function mkStopIcon() {
  return L.divIcon({
    className: "stp",
    html: `<div style="width:10px;height:10px;border-radius:2px;background:#111;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [12,12], iconAnchor: [6,6]
  });
}

function colorFor(routeId="") {
  const id = (routeId || "").toLowerCase();
  if (id.startsWith("green") || id.includes("mattapan")) return "#2ecc71";
  if (id.includes("red"))     return "#e74c3c";
  if (id.includes("orange"))  return "#e67e22";
  if (id.includes("blue"))    return "#3498db";
  if (id.startsWith("cr-"))   return "#8e44ad";
  if (id.startsWith("ferry")) return "#16a085";
  return "#555";
}

function headers() {
  const key = apiKeyInput.value.trim();
  return key ? { "x-api-key": key } : {};
}

function selectedModeTypes(){
  return modeBoxes.filter(b => b.checked).map(b => b.value); // strings "0".."4"
}

function selectedRoutesArray() {
  const typed = routeInput.value.trim();
  const fromText = typed ? [typed] : [];
  const fromMulti = Array.from(multiRoutes.selectedOptions).map(o => o.value).filter(Boolean);
  const all = [...new Set([...fromText, ...fromMulti])];
  return all;
}

// ---- routes ----
async function loadRoutes() {
  try {
    setStatus("Loading routes…");
    const url = new URL("https://api-v3.mbta.com/routes");
    url.searchParams.set("page[limit]", "500");
    url.searchParams.set("sort", "type,short_name");
    const res = await fetch(url.toString(), { headers: headers() });
    const json = await res.json();
    const routes = json.data || [];

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

    // single select
    routeList.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "-- All Routes --";
    routeList.appendChild(blank);

    // multi select
    multiRoutes.innerHTML = "";

    for (const [type, group] of groups.entries()){
      if (!group.items.length) continue;

      // single-select group
      const og = document.createElement("optgroup");
      og.label = group.label;
      group.items.forEach(({ id, name }) => {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = `${id} -- ${name}`;
        og.appendChild(opt);
      });
      routeList.appendChild(og);

      // multi-select options (flat is easier to tap)
      const labelOpt = document.createElement("option");
      labelOpt.disabled = true;
      labelOpt.textContent = `-- ${group.label} --`;
      multiRoutes.appendChild(labelOpt);

      group.items.forEach(({ id, name }) => {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = `${id} -- ${name}`;
        multiRoutes.appendChild(opt);
      });
    }

    setStatus("Routes loaded.");
  } catch (e) {
    console.error(e);
    setStatus("Failed to load routes (try saving API key).");
  }
}

routeList.addEventListener("change", () => {
  routeInput.value = routeList.value;
  refreshAll();
});
multiRoutes.addEventListener("change", refreshAll);

// ---- vehicles ----
async function fetchVehicles(routeIds, types) {
  const url = new URL("https://api-v3.mbta.com/vehicles");
  if (routeIds && routeIds.length){
    url.searchParams.set("filter[route]", routeIds.join(","));
  } else if (types && types.length && types.length < 5) {
    url.searchParams.set("filter[route_type]", types.join(","));
  }
  url.searchParams.set("include", "trip,route");
  url.searchParams.set("page[limit]", "200");
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function refreshOnce() {
  const routeIds = selectedRoutesArray();
  const types = selectedModeTypes();
  const label = routeIds.length ? routeIds.join(", ") : (types.length && types.length<5 ? `types ${types.join(",")}` : "all");
  setStatus(`Loading ${label}…`);
  try {
    const vehicles = await fetchVehicles(routeIds, types);
    let bounds = [];

    vehicles.forEach(v => {
      const id = v.id;
      const a  = v.attributes || {};
      if (a.latitude == null || a.longitude == null) return;

      const latlng = [a.latitude, a.longitude];
      bounds.push(latlng);

      const routeRel = (v.relationships && v.relationships.route && v.relationships.route.data && v.relationships.route.data.id) || "";
      const color = colorFor(routeRel);

      const text = `
        <b>Vehicle:</b> ${id}<br/>
        <b>Route:</b> ${routeRel || "--"}<br/>
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

    setStatus(`Showing ${vehicles.length} vehicles (${label}).`);
    return bounds;
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
    return [];
  }
}

// ---- alerts ----
async function fetchAlerts(routeIds, types){
  const url = new URL("https://api-v3.mbta.com/alerts");
  url.searchParams.set("page[limit]","50");
  url.searchParams.set("sort","-updated_at");
  if (routeIds && routeIds.length) {
    url.searchParams.set("filter[route]", routeIds.join(","));
  } else if (types && types.length && types.length < 5) {
    url.searchParams.set("filter[route_type]", types.join(","));
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

async function refreshAlerts(){
  const routeIds = selectedRoutesArray();
  const types = selectedModeTypes();
  try{
    const items = await fetchAlerts(routeIds, types);
    if (!items.length){ alertsEl.innerHTML = `<div class="stop-result">No active alerts.</div>`; return; }
    alertsEl.innerHTML = items.slice(0,12).map(a=>{
      const at = a.attributes || {};
      const h  = (at.header || "Service alert").replace(/\n/g," ");
      const desc = (at.short_header || at.description || "").toString().slice(0,200);
      const sev = at.severity != null ? `Severity ${at.severity}` : "";
      const when = at.updated_at ? new Date(at.updated_at).toLocaleString() : "";
      return `<div class="stop-result"><strong>${h}</strong><br/><small>${sev}${sev&&when?" • ":""}${when}</small>${desc ? `<div>${desc}</div>`:""}</div>`;
    }).join("");
  }catch(e){
    console.error(e);
    alertsEl.innerHTML = `<div class="stop-result">Failed to load alerts.</div>`;
  }
}

// ---- stop search ----
async function searchStops(){
  const q = stopQuery.value.trim();
  const routeIds = selectedRoutesArray();
  if (!q){ stopResults.textContent = "Type a stop name (e.g., Park St)."; return; }

  const url = new URL("https://api-v3.mbta.com/stops");
  url.searchParams.set("page[limit]","50");
  url.searchParams.set("filter[search]", q);
  if (routeIds.length) url.searchParams.set("filter[route]", routeIds.join(","));

  try{
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const stops = json.data || [];

    // draw markers
    stopLayer.clearLayers();
    if (showStopsChk.checked){
      stops.forEach(s=>{
        const a = s.attributes || {};
        if (a.latitude == null || a.longitude == null) return;
        const m = L.marker([a.latitude, a.longitude], { icon: mkStopIcon(), title: a.name || s.id }).addTo(stopLayer);
        m.bindPopup(`<b>${a.name || s.id}</b><br/>${s.id}`);
      });
    }

    if (!stops.length){
      stopResults.textContent = "No stops found.";
    } else {
      stopResults.innerHTML = stops.slice(0,10).map(s=>{
        const a = s.attributes || {};
        return `<div class="stop-result"><strong>${a.name || s.id}</strong><br/><small>${a.address || ""}</small></div>`;
      }).join("");
    }
  }catch(e){
    console.error(e);
    stopResults.textContent = "Failed to search stops.";
  }
}

searchStopsBtn.addEventListener("click", searchStops);
showStopsChk.addEventListener("change", ()=>{ if (!showStopsChk.checked) stopLayer.clearLayers(); });

// ---- controls ----
async function refreshAll(){
  await Promise.all([refreshOnce(), refreshAlerts()]);
}

startBtn.addEventListener("click", async () => {
  const ms = parseInt(refreshSel.value, 10) || 10000;
  await refreshAll();
  if (timer) clearInterval(timer);
  timer = setInterval(refreshAll, ms);
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

modeBoxes.forEach(b => b.addEventListener("change", refreshAll));
routeInput.addEventListener("change", refreshAll);

// init
routeInput.value ||= "";
loadRoutes().then(refreshAll);

function setStatus(msg){ statusEl.textContent = msg; }
function toast(msg){ setStatus(msg); }