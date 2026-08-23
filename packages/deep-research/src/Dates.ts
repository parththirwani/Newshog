const ISO_PATTERNS = [
  /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  /(\d{4}-\d{2}-\d{2})/,
];

// Full + common-abbreviated spellings per month, in calendar order.
const MONTH_VARIANTS: string[][] = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];
const MONTH_ALIASES = MONTH_VARIANTS.flat();
const MONTH_NAME_BODY = MONTH_ALIASES.join("|");
// "May 12, 2026" / "12 May 2026" / "Sep 1 2026" — 4-digit-year forms only, to
// avoid matching "on the 12th of May" or two-digit years in a sentence.
const NAME_PATTERN = new RegExp(
  `\\b((?:${MONTH_NAME_BODY})\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+((?:${MONTH_NAME_BODY})\\.?)\\s+(\\d{4})\\b`,
  "i",
);

export function monthIndex(name: string): number {
  const key = name.replace(".", "").toLowerCase();
  const i = MONTH_VARIANTS.findIndex((variants) => variants.includes(key));
  return Math.max(0, i);
}

const META_KEYS = [
  "datePublished",
  "article:published_time",
  "publish_date",
  "published",
  "pubdate",
  "og:published_time",
];

const HALF_LIFE_CAP = "2099-12-31T00:00:00.000Z";

/**
 * The single publish-date extractor for the whole app. Reads the most likely
 * article publish date from scraped text/markdown (or an explicit HTML string
 * with meta/JSON-LD). Returns a normalized ISO date or null when none is
 * findable. Using one extractor for both the submitted article and every
 * research source keeps date semantics consistent — never build a second one.
 */
export function extractPublishDate(source: string | null | undefined): Date | null {
  if (!source) return null;
  const text = source.slice(0, 8_000);
  const haystack = text.toLowerCase();

  for (const key of META_KEYS) {
    const meta = matchMeta(text, key);
    if (meta) {
      const d = parseDateString(meta);
      if (isSane(d)) return d;
    }
  }

  for (const re of ISO_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const d = parseDateString(m[1]);
    if (isSane(d)) return d;
  }

  const named = NAME_PATTERN.exec(haystack);
  if (named) {
    let d: Date | null = null;
    if (named[1]) d = new Date(Date.UTC(Number(named[3]), monthIndex(named[1]), Number(named[2])));
    else if (named[4]) d = new Date(Date.UTC(Number(named[6]), monthIndex(named[5]), Number(named[4])));
    if (d && isSane(d)) return d;
  }

  return null;
}

function matchMeta(text: string, key: string): string | null {
  // JSON-LD: "datePublished":"2023-05-02" then plain meta property/value.
  const ld = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text);
  if (ld) return ld[1];
  const prop = new RegExp(`property=["']${key}["'][^>]*content=["']([^"']+)["']`).exec(text);
  if (prop) return prop[1];
  const contentFirst = new RegExp(`content=["']([^"']+)["'][^>]*property=["']${key}["']`).exec(text);
  return contentFirst?.[1] ?? null;
}

function parseDateString(value: string): Date | null {
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Reject absurd years (parsers can grab a fragment like "2023-" → 2023-01-01). */
function isSane(d: Date | null): boolean {
  if (!d) return false;
  const year = d.getUTCFullYear();
  return year >= 1980 && year <= 2099 && d.getTime() <= Date.parse(HALF_LIFE_CAP);
}