/**
 * Once per OPENING: a driver who said "Not now" to the location disclosure is
 * not asked again on every visit to the home screen in the same sitting — but
 * is asked again the next time they open the app, for as long as it is off
 * (founder, 2026-10-08). With location off a driver gets no jobs (0076).
 */
import { currentOpen } from '@/lib/app-opens';

let promptedOpen = 0;

/** True the first time it is called in this opening of the app; false after. */
export function claimLocationPrompt(open: number = currentOpen()): boolean {
  if (promptedOpen === open) return false;
  promptedOpen = open;
  return true;
}

/** For tests: a fresh launch. */
export function __resetLocationPrompt(): void {
  promptedOpen = 0;
}
