/**
 * Capitalization helpers for person and address fields.
 *
 * Applied at submit/save time so the user's typing is never disrupted mid-stream
 * and so that a user who intentionally types "iPhone Clinic" or "deWitt" still
 * has a chance to override after the field loses focus.
 *
 * Conservative on purpose: empty strings round-trip empty, all-caps acronyms
 * stay caps, words that already have an internal capital are left alone, and
 * separators (hyphen, apostrophe, period) all get their following letter
 * capitalized so names like "o'connor-smith" or "st. john" come out correctly.
 */

const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const SMALL_WORDS = new Set(["of", "the", "and", "de", "la", "le", "von", "van", "del"]);

function capitalizeWord(word: string): string {
  if (!word) return word;
  // Mixed case (has both upper and lower letters) — assume the user meant it
  // (e.g. "McDonald", "deWitt", "iPhone").
  if (/\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) return word;
  // Keep an explicitly all-caps token of two or more Unicode letters as typed.
  // It may be an acronym (e.g. "ENT", "OB", "GYN", "USA"); normalizing it
  // would lose user intent.
  if (/^\p{Lu}{2,}$/u.test(word)) return word;

  const lower = word.toLowerCase();

  // Roman numeral / generational suffixes get fully capitalized.
  if (SUFFIX_TOKENS.has(lower)) {
    return lower === "jr" || lower === "sr" ? lower[0].toUpperCase() + lower.slice(1) : lower.toUpperCase();
  }

  return lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

function capitalizeTitleCaseWord(word: string): string {
  if (!word) return word;
  // Mixed case (has both upper and lower letters) — assume the user meant it
  // (e.g. "iPhone").
  if (/\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) return word;
  // Keep an explicitly all-caps token of two or more Unicode letters as typed.
  // It may be an acronym (e.g. "ENT", "OB", "GYN", "CVS"); normalizing it
  // would lose user intent.
  if (/^\p{Lu}{2,}$/u.test(word)) return word;

  const lower = word.toLowerCase();
  return lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

// Capitalize after Unicode letters only; preserves separators like '-', "'", '.' verbatim
// so "o'connor-smith" -> "O'Connor-Smith" and "st. john" -> "St. John".
function titleCaseSegment(segment: string): string {
  return segment.replace(/(\p{L}+)/gu, (match) => capitalizeWord(match));
}

function titleCaseTextSegment(segment: string): string {
  return segment.replace(/(\p{L}+)/gu, (match) => capitalizeTitleCaseWord(match));
}

/**
 * Title-case a person's name. Handles multi-word names, hyphenated last names,
 * apostrophes, and generational suffixes.
 *
 *   "mary jane o'connor-smith" -> "Mary Jane O'Connor-Smith"
 *   "JOHN DOE JR"              -> "JOHN DOE JR"
 *   "dr. jane smith"           -> "Dr. Jane Smith"
 */
export function formatPersonName(value: string): string {
  if (!value) return value;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .map((word) => titleCaseSegment(word))
    .join(" ");
}

/**
 * Title-case general text fields while preserving existing acronym tokens.
 * Unlike formatPersonName, this does not apply person-name-specific suffix
 * handling.
 *
 *   "ear, nose & throat" -> "Ear, Nose & Throat"
 *   "CVS pharmacy"       -> "CVS Pharmacy"
 *   "OB/GYN"             -> "OB/GYN"
 */
export function formatTitleCase(value: string): string {
  if (!value) return value;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .map((word) => titleCaseTextSegment(word))
    .join(" ");
}

/**
 * Title-case a street address line. Numbers and unit tokens pass through
 * unchanged.
 *
 *   "123 oak ridge dr"   -> "123 Oak Ridge Dr"
 *   "456 N main st apt 2"-> "456 N Main St Apt 2"
 */
export function formatStreetAddress(value: string): string {
  if (!value) return value;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .map((word) => {
      // Leave numeric tokens and ordinals alone: "123", "456a", "5th", "21st".
      if (/^\d+(\p{L}{0,3})?$/u.test(word)) return word.toLowerCase();
      return titleCaseSegment(word);
    })
    .join(" ");
}

/**
 * Title-case a city name. Multi-word city names like "fort worth" or
 * "st. louis" come out properly cased; small connector words like "of" are
 * lowercased except when they lead.
 *
 *   "fort worth"        -> "Fort Worth"
 *   "isle of palms"     -> "Isle of Palms"
 *   "ST. LOUIS"         -> "St. Louis"
 */
export function formatCity(value: string): string {
  if (!value) return value;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const words = trimmed.split(" ");
  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && SMALL_WORDS.has(lower)) return lower;
      return titleCaseSegment(word);
    })
    .join(" ");
}

/**
 * Normalize a US state field. Two-letter abbreviations are uppercased; longer
 * full state names are title-cased.
 *
 *   "tx"             -> "TX"
 *   "Tx"             -> "TX"
 *   "north dakota"   -> "North Dakota"
 *   "NEW YORK"       -> "New York"
 */
export function formatState(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\p{L}{2}$/u.test(trimmed)) return trimmed.toUpperCase();
  return formatCity(trimmed);
}
