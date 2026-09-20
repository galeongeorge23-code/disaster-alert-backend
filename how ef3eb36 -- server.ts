[33mcommit ef3eb362c643811547d8a1926d37049e2a1dbbaa[m
Author: Admin <galeongeorge23@gmail.com>
Date:   Tue Sep 1 15:35:07 2026 +0800

    Fix alert pagination and chronological ordering

[1mdiff --git a/server.ts b/server.ts[m
[1mindex a228ccf..c6b2fdb 100644[m
[1m--- a/server.ts[m
[1m+++ b/server.ts[m
[36m@@ -1,22 +1,18 @@[m
 import express from "express";[m
 import { fetchPagasaAlertsReal } from "./src/pagasa_adapter.js";[m
 import { fetchPhivolcsAlertsReal } from "./src/phivolcs_adapter.js";[m
[31m-import { resolvePsgcToH3, resolveLatLngToH3 } from "./src/h3_lookup.js";[m
 [m
 const app = express();[m
 [m
 const TYPHOON_SIGNAL_TRIGGER = 2;[m
 const EARTHQUAKE_MAGNITUDE_TRIGGER = 5.0;[m
 [m
[31m-const DEFAULT_PAGE_SIZE = 50;[m
[31m-const SOURCE_BATCH_SIZE = 10;[m
[31m-[m
[31m-// PAGASA now uses the real parser.[m
[32m+[m[32m// STAGE 2: PAGASA now uses the real parser (ported from bagyo-api).[m
 async function fetchPagasaAlerts() {[m
   return fetchPagasaAlertsReal();[m
 }[m
 [m
[31m-// PHIVOLCS uses the real scraper.[m
[32m+[m[32m// STAGE 2: both PAGASA and PHIVOLCS now use real scrapers.[m
 async function fetchPhivolcsAlerts() {[m
   return fetchPhivolcsAlertsReal();[m
 }[m
[36m@@ -25,17 +21,7 @@[m [mfunction normalizePagasa(raw) {[m
   const areas = raw.affectedAreas.map((a) => ({[m
     area_name: a.name,[m
     psgc_code: a.psgcCode,[m
[31m-    h3_index: (() => {[m
[31m-      const result = resolvePsgcToH3(a.psgcCode);[m
[31m-[m
[31m-      console.log([m
[31m-        `[PAGASA H3] ${a.name} | PSGC: ${a.psgcCode} | ` +[m
[31m-        `Level: ${result.matchedLevel} | ` +[m
[31m-        `H3 cells: ${result.h3_cells.length}`[m
[31m-      );[m
[31m-[m
[31m-      return result.h3_cells;[m
[31m-    })(),[m
[32m+[m[32m    h3_index: `PLACEHOLDER_${a.psgcCode}`, // real PSGC->H3 mapping comes later[m
     signal_level: a.signalLevel,[m
     peis: null,[m
   }));[m
[36m@@ -50,15 +36,11 @@[m [mfunction normalizePagasa(raw) {[m
       typhoon: {[m
         cyclone_name: raw.cycloneName,[m
         category: raw.category,[m
[31m-        max_signal_in_bulletin: Math.max([m
[31m-          ...areas.map((a) => a.signal_level ?? 0)[m
[31m-        ),[m
[32m+[m[32m        max_signal_in_bulletin: Math.max(...areas.map((a) => a.signal_level ?? 0)),[m
       },[m
     },[m
     areas,[m
[31m-    alert_level: areas.some([m
[31m-      (a) => (a.signal_level ?? 0) >= TYPHOON_SIGNAL_TRIGGER[m
[31m-    )[m
[32m+[m[32m    alert_level: areas.some((a) => (a.signal_level ?? 0) >= TYPHOON_SIGNAL_TRIGGER)[m
       ? "active_caching"[m
       : "surveillance",[m
     instructions: raw.instructions ?? [],[m
[36m@@ -84,107 +66,82 @@[m [mfunction normalizePhivolcs(raw) {[m
       {[m
         area_name: raw.location,[m
         psgc_code: null,[m
[31m-        h3_index: [resolveLatLngToH3(raw.latitude, raw.longitude)],[m
[32m+[m[32m        h3_index: `PLACEHOLDER_${raw.latitude}_${raw.longitude}`,[m
         signal_level: null,[m
         peis: null,[m
       },[m
     ],[m
[31m-    alert_level:[m
[31m-      raw.magnitude >= EARTHQUAKE_MAGNITUDE_TRIGGER[m
[31m-        ? "active_caching"[m
[31m-        : "surveillance",[m
[32m+[m[32m    alert_level: raw.magnitude >= EARTHQUAKE_MAGNITUDE_TRIGGER ? "active_caching" : "surveillance",[m
     instructions: [],[m
     raw_payload: JSON.stringify(raw),[m
   };[m
 }[m
 [m
 /**[m
[31m- * Builds a balanced alert page.[m
[32m+[m[32m * Returns a source-balanced page of alerts.[m
  *[m
[31m- * Each round attempts to take:[m
[32m+[m[32m * Alerts are taken in rounds of up to 10:[m
  *   - up to 10 PAGASA alerts[m
  *   - up to 10 PHIVOLCS alerts[m
  *[m
[31m- * This continues until the requested page size is reached.[m
[31m- *[m
[31m- * If one source runs out of alerts, the remaining slots are filled[m
[31m- * from the other source.[m
[32m+[m[32m * If one source runs out of alerts, the other source fills[m
[32m+[m[32m * the remaining slots.[m
  */[m
[31m-function buildBalancedPage(pagasaAlerts, phivolcsAlerts, page, limit) {[m
[31m-  const pagasaStart = page * Math.ceil(limit / 2);[m
[31m-  const phivolcsStart = page * Math.ceil(limit / 2);[m
[31m-[m
[31m-  let pagasaIndex = pagasaStart;[m
[31m-  let phivolcsIndex = phivolcsStart;[m
[31m-[m
[31m-  const result = [];[m
[31m-[m
[31m-  while (result.length < limit) {[m
[31m-    let addedThisRound = false;[m
[31m-[m
[32m+[m[32mfunction getBalancedPage([m
[32m+[m[32m  pagasaAlerts,[m
[32m+[m[32m  phivolcsAlerts,[m
[32m+[m[32m  page,[m
[32m+[m[32m  limit[m
[32m+[m[32m) {[m
[32m+[m[32m  const PAGASA_BATCH_SIZE = 10;[m
[32m+[m[32m  const PHIVOLCS_BATCH_SIZE = 10;[m
[32m+[m
[32m+[m[32m  const startOffset = (page - 1) * limit;[m
[32m+[m
[32m+[m[32m  // Build the complete balanced sequence first.[m
[32m+[m[32m  const balanced = [];[m
[32m+[m
[32m+[m[32m  let pagasaIndex = 0;[m
[32m+[m[32m  let phivolcsIndex = 0;[m
[32m+[m
[32m+[m[32m  while ([m
[32m+[m[32m    pagasaIndex < pagasaAlerts.length ||[m
[32m+[m[32m    phivolcsIndex < phivolcsAlerts.length[m
[32m+[m[32m  ) {[m
     // Take up to 10 PAGASA alerts.[m
[31m-    for ([m
[31m-      let i = 0;[m
[31m-      i < SOURCE_BATCH_SIZE && result.length < limit;[m
[31m-      i++[m
[31m-    ) {[m
[31m-      if (pagasaIndex < pagasaAlerts.length) {[m
[31m-        result.push(pagasaAlerts[pagasaIndex]);[m
[31m-        pagasaIndex++;[m
[31m-        addedThisRound = true;[m
[31m-      } else {[m
[31m-        break;[m
[31m-      }[m
[32m+[m[32m    for (let i = 0; i < PAGASA_BATCH_SIZE; i++) {[m
[32m+[m[32m      if (pagasaIndex >= pagasaAlerts.length) break;[m
[32m+[m
[32m+[m[32m      balanced.push(pagasaAlerts[pagasaIndex]);[m
[32m+[m[32m      pagasaIndex++;[m
     }[m
 [m
     // Take up to 10 PHIVOLCS alerts.[m
[31m-    for ([m
[31m-      let i = 0;[m
[31m-      i < SOURCE_BATCH_SIZE && result.length < limit;[m
[31m-      i++[m
[31m-    ) {[m
[31m-      if (phivolcsIndex < phivolcsAlerts.length) {[m
[31m-        result.push(phivolcsAlerts[phivolcsIndex]);[m
[31m-        phivolcsIndex++;[m
[31m-        addedThisRound = true;[m
[31m-      } else {[m
[31m-        break;[m
[31m-      }[m
[31m-    }[m
[32m+[m[32m    for (let i = 0; i < PHIVOLCS_BATCH_SIZE; i++) {[m
[32m+[m[32m      if (phivolcsIndex >= phivolcsAlerts.length) break;[m
 [m
[31m-    // Both sources have been exhausted.[m
[31m-    if (!addedThisRound) {[m
[31m-      break;[m
[32m+[m[32m      balanced.push(phivolcsAlerts[phivolcsIndex]);[m
[32m+[m[32m      phivolcsIndex++;[m
     }[m
   }[m
 [m
[31m-  return result;[m
[32m+[m[32m  return balanced.slice(startOffset, startOffset + limit);[m
 }[m
 [m
 app.get("/getAlerts", async (req, res) => {[m
   try {[m
[31m-    const page = Math.max([m
[32m+[m[32m    const offset = Math.max([m
       0,[m
[31m-      Number.parseInt(String(req.query.page ?? "0"), 10) || 0[m
[32m+[m[32m      Number.parseInt(String(req.query.offset ?? "0"), 10) || 0[m
     );[m
 [m
[31m-    const limit = Math.min([m
[31m-      100,[m
[31m-      Math.max([m
[31m-        1,[m
[31m-        Number.parseInt([m
[31m-          String(req.query.limit ?? DEFAULT_PAGE_SIZE),[m
[31m-          10[m
[31m-        ) || DEFAULT_PAGE_SIZE[m
[31m-      )[m
[31m-    );[m
[32m+[m[32m    const limit = 50;[m
 [m
     const [pagasaRaw, phivolcsRaw] = await Promise.all([[m
       fetchPagasaAlerts(),[m
       fetchPhivolcsAlerts(),[m
     ]);[m
 [m
[31m-    // Normalize each source separately.[m
     const pagasaAlerts = pagasaRaw[m
       .map(normalizePagasa)[m
       .sort([m
[36m@@ -201,41 +158,53 @@[m [mapp.get("/getAlerts", async (req, res) => {[m
           new Date(a.issued_at).getTime()[m
       );[m
 [m
[31m-    const alerts = buildBalancedPage([m
[31m-      pagasaAlerts,[m
[31m-      phivolcsAlerts,[m
[31m-      page,[m
[31m-      limit[m
[31m-  