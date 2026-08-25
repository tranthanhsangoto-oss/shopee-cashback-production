const ALLOWED_INPUT_HOSTS = new Set([
  "s.shopee.vn",
  "vn.shp.ee",
  "shopee.vn",
  "www.shopee.vn",
]);

const PRODUCTION_SUPABASE_HOST = "jqzyytgzgpjpgbtuirmn.supabase.co";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function extractProductFromUrl(url) {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    const path = decodeURIComponent(u.pathname);
    let shopId = "";
    let itemId = "";
    let m;
    m = path.match(/\/product\/(\d+)\/(\d+)/i);
    if (m) { shopId = m[1]; itemId = m[2]; }
    if (!shopId) {
      m = path.match(/\/[^/]+\/(\d+)\/(\d+)(?:\/|$)/i);
      if (m) { shopId = m[1]; itemId = m[2]; }
    }
    if (!shopId) {
      m = path.match(/-i\.(\d+)\.(\d+)/i);
      if (m) { shopId = m[1]; itemId = m[2]; }
    }
    if (!shopId || !itemId) return null;
    return { shopId, itemId, cleanUrl: `https://shopee.vn/product/${shopId}/${itemId}` };
  } catch { return null; }
}

function extractFromHtml(html, baseUrl) {
  const decoded = String(html || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
  const urlMatches = decoded.match(/https?:\/\/(?:www\.)?shopee\.vn\/[^"'<>\\\s]+/gi);
  if (urlMatches) {
    for (const candidate of urlMatches) {
      const product = extractProductFromUrl(candidate);
      if (product) return product;
    }
  }
  const shopPatterns = [/"shopid"\s*:\s*(\d+)/i,/"shop_id"\s*:\s*(\d+)/i,/shopid[=:]\s*["']?(\d+)/i];
  const itemPatterns = [/"itemid"\s*:\s*(\d+)/i,/"item_id"\s*:\s*(\d+)/i,/itemid[=:]\s*["']?(\d+)/i];
  let shopId = "", itemId = "";
  for (const p of shopPatterns) { const m = decoded.match(p); if (m) { shopId = m[1]; break; } }
  for (const p of itemPatterns) { const m = decoded.match(p); if (m) { itemId = m[1]; break; } }
  if (shopId && itemId) return {shopId,itemId,cleanUrl:`https://shopee.vn/product/${shopId}/${itemId}`};
  const meta = decoded.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i);
  if (meta) {
    try { const target = new URL(meta[1].trim(), baseUrl); const product = extractProductFromUrl(target); if (product) return product; } catch {}
  }
  const jsPatterns = [/(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/i,/(?:window\.)?location\s*=\s*["']([^"']+)["']/i,/location\.replace\(\s*["']([^"']+)["']\s*\)/i,/location\.assign\(\s*["']([^"']+)["']\s*\)/i];
  for (const p of jsPatterns) {
    const m = decoded.match(p);
    if (m) { try { const target = new URL(m[1], baseUrl); const product = extractProductFromUrl(target); if (product) return product; } catch {} }
  }
  return null;
}

async function resolveShopee(requestUrl) {
  const raw = (requestUrl.searchParams.get("url") || "").trim();
  if (!raw) return json({ok:false,error:"missing_url"},400);
  let currentUrl;
  try { currentUrl = new URL(raw); } catch { return json({ok:false,error:"invalid_url"},400); }
  if (!ALLOWED_INPUT_HOSTS.has(currentUrl.hostname.toLowerCase())) return json({ok:false,error:"unsupported_host"},400);
  const direct = extractProductFromUrl(currentUrl);
  if (direct) return json({ok:true,...direct,resolvedFrom:raw,method:"direct"});
  try {
    for (let i=0;i<6;i++) {
      const response = await fetch(currentUrl.toString(), {
        redirect:"manual",
        headers:{
          "user-agent":"Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
          accept:"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language":"vi-VN,vi;q=0.9,en;q=0.8",
        },
      });
      const location = response.headers.get("location");
      if (location) {
        currentUrl = new URL(location,currentUrl);
        const product = extractProductFromUrl(currentUrl);
        if (product) return json({ok:true,...product,resolvedFrom:raw,method:"http_redirect"});
        const host = currentUrl.hostname.toLowerCase().replace(/^www\./,"");
        if (host!=="s.shopee.vn"&&host!=="vn.shp.ee"&&host!=="shopee.vn") return json({ok:false,error:"redirect_not_shopee",finalHost:host},400);
        continue;
      }
      const html = await response.text();
      const product = extractFromHtml(html,currentUrl);
      if (product) return json({ok:true,...product,resolvedFrom:raw,method:"html"});
      return json({ok:false,error:"product_not_found_in_response",status:response.status,finalHost:currentUrl.hostname,responseLength:html.length},422);
    }
    return json({ok:false,error:"too_many_redirects"},400);
  } catch { return json({ok:false,error:"resolve_failed"},502); }
}

function devNetworkGuardScript() {
  return `<script>(function(){
    const PROD_HOST=${JSON.stringify(PRODUCTION_SUPABASE_HOST)};
    const nativeFetch=window.fetch.bind(window);
    window.fetch=function(input,init){
      try{
        const raw=typeof input==='string'?input:(input&&input.url)||'';
        const u=new URL(raw,location.href);
        if(u.hostname===PROD_HOST){
          console.warn('[DEV GUARD] Blocked Production Supabase request:',u.pathname);
          return Promise.reject(new Error('DEV_MODE_BLOCKED_PRODUCTION_SUPABASE'));
        }
      }catch(e){ if(String(e&&e.message)==='DEV_MODE_BLOCKED_PRODUCTION_SUPABASE') return Promise.reject(e); }
      return nativeFetch(input,init);
    };
    window.__SHOPEE_CASHBACK_MODE__='DEV';
  })();</script>`;
}

async function injectDevSandbox(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;
  const contentType = assetResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return assetResponse;

  let html = await assetResponse.text();

  // DEV has its own browser storage namespace even if someone later maps the same hostname locally.
  html = html.replaceAll('shopeeCashbackProductionStateV1','shopeeCashbackDevStateV1');

  // Guard is injected before any page scripts so Production Supabase cannot be contacted from DEV.
  const guard = devNetworkGuardScript();
  html = html.includes('</head>') ? html.replace('</head>', `${guard}</head>`) : guard + html;

  // Do NOT inject any Production patch files on DEV.
  const version='20260825-dev-1';
  const sandboxTag=`<script src="/dev-sandbox.js?v=${version}"></script>`;
  if(!html.includes('/dev-sandbox.js?v=')){
    html = html.includes('</body>') ? html.replace('</body>', `${sandboxTag}</body>`) : html + sandboxTag;
  }

  const headers=new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.set('cache-control','no-store');
  headers.set('x-shopee-cashback-mode','DEV');
  return new Response(html,{status:assetResponse.status,statusText:assetResponse.statusText,headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/resolve-shopee") {
      if (request.method !== "GET") return json({ok:false,error:"method_not_allowed"},405);
      return resolveShopee(url);
    }
    if (request.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") {
        return injectDevSandbox(request,env);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
