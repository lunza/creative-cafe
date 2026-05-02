export function ensurePositiveInteger(value: any, defaultValue: number): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    return defaultValue;
  }
  return Math.max(1, Math.floor(num));
}

export function ensureStringNotEmpty(value: any, defaultValue: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return defaultValue;
}
