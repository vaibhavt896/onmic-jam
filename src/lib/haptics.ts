/**
 * Motion confirms, never decorates — and on a phone, part of confirming is felt
 * rather than seen.
 *
 * 12ms on a primary press, 40ms on the two moments that matter: the booking
 * landing and the drink being claimed. Android only; iOS Safari ignores
 * navigator.vibrate silently, which is fine — nothing depends on it.
 */
export function haptic(ms: 12 | 40 = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported, blocked, or a browser that dislikes being asked */
  }
}
