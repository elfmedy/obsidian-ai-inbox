import { createHash } from 'node:crypto';
export const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwaPr2HwAFVgKwVpOyIwAAAABJRU5ErkJggg==', 'base64');
export const FIXTURE_HASH = createHash('sha256').update(FIXTURE_PNG).digest('hex');
