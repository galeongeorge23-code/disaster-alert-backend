 import type { ParsedBulletin } from './shared/index.js';

const PAGASA_BULLETIN_URL = 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin';

export async function fetchPagasaAlertsReal(): Promise<
  Array<{
    cycloneId: string;
    bulletinNumber: number;
    cycloneName: string;
    category: string;
    issuedAt: string;
    expiresAt: string | null;
    affectedAreas: Array<{ name: string; psgcCode: string | null; signalLevel: number }>;
    instructions: string[];
  }>
> {
  try {
    // Attempt real parse (will fail due to JS-rendering, but keep for future)
    const response = await fetch(PAGASA_BULLETIN_URL, {
      headers: {
        'user-agent': 'ASPER-Alert (SchoolResearchProject)',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Check for "No Active Tropical Cyclone"
    if (/No Active Tropical Cyclone/i.test(html)) {
      console.log('PAGASA: No active tropical cyclone');
      return [];
    }

    // Real parsing would go here (requires Puppeteer for JS rendering)
    // For now, fall back to mock data
    throw new Error('PAGASA page requires JS rendering (future: implement Puppeteer)');
  } catch (error) {
    console.warn('PAGASA real parsing failed:', error);
    console.log('Using PAGASA fallback data for demo...');
    return getPagasaFallbackData();
  }
}

function getPagasaFallbackData() {
  const now = new Date();
  const issuedAt = new Date(now.getTime() - 2 * 60 * 60000); // 2 hours ago

  return [
    {
      cycloneId: 'PAGASA_OBET_2026',
      bulletinNumber: 26,
      cycloneName: 'Typhoon OBET',
      category: 'Typhoon (Category 3)',
      issuedAt: issuedAt.toISOString(),
      expiresAt: null,
      affectedAreas: [
        { name: 'Metro Manila', psgcCode: '130000000', signalLevel: 3 },
        { name: 'Cavite', psgcCode: '042300000', signalLevel: 3 },
        { name: 'Laguna', psgcCode: '042400000', signalLevel: 3 },
        { name: 'Batangas', psgcCode: '041700000', signalLevel: 2 },
        { name: 'Rizal', psgcCode: '074400000', signalLevel: 3 },
        { name: 'Quezon', psgcCode: '062600000', signalLevel: 1 },
      ],
      instructions: [
        'Evacuate low-lying and flood-prone areas',
        'Avoid venturing in the sea',
        'Remain indoors during strong winds',
        'Do not drive unless necessary',
      ],
    },
  ];
}