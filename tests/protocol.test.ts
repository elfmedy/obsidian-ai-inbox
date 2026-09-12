import { describe, expect, it } from 'vitest';
import { SaveRequest, ReceiptSchema } from '../src/core/schema';
import fixture from '../protocol/save-example.json';
describe('shared wire contract', () => {
  it('accepts the independently versioned companion payload and receipt', () => {
    expect(SaveRequest.parse(fixture.request)).toEqual(fixture.request);
    expect(ReceiptSchema.parse(fixture.receipt)).toEqual(fixture.receipt);
  });
  it('rejects mismatched conversation identities before writing', () => {
    const bad = structuredClone(fixture.request); bad.snapshot.conversationId = 'different';
    expect(SaveRequest.safeParse(bad).success).toBe(false);
  });
});
