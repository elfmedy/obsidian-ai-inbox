import { isRecord } from '../shared/errors';

const fields = new Set(['id', 'conversation_id', 'current_node', 'mapping', 'messages', 'turns', 'items', 'nodes',
  'data', 'conversation', 'result', 'payload', 'pagination', 'page_info', 'message', 'content', 'parts',
  'author', 'role', 'channel', 'status', 'parent', 'children', 'title', 'create_time', 'update_time',
  'has_more', 'has_more_messages', 'has_more_turns', 'has_next', 'has_previous', 'has_older_messages',
  'next_cursor', 'previous_cursor', 'cursor', 'total', 'total_count', 'total_messages', 'num_turns', 'is_complete',
  'has_previous_page', 'has_next_page', 'start_cursor', 'end_cursor']);
const wrappers = ['data', 'conversation', 'result', 'payload', 'pagination', 'page_info', 'message'];
const moreFlags = ['has_more', 'has_more_messages', 'has_more_turns', 'has_next', 'has_previous', 'has_older_messages', 'has_previous_page', 'has_next_page'];

/** Only schema categories and numeric/boolean pagination hints leave the page.
 * Titles, message text, IDs, cursor strings and unrecognized keys are omitted. */
export function summarizeResponseShape(input: unknown) {
  const objects: Array<{ location: string; fields: Record<string, { type: string; count?: number }>;
    unknownFields: number; pagination: Record<string, boolean | number | 'present'> }> = [];
  let explicitlyPartial = false;
  const seen = new Set<object>();
  function visit(value: unknown, location: string, depth: number) {
    if (depth > 3 || objects.length >= 16 || !isRecord(value) || seen.has(value)) return;
    seen.add(value);
    const descriptors: Record<string, { type: string; count?: number }> = {};
    const pagination: Record<string, boolean | number | 'present'> = {};
    let unknownFields = 0;
    for (const key of Object.keys(value)) {
      if (!fields.has(key)) { unknownFields++; continue; }
      const child = value[key];
      descriptors[key] = child === null ? { type: 'null' } : Array.isArray(child) ? { type: 'array', count: child.length }
        : isRecord(child) ? { type: 'object', count: Object.keys(child).length } : { type: typeof child };
      if (moreFlags.includes(key) && typeof child === 'boolean') {
        pagination[key] = child;
        if (child) explicitlyPartial = true;
      }
      if (key === 'is_complete' && typeof child === 'boolean') { pagination[key] = child; if (!child) explicitlyPartial = true; }
      if (['next_cursor', 'previous_cursor', 'cursor', 'start_cursor', 'end_cursor'].includes(key) && child != null && child !== '') pagination[key] = 'present';
      if (['total', 'total_count', 'total_messages', 'num_turns'].includes(key) && typeof child === 'number' && Number.isSafeInteger(child) && child >= 0) pagination[key] = child;
    }
    objects.push({ location, fields: descriptors, unknownFields, pagination });
    for (const key of wrappers) visit(value[key], `${location}.${key}`, depth + 1);
    for (const key of ['messages', 'turns', 'items', 'nodes']) {
      if (Array.isArray(value[key])) visit(value[key][0], `${location}.${key}[]`, depth + 1);
    }
  }
  visit(input, '$', 0);
  if (Array.isArray(input)) visit(input[0], '$[]', 0);
  return { rootType: input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input, objects, explicitlyPartial };
}
