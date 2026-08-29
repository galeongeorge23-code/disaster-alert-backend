import * as cheerio from 'cheerio';
import https from 'https';
import { createGunzip } from 'zlib';

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
  try {
    const html = await fetchHtml();
    console.log('PHIVOLCS HTML length:', html.length);

    const $ = cheerio.load(html);

    // Find all MsoNormalTable tables
    const allTables = $('table.MsoNormalTable');
    console.log(`Found ${allTables.length} MsoNormalTable tables on page`);

    // The earthquake data table is the one with 1000+ rows
    let $table: any = null;
    allTables.each((i: number, table: any) => {
      const $t = $(table);
      const rows = $t.find('tr').length;
      console.log(`Table ${i}: ${rows} rows`);

      if (rows > 100 && !$table) {
        console.log(`Using table ${i} with ${rows} rows`);
        $table = $t;
      }
    });

    if (!$table || $table.length === 0) {
      throw new Error('Could not find earthquake data table (1000+ rows)');
    }

    const rows: RawPhivolcsRow[] = [];
    let headerSkipped = false;

    $table.find('tr').each((_: number, row: any) => {
      const $row = $(row);
      const $cols = $row.find('td');

      if ($cols.length < 6) return;

      // Skip header row
      if (!headerSkipped && $row.text().includes('enter new event')) {
        headerSkipped = true;
        return;
      }

      const getText = (index: number): string => {
        const $col = $cols.eq(index);
        const $spans = $col.find('span');
        if ($spans.length > 0) {
          return $spans
            .map((_, s: any) => $(s).text().trim())
            .get()
            .join(' ')
            .trim();
        }
        return $col.text().trim();
      };

      const rawDateTime = getText(0);
      const latStr = getText(1);
      const lngStr = getText(2);
      const depthStr = getText(3);
      const magStr = getText(4);
      const location = getText(5).replace(/\s+/g, ' ');

      const latitude = parseFloat(latStr);
      const longitude = parseFloat(lngStr);
      const depth = parseFloat(depthStr);
      const magnitude = parseFloat(magStr);

      if (!rawDateTime || !location || Number.isNaN(magnitude)) {
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
      throw new Error('Parsed earthquake table but found zero rows');
    }

    console.log(`PHIVOLCS: Parsed ${rows.length} earthquakes`);
    return rows;
  } catch (error) {
    console.error('PHIVOLCS parsing failed:', error);
    throw error;
  }
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
          'Accept-Encoding': 'gzip, deflate',
        },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (res: any) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`PHIVOLCS fetch failed: HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        let stream: any = res;

        // If response is gzipped, decompress it
        if (res.headers['content-encoding'] === 'gzip') {
          console.log('Response is gzip-encoded, decompressing...');
          stream = res.pipe(createGunzip());
        }

        stream.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        stream.on('end', () => {
          resolve(data);
        });

        stream.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('PHIVOLCS fetch timed out'));
    });
  });
}