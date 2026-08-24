/**
 * h3_lookup.ts
 *
 * Loads psgc_h3_mapping.json once at server startup and exposes two
 * resolver functions:
 *   - resolvePsgcToH3(psgcCode)   -> for PAGASA (area names -> PSGC -> H3)
 *   - resolveLatLngToH3(lat,lng)  -> for PHIVOLCS (already has coordinates)
 *
 * Drop this file next to server.ts (e.g. src/h3_lookup.ts) and place
 * psgc_h3_mapping.json in the same directory or adjust MAPPING_PATH below.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from "fs";
import path from "path";
import * as h3 from "h3-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAPPING_PATH = path.join(__dirname, "psgc_h3_mapping.json");
interface AdminAreaEntry {
  name: string | null;
  centroid_h3: string | null;
  h3_cells: string[];
  region_psgc?: number | null;
  province_psgc?: number | null;
}

interface PsgcH3Mapping {
  generated_at: string;
  h3_resolution: number;
  provinces: Record<string, AdminAreaEntry>;
  municipalities: Record<string, AdminAreaEntry>;
}

let mapping: PsgcH3Mapping | null = null;

function loadMapping(): PsgcH3Mapping {
  if (mapping) return mapping;

  if (!fs.existsSync(MAPPING_PATH)) {
    throw new Error(
      `psgc_h3_mapping.json not found at ${MAPPING_PATH}. ` +
        `Run generate_psgc_h3_mapping.js and copy its output next to this file.`
    );
  }

  const raw = fs.readFileSync(MAPPING_PATH, "utf8");
  mapping = JSON.parse(raw) as PsgcH3Mapping;
  console.log(
    `[h3_lookup] Loaded PSGC->H3 mapping: ${Object.keys(mapping.provinces).length} provinces, ` +
      `${Object.keys(mapping.municipalities).length} municipalities, resolution ${mapping.h3_resolution} ` +
      `(generated ${mapping.generated_at})`
  );
  return mapping;
}

// Load eagerly on module import so a bad/missing file fails fast at boot
// rather than silently on the first request.
loadMapping();

/**
 * Resolves a PSGC code (province OR municipality/city level — both key
 * spaces are checked) to its H3 cell coverage. Returns the municipality-level
 * entry when available for finer precision, otherwise falls back to the
 * province-level entry containing it, otherwise null (unmapped area —
 * known gap for the ~5 islands with null source geometry and for
 * independently-chartered cities not present in the 2023 boundary dataset,
 * e.g. Cebu City; log these and fall back to text-only area matching for now).
 */
export function resolvePsgcToH3(psgcCode: string | number): {
  h3_cells: string[];
  centroid_h3: string | null;
  matchedLevel: "municipality" | "province" | "unmatched";
} {
  const m = loadMapping();
  const key = String(psgcCode);

  const muni = m.municipalities[key];
  if (muni) {
    return {
      h3_cells: muni.h3_cells,
      centroid_h3: muni.centroid_h3,
      matchedLevel: "municipality",
    };
  }

  const prov = m.provinces[key];
  if (prov) {
    return {
      h3_cells: prov.h3_cells,
      centroid_h3: prov.centroid_h3,
      matchedLevel: "province",
    };
  }

  return { h3_cells: [], centroid_h3: null, matchedLevel: "unmatched" };
}

/**
 * Resolves a raw lat/long (PHIVOLCS earthquake epicenters) directly to its
 * H3 cell at the same resolution used to build the PSGC mapping, so the two
 * hazard sources stay comparable in Alert.matchesH3() on the client.
 */
export function resolveLatLngToH3(lat: number, lng: number): string {
  const m = loadMapping();
  return h3.latLngToCell(lat, lng, m.h3_resolution);
}

export function getH3Resolution(): number {
  return loadMapping().h3_resolution;
}
