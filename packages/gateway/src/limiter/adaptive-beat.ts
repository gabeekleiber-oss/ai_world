/**
 * Adaptive beat length (DESIGN.md section 10): `max(configured_beat_seconds, calls_needed / rpm_budget)`,
 * with the rate in requests per minute, so the result is in seconds.
 *
 * When the API budget binds, beats stretch rather than drop decisions or skew fairness. Pass the
 * limiter's current rate, not the configured one, so a slowdown after a 429 also stretches the beat.
 */
export function adaptiveBeatSeconds(configuredBeatSeconds: number, callsNeeded: number, rpm: number): number {
  if (!(rpm > 0)) throw new RangeError("rpm must be positive");
  if (callsNeeded <= 0) return configuredBeatSeconds;
  return Math.max(configuredBeatSeconds, (callsNeeded / rpm) * 60);
}
