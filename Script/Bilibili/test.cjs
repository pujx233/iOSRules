const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { gzipSync, gunzipSync } = require('node:zlib');

const source = Object.fromEntries(['request', 'response'].map(kind => [kind, readFileSync(join(__dirname, kind + '.js'), 'utf8')]));
const dmPath = 'community.service.dm.v1.DM/DmView';
const segmentPath = 'community.service.dm.v1.DM/DmSegMobile';
const progressPaths = ['app.viewunite.v1.View/ViewProgress', 'app.view.v1.View/ViewProgress'];

function varint(value) {
  const result = [];
  do {
    result.push((value & 127) | (value > 127 ? 128 : 0));
    value >>>= 7;
  } while (value);
  return Buffer.from(result);
}
function bytes(id, value) {
  const data = Buffer.from(value);
  return Buffer.concat([varint(id * 8 + 2), varint(data.length), data]);
}
function scalar(id, value) {
  return Buffer.concat([varint(id * 8), varint(value)]);
}
function frame(payload, compressed = false) {
  const data = compressed ? gzipSync(payload) : Buffer.from(payload);
  const header = Buffer.alloc(5);
  header[0] = Number(compressed);
  header.writeUInt32BE(data.length, 1);
  return new Uint8Array(Buffer.concat([header, data]));
}
function unframe(data) {
  const buffer = Buffer.from(data);
  assert.equal(buffer.readUInt32BE(1), buffer.length - 5);
  return buffer[0] ? gunzipSync(buffer.subarray(5)) : buffer.subarray(5);
}
function fields(data) {
  const buffer = Buffer.from(data);
  let offset = 0;
  const readVarint = () => {
    let value = 0, shift = 0, byte;
    do {
      assert.ok(offset < buffer.length, 'complete protobuf varint');
      byte = buffer[offset++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  const result = [];
  while (offset < buffer.length) {
    const tag = readVarint(), id = Math.floor(tag / 8), wire = tag & 7;
    let value;
    if (wire === 0) value = readVarint();
    else if (wire === 2) {
      const length = readVarint();
      value = buffer.subarray(offset, offset + length);
      offset += length;
      assert.equal(value.length, length);
    } else throw new Error('Unexpected fixture wire type: ' + wire);
    result.push({ id, value });
  }
  return result;
}
const getField = (data, id) => fields(data).find(field => field.id === id)?.value;
const originalChronos = Buffer.concat([
  bytes(1, '5bca6725b04c018358e69be749f0ee11'),
  bytes(2, 'https://example.invalid/original-chronos.zip'),
  bytes(3, 'original-rsa-signature'),
]);
const progress = Buffer.concat([bytes(2, originalChronos), bytes(99, 'untargeted-field')]);
const ordinaryElement = Buffer.concat([scalar(1, 777), scalar(2, 1000), scalar(3, 1), bytes(7, '普通滚动弹幕')]);
const segmentReply = bytes(1, ordinaryElement);
const segmentRequest = type => Buffer.concat([scalar(1, 170001), scalar(2, 279786), scalar(3, type), scalar(4, 1)]);

async function run(kind, path, payload, options = {}) {
  const calls = [], logs = [];
  let done;
  const completion = new Promise(resolve => { done = resolve; });
  const headers = { te: 'trailers', ...options.headers };
  if (options.userAgent !== null) headers['user-agent'] = options.userAgent ?? 'bili-universal/' + (options.version ?? 91700000);
  const originalResponse = { status: 200, headers: options.responseHeaders ?? { 'content-type': 'application/grpc' }, body: frame(payload, options.compressed) };
  if (options.trailers !== undefined) originalResponse.h2_trailers = options.trailers;
  const sandbox = {
    Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, URL,
    $loon: 'iPhone',
    $request: { method: 'POST', url: 'https://' + (options.host ?? 'grpc.biliapi.net') + '/bilibili.' + path, headers, body: frame(payload, options.compressed) },
    $argument: { sponsorBlock: options.sponsorBlock ?? true, logLevel: 'off' },
    $utils: { ungzip: data => new Uint8Array(gunzipSync(data)) },
    $persistentStore: { read: () => null, write: () => true },
    console: { log: (...args) => logs.push(args.join(' ')) },
    $done: done,
    $httpClient: Object.fromEntries(['get', 'post'].map(method => [method, (request, callback) => {
      calls.push({ method, ...request });
      if (method === 'get') {
        if (options.sponsorError) callback('simulated SponsorBlock outage');
        else callback(null, { status: 200, headers: {} }, JSON.stringify(options.segments ?? []));
      } else {
        const response = { status: 200, headers: { 'content-type': 'application/grpc' } };
        if (options.trailers !== undefined) response.h2_trailers = options.trailers;
        callback(null, response, frame(options.upstreamPayload ?? segmentReply, options.upstreamCompressed));
      }
    }])),
  };
  if (kind === 'response') sandbox.$response = originalResponse;
  vm.runInNewContext(source[kind], sandbox, { timeout: 2000 });
  let timer;
  const result = await Promise.race([completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Script did not finish')), 2000); })]).finally(() => clearTimeout(timer));
  const changed = kind === 'request' ? result.response : result;
  const response = changed ? { ...originalResponse, ...changed, headers: { ...originalResponse.headers, ...changed.headers } } : undefined;
  return { result, response, payload: response?.body ? unframe(response.body) : undefined, calls, logs };
}

for (const path of progressPaths) {
  for (const options of [{ version: 91700000 }, { version: 91800000 }, { userAgent: null }, { userAgent: 'unrecognized-app/1' }]) {
    test(path + ' preserves signed Chronos with ' + JSON.stringify(options), async () => {
      const result = await run('response', path, progress, options);
      assert.deepEqual(getField(result.payload, 2), originalChronos);
      assert.equal(getField(result.payload, 99).toString(), 'untargeted-field');
    });
  }
  test(path + ' preserves Chronos with SponsorBlock off on a legacy client', async () => {
    const result = await run('response', path, progress, { version: 91600000, sponsorBlock: false });
    assert.deepEqual(getField(result.payload, 2), originalChronos);
  });
  test(path + ' updates legacy Chronos using the 3.11.0 mapping', async () => {
    const result = await run('response', path, progress, { version: 91600000 });
    const chronos = getField(result.payload, 2);
    assert.equal(getField(chronos, 1).toString(), '106d21a147f49e9d4ef86e2e8523474f');
    assert.equal(getField(chronos, 2).toString(), 'https://raw.githubusercontent.com/kokoryh/chronos/refs/heads/master/106d21a147f49e9d4ef86e2e8523474f.zip');
    assert.equal(getField(chronos, 3), undefined);
  });
}

for (const compressed of [false, true]) {
  test('DmView preserves untargeted fields with gzip=' + compressed, async () => {
    const payload = Buffer.concat([bytes(4, 'untargeted-config'), bytes(18, 'activity'), bytes(22, bytes(1, 'command')), bytes(25, 'qoe')]);
    const result = await run('response', dmPath, payload, { compressed });
    assert.equal(getField(result.payload, 4).toString(), 'untargeted-config');
    assert.equal(getField(result.payload, 18), undefined);
    assert.equal(getField(result.payload, 22).length, 0);
    assert.equal(getField(result.payload, 25), undefined);
    assert.equal(result.response.headers['grpc-status'], '0');
  });
}
test('existing HTTP/2 trailers are retained', async () => {
  const trailers = { 'grpc-status': '0' };
  const result = await run('response', dmPath, bytes(4, 'config'), { trailers });
  assert.deepEqual(result.response.h2_trailers, trailers);
  assert.equal(result.response.headers['grpc-status'], undefined);
});
test('an existing nonzero grpc-status is not replaced', async () => {
  const result = await run('response', dmPath, bytes(4, 'config'), { responseHeaders: { 'grpc-status': '7' } });
  assert.equal(result.response.headers['grpc-status'], '7');
});

for (const options of [{ version: 91700000 }, { version: 91800000 }, { userAgent: null }, { userAgent: 'unrecognized-app/1' }]) {
  test('DmSegMobile passes through without auxiliary requests: ' + JSON.stringify(options), async () => {
    const result = await run('request', segmentPath, segmentRequest(1), options);
    assert.equal(Object.keys(result.result).length, 0);
    assert.equal(result.calls.length, 0);
  });
}
test('a legacy client keeps its ordinary danmaku while adding a skip marker', async () => {
  const result = await run('request', segmentPath, segmentRequest(1), { version: 91600000, segments: [{ actionType: 'skip', segment: [10, 30] }] });
  const elements = fields(result.payload).filter(field => field.id === 1).map(field => field.value);
  assert.equal(elements.length, 2);
  assert.equal(getField(elements[0], 7).toString(), '普通滚动弹幕');
  assert.equal(getField(elements[1], 10).toString(), 'airborne:30000');
  assert.equal(result.calls.filter(call => call.method === 'post').length, 1);
  assert.equal(result.calls.filter(call => call.method === 'get').length, 1);
  assert.equal(result.response.headers['grpc-status'], '0');
});
test('SponsorBlock outage preserves the original compressed danmaku response', async () => {
  const result = await run('request', segmentPath, segmentRequest(1), { version: 91600000, sponsorError: true, upstreamCompressed: true });
  assert.deepEqual(result.payload, segmentReply);
});
test('a non-UGC segment request passes through', async () => {
  const result = await run('request', segmentPath, segmentRequest(2), { version: 91600000 });
  assert.equal(Object.keys(result.result).length, 0);
  assert.equal(result.calls.length, 0);
});
for (const path of ['app.viewunite.v1.View/View', 'main.community.reply.v1.Reply/MainList']) {
  test('ordinary request optimization still works for ' + path, async () => {
    const result = await run('request', path, Buffer.alloc(0), { upstreamPayload: bytes(99, 'preserved'), version: 91700000 });
    assert.equal(getField(result.payload, 99).toString(), 'preserved');
    assert.equal(result.calls.length, 1);
    assert.equal(result.response.headers['grpc-status'], '0');
  });
}
