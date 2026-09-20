import assert from 'node:assert/strict';
import test from 'node:test';
import loadTypeScript from '../../tests/load-typescript.mjs';

const { consumeOcrStream } = loadTypeScript(new URL('./ocrStream.ts', import.meta.url));
const stream = (chunks) => new ReadableStream({ start(controller) {
  for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
  controller.close();
} });

test('split and unterminated final packets preserve partial outcome and release reader', async () => {
  const body = stream(['{"type":"progress","current":1,"total":3}\n{"type":"res',
    'ult","success":true,"aborted":true,"message":"合成停止","download_url":"outputs/synthetic.xlsx"}']);
  const packets = [];
  await consumeOcrStream(body, packet => packets.push(structuredClone(packet)));
  assert.equal(packets.length, 2);
  assert.equal(packets[1].aborted, true);
  assert.equal(packets[1].download_url, 'outputs/synthetic.xlsx');
  assert.equal(body.locked, false);
});

test('truncated or malformed streams do not silently finish or leave a locked reader', async () => {
  for (const chunk of ['{"type":"progress","current":1,"total":3}\n', '{bad json}\n', '{"type":"result","success":"false"}\n']) {
    const body = stream([chunk]);
    const packets = [];
    await assert.rejects(consumeOcrStream(body, packet => packets.push(packet)));
    assert.ok(packets.every(packet => packet.type !== 'result'));
    assert.equal(body.locked, false);
  }
});

test('a second terminal result cannot announce success after a failure', async () => {
  const body = stream(['{"type":"result","success":false}\n{"type":"result","success":true}\n']);
  const packets = [];
  await assert.rejects(consumeOcrStream(body, packet => packets.push(packet)), /ocr_stream_invalid/);
  assert.equal(packets.length, 0);
  assert.equal(body.locked, false);
});
