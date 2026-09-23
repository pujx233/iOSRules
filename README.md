# Stash

## Loon

- 哔哩哔哩去广告 Debug:
  `loon://import?plugin=https://raw.githubusercontent.com/pujx233/Stash/refs/heads/main/Bilibili_remove_ads_debug.lpx`

- **FotMob去广告**：[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fpujx233%2FStash%2Fmain%2FFotMobLite.lpx) · [下载 LPX](https://raw.githubusercontent.com/pujx233/Stash/main/FotMobLite.lpx) · [图标](./icons/FotMob.jpg)
  - 两条原生规则：精确拦截 FotMob 专用 Nimbus 广告域名，将 `/prod/pub/houseads` 自家推广接口返回为空列表；无脚本、无开关。
  - 补充现有通用去广告规则，清理会员、Predict、通知、社交账号和游戏推广；只需解密 `pub.fotmob.com`。要求 Loon 3.5.1 (978) 或更新版本。
  - 已通过 iPhone 镜像和抓包验证：首页、比赛详情推广消失，比分、积分榜、新闻正常。部分广告位仍留白，不保证覆盖所有地区及其他广告 SDK。
  - 导入后完全关闭 FotMob 再打开。此前在主配置中添加的两条 `FotMob 去广告` 规则，可在插件启用后删除，避免重复维护。
  - 图标取自 [FotMob 官方 App Store 页面](https://apps.apple.com/app/id488575683)，随本仓库保存；私有抓包、原始配置和账号信息不包含在插件中。

- **知乎去广告**：[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fpujx233%2FStash%2Fmain%2FZhihuLite.lpx) · [LPX](./ZhihuLite.lpx) · [处理脚本](./ZhihuLite.js)
  - 清理开屏、关注/推荐信息流、回答和评论广告；过滤回答正文底部 `recommendations` 接口中明确标记为 `ad` 的卡片。
  - 固定移除关注流中“你可能感兴趣”“为你推荐”等插入卡片，与去广告一起执行，无需配置开关。
  - 合入可莉规则所覆盖的 HTTPDNS/QUIC 配置、正文推广卡片、圈子卡片、评论调查、搜索推广、直答引导和会员推广入口清理。
  - 保留原生首页标签、默认页和排序；旧版单关注布局及启动配置实验已移除。
  - 保留普通回答、付费内容和分页；脚本保护 64 位整数，遇到不能安全处理的响应时保留原文。
  - 直接拦截使用原生规则，回答底部使用原生 jq；复杂卡片保留脚本。无清理标记时跳过 JSON 解析，命中后只运行相关过滤，并减少数组和大整数处理的临时分配。
  - 导入或更新后完全关闭知乎再打开。使用这份合并版时，停用其他知乎去广告插件；此前单独添加的回答底部补充规则也可删除，避免重复维护。

### 知乎规则来源与维护范围

这是本仓库维护的合并版，沿用可莉的名称、署名、主页、图标等头部展示信息；功能说明对应本版行为。可莉相关规则以既有源码副本为对照，其头部日期为 `2026-06-01 17:11:35`，不是本仓库的更新日期，也不表示已同步其最新版本。

参考：[可莉知乎规则](https://kelee.one/Tool/Loon/Lpx/Zhihu_remove_ads.lpx)、[fmz200 知乎脚本](https://github.com/fmz200/wool_scripts/blob/main/Scripts/zhihu/zhihu.js)、[Loon Rewrite 文档](https://nsloon.app/docs/Rewrite/)。

广告和兴趣推荐采用明确标识及已知卡片位置过滤。首页标签、搜索标签、下一回答中的正常内容保留；不使用整条推荐流拒绝或仅允许单一卡片类型的策略。

### 验证

运行 `node ZhihuLite.test.js`，需要 Node.js 和 jq。17 项测试使用合成样本，覆盖兴趣卡片、普通/付费回答、分页、64 位整数、转义字符、无标记响应直接返回、网络配置、原生导航保留和 LPX 匹配范围。

性能优化与前版 `a53097b` 对照：297 个响应处理结果一致，510 个网址拦截范围一致。相同输入、每版每组 120 次的 macOS ARM64 / Node.js 26.8.2 测试中，关注流耗时中位数由 6.18 ms 降至 5.27 ms；两个无需清理的信息流样本分别由 2.25 ms 降至 0.43 ms、0.90 ms 降至 0.27 ms。测量包含脚本执行环境开销；这是桌面回放结果，不代表 iPhone Loon 的实际延迟或耗电，也不保证所有响应都更快。

回答底部规则已单独通过实机验证：同一回答的原始响应含 1 张广告，Loon 处理后为 0 张，其余字段及分页一致，页面正文和评论正常。合并版另用本地历史抓包回放；不把离线结果视为所有广告位置的实机验收。私有 HAR、账号信息及原始响应不提交到仓库。
