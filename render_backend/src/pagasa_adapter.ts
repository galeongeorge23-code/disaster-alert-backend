import { parseBulletinHtml } from './parser/html.js';
import type { ParsedBulletin } from './shared/index.js';

const PAGASA_BULLETIN_URL = 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin';

/**
 * Real PAGASA fetch + parse, replacing fetchPagasaAlertsMock. Uses a
 * courteous, identifiable User-Agent -- same etiquette bagyo-api's own
 * fetcher documents, even though we're not reusing its full retry/circuit
 * breaker machinery here (kept simple for the prototype; see note below).
 *
 * NOTE ON SCOPE: bagyo-api's own fetcher (apps/worker/src/fetcher.ts) adds
 * retry-with-backoff, a circuit breaker, and >=5s host spacing on top of
 * this. We're intentionally not porting that whole layer -- a single-shot
 * fetch every 15 minutes (this app's own sync interval) already respects
 * the spirit of "don't hammer the host" without needing the full worker
 * infrastructure bagyo-api built for running continuously at scale. Worth
 * stating this simplification explicitly in the paper rather than silently
 * dropping it.
 */
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
  const response = await fetch(PAGASA_BULLETIN_URL, {
    headers: {
      'user-agent':
        'DisasterAlertApp-SchoolResearchProject/0.1 (+https://github.com/YOUR_REPO_HERE)',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`PAGASA fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const { bulletins, issues } = parseBulletinHtml(html, PAGASA_BULLETIN_URL);

  if (issues.length > 0) {
    // Areas that failed to parse cleanly -- logged, not thrown. A handful
    // of unparseable area phrases shouldn't take down the whole sync; the
    // bulletin's other areas are still valid and worth caching.
    console.warn(`PAGASA parse produced ${issues.length} area-parsing issues`, issues);
  }

  return bulletins.map((b: ParsedBulletin) => {
    // Flatten all signal levels' areas into one list; each area keeps its
    // own signalLevel so normalizePagasa can still group by area.
    const affectedAreas = b.signals.flatMap((signal) =>
      signal.areas.map((area) => ({
        name: area.locationName,
        psgcCode: area.psgcCode,
        signalLevel: signal.signalLevel,
      })),
    );

    return {
      cycloneId: b.pagasaName, // PAGASA doesn't expose a separate numeric cyclone id
      bulletinNumber: b.bulletinNumber,
      cycloneName: b.pagasaName,
      category: b.categoryRaw,
      issuedAt: b.issuedAt,
      expiresAt: null, // PAGASA bulletins are superseded, not expired -- same pattern as PHIVOLCS
      affectedAreas,
      instructions: b.headline ? [b.headline] : [],
    };
  });
}
