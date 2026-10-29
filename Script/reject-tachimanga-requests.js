const targetUserAgent = 'Tachimanga';

if ($request?.headers?.['User-Agent']?.includes(targetUserAgent)) {
    console.log("Blocking request with User-Agent containing Tachimanga");
    $done({ response: { status: 403, body: 'Access denied' } });
} else {
    $done({});
}
