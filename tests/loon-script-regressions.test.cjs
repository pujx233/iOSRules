const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('京东比价捕获令牌后结束请求，保留原请求和存储', () => {
  const end = {}; let done, doneCount = 0, writes = 0, notifications = 0;
  const storage = {};
  const context = {
    $loon: 'iPhone', console: { log() {} },
    $request: { method: 'POST', url: 'https://apapia-sqk-weblogic.manmanbuy.com/baoliao/center/menu', body: 'test=value', headers: {} },
    $persistentStore: { read: key => storage[key] ?? null, write: (value, key) => { storage[key] = value; writes++; return true; } },
    $notification: { post() { notifications++; } },
    $httpClient: { get() { throw Error('Unexpected network'); }, post() { throw Error('Unexpected network'); } },
    $done: value => { done = value; doneCount++; throw end; }, setTimeout, clearTimeout
  };
  try { vm.runInNewContext(read('Script/Kelee/JD_Price.js'), context, { timeout: 2000 }); }
  catch (error) { if (error !== end) throw error; }
  assert.equal(doneCount, 1);
  assert.equal(Object.keys(done).length, 0);
  assert.equal(writes, 1); assert.equal(notifications, 1);
  assert.equal(storage.manmanbuy_val, 'test=value');
});

test('航旅纵横仅匹配指定主机的网关接口，兼容 HTTP 和 HTTPS', () => {
  const line = read('Loon/Umetrip_remove_ads.lpx').split('\n').find(l => l.startsWith('response if'));
  const regex = new RegExp(line.match(/~= \/(.*)\/i then/)[1], 'i');
  for (const scheme of ['http', 'https']) for (const host of ['114.115.217.129', 'home.umetrip.com']) {
    assert.ok(regex.test(`${scheme}://${host}/gateway/api/umetrip/native`));
  }
  for (const url of ['http://114.115.217.129/unrelated', 'https://home.umetrip.com/other', 'https://example.com/?next=home.umetrip.com/gateway/api/umetrip/native']) assert.ok(!regex.test(url));
  const adRule = read('Loon/Umetrip_remove_ads.lpx').split('\n').find(l => l.startsWith('URL-REGEX,'));
  const adRegex = new RegExp(adRule.match(/"(.+)"/)[1]);
  for (const scheme of ['http', 'https']) for (const host of ['discardrp.umetrip.com', 'startup.umetrip.com']) {
    assert.ok(adRegex.test(`${scheme}://${host}/gateway/api/umetrip/native`));
  }
  assert.ok(!adRegex.test('https://example.com/gateway/api/umetrip/native'));
});

test('通用广告过滤器的 popup_displays 规则覆盖 HTTPS', () => {
  const line = read('Loon/Remove_ads_by_keli.lpx').split('\n').find(l => l.includes('popup_displays?'));
  const regex = new RegExp(line.match(/~= \/(.*)\/i then/)[1], 'i');
  for (const scheme of ['http', 'https']) assert.ok(regex.test(`${scheme}://sfo.mddcloud.com.cn/api/v2/sfo/popup_displays?city=110100`));
});

test('GetADResult 清空实际 XML 广告内容，保留其他节点', () => {
  const line = read('Loon/Remove_ads_by_keli.lpx').split('\n').find(l => l.includes('GetADResult'));
  const [regex, replacement] = vm.runInNewContext('[' + line.match(/response\.body\.replace\((.*)\)$/)[1] + ']');
  for (const body of ['{"ret":0,"data":{"ad":[1]}}', '\n{"ret":0,"data":{"ad":[1]}}\n']) {
    const xml = `<GetADResult>${body}</GetADResult><Keep>ok</Keep>`;
    const changed = xml.replace(regex, replacement);
    assert.deepEqual(JSON.parse(changed.match(/<GetADResult>([\s\S]*?)<\/GetADResult>/)[1]).data.ad, []);
    assert.ok(changed.endsWith('<Keep>ok</Keep>'));
  }
  assert.equal('<Keep>ok</Keep>'.replace(regex, replacement), '<Keep>ok</Keep>');
});

test('微信解锁按 forceRedirect=true 参数返回原链接重定向', () => {
  function replay(flag) {
    const end = {}; let result, count = 0;
    const context = {
      $loon: 'iPhone', $argument: `forceRedirect=${flag}&useCache=false`,
      $request: { url: 'https://weixin110.qq.com/cgi-bin/mmspamsupport-bin/newredirectconfirmcgi?x=1' },
      $response: { body: '<script>var cgiData = {"type":"gray","url":"https://example.test/target"};</script>' },
      $persistentStore: { read: () => null, write: () => true }, $notification: { post() {} },
      $done: value => { result = value; count++; throw end; }, console: { log() {} }, URL, URLSearchParams
    };
    try { vm.runInNewContext(read('Script/Kelee/Weixin_external_links_unlock.js'), context, { timeout: 2000 }); }
    catch (error) { if (error !== end) throw error; }
    assert.equal(count, 1); return result;
  }
  const on = replay('true');
  assert.equal(on.status, 302);
  assert.equal(on.headers.Location, 'https://example.test/target');
  assert.equal(Object.keys(replay('false')).length, 0);
});

test('贴吧字符串 false 关闭视频过滤，保留直播过滤', () => {
  const source = read('Script/Kelee/tieba-proto.js');
  const filter = source.match(/function removeThread\(threadList, filterVideo\) \{[\s\S]*?\n\}/)[0];
  const start = source.indexOf('        const argOptions = {');
  const end = source.indexOf('        const personalizedResIdlObj', start);
  assert.ok(start > 0 && end > start);
  const parse = source.slice(start, end);
  const cases = [
    [{ per_filter_video_thread: 'false' }, ['video', 'normal']], [{ per_filter_video_thread: false }, ['video', 'normal']],
    [{ per_filter_video_thread: 'true' }, ['normal']], [{ per_filter_video_thread: true }, ['normal']],
    [{ per_filter_video_thread: 0 }, ['video', 'normal']], [{ per_filter_video_thread: 1 }, ['normal']],
    ['per_filter_video_thread=false', ['video', 'normal']], ['per_filter_video_thread=true', ['normal']]
  ];
  for (const [argument, expected] of cases) {
    const result = vm.runInNewContext('(function(){' + filter + '\n' + parse + '\nreturn removeThread(input,argOptions.per_filter_video_thread).map(x=>x.id);})()', {
      $argument: argument, input: [{ id: 'video', videoInfo: {} }, { id: 'normal' }, { id: 'live', alaInfo: {} }], console: { log() {} }
    });
    assert.deepEqual(Array.from(result), expected);
  }
});
