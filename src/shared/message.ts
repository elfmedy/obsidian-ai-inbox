import type { ContentReference } from '../render/citations';

export interface GraphMessage {
  id: string;
  role: 'user' | 'assistant';
  sourceKind?: 'tool-image' | 'thinking';
  contentReferences?: ContentReference[];
  parts: Array<{ type: 'text'; text: string } | { type: 'image'; pointer: string; alt?: string }>;
}
