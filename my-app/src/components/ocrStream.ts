type OcrPacket =
  | { type: 'init'; request_id: string }
  | { type: 'progress'; current: number; total: number }
  | { type: 'log'; content: string }
  | { type: 'result'; success: boolean; message: string; aborted?: boolean; download_url?: string };

function parsePacket(line: string): OcrPacket | null {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('ocr_stream_invalid');
  const packet = value as Record<string, unknown>;
  switch (packet.type) {
    case 'init':
      if (typeof packet.request_id === 'string') return { type: 'init', request_id: packet.request_id };
      break;
    case 'progress':
      if (typeof packet.current === 'number' && typeof packet.total === 'number')
        return { type: 'progress', current: packet.current, total: packet.total };
      break;
    case 'log':
      if (typeof packet.content === 'string') return { type: 'log', content: packet.content };
      break;
    case 'result':
      if (typeof packet.success === 'boolean') return { type: 'result', success: packet.success,
        message: typeof packet.message === 'string' ? packet.message : '', aborted: packet.aborted === true,
        download_url: typeof packet.download_url === 'string' ? packet.download_url : undefined };
      break;
    default:
      return null; // Preserve compatibility with future nonterminal event types.
  }
  throw new Error('ocr_stream_invalid');
}

export async function consumeOcrStream(body: ReadableStream<Uint8Array> | null, onPacket: (packet: OcrPacket) => void) {
  if (!body) throw new Error('ocr_result_missing');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const terminal: { packet: Extract<OcrPacket, { type: 'result' }> | null } = { packet: null };
  let completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const packet = parsePacket(line);
    if (!packet) return;
    if (terminal.packet) throw new Error('ocr_stream_invalid');
    if (packet.type === 'result') terminal.packet = packet;
    else onPacket(packet);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(consume);
    }
    consume(buffer + decoder.decode());
    if (!terminal.packet) throw new Error('ocr_result_missing');
    onPacket(terminal.packet);
  } finally {
    try {
      if (!completed) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
