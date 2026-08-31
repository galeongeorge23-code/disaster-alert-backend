import express from "express";
import { fetchPagasaAlertsReal } from "./src/pagasa_adapter.js";
import { fetchPhivolcsAlertsReal } from "./src/phivolcs_adapter.js";
import { resolvePsgcToH3, resolveLatLngToH3 } from "./src/h3_lookup.js";

const app = express();

const TYPHOON_SIGNAL_TRIGGER = 2;
const EARTHQUAKE_MAGNITUDE_TRIGGER = 5.0;

const DEFAULT_PAGE_SIZE = 50;
const SOURCE_BATCH_SIZE = 10;

// PAGASA now uses the real parser.
async function fetchPagasaAlerts() {
  return fetchPagasaAlertsReal();
}

// PHIVOLCS uses the real scraper.
async function fetchPhivolcsAlerts() {
  return fetchPhivolcsAlertsReal();
}

function normalizePagasa(raw) {
  const areas = raw.affectedAreas.map((a) => ({
    area_name: a.name,
    psgc_code: a.psgcCode,
    h3_index: (() => {
      const result = resolvePsgcToH3(a.psgcCode);

      console.log(
        `[PAGASA H3] ${a.name} | PSGC: ${a.psgcCode} | ` +
        `Level: ${result.matchedLevel} | ` +
        `H3 cells: ${result.h3_cells.length}`
      );

      return result.h3_cells;
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
        max_signal_in_bulletin: Math.max(
          ...areas.map((a) => a.signal_level ?? 0)
        ),
      },
    },
    areas,
    alert_level: areas.some(
      (a) => (a.signal_level ?? 0) >= TYPHOON_SIGNAL_TRIGGER
    )
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
    alert_level:
      raw.magnitude >= EARTHQUAKE_MAGNITUDE_TRIGGER
        ? "active_caching"
        : "surveillance",
    instructions: [],
    raw_payload: JSON.stringify(raw),
  };
}

/**
 * Builds a balanced alert page.
 *
 * Each round attempts to take:
 *   - up to 10 PAGASA alerts
 *   - up to 10 PHIVOLCS alerts
 *
 * This continues until the requested page size is reached.
 *
 * If one source runs out of alerts, the remaining slots are filled
 * from the other source.
 */
function buildBalancedPage(pagasaAlerts, phivolcsAlerts, page, limit) {
  const pagasaStart = page * Math.ceil(limit / 2);
  const phivolcsStart = page * Math.ceil(limit / 2);

  let pagasaIndex = pagasaStart;
  let phivolcsIndex = phivolcsStart;

  const result = [];

  while (result.length < limit) {
    let addedThisRound = false;

    // Take up to 10 PAGASA alerts.
    for (
      let i = 0;
      i < SOURCE_BATCH_SIZE && result.length < limit;
      i++
    ) {
      if (pagasaIndex < pagasaAlerts.length) {
        result.push(pagasaAlerts[pagasaIndex]);
        pagasaIndex++;
        addedThisRound = true;
      } else {
        break;
      }
    }

    // Take up to 10 PHIVOLCS alerts.
    for (
      let i = 0;
      i < SOURCE_BATCH_SIZE && result.length < limit;
      i++
    ) {
      if (phivolcsIndex < phivolcsAlerts.length) {
        result.push(phivolcsAlerts[phivolcsIndex]);
        phivolcsIndex++;
        addedThisRound = true;
      } else {
        break;
      }
    }

    // Both sources have been exhausted.
    if (!addedThisRound) {
      break;
    }
  }

  return result;
}

app.get("/getAlerts", async (req, res) => {
  try {
    const page = Math.max(
      0,
      Number.parseInt(String(req.query.page ?? "0"), 10) || 0
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(
          String(req.query.limit ?? DEFAULT_PAGE_SIZE),
          10
        ) || DEFAULT_PAGE_SIZE
      )
    );

    const [pagasaRaw, phivolcsRaw] = await Promise.all([
      fetchPagasaAlerts(),
      fetchPhivolcsAlerts(),
    ]);

    // Normalize each source separately.
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

    const alerts = buildBalancedPage(
      pagasaAlerts,
      phivolcsAlerts,
      page,
      limit
    );

    const hasMore =
      (page + 1) * Math.ceil(limit / 2) < pagasaAlerts.length ||
      (page + 1) * Math.ceil(limit / 2) < phivolcsAlerts.length;

    console.log(
      `getAlerts page=${page}, limit=${limit}: ` +
      `${alerts.length} alerts ` +
      `(PAGASA available: ${pagasaAlerts.length}, ` +
      `PHIVOLCS available: ${phivolcsAlerts.length}, ` +
      `hasMore: ${hasMore})`
    );

    res.status(200).json({
      alerts,
      page,
      limit,
      has_more: hasMore,
      total_returned: alerts.length,
    });
  } catch (err) {
    console.error("getAlerts failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Render/free hosts provide PORT through the environment.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});