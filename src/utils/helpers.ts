// ============ Date Formatting ============

/**
 * Format date to local YYYY-MM-DD string
 */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Format timestamp to time string (HH:MM)
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Format timestamp to full datetime string
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatLocalDate(date)} ${formatTime(timestamp)}`;
}

// ============ File Helpers ============

/**
 * Get display name from file path
 */
export function getFileDisplayName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Check if file is an image based on extension
 */
export function isImageFile(path: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(path);
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  const match = path.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

// ============ String Helpers ============

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

// ============ Animation Helpers ============

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
