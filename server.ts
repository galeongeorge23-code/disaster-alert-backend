import express from "express";
import { fetchPagasaAlertsReal } from "./src/pagasa_adapter.js";
import { fetchPhivolcsAlertsReal } from "./src/phivolcs_adapter.js";

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

/**
 * Returns a source-balanced page of alerts.
 *
 * Alerts are taken in rounds of up to 10:
 *   - up to 10 PAGASA alerts
 *   - up to 10 PHIVOLCS alerts
 *
 * If one source runs out of alerts, the other source fills
 * the remaining slots.
 */
function getBalancedPage(
  pagasaAlerts,
  phivolcsAlerts,
  page,
  limit
) {
  const PAGASA_BATCH_SIZE = 10;
  const PHIVOLCS_BATCH_SIZE = 10;

  const startOffset = (page - 1) * limit;

  // Build the complete balanced sequence first.
  const balanced = [];

  let pagasaIndex = 0;
  let phivolcsIndex = 0;

  while (
    pagasaIndex < pagasaAlerts.length ||
    phivolcsIndex < phivolcsAlerts.length
  ) {
    // Take up to 10 PAGASA alerts.
    for (let i = 0; i < PAGASA_BATCH_SIZE; i++) {
      if (pagasaIndex >= pagasaAlerts.length) break;

      balanced.push(pagasaAlerts[pagasaIndex]);
      pagasaIndex++;
    }

    // Take up to 10 PHIVOLCS alerts.
    for (let i = 0; i < PHIVOLCS_BATCH_SIZE; i++) {
      if (phivolcsIndex >= phivolcsAlerts.length) break;

      balanced.push(phivolcsAlerts[phivolcsIndex]);
      phivolcsIndex++;
    }
  }

  return balanced.slice(startOffset, startOffset + limit);
}

app.get("/getAlerts", async (req, res) => {
  try {
    const offset = Math.max(
      0,
      Number.parseInt(String(req.query.offset ?? "0"), 10) || 0
    );

    const limit = 50;

    const [pagasaRaw, phivolcsRaw] = await Promise.all([
      fetchPagasaAlerts(),
      fetchPhivolcsAlerts(),
    ]);

    const pagasaAlerts = pagasaRaw
      .map(normalizePagasa)
      .sort(
        (a, b) =>
          new Date(b.issued_at).getTime() -
          new Date(a.issued_at).getTime()
      );

    const phivolcsAlerts = phivolcsRaw
      .map(normalizePhivolcs)
      .sort(
        (a, b) =>
          new Date(b.issued_at).getTime() -
          new Date(a.issued_at).getTime()
      );

    // Build a balanced stream:
    // 10 PAGASA, then 10 PHIVOLCS, repeatedly.
    const balancedAlerts = [];

    let pagasaIndex = 0;
    let phivolcsIndex = 0;

    while (
      balancedAlerts.length < offset + limit &&
      (pagasaIndex < pagasaAlerts.length ||
        phivolcsIndex < phivolcsAlerts.length)
    ) {
      // Take up to 10 PAGASA alerts.
      for (
        let i = 0;
        i < 10 && pagasaIndex < pagasaAlerts.length;
        i++
      ) {
        balancedAlerts.push(pagasaAlerts[pagasaIndex++]);
      }

      // Take up to 10 PHIVOLCS alerts.
      for (
        let i = 0;
        i < 10 && phivolcsIndex < phivolcsAlerts.length;
        i++
      ) {
        balancedAlerts.push(phivolcsAlerts[phivolcsIndex++]);
      }
    }

    const alerts = balancedAlerts.slice(offset, offset + limit);

    console.log(
      `getAlerts offset=${offset} returning ${alerts.length} alerts`
    );

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
