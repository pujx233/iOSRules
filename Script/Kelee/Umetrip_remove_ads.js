const version = 'V1.0.1';
const headers = $request.headers || {};
const key = Object.keys(headers).find(name => name.toLowerCase() === 'rpid');
const rpid = key ? headers[key] : '';
const isAd = typeof rpid === 'string' && (rpid.includes('1000002') || rpid.includes('1000019'));
$done(isAd ? {status: 'HTTP/1.1 404 Not Found'} : {});