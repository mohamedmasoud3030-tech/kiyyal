const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/**
 * Accepts the formats an owner actually types on an Egyptian keypad
 * (012XXXXXXXX, Arabic-Indic digits, 20..., +20...) and converts them to the
 * E.164 string the identity provider stores. Returns null when the input
 * cannot be a phone.
 */
export function normalizeOwnerPhone(raw: string): string | null {
  const compact = raw
    .trim()
    .replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] ?? digit)
    .replace(/[\s().-]/g, '');
  let normalized = compact;
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  else if (normalized.startsWith('0')) normalized = `+2${normalized}`;
  else if (normalized.startsWith('1') && normalized.length === 10) normalized = `+2${normalized}`;
  else if (!normalized.startsWith('+')) normalized = `+${normalized}`;
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}
