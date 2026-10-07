/** Normalize digits typed by English, Arabic and Urdu keyboards. Keep other
 * characters intact so each field can apply its own validation rules. */
export function asciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}
