const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const own = 'https://raw.githubusercontent.com/pujx233/iOSRules/main/';
const local = url => path.join(root, decodeURIComponent(url.slice(own.length)));
function jqFilter(line) {
  return JSON.parse(line.match(/response\.json\.jq\(("(?:\\.|[^"\\])*")\)/)[1]);
}
function jq(filter, input) {
  return JSON.parse(execFileSync('jq', ['-c', filter], { input: JSON.stringify(input), encoding: 'utf8' }));
}
function run(file, globals) {
  let result;
  vm.runInNewContext(read(file), { ...globals, $done(value) { result = value; } });
  return result;
}

test('顺丰使用完整 JSON，寄件等服务入口仍在', () => {
  const rule = read('Loon/SF-Express_remove_ads.lpx').split('\n').find(line => line.includes('module-config'));
  const url = rule.match(/mock_file\("json", "([^"]+)", 200\)/)[1];
  assert.ok(url.startsWith(own));
  const data = JSON.parse(fs.readFileSync(local(url), 'utf8'));
  assert.equal(data.success, true);
  assert.equal(data.obj.length, 3);
  const scenes = data.obj.flatMap(position => position.sceneList);
  assert.equal(scenes.length, 31);
  assert.ok(scenes.some(scene => scene.sceneName === '寄快递'));
  for (const scene of scenes) if (scene.url?.startsWith('{')) JSON.parse(scene.url);
});

test('腾讯视频原生替换保留表单参数，不写入 undefined', () => {
  const source = read('Loon/Tencent_Video_remove_ads.lpx');
  assert.ok(!source.includes('replace-body.js'));
  const args = source.split('\n').find(line => line.includes('request.body.replace')).match(/request\.body\.replace\((.*)\)$/)[1];
  const [match, replacement] = vm.runInNewContext('[' + args + ']');
  const body = 'before=1&sppreviewtype=1&vid=abc&spsrt=1&after=2';
  assert.equal(body.replace(match, replacement), 'before=1&sppreviewtype=0&vid=abc&spsrt=0&after=2');
  assert.equal('vid=abc'.replace(match, replacement), 'vid=abc');
});

test('拼多多替换为可加载的页面资源，保留取件数据', () => {
  const original = 'https://pfile.pddpic.com/mdkd/mdkd/_next/static/chunks/9410-b8806e870a26db7d.js';
  const chunk = 'Script/PinDuoDuo/9410-b8806e870a26db7d.js';
  const replacement = 'https://cdn.jsdelivr.net/gh/pujx233/iOSRules@main/' + chunk;
  const data = { props: { pageProps: { serverData: [
    { key: 'fastBindCMobilePreCheck', value: 'mobile' },
    { key: 'queryStationPackageInfo', value: 'package' },
    { key: 'recommendations', value: 'ad' }
  ] } } };
  const html = `<script src="${original}"></script><div class="index_gif-container"><div>ad</div></div><script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`;
  const result = run('Script/Kelee/PinDuoDuo_remove_ads.js', { $response: { body: html } }).body;
  assert.ok(result.includes(replacement));
  assert.ok(!result.includes(original));
  assert.ok(!result.includes('index_gif-container'));
  const parsed = JSON.parse(result.match(/id="__NEXT_DATA__">(.*?)<\/script>/)[1]);
  assert.deepEqual(parsed.props.pageProps.serverData.map(item => item.key), ['fastBindCMobilePreCheck', 'queryStationPackageInfo']);
  const self = {};
  vm.runInNewContext(read(chunk), { self });
  const modules = self.webpackChunk_N_E[0][1];
  assert.deepEqual(Object.keys(modules).sort(), ['27519', '43435', '53203', '70242', '75637', '82115']);
  const exports = {};
  const requireStub = () => ({});
  requireStub.n = () => () => ({});
  requireStub.d = (target, getters) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(target, key, { get });
  };
  modules[53203]({}, exports, requireStub);
  assert.equal(exports.r({}), null);
});

test('酷狗递归清理推广项，保留标量和普通栏目', () => {
  const filter = jqFilter(read('Loon/KuGou_remove_ads.lpx').split('\n').find(line => line.includes('response.json.jq')));
  const input = { code: 0, title: '首页', data: { ad: { name: '游戏' }, normal: { name: '音乐', enabled: true }, tabs: [{ name: 'AI帮唱' }, { name: '歌曲', count: 3 }, 'keep', null] } };
  assert.deepEqual(jq(filter, input), { code: 0, title: '首页', data: { normal: { name: '音乐', enabled: true }, tabs: [{ name: '歌曲', count: 3 }, 'keep', null] } });
});

test('爱奇艺删除空表达式，保留已有评论过滤', () => {
  const source = read('Loon/iQiYi_Video_remove_ads.lpx');
  assert.ok(!source.includes('response.json.jq("")'));
  const rules = source.split('\n').filter(line => line.includes('long_video_comments') && line.includes('response.json.jq'));
  assert.equal(rules.length, 1);
  assert.deepEqual(jq(jqFilter(rules[0]), { cards: [{ alias_name: 'comment', id: 1 }, { ad: true }] }), { cards: [{ alias_name: 'comment', id: 1 }] });
});

test('斗鱼的 IP 地址重定向位于 Rewrite', () => {
  const source = read('Loon/Douyu_remove_ads.lpx');
  const rule = source.split('\n').find(line => line.includes(' 307 '));
  assert.ok(!source.split('[Rule]')[1].split('[Rewrite]')[0].includes(rule));
  assert.ok(source.split('[Rewrite]')[1].includes(rule));
  const [pattern, , replacement] = rule.split(' ');
  const url = 'http://1.2.3.4/hlsh5p1.douyucdn2.cn/live/test.m3u8';
  assert.equal(url.replace(new RegExp(pattern), replacement), 'http://hlsh5p1.douyucdn2.cn/live/test.m3u8');
});

test('有道广告域名是完整拒绝规则', () => {
  assert.match(read('Loon/YoudaoDict_remove_ads.lpx'), /^DOMAIN, ad-sdk-config\.youdao\.com, REJECT$/m);
});

test('快捷搜索完整保留无附加参数、单字和中文关键词', () => {
  const source = read('Loon/QuickSearch.lpx');
  const rules = source.split('\n').filter(line => line.includes('as urlMatch then redirect')).map(line => new RegExp(line.match(/~= \/(.*)\/i as urlMatch/)[1], 'i'));
  assert.equal(rules.length, 8);
  const prefixes = ['bd+', 'bdimg+', 'gimg+', 'b+', 'wk+', 'qm+', 'gh+', ''];
  for (let i = 0; i < prefixes.length; i++) {
    for (const query of ['Loon', 'x', '%E5%BC%B9%E5%B9%95']) {
      for (const suffix of ['', '&ia=web', '#top']) {
        assert.equal(rules[i].exec('https://duckduckgo.com/?q=' + prefixes[i] + query + suffix)[1], query);
      }
    }
  }
});

test('GitHub A/B 镜像和默认值正确更新 URL 与 Host', () => {
  for (const [selection, host] of [[null, 'fastraw.ixnic.net'], ['', 'fastraw.ixnic.net'], ['A镜像', 'fastraw.ixnic.net'], ['B镜像', 'hub.incept.pw']]) {
    const request = { url: own + 'README.md', headers: { Host: 'raw.githubusercontent.com', Accept: '*/*' } };
    const result = run('Script/Kelee/Switch_github_mirror.js', { $request: request, $persistentStore: { read: () => selection } });
    assert.equal(result.url, `https://${host}/pujx233/iOSRules/main/README.md`);
    assert.equal(result.headers.Host, host);
    assert.equal(result.headers.Accept, '*/*');
  }
});

test('Script-Hub 图标查询使用本仓库清单及新缓存', async () => {
  const collection = JSON.parse(read('Icon/iOSRules.json'));
  for (const icon of collection.icons) {
    assert.ok(icon.url.startsWith(own + 'Icon/'));
    assert.ok(fs.existsSync(local(icon.url)));
  }
  const cache = { Parser_Kelee_icon: [{ name: '哔哩哔哩', url: 'https://example.invalid/old.png' }] };
  const requests = [];
  const fn = read('Script/Kelee/Rewrite-Parser.js').match(/async function getIcon\(icon\) \{[\s\S]*?\n\}/)[0];
  const getIcon = vm.runInNewContext('(' + fn + ')', {
    $: { getjson: key => cache[key], toObj: JSON.parse, setjson: (value, key) => { cache[key] = value; } },
    http: async url => { requests.push(url); return { body: JSON.stringify(collection) }; }
  });
  assert.equal(await getIcon('哔哩哔哩'), own + 'Icon/Bilibili.png');
  assert.deepEqual(requests, [own + 'Icon/iOSRules.json']);
});

for (const [name, file, urls, unrelated] of [
  ['一点点', 'alittle-tea.js', [
    'https://cappapi.alittle-tea.com/open?method=catering.set.ad',
    'https://cappapi.alittle-tea.com/open?method=catering.set.ad&store=1'
  ], 'https://cappapi.alittle-tea.com/open?method=catering.order.list'],
  ['T3', 'T3.js', [
    'https://passenger.t3go.cn/passenger-api/notoken/api/v1/ad/getNegativescreen',
    'https://passenger.t3go.cn/common-passenger-activity-api/notoken/trip/api/common/v2/leftmenu'
  ], 'https://passenger.t3go.cn/passenger-api/notoken/api/v1/trip/getOrder'],
  ['古茗', 'ming.js', [
    'https://newton.gumingnc.com/newton-buyer/newton/buyer/ump',
    'https://newton.gumingnc.com/newton-buyer/newton/buyer/external/front'
  ], 'https://newton.gumingnc.com/newton-buyer/newton/buyer/order']
]) test(`${name}原生 JSON 处理与原脚本一致，保留其他字段和 URL 范围`, () => {
  const source = read('Loon/WexinMiniPrograms_Remove_ads.lpx');
  const rewrite = source.split('[Rewrite]')[1].split('[Script]')[0];
  const lines = rewrite.split('\n').filter(line => line.includes('response.json.jq'));
  const regex = line => new RegExp(line.match(/~= \/(.*)\/i then/)[1], 'i');
  const matched = lines.filter(line => regex(line).test(urls[0]));
  assert.equal(matched.length, 1);
  const line = matched[0];
  for (const url of urls) assert.ok(regex(line).test(url));
  assert.ok(!regex(line).test(unrelated));
  assert.ok(!regex(line).test(urls[0].replace('https://', 'http://')));
  assert.ok(!source.includes('/Script/Kelee/' + file));
  for (const input of [
    { code: 0, data: { ad: [1] }, keep: { enabled: true } },
    { data: [1, 2], id: '900719925474099312345', text: '保留文字' },
    { data: null, keep: false },
    { keep: ['unchanged'] }
  ]) {
    const original = run('Script/Kelee/' + file, { $response: { body: JSON.stringify(input) } });
    assert.deepEqual(jq(jqFilter(line), input), JSON.parse(original.body));
  }
});
