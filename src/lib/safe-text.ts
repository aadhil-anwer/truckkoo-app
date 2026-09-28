/**
 * Text safety at output boundaries. SECURITY.md §7.
 *
 * Two concrete threats in this app:
 *
 * 1. **The WhatsApp deep link is an injection sink.** Cargo descriptions, city
 *    names and person names flow into a `wa.me/...?text=` query parameter.
 *    Unencoded, a `&` or newline lets an attacker restructure the message a
 *    victim is about to send.
 *
 * 2. **Bidi overrides are a spoofing vector in a bilingual RTL UI.** A name
 *    containing U+202E (RIGHT-TO-LEFT OVERRIDE) renders following text
 *    reversed, so "Muscat → Salalah" can be made to *display* as
 *    "Salalah → Muscat" while the stored data says otherwise. In an
 *    Arabic/English app nobody looks twice at reversed text.
 *
 * The database rejects these too (`public.contains_unsafe_text`). Both layers
 * exist on purpose: a client-side control is not a control, and a server that
 * has already stored a hostile string still has to render it.
 */

// Written as \u escapes on purpose: these characters are invisible in an editor,
// so a literal character class would be unreviewable and silently corruptible.

/** U+202A–U+202E (embedding/override) and U+2066–U+2069 (isolates). */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

/** C0 controls except tab (09), LF (0A), CR (0D), plus DEL and C1. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Zero-width characters used to hide content inside a visible string. */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Strip anything that can lie about what a string says.
 *
 * Use on every user-supplied string before it is displayed or interpolated.
 * Not a validator — it never throws. Rejection happens server-side; this is
 * about never *rendering* a lie.
 */
export function safeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(BIDI_CONTROLS, '')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .trim();
}

/**
 * True when a string carries characters that misrepresent its own content.
 *
 * Note the non-global copies: `RegExp.test` on a `/g` pattern advances
 * `lastIndex`, so reusing the constants above would make this return
 * true/false alternately for the same input.
 */
const BIDI_TEST = new RegExp(BIDI_CONTROLS.source);
const CONTROL_TEST = new RegExp(CONTROL_CHARS.source);
const ZERO_WIDTH_TEST = new RegExp(ZERO_WIDTH.source);

export function hasUnsafeText(input: string | null | undefined): boolean {
  if (!input) return false;
  return (
    BIDI_TEST.test(input) || CONTROL_TEST.test(input) || ZERO_WIDTH_TEST.test(input)
  );
}

/** Collapse newlines and clamp length for single-line display. */
export function oneLine(input: string | null | undefined, max = 160): string {
  const cleaned = safeText(input).replace(/\s+/g, ' ');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** The one WhatsApp number, from the website. Single source of truth. */
export const WHATSAPP_NUMBER = '96875172824';

/**
 * Build a WhatsApp deep link.
 *
 * Every interpolated value is sanitised and then `encodeURIComponent`-encoded.
 * Never assemble this URL by hand at a call site — that is how the encoding
 * gets skipped exactly once, which is all it takes.
 */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(safeText(message))}`;
}

/**
 * Turn-by-turn directions in Google Maps, from wherever the driver is (D7's
 * "Directions to Sohar"). Our map shows the corridor at about a pixel a
 * kilometre; navigating is Google's job, and every driver already has the app.
 *
 * The universal URL opens the Google Maps app when it is installed and the
 * browser when it is not, on both platforms. Digits are `toFixed`, never
 * `formatNumber`: in Arabic that renders ١٧٫٠٢, which Google cannot read. A URL
 * is not copy. Anything that is not a finite coordinate gives no link, so the
 * caller shows no button rather than a link to nowhere.
 */
export function directionsLink(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const destination = encodeURIComponent(`${lat.toFixed(6)},${lng.toFixed(6)}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}
