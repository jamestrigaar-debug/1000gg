/**
 * Clamps a numeric value within the range [min, max].
 * @param value Number to clamp
 * @param min Lower bound
 * @param max Upper bound
 * @returns Clamped number
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linearly interpolates between value a and b by factor t.
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor in [0, 1]
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Calculates Euclidean distance between two 2D points.
 * @param x1 Start X
 * @param y1 Start Y
 * @param x2 End X
 * @param y2 End Y
 * @returns Euclidean distance
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
