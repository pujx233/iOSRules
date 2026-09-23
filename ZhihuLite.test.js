// Run with Node.js and jq. Fixtures are synthetic; no accounts or captured bodies.
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = readFileSync(__dirname + '/ZhihuLite.js', 'utf8');
const plugin = readFileSync(__dirname + '/ZhihuLite.lpx', 'utf8');
const root = 'https://api.zhihu.com';
const feedURL = root + '/moments_v3?feed_type=timeline';
const bottomURL = 'https://www.zhihu.com/api/v4/answers/123/recommendations';
const scriptLines = plugin.split('\n').filter(line => line.startsWith('http-response '));
const scripts = scriptLines.map(line => new RegExp(line.split(' ')[1]));
const rewriteLines = plugin.split('\n').filter(line => line.startsWith('^https:'));
const rewrites = rewriteLines.map(line => new RegExp(line.split(' ')[0]));
const bottomRule = rewriteLines.find(line => line.includes(' response-body-json-jq '));
const [bottomPattern, quotedJq] = bottomRule.split(' response-body-json-jq ');
let passed = 0;
function run(url, body, args) {
  const calls = [];
  const sandbox = { $request: { url }, $argument: args, $done: value => calls.push(value), console: { log() {} } };
  if (body !== undefined) sandbox.$response = { body: typeof body === 'string' ? body : JSON.stringify(body) };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  assert.equal(calls.length, 1, 'exactly one completion');
  return JSON.parse(JSON.stringify(calls[0]));
}
function output(url, input, args) {
  const result = run(url, input, args);
  return result.body === undefined ? input : JSON.parse(result.body);
}
function native(input) {
  const result = spawnSync('jq', ['-c', quotedJq.slice(1, -1)], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
function test(name, check) { check(); passed++; console.log('PASS ' + name); }

test('homepage, selected tab, sort and unrelated config are untouched', () => {
  const tabs = { selected_index: 2, tab_list: [{ tab_type: 'follow' }, { tab_type: 'recommend' }, { tab_type: 'hot' }] };
  for (const args of [undefined, { simplify: true }, { filter_interest: true }, { filter_interest: false }]) {
    for (const path of ['/root/tab/v2', '/root/tab/v2?x=1', '/moments/tab_v2', '/feed/render/tab/config']) {
      const url = root + path;
      assert.deepEqual(run(url, tabs, args), {});
      assert.ok(![...scripts, ...rewrites].some(pattern => pattern.test(url)), url);
    }
  }
  for (const query of ['feed_type=timeline', 'feed_type=recommend', 'feed_type=pin']) {
    assert.deepEqual(run(root + '/moments_v3?' + query), {});
  }
  const startup = { data: { configs: [
    { configKey: 'follow_tab_is_move_left', status: true, configValue: 1 },
    { configKey: 'fu_home_st_opt', status: true, configValue: 1 }
  ] } };
  assert.deepEqual(run('https://m-cloud.zhihu.com/api/cloud/zhihu/config/all', startup), {});
});

test('interest cards are filtered independently of homepage navigation', () => {
  const normal = { type: 'ComponentCard', children: [{ type: 'HtmlText', text: '你可能感兴趣的正文讨论' }] };
  const injected = [
    { type: 'ComponentCard', extra: { business_ext_map: { moments_biz_data: { action_text: '发布了文章 · 你可能感兴趣' } } } },
    { type: 'ComponentCard', children: [{ type: 'Author', desc_line: { elements: [{ type: 'Text', text: '回答了问题 · 你可能感兴趣' }] } }] },
    { type: 'moments_feed', source: { action_text: '为你推荐' } },
    { type: 'recommendation', title: '你可能感兴趣' }
  ];
  const input = { data: [normal, ...injected], paging: { next: 'cursor', is_end: false }, style: { columns: 2 } };
  const result = output(feedURL, input);
  assert.deepEqual(result, { ...input, data: [normal] });
  assert.deepEqual(run(feedURL, result), {});
  for (const filter_interest of [false, 'false', 0, '0']) assert.deepEqual(output(feedURL, input, { filter_interest }), result);
  assert.deepEqual(output(feedURL, input, { simplify: false }), result);
});

test('ordinary content titles and unfollowed recommendation targets are preserved', () => {
  const data = [
    { type: 'answer', title: '你可能感兴趣', content: '为你推荐只是正文' },
    { type: 'feed', title: '你可能感兴趣', target: { type: 'article', id: 'normal' } },
    { type: 'ComponentCard', extra: { business_ext_map: { moments_biz_data: { action_text: '赞同了回答', users: [{ relation: { is_following: false } }] } } } }
  ];
  assert.deepEqual(run(feedURL, { data }), {});
});

test('ads and interest cards are always removed while paid answers are retained', () => {
  const input = { data: [
    { type: 'recommendation', title: '你可能感兴趣' },
    { type: 'feed', target: { type: 'answer', content: '广告设计', answer_type: 'PAID' }, ad_info: { slot: 1 } },
    { type: 'feed_advert' }, { type: 'feed', adjson: '{"mock":true}' },
    { type: 'read' }, { type: 'download' }, { type: 'adapter' }
  ], paging: { next: 'cursor', is_end: false } };
  const result = output(feedURL, input, { filter_interest: false });
  assert.equal(result.data.length, 4);
  assert.equal(result.data[0].target.answer_type, 'PAID');
  assert.equal(result.data[0].target.content, '广告设计');
  assert.ok(!('ad_info' in result.data[0]));
  assert.deepEqual(result.paging, input.paging);
});

test('next response filtering retains normal and paid cards', () => {
  const data = [
    { type: 'answer', answer_type: 'PAID' },
    { origin_data: { resource_type: 'feed_advert' } },
    { type: 'common_card', common_card: { footline: { elements: [{ text: { panel_text: '广告' } }] } } },
    { origin_data: { next_guide: { title: '你可能感兴趣' } } }
  ];
  assert.deepEqual(output(root + '/next-bff?id=123', { data }), { data: [data[0]] });
  const nested = { data: { data: [{ type: 'answer' }, { type: 'ad' }, { next_guide: { title: '为你推荐' } }] } };
  assert.deepEqual(output(root + '/next-data?type=answer&id=123', nested), { data: { data: [{ type: 'answer' }] } });
  assert.deepEqual(output(root + '/next-render?type=answer&id=123', { data: data.slice(0, 3) }), { data: [data[0]] });
});

test('Kelee answer card cleanup preserves text and unrelated properties', () => {
  const input = { content: '完整正文', answer_type: 'PAID', third_business: {}, ring_info: {}, interaction_bar_plugins: [], float_search_word: {}, structured_content: { segments: [{ type: 'text', text: '正文' }, { type: 'card' }, null] } };
  const expected = { content: input.content, answer_type: 'PAID', structured_content: { segments: [input.structured_content.segments[0], null] } };
  for (const url of [root + '/answers/v2/123', 'https://page-info.zhihu.com/answers/v2/123?x=1', root + '/v4/answers/123']) {
    assert.deepEqual(output(url, input), expected);
  }
  assert.deepEqual(output(root + '/articles/v2/123', { content: 'article', ring_info: {}, interaction_bar_plugins: [] }), { content: 'article' });
});

test('Kelee feed ring cleanup preserves ordinary feed types and cards', () => {
  const input = { data: [{ type: 'ComponentCard', children: [{ id: 'ring' }, { id: 'answer' }] }, { type: 'feed', target: { type: 'answer' } }, { type: 'ad' }] };
  assert.deepEqual(output(root + '/topstory/recommend', input), { data: [{ type: 'ComponentCard', children: [{ id: 'answer' }] }, input.data[1]] });
});

test('Kelee comments, search, podcasts and profile promotion cleanup is scoped', () => {
  assert.deepEqual(output(root + '/comment_v5/answers/123/root_comment', { data: [{ type: 'comment', content: '广告' }], atmosphere_voting_config: {} }), { data: [{ type: 'comment', content: '广告' }] });
  assert.deepEqual(output(root + '/comment_v5/answers/123/list-headers', { continuous_consumption_module: {}, keep: true }), { keep: true });
  assert.deepEqual(output(root + '/podcasts/hub/v1', { banners: [1], data: [2] }), { data: [2] });
  assert.deepEqual(output(root + '/search/recommend_query/v2', { recommend_queries: { queries: [{ type: 'normal', text: '正常词' }, { type: 'ad' }] } }), { recommend_queries: { queries: [{ type: 'normal', text: '正常词' }] } });
  assert.deepEqual(output(root + '/search_v3', { pendant: {}, data: [{ type: 'answer' }] }), { data: [{ type: 'answer' }] });
  assert.deepEqual(output(root + '/people/self', { vip_info: { entrance_new: { right_button: {}, keep: true }, entrance_v2: {}, is_vip: true }, name: 'synthetic' }), { vip_info: { entrance_new: { keep: true }, is_vip: true }, name: 'synthetic' });
  assert.deepEqual(run(root + '/account/profile', { pendant: {}, banners: [1], vip_info: { entrance_v2: {} } }), {});
});

test('network cleanup removes only known transport fields and keeps startup flags', () => {
  const startup = { configKey: 'follow_tab_is_move_left', configValue: 1, status: true };
  const input = { data: { configs: [{ configKey: 'sugarQuicConfig' }, startup, { configKey: 'theme', configValue: { HTTPDNS: 1, color: 'blue' } }] } };
  assert.deepEqual(output('https://m-cloud.zhihu.com/api/cloud/zhihu/config/all', input), { data: { configs: [startup, { configKey: 'theme', configValue: { color: 'blue' } }] } });
});

test('64-bit IDs and literal marker strings survive script cleanup exactly', () => {
  const input = '{"data":[{"type":"feed","id":9223372036854775807,"negative":-9223372036854775808,"marker":"__ZHILITE_NUMBER_0__","text":"id 9223372036854775807"}],"ad_info":{}}';
  const result = run(feedURL, input).body;
  assert.ok(result.includes('"id":9223372036854775807'));
  assert.ok(result.includes('"negative":-9223372036854775808'));
  assert.equal(JSON.parse(result).data[0].marker, '__ZHILITE_NUMBER_0__');
  assert.equal(JSON.parse(result).data[0].text, JSON.parse(input).data[0].text);
});

test('signal gates preserve escaped keys, labels, types and quoted boundaries', () => {
  const variants = value => {
    const plain = JSON.stringify(value);
    const unicode = plain.replace(/"(?:\\.|[^"\\])*"/g, token => '"' +
      JSON.parse(token).split('').map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"');
    return [plain, unicode, JSON.stringify(value, null, 2)];
  };
  const ordinary = { type: 'answer', content: '正文保留' };
  for (const ad of [
    { type: 'AdCard' }, { resource_type: 'feed_advert' }, { business_type: 'sponsored_item' },
    { type: 'prefix"_ad' }, { type: 'prefix\\_ad' }, { type: 'prefix\n_ad' },
    { type: 'prefix&_ad' }, { type: 'prefix<_ad' }, { type: 'prefix>_ad' },
    { is_ad: '1' }, { is_advert: true }, { promotion_extra: { enabled: true } },
    { origin_data: { card_type: 'ad-item' } },
    { common_card: { footline: { elements: [{ text: { panel_text: '\t广告\n' } }] } } }
  ]) {
    for (const input of variants({ data: [ordinary, ad] })) {
      assert.deepEqual(JSON.parse(run(feedURL, input).body), { data: [ordinary] });
    }
  }
  const interest = { type: 'ComponentCard', extra: { business_ext_map: { moments_biz_data: { action_text: '发布了文章 · 你可能感兴趣' } } } };
  for (const input of variants({ data: [ordinary, interest], ad_info: {} })) {
    assert.deepEqual(JSON.parse(run(feedURL, input).body), { data: [ordinary] });
  }
  for (const input of variants({ structured_content: { segments: [{ type: 'card' }, { type: 'text' }] }, ring_info: {} })) {
    assert.deepEqual(JSON.parse(run(root + '/answers/v2/123', input).body), { structured_content: { segments: [{ type: 'text' }] } });
  }
  for (const input of variants({ data: { configs: [{ configKey: 'sugarQuicConfig' }, { configKey: 'theme', configValue: { HTTPDNS: 1, color: 'blue' } }] } })) {
    assert.deepEqual(JSON.parse(run('https://m-cloud.zhihu.com/api/cloud/zhihu/config/all', input).body), { data: { configs: [{ configKey: 'theme', configValue: { color: 'blue' } }] } });
  }
});

test('clean responses bypass JSON parsing and keep their original bytes', () => {
  for (const url of [feedURL, root + '/topstory/hot-lists/total', 'https://m-cloud.zhihu.com/api/cloud/zhihu/config/all']) {
    let parses = 0, result;
    const input = '{ "data": [], "text": "\\u666e\\u901a\\u5185\\u5bb9", "keep": 9223372036854775807 }';
    vm.runInNewContext(source, {
      $request: { url }, $response: { body: input }, $done: value => { result = value; },
      JSON: { parse(text) { parses++; return JSON.parse(text); }, stringify: JSON.stringify },
      console: { log() {} }
    });
    assert.equal(parses, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
  }
});

test('integer protection handles escaped marker collisions, arrays and invalid tokens', () => {
  const input = '{"data":[{"type":"answer","ids":[9007199254740993,-9223372036854775808],"marker":"\\u005f\\u005fZHILITE_NUMBER_0__","decimal":1.2345678901234567,"quoted":"x:9223372036854775807"}],"ad_info":{}}';
  const body = run(feedURL, input).body;
  assert.ok(body.includes('"ids":[9007199254740993,-9223372036854775808]'));
  assert.equal(JSON.parse(body).data[0].marker, '__ZHILITE_NUMBER_0__');
  assert.equal(JSON.parse(body).data[0].quoted, 'x:9223372036854775807');
  assert.deepEqual(run(feedURL, '{"id":01234567890123456789,"ad_info":{}}'), {});
});

test('invalid and unchanged responses fail open', () => {
  for (const input of ['', '<html>error</html>', 'null', 'true', '{"data":null}', '{"data":[]}']) assert.deepEqual(run(feedURL, input), {});
  assert.deepEqual(run('https://example.com/moments_v3', { data: [{ type: 'ad' }] }), {});
  assert.deepEqual(run('https://api.zhihu.com.example.com/moments_v3', { data: [{ type: 'ad' }] }), {});
  for (const path of ['/answers/v2/123', '/people/self', '/search/recommend_query/v1', '/podcasts/hub/v1']) {
    for (const input of [{}, { structured_content: null }, { recommend_queries: null }, { vip_info: null }]) assert.deepEqual(run(root + path, input), {});
  }
});

test('answer bottom jq only removes exact ad cards and preserves paging', () => {
  const input = { data: [{ type: 'ad', ad_info: { adjson: 'synthetic' } }, { type: 'answer', answer_type: 'PAID', title: '广告行业' }, null, 7], paging: { next: bottomURL + '?offset=20', is_end: false }, keep: true };
  assert.deepEqual(JSON.parse(native(input)), { ...input, data: input.data.slice(1) });
  for (const value of [{}, { data: null }, { data: {} }, { data: [] }, { error: true }]) assert.deepEqual(JSON.parse(native(value)), value);
  assert.ok(native('{"data":[{"type":"answer","id":9223372036854775807},{"type":"ad"}]}').includes('9223372036854775807'));
});

test('answer bottom endpoint has one native handler and no script overlap', () => {
  for (const query of ['', '?omni=1', '?source=answer&omni=1']) {
    const url = bottomURL + query;
    assert.ok(new RegExp(bottomPattern).test(url));
    assert.equal(rewrites.filter(pattern => pattern.test(url)).length, 1);
    assert.equal(scripts.filter(pattern => pattern.test(url)).length, 0);
    assert.deepEqual(run(url, { data: [{ type: 'ad' }] }), {});
  }
  for (const url of [bottomURL + '/more', bottomURL.replace('/recommendations', '/segments'), bottomURL.replace('/answers/', '/articles/'), bottomURL.replace('www.zhihu.com', 'example.com')]) assert.ok(!new RegExp(bottomPattern).test(url));
});

test('LPX covers cleanup endpoints, promotion blocks and the current script hash', () => {
  for (const path of ['/moments_v3?feed_type=timeline', '/answers/v2/123', '/next-render?type=answer&id=123', '/comment_v5/answers/123/root_comment', '/podcasts/hub/v1', '/search/recommend_query/v2', '/search_v3', '/people/self']) assert.equal(scripts.filter(pattern => pattern.test(root + path)).length, 1, path);
  for (const path of ['/commercial_api/launch_v2?app=zhihu', '/content-distribution-core/bubble/common/show?scene=1', '/fringe/ad', '/ad-style-service/request', '/search/preset_words', '/search/related_queries/question/123', '/people/homepage_entry_v2', '/kvip/right/my_card', '/unlimited/go/my_card/v1']) assert.ok(rewrites.some(pattern => pattern.test(root + path)), path);
  const sha = createHash('sha256').update(source).digest('hex').slice(0, 12);
  for (const line of scriptLines) {
    assert.ok(line.includes('requires-body=true'));
    assert.ok(line.includes('ZhihuLite.js?v=' + sha));
  }
  assert.ok(!plugin.includes('[Argument]'));
  assert.ok(!plugin.includes('argument='));
  assert.ok(!source.includes('$argument'));
  assert.ok(!plugin.includes('simplify'));
  assert.ok(plugin.startsWith('#!name=知乎去广告\n'));
  assert.ok(plugin.includes('#!author=可莉🅥['));
  assert.ok(plugin.includes('#!homepage=https://hub.kelee.one'));
});
console.log(passed + ' checks passed');
