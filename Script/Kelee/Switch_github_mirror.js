/*
Loon专用
2024-04-21 01:29:51
*/
const githubPrefix = "https://raw.githubusercontent.com/";
const mirrors = {
    "A镜像": "https://fastraw.ixnic.net/",
    "B镜像": "https://hub.incept.pw/"
};
const selection = $persistentStore.read("镜像源") || "A镜像";
const mirror = mirrors[selection];

if (!$request.url.startsWith(githubPrefix) || !mirror) {
    $done({});
} else {
    const headers = { ...$request.headers };
    for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "host") delete headers[name];
    }
    headers.Host = mirror.slice("https://".length, -1);
    $done({
        url: $request.url.replace(githubPrefix, mirror),
        headers
    });
}
