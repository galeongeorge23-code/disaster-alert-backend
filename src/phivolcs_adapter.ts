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
    console.log('PHIVOLCS HTML first 1000 chars:');
    console.log(html.substring(0, 1000));

    const $ = cheerio.load(html);
    
    // Try to find ANY table
    const allTables = $('table');
    console.log(`Found ${allTables.length} total tables on page`);
    
    allTables.each((i, table) => {
      const $t = $(table);
      const classes = $t.attr('class');
      const id = $t.attr('id');
      const rows = $t.find('tr').length;
      console.log(`Table ${i}: class="${classes}" id="${id}" rows=${rows}`);
    });

    let $table = $('table.MsoNormalTable');
    if ($table.length === 0) {
      console.log('MsoNormalTable not found, using first table...');
      $table = $('table').first();
    }

    if ($table.length === 0) {
      throw new Error('No tables found on PHIVOLCS page');
    }

    // ... rest of parsing ...

    return [];
  } catch (error) {
    console.error('Error fetching PHIVOLCS alerts:', error);
    return [];
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
      (res: import('http').IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`PHIVOLCS fetch failed: HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        let stream: NodeJS.ReadableStream = res;

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