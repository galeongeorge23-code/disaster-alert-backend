import express from "express";
import { fetchPagasaAlertsReal } from "./src/pagasa_adapter.js";

const app = express();

const TYPHOON_SIGNAL_TRIGGER = 2;
const EARTHQUAKE_MAGNITUDE_TRIGGER = 5.0;

/**
 * STAGE 1 OF 2: hand-written mock data, same as the Firebase version --
 * proving the pipeline (Flutter app -> this server -> normalized JSON ->
 * back into SQLite) works before real PAGASA/PHIVOLCS scraping is wired in.
 */
function fetchPagasaAlertsMock() {
  return [
    {
      cycloneId: "TEST01",
      bulletinNumber: 1,
      cycloneName: "TestStorm",
      category: "TS",
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      affectedAreas: [
        { name: "Metro Manila", psgcCode: "1300000000", signalLevel: 2 },
        { name: "Cavite", psgcCode: "0402100000", signalLevel: 1 },
      ],
      instructions: ["Stay indoors", "Monitor official updates"],
    },
  ];
}

function fetchPhivolcsAlertsMock() {
  return [
    {
      dateTime: new Date().toISOString(),
      latitude: 14.5995,
      longitude: 120.9842,
      depth: 10,
      magnitude: 5.4,
      location: "Manila Bay",
    },
  ];
}

// STAGE 2: PAGASA now uses the real parser (ported from bagyo-api).
// PHIVOLCS is still mock -- that's the next task, not done here.
async function fetchPagasaAlerts() {
  return fetchPagasaAlertsReal();
}

// TODO (stage 2): replace with real phivocs-api-derived scraper
async function fetchPhivolcsAlerts() {
  return fetchPhivolcsAlertsMock();
}

function normalizePagasa(raw) {
  const areas = raw.affectedAreas.map((a) => ({
    area_name: a.name,
    psgc_code: a.psgcCode,
    h3_index: `PLACEHOLDER_${a.psgcCode}`, // real PSGC->H3 mapping comes later
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
        h3_index: `PLACEHOLDER_${raw.latitude}_${raw.longitude}`,
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

    console.log(`getAlerts returning ${alerts.length} alerts (mock data, stage 1)`);
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
