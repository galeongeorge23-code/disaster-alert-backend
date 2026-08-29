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
