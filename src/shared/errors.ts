export class ProbeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireRecord(value: unknown, code = 'INVALID_INPUT'): Record<string, unknown> {
  if (!isRecord(value)) throw new ProbeError(code, 'Expected a JSON object');
  return value;
}
