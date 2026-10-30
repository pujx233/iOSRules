# Bilibili（Loon）

基于 kokoryh / Sparkle 的 2026-09-06 构建，以及本仓库 `Script/Kelee/` 中保留的原始备份。入口为 [`Loon/Bilibili_remove_ads.lpx`](../../Loon/Bilibili_remove_ads.lpx)。

本地兼容修正：

- 空降助手默认关闭。9.17.0 及以上或无法识别版本时，请求直接放行，响应保留原始 Chronos 地址、MD5 和签名。
- 旧版本保留原空降方式，补充原作者 10 月 7 日更新的 Chronos 映射。
- 使用 `te: trailers` 判断是否需要补充 `grpc-status`，保留已有 HTTP/2 trailers。

来源：[Sparkle](https://github.com/kokoryh/Sparkle)、[10 月 7 日兼容更新](https://github.com/kokoryh/Sparkle/commit/290bcbdd2f158cdd8f7db9c996e90fe63490e16f)、[9.17.0 验签变更](https://github.com/kokoryh/Sparkle/commit/0c3bc09b498e90ca08ac22ca855800c7d35154c1)。本版本不启用会改变播放历史的新版空降备用方案。

本地验证：`node --test Script/Bilibili/test.cjs`。
