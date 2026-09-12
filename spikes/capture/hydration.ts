import { isRecord, ProbeError } from '../shared/errors';

/** Decode only JSON data, never evaluate the page's JavaScript. Unknown tagged
 * values become null so they cannot supply false conversation evidence. */
export function decodeTable(table: unknown[]): unknown {
  if (table.length > 200000) throw new ProbeError('LIMIT_EXCEEDED', 'Hydration table too large');
  const cache = new Map<number, unknown>();
  function resolve(index: unknown, depth: number): unknown {
    if (depth > 200) throw new ProbeError('LIMIT_EXCEEDED', 'Hydration nesting too deep');
    if (!Number.isInteger(index)) return null;
    const id = index as number;
    if (id < 0) return null;
    if (id >= table.length) throw new ProbeError('INVALID_TABLE', 'Reference outside table');
    if (cache.has(id)) return cache.get(id);
    const value = table[id];
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') return null;
      const result: unknown[] = [];
      cache.set(id, result);
      for (const ref of value) result.push(resolve(ref, depth + 1));
      return result;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    cache.set(id, result);
    for (const [key, ref] of Object.entries(value)) {
      if (!/^_\d+$/.test(key)) continue;
      const decodedKey = resolve(Number(key.slice(1)), depth + 1);
      if (typeof decodedKey !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(decodedKey)) continue;
      result[decodedKey] = resolve(ref, depth + 1);
    }
    return result;
  }
  return resolve(0, 0);
}

export interface ParseCounts { enqueueCalls: number; rejectedChunks: number; }

export function extractJsonDocuments(scriptTexts: string[], counts?: ParseCounts): unknown[] {
  const documents: unknown[] = [];
  let total = 0;
  for (const script of scriptTexts) {
    total += script.length;
    if (total > 20000000) throw new ProbeError('LIMIT_EXCEEDED', 'Page scripts exceed probe limit');
    const plain = script.trim();
    if (plain.startsWith('{') || plain.startsWith('[')) {
      try { documents.push(JSON.parse(plain)); } catch { /* Not JSON. Never eval. */ }
    }
    const pattern = /streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g;
    for (const match of script.matchAll(pattern)) {
      if (counts) counts.enqueueCalls++;
      try {
        const encoded: unknown = JSON.parse(match[1]!);
        if (typeof encoded !== 'string' || !encoded.trimStart().startsWith('[')) {
          if (counts) counts.rejectedChunks++;
          continue;
        }
        const table: unknown = JSON.parse(encoded);
        if (Array.isArray(table)) documents.push(decodeTable(table));
      } catch { if (counts) counts.rejectedChunks++; }
    }
  }
  return documents;
}

export function findConversationGraphs(documents: unknown[], id: string, counts?: { graphObjects: number; otherConversationGraphs: number }): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const queue = [...documents];
  for (let position = 0; position < queue.length; position++) {
    if (position > 200000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many data objects');
    const value = queue[position];
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (isRecord(value) && isRecord(value.mapping) && typeof value.current_node === 'string') {
      if (counts) counts.graphObjects++;
      if (value.conversation_id === id || value.id === id) found.push(value);
      else if (counts) counts.otherConversationGraphs++;
    }
    const children: unknown[] = Object.values(value);
    for (const child of children) queue.push(child);
  }
  return found;
}

export function inspectHydration(scriptTexts: string[], id: string) {
  const counts = { enqueueCalls: 0, rejectedChunks: 0, graphObjects: 0, otherConversationGraphs: 0 };
  const documents = extractJsonDocuments(scriptTexts, counts);
  const graphs = findConversationGraphs(documents, id, counts);
  return { graphs, diagnostics: {
    ...counts, scriptCount: scriptTexts.length,
    scriptCharacters: scriptTexts.reduce((total, text) => total + text.length, 0),
    parsedDocuments: documents.length, matchingGraphs: graphs.length,
    scriptsMentionCurrentId: scriptTexts.some(text => text.includes(id)),
    scriptsMentionMapping: scriptTexts.some(text => text.includes('mapping')),
    scriptsMentionCurrentNode: scriptTexts.some(text => text.includes('current_node')),
  } };
}
