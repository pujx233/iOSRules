// 知乎去广告：广告清理与兴趣推荐过滤，保留原生首页导航和排序。
// API coverage informed by Kelee's Zhihu_remove_ads.lpx and fmz200's zhihu.js.
// No account data is stored or sent by this script.
(() => {
  "use strict";
  const url = $request.url || "";
  const match = /^https:\/\/([a-z0-9-]+)\.zhihu\.com(\/[^?#]*)(?:[?#]|$)/i.exec(url);
  if (!match) return $done({});
  const host = match[1];
  const path = match[2];

  if (typeof $response === "undefined") return $done({});

  const isConfig = host === "m-cloud" && path === "/api/cloud/zhihu/config/all";
  // This endpoint uses the separately verified native Rewrite in the LPX.
  if (host === "www" && /^\/api\/v4\/answers\/\d+\/recommendations$/.test(path)) return $done({});
  const isContent = ["api", "www", "page-info", "zhuanlan"].includes(host) && (
    /^\/moments(?:_v\d+)?$/.test(path) ||
    /^\/moments\/(?:recommend|timeline)$/.test(path) ||
    /^\/topstory\/(?:recommend|hot-lists)(?:\/|$)/.test(path) ||
    /^\/questions\/\d+\/feeds(?:\/|$)/.test(path) ||
    /^\/(?:answers|articles|pins)\/v\d+\/\d+(?:\/|$)/.test(path) ||
    /^\/(?:api\/)?v\d+\/(?:questions|answers|articles)\//.test(path) ||
    /^\/next-(?:bff|data|render)$/.test(path) ||
    /^\/comment_v\d+\//.test(path) ||
    (host === "api" && (/^\/podcasts\/hub\/v\d+$/.test(path) ||
      /^\/search\/recommend_query\/v\d+$/.test(path) ||
      /^\/search_v\d+$/.test(path) || path === "/people/self"))
  );
  if ((!isConfig && !isContent) || !$response.body || typeof $response.body !== "string") {
    return $done({});
  }

  const original = $response.body;
  // A detection-only view exposes escaped keys/labels. Keep escaped quotes,
  // backslashes and controls intact so they cannot hide a token boundary.
  // HTML escapes for &, < and > cannot occur in a recognized key/label; leave
  // them untouched to avoid copying large bodies just to inspect their signals.
  // False positives only cost work; all edits still use parsed original JSON.
  const signals = original.includes("\\u") ? original.replace(/\\u(?!0026|003[cCeE])([0-9a-fA-F]{4})/g, (escape, hex) => {
    const code = parseInt(hex, 16);
    return code < 32 || code === 34 || code === 92 ? escape : String.fromCharCode(code);
  }) : original;
  const scanAds = !isConfig &&
    /"(?:ad_info|adjson|ad_json|ad_list|advert_info|adverts|third_business|float_search_word|atmosphere_voting_config|continuous_consumption_module|is_ad|is_advert|ad|promotion_extra)"\s*:|"(?:type|resource_type|card_type|business_type)"\s*:\s*"[^"\\]*(?:ad|sponsor|promot|\\)|"panel_text"\s*:\s*"(?:[^"\\]*\\|\s*(?:广告|推广|赞助)\s*")/i.test(signals);
  const interestRoute = (host === "api" && path.startsWith("/moments")) || path === "/next-bff" || path === "/next-data";
  const scanInterest = interestRoute && /为您推荐|为你推荐|你可能感兴趣|推荐的相关内容/.test(signals);
  const scanSurfaces = !isConfig && potentialSurfaceChange(signals);
  const scanNetwork = isConfig && /httpdns|dnsParser|quic|coreNetworkConf_useTars|networkExprimentList|tars_ab_list|zaSetExtraRequestHeader/i.test(signals);
  if (!scanAds && !scanInterest && !scanSurfaces && !scanNetwork) return $done({});

  const adFields = new Set(["ad_info", "adjson", "ad_json", "ad_list", "advert_info", "adverts", "third_business", "float_search_word", "atmosphere_voting_config", "continuous_consumption_module"]);
  const count = { ads: 0, recommendations: 0, fields: 0, network: 0 };
  try {
    // Keep 64-bit answer/video IDs exact while changing unrelated JSON fields.
    const codec = protectIntegers(original);
    const data = JSON.parse(codec.text);
    if (!data || typeof data !== "object") return $done({});
    if (isConfig) {
      cleanNetworkConfig(data);
    } else {
      if (scanInterest) cleanRecommendationModules(data);
      if (scanSurfaces) cleanKeleeSurfaces(data);
      if (scanAds) cleanContent(data);
    }
    if (!Object.values(count).some(n => n > 0)) {
      return $done({});
    }
    const body = codec.restore(JSON.stringify(data));
    console.log("[知乎去广告] " + category() + "：广告条目=" + count.ads + "，推荐模块=" + count.recommendations + "，广告字段=" + count.fields + "，网络配置=" + count.network);
    return $done({ body });
  } catch (_) {
    console.log("[知乎去广告] 响应无法安全处理，已保留原文");
    return $done({});
  }

  function category() {
    if (isConfig) return "知乎网络配置";
    if (path.startsWith("/moments")) return "关注信息流";
    if (path.startsWith("/comment_")) return "评论区";
    if (path.startsWith("/topstory/")) return "首页信息流";
    return "回答和文章";
  }
  function meaningful(value) {
    if (value === null || value === undefined || value === false || value === "" || value === 0) return false;
    return typeof value !== "object" || Object.keys(value).length > 0;
  }
  function adType(value) {
    return typeof value === "string" && (
      /^(?:adcard|aditem|adinfo|feedadvert)$/i.test(value) ||
      /(?:^|[_-])(?:ad|ads|advert|advertisement|sponsored|promoted)(?:[_-]|$)/i.test(value)
    );
  }
  function isAd(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (item.is_ad === true || item.is_ad === 1 || item.is_ad === "1" ||
        item.is_advert === true || item.is_advert === 1 || item.is_advert === "1") return true;
    if (adType(item.type) || adType(item.resource_type) || adType(item.card_type) || adType(item.business_type)) return true;
    if (meaningful(item.adjson) || meaningful(item.ad_json) || meaningful(item.ad) || meaningful(item.promotion_extra)) return true;
    const origin = item.origin_data;
    if (origin && (adType(origin.type) || adType(origin.resource_type) || adType(origin.card_type))) return true;
    const elements = item.common_card && item.common_card.footline && item.common_card.footline.elements;
    return Array.isArray(elements) && elements.some(element => {
      const label = element && element.text && element.text.panel_text;
      return typeof label === "string" && /^(?:广告|推广|赞助)$/.test(label.trim());
    });
  }
  // Match module metadata at known feed boundaries, never words in answer/comment bodies.
  // Evidence: fmz200's /moments_v3 title and /next-bff origin_data.next_guide handling.
  // A real /moments_v3 timeline capture also puts this label in ComponentCard
  // moments_biz_data.action_text and Author.desc_line, not in a module title.
  function cleanRecommendationModules(data) {
    const labels = new Set(["为您推荐", "为你推荐", "你可能感兴趣", "推荐的相关内容"]);
    const isLabel = value => typeof value === "string" && labels.has(value.trim());
    const hasRecommendationHint = value => typeof value === "string" &&
      value.split(/[·•]/).some(part => isLabel(part));
    const injectedFollowCard = item => {
      if (item.type === "ComponentCard") {
        const business = item.extra && item.extra.business_ext_map && item.extra.business_ext_map.moments_biz_data;
        if (business && hasRecommendationHint(business.action_text)) return true;
        return Array.isArray(item.children) && item.children.some(child =>
          child && child.type === "Author" && child.desc_line &&
          Array.isArray(child.desc_line.elements) && child.desc_line.elements.some(element =>
            element && element.type === "Text" && hasRecommendationHint(element.text)));
      }
      return item.type === "moments_feed" && item.source && hasRecommendationHint(item.source.action_text);
    };
    const isContentObject = value => value && typeof value === "object" && (
      ["answer", "article", "question", "pin", "comment", "zvideo"].includes(value.type) ||
      typeof value.content === "string" || typeof value.excerpt === "string"
    );
    const removeFrom = (owner, key, predicate) => {
      if (!owner || !Array.isArray(owner[key])) return;
      owner[key] = owner[key].filter(item => {
        if (item && typeof item === "object" && predicate(item)) {
          count.recommendations++;
          return false;
        }
        return true;
      });
    };
    if (host === "api" && (/^\/moments(?:_v\d+)?$/.test(path) || /^\/moments\/(?:recommend|timeline)$/.test(path))) {
      removeFrom(data, "data", item => injectedFollowCard(item) || (isLabel(item.title) &&
        !isContentObject(item) && !isContentObject(item.target)));
    } else if (path === "/next-bff") {
      removeFrom(data, "data", item => isLabel(item.origin_data && item.origin_data.next_guide && item.origin_data.next_guide.title));
    } else if (path === "/next-data") {
      removeFrom(data.data, "data", item => isLabel(item.next_guide && item.next_guide.title));
    }
  }
  function cleanContent(node) {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (adFields.has(key)) {
        delete node[key];
        count.fields++;
        continue;
      }
      const value = node[key];
      if (Array.isArray(value)) {
        let kept = 0;
        for (let index = 0; index < value.length; index++) {
          const item = value[index];
          if (isAd(item)) { count.ads++; continue; }
          cleanContent(item);
          if (kept !== index) value[kept] = item;
          kept++;
        }
        if (kept !== value.length) value.length = kept;
      } else {
        cleanContent(value);
      }
    }
  }
  function potentialSurfaceChange(body) {
    if (/^\/(?:answers|articles|pins)\/v\d+\/\d+$/.test(path) ||
        /^\/(?:api\/)?v\d+\/(?:answers|articles)\/\d+$/.test(path)) {
      return /"(?:ring_info|interaction_bar_plugins)"\s*:|"type"\s*:\s*"card"/.test(body);
    }
    if (host !== "api") return false;
    if (path === "/topstory/recommend") return body.includes('"ring"');
    if (/^\/podcasts\/hub\/v\d+$/.test(path)) return body.includes('"banners"');
    if (/^\/search\/recommend_query\/v\d+$/.test(path)) return body.includes('"queries"');
    if (/^\/search_v\d+$/.test(path)) return body.includes('"pendant"');
    if (path === "/people/self") return /"(?:right_button|entrance_v2)"/.test(body);
    return false;
  }
  function cleanKeleeSurfaces(data) {
    const drop = (owner, keys) => {
      if (!owner || typeof owner !== "object") return;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(owner, key)) {
          delete owner[key];
          count.fields++;
        }
      }
    };
    const keep = (owner, key, predicate) => {
      if (!owner || !Array.isArray(owner[key])) return;
      owner[key] = owner[key].filter(item => {
        if (predicate(item)) return true;
        count.fields++;
        return false;
      });
    };
    // Apply card/promotion cleanup only at Kelee's known response boundaries.
    // Keep normal topstory and next-render entries instead of rejecting their stream.
    if (/^\/(?:answers|articles|pins)\/v\d+\/\d+$/.test(path) ||
        /^\/(?:api\/)?v\d+\/(?:answers|articles)\/\d+$/.test(path)) {
      drop(data, ["third_business", "ring_info", "interaction_bar_plugins"]);
      if (/\/answers\//.test(path)) {
        drop(data, ["float_search_word"]);
        keep(data.structured_content, "segments", item => !item || item.type !== "card");
      }
    }
    if (host !== "api") return;
    if (path === "/topstory/recommend" && Array.isArray(data.data)) {
      for (const item of data.data) keep(item, "children", child => !child || child.id !== "ring");
    } else if (/^\/podcasts\/hub\/v\d+$/.test(path)) {
      drop(data, ["banners"]);
    } else if (/^\/search\/recommend_query\/v\d+$/.test(path)) {
      keep(data.recommend_queries, "queries", item => item && item.type === "normal");
    } else if (/^\/search_v\d+$/.test(path)) {
      drop(data, ["pendant"]);
    } else if (path === "/people/self") {
      const vip = data.vip_info;
      drop(vip && vip.entrance_new, ["right_button"]);
      drop(vip, ["entrance_v2"]);
    }
  }
  function cleanNetworkConfig(data) {
    if (!data.data || !Array.isArray(data.data.configs)) return;
    const remove = new Set([
      "km_httpdns_new_config_tars", "preFetchHttpDns", "httpdns_detector_use_concurrent",
      "httpdns_use_memory_cache", "httpdns_new_config_tars", "coreNetworkConf_useTars",
      "km_coreNetworkConf_useTars", "sugarQuicConfig", "quic_dns_detect_enable",
      "quicMixAB", "quic_downgrade_enable", "quic_priority_strategy", "quic_check_health_enable",
      "tquic_configuration", "networkExprimentList", "tars_ab_list", "zaSetExtraRequestHeader"
    ]);
    data.data.configs = data.data.configs.filter(config => {
      if (!config || typeof config !== "object") return true;
      if (remove.has(config.configKey)) { count.network++; return false; }
      if (config.configValue && typeof config.configValue === "object") {
        for (const key of ["delayHttpdns", "dnsParser", "HTTPDNS"]) {
          if (Object.prototype.hasOwnProperty.call(config.configValue, key)) {
            delete config.configValue[key];
            count.network++;
          }
        }
      }
      return true;
    });
  }
  function protectIntegers(text) {
    const unchanged = { text, restore: result => result };
    if (!/(?:^|[:,\[])\s*-?\d{16}/.test(text)) return unchanged;
    const numbers = [];
    const tokens = /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let match;
    // Record only unsafe integer spans; ordinary strings/numbers are never copied.
    while ((match = tokens.exec(text)) !== null) {
      const token = match[1];
      if (token && token.length >= 16 && !/[.eE]/.test(token) && !Number.isSafeInteger(Number(token)) &&
          token[0] !== "0" && !token.startsWith("-0")) {
        numbers.push({ start: match.index, end: tokens.lastIndex, token });
      }
    }
    if (!numbers.length) return unchanged;
    let prefix = "__ZHILITE_NUMBER_";
    while (signals.includes(prefix)) prefix += "_";
    const parts = [];
    let previous = 0;
    for (let index = 0; index < numbers.length; index++) {
      const number = numbers[index];
      parts.push(text.slice(previous, number.start), '"' + prefix + index + '__"');
      previous = number.end;
    }
    parts.push(text.slice(previous));
    return {
      text: parts.join(""),
      restore: result => result.replace(new RegExp('"' + prefix + '(\\d+)__"', "g"), (_, index) => numbers[Number(index)].token)
    };
  }
})();
