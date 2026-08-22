import * as cheerio from 'cheerio';
import https from 'https';

const PHIVOLCS_URL = 'https://earthquake.phivolcs.dost.gov.ph/';

interface RawPhivolcsRow {
  dateTime: string;
  latitude: number;
  longitude: number;
  depth: number;
  magnitude: number;
  location: string;
}

/**
 * Real PHIVOLCS fetch + parse, ported from phivocs-api's fetchEarthquakes.
 * Confirmed against the live page structure during Phase 1: the main
 * catalog table only has date/time, coordinates, depth, origin, magnitude,
 * location -- no intensity data anywhere (see Phase 1 write-up). This
 * scraper only ever needs magnitude, matching the corrected trigger design.
 *
 * SECURITY NOTE, stated plainly rather than buried: this disables TLS
 * certificate verification (rejectUnauthorized: false) for this one host,
 * carried over directly from phivocs-api's original code. That project's
 * author apparently found the fetch fails without it -- likely a
 * certificate configuration issue on PHIVOLCS's server, not something in
 * our control. This is a real trade-off (it means we can't detect a
 * man-in-the-middle attack on this specific request) worth naming
 * explicitly in the paper's methodology/limitations, not quietly inheriting.
 *
 * UNVERIFIED DETAIL: PHIVOLCS's exact date/time text format wasn't
 * directly confirmed during this port. parsePhivolcsDateTime attempts a
 * real parse and falls back to the fetch time (logging a warning) if it
 * fails -- check server logs after first deploy to see which path fired.
 */
export async function fetchPhivolcsAlertsReal(): Promise<RawPhivolcsRow[]> {
  const html = await fetchHtml();
  const $ = cheerio.load(html);
  const $table = $('table.MsoNormalTable');

  if ($table.length === 0) {
    throw new Error('PHIVOLCS earthquake table not found on page (selector may be stale)');
  }

  const rows: RawPhivolcsRow[] = [];

  $table.find('tr').each((_, row) => {
    const $row = $(row);
    const $cols = $row.find('td');
    if ($cols.length < 6) return;

    const $dateLink = $cols.eq(0).find('a');
    const rawDateTime = $dateLink.length ? $dateLink.text().trim() : $cols.eq(0).text().trim();
    if (!rawDateTime) return;

    const latitude = parseFloat($cols.eq(1).text().trim());
    const longitude = parseFloat($cols.eq(2).text().trim());
    const depth = parseFloat($cols.eq(3).text().trim());
    const magnitude = parseFloat($cols.eq(4).text().trim());
    const location = $cols.eq(5).text().replace(/\s+/g, ' ').trim();

    if (!location || Number.isNaN(magnitude)) return;

    rows.push({
      dateTime: parsePhivolcsDateTime(rawDateTime),
      latitude: Number.isNaN(latitude) ? 0 : latitude,
      longitude: Number.isNaN(longitude) ? 0 : longitude,
      depth: Number.isNaN(depth) ? 0 : depth,
      magnitude,
      location,
    });
  });

  if (rows.length === 0) {
    throw new Error('PHIVOLCS table found but zero rows parsed -- selector or column order may have changed');
  }

  return rows;
}

function parsePhivolcsDateTime(raw: string): string {
  const parsed = new Date(raw.replace(' - ', ' '));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  console.warn(`PHIVOLCS date "${raw}" did not parse cleanly -- using fetch time as fallback`);
  return new Date().toISOString();
}

function fetchHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      PHIVOLCS_URL,
      {
        headers: { 'User-Agent': 'DisasterAlertApp-SchoolResearchProject/0.1' },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`PHIVOLCS fetch failed: HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('PHIVOLCS fetch timed out')));
  });
}
