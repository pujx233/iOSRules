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

  const count = { ads: 0, recommendations: 0, fields: 0, network: 0 };
  try {
    // Keep 64-bit answer/video IDs exact while changing unrelated JSON fields.
    const codec = protectIntegers($response.body);
    const data = JSON.parse(codec.text);
    if (!data || typeof data !== "object") return $done({});
    if (isConfig) {
      cleanNetworkConfig(data);
    } else {
      cleanRecommendationModules(data);
      cleanKeleeSurfaces(data);
      cleanContent(data);
    }
    if (!Object.values(count).some(n => n > 0)) {
      console.log("[知乎去广告] " + category() + "：已检查，无需修改");
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
    if ([true, 1, "1"].includes(item.is_ad) || [true, 1, "1"].includes(item.is_advert)) return true;
    if ([item.type, item.resource_type, item.card_type, item.business_type].some(adType)) return true;
    if ([item.adjson, item.ad_json, item.ad, item.promotion_extra].some(meaningful)) return true;
    const origin = item.origin_data;
    if (origin && [origin.type, origin.resource_type, origin.card_type].some(adType)) return true;
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
    const adFields = ["ad_info", "adjson", "ad_json", "ad_list", "advert_info", "adverts", "third_business", "float_search_word", "atmosphere_voting_config", "continuous_consumption_module"];
    for (const key of Object.keys(node)) {
      if (adFields.includes(key)) {
        delete node[key];
        count.fields++;
        continue;
      }
      const value = node[key];
      if (Array.isArray(value)) {
        node[key] = value.filter(item => {
          if (isAd(item)) { count.ads++; return false; }
          cleanContent(item);
          return true;
        });
      } else {
        cleanContent(value);
      }
    }
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
    let prefix = "__ZHILITE_NUMBER_";
    while (text.includes(prefix)) prefix += "_";
    const originals = [];
    // Consume quoted strings whole; only unquoted integer tokens are protected.
    const encoded = text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
      if (!/^-?\d+$/.test(token) || Number.isSafeInteger(Number(token))) return token;
      originals.push(token);
      return '"' + prefix + (originals.length - 1) + '__"';
    });
    return {
      text: encoded,
      restore: result => result.replace(new RegExp('"' + prefix + '(\\d+)__"', "g"), (_, index) => originals[Number(index)])
    };
  }
})();
