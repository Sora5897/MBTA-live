// ====== MBTA Live Map ======

const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn  = document.getElementById("saveKey");
const routeInput  = document.getElementById("routeInput");
const presetsSel  = document.getElementById("presets");
const refreshSel  = document.getElementById("refreshMs");
const startBtn    = document.getElementById("startBtn");
const stopBtn     = document.getElementById("stopBtn");
const fitBtn      = document.getElementById("fitBtn");
const statusEl    = document.getElementById("status");

// restore saved key
apiKeyInput.value = localStorage.getItem("mbta_api_key") || "";
saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem("mbta_api_key", apiKeyInput.value.trim());
  toast("API key saved locally.");
});

// preset picker -> copies into route field
presetsSel.addEventListener("change", () => {
  if (presetsSel.value) routeInput.value = presetsSel.value;
});

// ---- Leaflet map ----
const map = L.map("map").setView([42.3601, -71.0589], 12); // Boston
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// marker cache by vehicle id
const markers = new Map();
let timer = null;

// basic colored circle for vehicles
function mkIcon(color="#0078ff") {
  return L.divIcon({
    className: "veh",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};
            border:2px solid white; box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  });
}

// choose color by mode from MBTA route id
function colorFor(routeId="") {
  const id = (routeId || "").toLowerCase();
  if (id.startsWith("green")) return "#2ecc71";
  if (id.includes("red"))     return "#e74c3c";
  if (id.includes("orange"))  return "#e67e22";
  if (id.includes("blue"))    return "#3498db";
  if (id.startsWith("cr-"))   return "#8e44ad"; // commuter rail
  return "#555"; // bus/other
}

function headers() {
  const key = apiKeyInput.value.trim();
  return key ? { "x-api-key": key } : {};
}

async function fetchVehicles(route) {
  const url = new URL("https://api-v3.mbta.com/vehicles");
  if (route) url.searchParams.set("filter[route]", route);
  url.searchParams.set("include", "trip,route");
  url.searchParams.set("page[limit]", "200");

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data; // array of vehicles
}

async function refreshOnce() {
  const route = routeInput.value.trim();
  setStatus(`Loading ${route || "all"}…`);
  try {
    const vehicles = await fetchVehicles(route);
    let bounds = [];

    // update/create markers
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

    // remove markers that disappeared
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

startBtn.addEventListener("click", async () => {
  const ms = parseInt(refreshSel.value, 10) || 10000;
  await refreshOnce();
  if (timer) clearInterval(timer);
  timer = setInterval(refreshOnce, ms);
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

function setStatus(msg){ statusEl.textContent = msg; }
function toast(msg){ setStatus(msg); }

// optional: start with a sensible default route
routeInput.value ||= "1";