export function makeGraph(count = 4): Record<string, unknown> & { mapping: Record<string, any>; current_node: string } {
  const mapping: Record<string, any> = {
    root: { id: 'root', parent: null, children: ['m0'], message: null },
  };
  for (let i = 0; i < count; i++) {
    mapping[`m${i}`] = { id: `m${i}`, parent: i === 0 ? 'root' : `m${i - 1}`,
      children: i === count - 1 ? [] : [`m${i + 1}`],
      message: { id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, channel: 'final',
        status: 'finished_successfully', content: { content_type: 'text', parts: [`合成测试消息 ${i}\n\n内容。`] } },
    };
  }
  return { conversation_id: 'synthetic-conversation', current_node: `m${count - 1}`, mapping };
}
