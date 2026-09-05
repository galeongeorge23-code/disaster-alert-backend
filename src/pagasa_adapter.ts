import puppeteer from 'puppeteer';

interface PagasaBulletin {
  cycloneId: string;
  bulletinNumber: number;
  cycloneName: string;
  category: string;
  issuedAt: string;
  expiresAt: string | null;
  affectedAreas: Array<{ name: string; psgcCode: string | null; signalLevel: number }>;
  instructions: string[];
}

const PAGASA_BULLETIN_URL = 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin';

  export async function fetchPagasaAlertsReal(): Promise<PagasaBulletin[]> {
  let browser;
  try {
    console.log("PAGASA: ENTERING PUPPETEER");

    console.log(
      "PAGASA: EXECUTABLE PATH =",
      process.env.PUPPETEER_EXECUTABLE_PATH
    );

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    console.log("PAGASA: CHROME LAUNCHED");
    
    const page = await browser.newPage();
    await page.goto(PAGASA_BULLETIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const html = await page.content();

    console.log('PAGASA: Puppeteer fetched page successfully');
    console.log(`PAGASA: HTML le  ngth = ${html.length}`);
    console.log(`PAGASA: Page title = ${await page.title()}`);
    console.log(
      `PAGASA: No Active Tropical Cyclone match = ${/No Active Tropical Cyclone/i.test(html)}`
    );
    await browser.close();
    
    // Check for "No Active Tropical Cyclone"
    if (/No Active Tropical Cyclone/i.test(html)) {
      console.log('PAGASA: No active tropical cyclone on website');
      return getPagasaFallbackData();
    }
    
    // TODO: Parse the HTML here (use cheerio or your existing parser)
    // For now, return fallback
    console.log('PAGASA: Page loaded but parsing not yet implemented');
    return getPagasaFallbackData();
    
  } catch (error) {
    console.error('PAGASA Puppeteer error:', error);
    console.log('Using PAGASA fallback data...');
    return getPagasaFallbackData();
  }
}

function getPagasaFallbackData(): PagasaBulletin[] {
  const now = new Date();
  const issuedAt = new Date(now.getTime() - 2 * 60 * 60000);

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
      ],
    },
  ];
}