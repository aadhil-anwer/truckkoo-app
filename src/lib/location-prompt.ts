/**
 * Once per launch: a driver who said "Not now" to the location disclosure is not
 * asked again on every visit to the home screen — only the next time they open
 * the app. Module state, so it resets exactly when the JS runtime does.
 */
let prompted = false;

/** True the first time it is called in this launch; false after. */
export function claimLocationPrompt(): boolean {
  if (prompted) return false;
  prompted = true;
  return true;
}

/** For tests: a fresh launch. */
export function __resetLocationPrompt(): void {
  prompted = false;
}
