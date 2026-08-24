import express from "express";
import { fetchPagasaAlertsReal } from "./src/pagasa_adapter.js";
import { fetchPhivolcsAlertsReal } from "./src/phivolcs_adapter.js";
import { resolvePsgcToH3, resolveLatLngToH3 } from "./src/h3_lookup.js";

const app = express();

const TYPHOON_SIGNAL_TRIGGER = 2;
const EARTHQUAKE_MAGNITUDE_TRIGGER = 5.0;

// STAGE 2: PAGASA now uses the real parser (ported from bagyo-api).
async function fetchPagasaAlerts() {
  return fetchPagasaAlertsReal();
}

// STAGE 2: both PAGASA and PHIVOLCS now use real scrapers.
async function fetchPhivolcsAlerts() {
  return fetchPhivolcsAlertsReal();
}

function normalizePagasa(raw) {
  const areas = raw.affectedAreas.map((a) => ({
    area_name: a.name,
    psgc_code: a.psgcCode,
    h3_index: (() => {
     const { h3_cells } = resolvePsgcToH3(a.psgcCode);
     return h3_cells;
      })(),
    signal_level: a.signalLevel,
    peis: null,
  }));

  return {
    hazard_id: `PAGASA_${raw.cycloneId}_${raw.bulletinNumber}`,
    source: "PAGASA",
    hazard_type: "typhoon",
    issued_at: raw.issuedAt,
    expires_at: raw.expiresAt ?? null,
    severity: {
      typhoon: {
        cyclone_name: raw.cycloneName,
        category: raw.category,
        max_signal_in_bulletin: Math.max(...areas.map((a) => a.signal_level ?? 0)),
      },
    },
    areas,
    alert_level: areas.some((a) => (a.signal_level ?? 0) >= TYPHOON_SIGNAL_TRIGGER)
      ? "active_caching"
      : "surveillance",
    instructions: raw.instructions ?? [],
    raw_payload: JSON.stringify(raw),
  };
}

function normalizePhivolcs(raw) {
  return {
    hazard_id: `PHIVOLCS_${raw.dateTime}_${raw.latitude}_${raw.longitude}`,
    source: "PHIVOLCS",
    hazard_type: "earthquake",
    issued_at: raw.dateTime,
    expires_at: null,
    severity: {
      earthquake: {
        magnitude: raw.magnitude,
        depth_km: raw.depth,
        reported_intensity: null,
      },
    },
    areas: [
      {
        area_name: raw.location,
        psgc_code: null,
        h3_index: [resolveLatLngToH3(raw.latitude, raw.longitude)],
        signal_level: null,
        peis: null,
      },
    ],
    alert_level: raw.magnitude >= EARTHQUAKE_MAGNITUDE_TRIGGER ? "active_caching" : "surveillance",
    instructions: [],
    raw_payload: JSON.stringify(raw),
  };
}

app.get("/getAlerts", async (req, res) => {
  try {
    const [pagasaRaw, phivolcsRaw] = await Promise.all([
      fetchPagasaAlerts(),
      fetchPhivolcsAlerts(),
    ]);

    const alerts = [
      ...pagasaRaw.map(normalizePagasa),
      ...phivolcsRaw.map(normalizePhivolcs),
    ];

    console.log(`getAlerts returning ${alerts.length} alerts (real data)`);
    res.status(200).json(alerts);
  } catch (err) {
    console.error("getAlerts failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Render (and most free hosts) inject the port to listen on via env var --
// don't hardcode 3000, or the deployed server won't be reachable.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
