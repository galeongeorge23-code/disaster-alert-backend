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

export async function fetchPhivolcsAlertsReal(): Promise<RawPhivolcsRow[]> {
  const html = await fetchHtml();
  console.log('PHIVOLCS HTML length:', html.length);

  const $ = cheerio.load(html);
  const $table = $('table.MsoNormalTable');

  if ($table.length === 0) {
    throw new Error(
      'PHIVOLCS earthquake table not found on page (selector may be stale)',
    );
  }

  const rows: RawPhivolcsRow[] = [];
  let headerSkipped = false;

  $table.find('tr').each((_, row) => {
    const $row = $(row);
    const $cols = $row.find('td');

    if ($cols.length < 6) return;

    // Skip header row (contains "enter new event below" comment)
    if (!headerSkipped && $row.text().includes('enter new event')) {
      headerSkipped = true;
      return;
    }

    // Extract text from td, but check nested spans first
    const getText = (index: number): string => {
      const $col = $cols.eq(index);
      // First try to get text from nested spans (new HTML structure)
      const $spans = $col.find('span');
      if ($spans.length > 0) {
        return $spans
          .map((_, s) => $(s).text().trim())
          .get()
          .join(' ')
          .trim();
      }
      // Fallback to direct text (old HTML structure)
      return $col.text().trim();
    };

    const rawDateTime = getText(0);
    const latStr = getText(1);
    const lngStr = getText(2);
    const depthStr = getText(3);
    const magStr = getText(4);
    const location = getText(5).replace(/\s+/g, ' ');

    // Parse numbers
    const latitude = parseFloat(latStr);
    const longitude = parseFloat(lngStr);
    const depth = parseFloat(depthStr);
    const magnitude = parseFloat(magStr);

    // Skip invalid rows
    if (!rawDateTime || !location || Number.isNaN(magnitude)) {
      console.debug(`Skipping row: date="${rawDateTime}" mag="${magStr}" loc="${location}"`);
      return;
    }

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
    throw new Error(
      'PHIVOLCS table found but zero rows parsed -- HTML structure may have changed',
    );
  }

  console.log(`PHIVOLCS: Parsed ${rows.length} earthquakes`);
  return rows;
}

function parsePhivolcsDateTime(raw: string): string {
  const parsed = new Date(raw.replace(' - ', ' '));

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  console.warn(
    `PHIVOLCS date "${raw}" did not parse cleanly -- using fetch time as fallback`,
  );

  return new Date().toISOString();
}

function fetchHtml(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = https.get(
      PHIVOLCS_URL,
      {
        headers: {
          'User-Agent': 'DisasterAlertApp-SchoolResearchProject/0.1',
        },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (res: import('http').IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(
              `PHIVOLCS fetch failed: HTTP ${res.statusCode}`,
            ),
          );
          return;
        }

        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          resolve(data);
        });

        res.on('error', reject);
      },
    );

    req.on('error', reject);

    req.on('timeout', () => {
      req.destroy(new Error('PHIVOLCS fetch timed out'));
    });
  });
}
