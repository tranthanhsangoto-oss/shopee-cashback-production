const ALLOWED_INPUT_HOSTS = new Set([
  "s.shopee.vn",
  "vn.shp.ee",
  "shopee.vn",
  "www.shopee.vn",
]);

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

async function injectRuntimePatch(request, env, patchPath) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;
  const contentType = assetResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return assetResponse;
  let html = await assetResponse.text();
  if (patchPath === "/admin-production-fix.js") {
    html = html.replace(
      "const prodSb=window.supabase.createClient(PROD_SUPABASE_URL,PROD_SUPABASE_KEY);",
      "const prodSb=window.supabase.createClient(PROD_SUPABASE_URL,PROD_SUPABASE_KEY,{auth:{storageKey:'shopee-cashback-admin-auth',persistSession:true,autoRefreshToken:true}});"
    );
  }
  const version = "20260824-5";
  let scriptTags = `<script src="${patchPath}?v=${version}"></script>`;
  if (patchPath === "/user-production-fix.js") {
    scriptTags += `<script src="/user-notification-fix.js?v=${version}"></script>`;
  }
  if (!html.includes(`${patchPath}?v=${version}`)) {
    html = html.includes("</body>") ? html.replace("</body>", `${scriptTags}</body>`) : html + scriptTags;
  }
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.set("cache-control","no-store");
  return new Response(html,{status:assetResponse.status,statusText:assetResponse.statusText,headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/resolve-shopee") {
      if (request.method !== "GET") return json({ok:false,error:"method_not_allowed"},405);
      return resolveShopee(url);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/" || url.pathname === "/index.html") return injectRuntimePatch(request,env,"/user-production-fix.js");
      if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") return injectRuntimePatch(request,env,"/admin-production-fix.js");
    }
    return env.ASSETS.fetch(request);
  },
};
