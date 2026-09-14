// ====================== 配置中心 (完全依靠环境变量，零硬编码) ======================
const VERSION = " Celestial Keeper";
const CUSTOM_TITLE = "🐀🐂🐅🐇🐉🐍「域梦·天守」🐎🐐🐒🐓🐕🐖";

// 动态读取 Cloudflare API Tokens（多个用逗号隔开）
function getApiKeys(env) {
  const keysStr = (env && env.CF_API_KEYS) || (typeof CF_API_KEYS !== 'undefined' ? CF_API_KEYS : "");
  if (!keysStr) return [];
  if (Array.isArray(keysStr)) return keysStr;
  return keysStr.split(',').map(k => k.trim()).filter(Boolean);
}

// 动态读取 WHOIS 代理接口列表
function getWhoisUrls(env) {
  const urlsStr = (env && env.WHOIS_PROXY_URLS) || (typeof WHOIS_PROXY_URLS !== 'undefined' ? WHOIS_PROXY_URLS : "");
  if (urlsStr) {
    return (Array.isArray(urlsStr) ? urlsStr : urlsStr.split(',')).map(u => u.trim()).filter(Boolean);
  }
  return [
    "https://rdap.org/domain/",               // 官方 RDAP
    "https://networkcalc.com/api/dns/lookup/" // 备用第三方 API
  ];
}

// 动态读取访问密码和后台管理员密码
function getPasswords(env) {
  const accessPassword = (env && typeof env.ACCESS_PASSWORD !== 'undefined') 
    ? env.ACCESS_PASSWORD 
    : (typeof ACCESS_PASSWORD !== 'undefined' ? ACCESS_PASSWORD : "");
    
  const adminPassword = (env && env.ADMIN_PASSWORD) 
    ? env.ADMIN_PASSWORD 
    : (typeof ADMIN_PASSWORD !== 'undefined' ? ADMIN_PASSWORD : "");

  return { accessPassword, adminPassword };
}

// 全局页脚
const footerHTML = `
  <footer>
    Powered by DomainDream 🚥${VERSION} | © 2023-2026 长风破浪会有时 🍁 直挂云帆济沧海
  </footer>
`;

// ====================== 路由监听 ======================
addEventListener('fetch', event => {
  const env = {
    CF_API_KEYS: typeof CF_API_KEYS !== 'undefined' ? CF_API_KEYS : undefined,
    ADMIN_PASSWORD: typeof ADMIN_PASSWORD !== 'undefined' ? ADMIN_PASSWORD : undefined,
    ACCESS_PASSWORD: typeof ACCESS_PASSWORD !== 'undefined' ? ACCESS_PASSWORD : undefined,
    WHOIS_PROXY_URLS: typeof WHOIS_PROXY_URLS !== 'undefined' ? WHOIS_PROXY_URLS : undefined,
    DOMAIN_INFO: typeof DOMAIN_INFO !== 'undefined' ? DOMAIN_INFO : undefined
  };
  event.respondWith(handleRequest(event.request, env));
});

async function handleRequest(request, env = {}) {
  // KV 命名空间动态绑定
  const kvNamespace = (env && env.DOMAIN_INFO) ? env.DOMAIN_INFO : (typeof DOMAIN_INFO !== 'undefined' ? DOMAIN_INFO : null);
  
  // 清理 KV 中的错误内容
  if (kvNamespace) {
    await cleanupKV(kvNamespace);
  }
  
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/manual-query") {
    return handleManualQuery(request, env, kvNamespace);
  } else if (path === "/") {
    return handleFrontend(request, env, kvNamespace);
  } else if (path === "/admin") {
    return handleAdmin(request, env, kvNamespace);
  } else if (path === "/api/update") {
    return handleApiUpdate(request, env, kvNamespace);
  } else if (path === "/login") {
    return handleLogin(request, env);
  } else if (path === "/admin-login") {
    return handleAdminLogin(request, env);
  } else if (path.startsWith("/whois/")) {
    const domain = path.split("/")[2];
    return handleWhoisRequest(domain, env);
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

// ====================== 核心业务逻辑 ======================

async function handleManualQuery(request, env, kvNamespace) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await request.json();
    const { domain } = data;
    const whoisInfo = await fetchWhoisInfo(domain, env);
    if (kvNamespace) {
      await cacheWhoisInfo(kvNamespace, domain, whoisInfo);
    }
    return new Response(JSON.stringify(whoisInfo), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

async function cleanupKV(kvNamespace) {
  try {
    const list = await kvNamespace.list();
    for (const key of list.keys) {
      const value = await kvNamespace.get(key.name);
      if (value) {
        try {
          const parsed = JSON.parse(value);
          const data = parsed.data || parsed;
          if (data && data.whoisError) {
            await kvNamespace.delete(key.name);
          }
        } catch (e) {
          await kvNamespace.delete(key.name);
        }
      }
    }
  } catch (e) {
    console.error("Cleanup KV error:", e);
  }
}

async function handleFrontend(request, env, kvNamespace) {
  const { accessPassword, adminPassword } = getPasswords(env);
  const cookie = request.headers.get("Cookie") || "";
  if (accessPassword && !cookie.includes(`access_token=${accessPassword}`)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  const domains = await fetchCloudflareDomainsInfo(env);
  const domainsWithInfo = await fetchDomainInfo(domains, env, kvNamespace);

  return new Response(generateHTML(domainsWithInfo, false, adminPassword), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleAdmin(request, env, kvNamespace) {
  const { adminPassword } = getPasswords(env);
  const cookie = request.headers.get("Cookie") || "";
  if (!adminPassword || !cookie.includes(`admin_token=${adminPassword}`)) {
    return Response.redirect(`${new URL(request.url).origin}/admin-login`, 302);
  }

  const domains = await fetchCloudflareDomainsInfo(env);
  const domainsWithInfo = await fetchDomainInfo(domains, env, kvNamespace);
  return new Response(generateHTML(domainsWithInfo, true, adminPassword), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleLogin(request, env) {
  const { accessPassword } = getPasswords(env);
  if (request.method === "POST") {
    const formData = await request.formData();
    const password = formData.get("password");
    
    if (password === accessPassword) {
      return new Response("Login successful", {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `access_token=${accessPassword}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
        }
      });
    } else {
      return new Response(generateLoginHTML("前台登录", "/login", "密码错误，请重试。"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 401
      });
    }
  }
  return new Response(generateLoginHTML("前台登录", "/login"), {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

async function handleAdminLogin(request, env) {
  const { adminPassword } = getPasswords(env);
  if (request.method === "POST") {
    const formData = await request.formData();
    const password = formData.get("password");

    if (adminPassword && password === adminPassword) {
      return new Response("Admin login successful", {
        status: 302,
        headers: {
          "Location": "/admin",
          "Set-Cookie": `admin_token=${adminPassword}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
        }
      });
    } else {
      return new Response(generateLoginHTML("后台登录", "/admin-login", "密码错误或未在环境变量中配置 ADMIN_PASSWORD"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 401
      });
    }
  }

  return new Response(generateLoginHTML("后台登录", "/admin-login"), {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

async function handleApiUpdate(request, env, kvNamespace) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { adminPassword } = getPasswords(env);
  const auth = request.headers.get("Authorization");
  if (!adminPassword || !auth || auth !== `Basic ${btoa(`:${adminPassword}`)}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const data = await request.json();
    const { action, domain, system, registrar, registrationDate, expirationDate } = data;

    if (!kvNamespace) {
      throw new Error("KV 命名空间未绑定，无法操作自定义数据");
    }

    if (action === 'add' || action === 'edit') {
      const existingData = await getCachedWhoisInfo(kvNamespace, domain) || {};
      const domainInfo = { 
        ...existingData, 
        domain, 
        registrar, 
        registrationDate, 
        expirationDate, 
        isCustom: existingData.isCustom !== undefined ? existingData.isCustom : true, 
        system: system || existingData.system || 'Custom'
      };
      await cacheWhoisInfo(kvNamespace, domain, domainInfo);
    } else if (action === 'delete') {
      await kvNamespace.delete(`whois_${domain}`);
    } else {
      let domainInfo = await getCachedWhoisInfo(kvNamespace, domain) || {};
      domainInfo = {
        ...domainInfo,
        domain,
        registrar,
        registrationDate,
        expirationDate
      };
      await cacheWhoisInfo(kvNamespace, domain, domainInfo);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 动态通过 API Keys 批量拉取域名
async function fetchCloudflareDomainsInfo(env) {
  const apiKeys = getApiKeys(env);
  if (!apiKeys || apiKeys.length === 0) {
    return [];
  }

  let allDomains = [];

  for (const apiKey of apiKeys) {
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4/zones', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.result)) {
          const zones = data.result.map(zone => ({
            domain: zone.name,
            registrar: 'Cloudflare',
            registrationDate: zone.created_on ? new Date(zone.created_on).toISOString().split('T')[0] : 'Unknown',
            system: 'Cloudflare',
          }));
          allDomains = allDomains.concat(zones);
        }
      }
    } catch (e) {
      console.error("Fetch Cloudflare domains error:", e);
    }
  }

  return allDomains;
}

async function fetchDomainInfo(domains, env, kvNamespace) {
  const result = [];
  let allDomains = [];
  const whoisUrls = getWhoisUrls(env);
  
  if (kvNamespace) {
    try {
      const allDomainKeys = await kvNamespace.list({ prefix: 'whois_' });
      allDomains = await Promise.all(allDomainKeys.keys.map(async (key) => {
        const value = await kvNamespace.get(key.name);
        if (!value) return null;
        try {
          const parsed = JSON.parse(value);
          const data = parsed.data || parsed;
          if (data && data.whoisError) return null;
          return data;
        } catch (e) {
          return null;
        }
      }));
    } catch (e) {
      console.error("Fetch KV domain list error:", e);
    }
  }

  allDomains = allDomains.filter(d => d !== null);
  const customDomains = allDomains.filter(d => d.isCustom);
  const domainMap = new Map();
  
  for (const domain of domains) {
    domainMap.set(domain.domain, { ...domain });
  }
  
  for (const domain of customDomains) {
    if (!domainMap.has(domain.domain)) {
      domainMap.set(domain.domain, { ...domain });
    }
  }
  
  const mergedDomains = Array.from(domainMap.values());
  
  for (const domain of mergedDomains) {
    let domainInfo = { ...domain };
    const cachedInfo = kvNamespace ? await getCachedWhoisInfo(kvNamespace, domainInfo.domain) : null;
    
    if (cachedInfo) {
      domainInfo = { 
        ...domainInfo, 
        ...cachedInfo, 
        domain: domainInfo.domain 
      };
    } else if (!domainInfo.isCustom && whoisUrls.length > 0) {
      try {
        const whoisInfo = await fetchWhoisInfo(domainInfo.domain, env);
        domainInfo = { ...domainInfo, ...whoisInfo };
        if (whoisInfo && !whoisInfo.whoisError && kvNamespace) {
          await cacheWhoisInfo(kvNamespace, domainInfo.domain, domainInfo);
        }
      } catch (error) {
        domainInfo.whoisError = error.message;
      }
    }
    result.push(domainInfo);
  }
  return result;
}

async function handleWhoisRequest(domain, env) {
  const whoisUrls = getWhoisUrls(env);
  try {
    const response = await fetch(`${whoisUrls[0]}${domain}`);
    if (!response.ok) {
      throw new Error(`WHOIS API responded with status: ${response.status}`);
    }
    const whoisData = await response.json();
    return new Response(JSON.stringify({ error: false, rawData: whoisData.rawData }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: true, message: error.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

async function fetchWhoisInfo(domain, env) {
  const whoisUrls = getWhoisUrls(env);
  for (const proxyUrl of whoisUrls) {
    try {
      const response = await fetch(`${proxyUrl}${domain}`);
      if (!response.ok) continue;

      const whoisData = await response.json();

      if (whoisData) {
        const registrar = whoisData.registrar || 
                          (whoisData.records && whoisData.records.registrar) || 
                          'Cloudflare';
        const creationDate = whoisData.creationDate || 
                             (whoisData.records && whoisData.records.created_at) || 
                             null;
        const expirationDate = whoisData.expirationDate || 
                              (whoisData.records && whoisData.records.expires_at) || 
                              null;

        return {
          registrar: registrar,
          registrationDate: formatDate(creationDate) || 'Unknown',
          expirationDate: formatDate(expirationDate) || 'Unknown'
        };
      }
    } catch (error) {
      continue;
    }
  }

  return { 
    registrar: 'Cloudflare', 
    registrationDate: 'Unknown', 
    expirationDate: 'Unknown' 
  };
}

function formatDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? dateString : date.toISOString().split('T')[0];
}

async function getCachedWhoisInfo(kvNamespace, domain) {
  if (!kvNamespace) return null;
  const cacheKey = `whois_${domain}`;
  const cachedData = await kvNamespace.get(cacheKey);
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      const data = parsed.data || parsed;
      if (data.whoisError) {
        await kvNamespace.delete(cacheKey);
        return null;
      }
      return data;
    } catch (e) {
      await kvNamespace.delete(cacheKey);
      return null;
    }
  }
  return null;
}

async function cacheWhoisInfo(kvNamespace, domain, whoisInfo) {
  if (!kvNamespace) return;
  const cacheKey = `whois_${domain}`;
  await kvNamespace.put(cacheKey, JSON.stringify({
    data: whoisInfo,
    timestamp: Date.now()
  }));
}

// ====================== 界面与渲染 ======================

function getStatusColor(daysRemaining) {
  if (isNaN(daysRemaining) || daysRemaining === 'N/A') return '#64748b';
  if (daysRemaining <= 7) return '#ef4444';   
  if (daysRemaining <= 30) return '#f59e0b';  
  if (daysRemaining <= 90) return '#eab308';  
  return '#10b981';                           
}

function getStatusTitle(daysRemaining) {
  if (isNaN(daysRemaining)) return '未知状态';
  if (daysRemaining <= 7) return '紧急';
  if (daysRemaining <= 30) return '警告';
  if (daysRemaining <= 90) return '注意';
  return '正常';
}

function generateLoginHTML(title, action, errorMessage = "") {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${CUSTOM_TITLE}</title>
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
        display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; 
        color: #f8fafc;
      }
      .login-container { 
        background: rgba(30, 41, 59, 0.7); 
        backdrop-filter: blur(16px);
        padding: 2.5rem; border-radius: 16px; 
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(59, 130, 246, 0.2); 
        text-align: center; width: 100%; max-width: 400px; 
        border: 1px solid rgba(255, 255, 255, 0.1); 
      }
      h1 { color: #f8fafc; margin-bottom: 1.5rem; font-size: 24px; font-weight: 700; text-shadow: 0 0 10px rgba(59, 130, 246, 0.5); }
      input[type="password"] { 
        width: 100%; padding: 0.75rem; margin-bottom: 1.25rem; 
        background: rgba(15, 23, 42, 0.6); color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; box-sizing: border-box; font-size: 14px; outline: none; transition: all 0.3s; 
      }
      input[type="password"]:focus { border-color: #3b82f6; box-shadow: 0 0 12px rgba(59,130,246,0.5); }
      input[type="submit"] { 
        background: linear-gradient(90deg, #2563eb, #3b82f6); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; width: 100%; transition: all 0.3s; box-shadow: 0 0 15px rgba(37, 99, 235, 0.4);
      }
      input[type="submit"]:hover { background: linear-gradient(90deg, #1d4ed8, #2563eb); box-shadow: 0 0 20px rgba(37, 99, 235, 0.7); }
      .error-message { color: #f87171; margin-bottom: 1rem; font-size: 14px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); padding: 8px; border-radius: 6px; }
      footer { position: fixed; left: 0; bottom: 0; width: 100%; background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(10px); color: #94a3b8; text-align: center; padding: 15px 0; font-size: 13px; border-top: 1px solid rgba(255, 255, 255, 0.05); }
    </style>
  </head>
  <body>
    <div class="login-container">
      <h1>${title}</h1>
      ${errorMessage ? `<p class="error-message">${errorMessage}</p>` : ''}
      <form method="POST" action="${action}">
        <input type="password" name="password" placeholder="请输入密码" required>
        <input type="submit" value="安全登录">
      </form>
    </div>
    ${footerHTML}
  </body>
  </html>`;
}

function generateHTML(domains, isAdmin, adminPassword) {
  const categorizedDomains = categorizeDomains(domains);
  const today = new Date();

  const urgentList = [];  
  const warningList = []; 

  domains.forEach(d => {
    if (d.expirationDate && d.expirationDate !== 'Unknown' && d.expirationDate !== '未知') {
      const exp = new Date(d.expirationDate);
      const days = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
      if (days >= 0 && days <= 30) {
        urgentList.push({ name: d.domain, days });
      } else if (days > 30 && days <= 90) {
        warningList.push({ name: d.domain, days });
      }
    }
  });

  let noticeBannerHTML = '';
  if (urgentList.length > 0 || warningList.length > 0) {
    noticeBannerHTML = `<div class="reminder-box">`;
    if (urgentList.length > 0) {
      noticeBannerHTML += `
        <div class="reminder-item urgent">
          <span class="icon">🚨</span>
          <div>
            <strong>紧急续费通知：</strong> 发现有 ${urgentList.length} 个域名资产即将在 30 天内过期！
            <div class="badge-row">${urgentList.map(item => `<span class="remind-tag">${item.name} (余 ${item.days} 天)</span>`).join('')}</div>
          </div>
        </div>`;
    }
    if (warningList.length > 0) {
      noticeBannerHTML += `
        <div class="reminder-item warning">
          <span class="icon">⏳</span>
          <div>
            <strong>近期到期提醒：</strong> 发现有 ${warningList.length} 个域名资产在 90 天内面临到期续费。
            <div class="badge-row">${warningList.map(item => `<span class="remind-tag">${item.name} (余 ${item.days} 天)</span>`).join('')}</div>
          </div>
        </div>`;
    }
    noticeBannerHTML += `</div>`;
  }

  const generateTable = (domainList, isCFTopLevel) => {
    if (!domainList || domainList.length === 0) {
      return `<tr><td colspan="${isAdmin ? 9 : 8}" class="empty-cell">此列表中暂无注册域名资产</td></tr>`;
    }

    return domainList.map(info => {
      const expirationDate = info.expirationDate && info.expirationDate !== 'Unknown' ? new Date(info.expirationDate) : null;
      const daysRemaining = !expirationDate || isNaN(expirationDate.getTime()) ? 'N/A' : Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
      
      const regDate = info.registrationDate && info.registrationDate !== 'Unknown' ? new Date(info.registrationDate) : null;
      const totalDays = !expirationDate || !regDate || isNaN(expirationDate.getTime()) || isNaN(regDate.getTime()) ? 'N/A' : Math.ceil((expirationDate - regDate) / (1000 * 60 * 60 * 24));
      
      const progressPercentage = isNaN(daysRemaining) || isNaN(totalDays) || totalDays <= 0 ? 0 : Math.max(0, Math.min(100, 100 - (daysRemaining / totalDays * 100)));
      
      const whoisErrorMessage = info.whoisError 
        ? `<br><span class="error-inline">⚠️ WHOIS解析错误: ${info.whoisError}</span>`
        : '';

      let badgeClass = 'badge-gray';
      if (!isNaN(daysRemaining)) {
        if (daysRemaining <= 7) badgeClass = 'badge-red';
        else if (daysRemaining <= 30) badgeClass = 'badge-orange';
        else if (daysRemaining <= 90) badgeClass = 'badge-yellow';
        else badgeClass = 'badge-green';
      }

      let operationButtons = '';
      if (isAdmin) {
        operationButtons = `
          <button class="btn btn-edit" onclick="editDomain('${info.domain}', this)">⚙️ 编辑</button>
          <button class="btn btn-secondary" onclick="triggerManualQuery('${info.domain}')">🔄 更新WHOIS</button>
          ${!isCFTopLevel ? `<button class="btn btn-danger" onclick="deleteDomain('${info.domain}')">🗑️ 删除</button>` : ''}
        `;
      }

      return `
        <tr class="domain-data-row" data-domain="${info.domain}">
          <td><span class="status-pill ${badgeClass}">${getStatusTitle(daysRemaining)}</span></td>
          <td class="domain-name">${info.domain}</td>
          <td><span class="sys-tag">${info.system}</span></td>
          <td class="editable-cell" data-field="registrar">${info.registrar || 'Cloudflare'}${whoisErrorMessage}</td>
          <td class="editable-cell" data-field="registrationDate">${info.registrationDate || 'Unknown'}</td>
          <td class="editable-cell" data-field="expirationDate">${info.expirationDate || 'Unknown'}</td>
          <td class="days-cell font-medium">${daysRemaining === 'N/A' ? 'N/A' : daysRemaining + ' 天'}</td>
          <td>
            <div class="progress-bar-wrapper">
              <div class="progress-bar-inner" style="width: ${progressPercentage}%; background-color: ${getStatusColor(daysRemaining)};"></div>
            </div>
          </td>
          ${isAdmin ? `<td><div class="btn-group">${operationButtons}</div></td>` : ''}
        </tr>
      `;
    }).join('');
  };

  const cfTopLevelTable = generateTable(categorizedDomains.cfTopLevel, true);
  const cfSecondLevelAndCustomTable = generateTable(categorizedDomains.cfSecondLevelAndCustom, false);

  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CUSTOM_TITLE}${isAdmin ? ' - 后台管理' : ''}</title>
    <style>
      :root {
        --primary: #3b82f6;
        --bg-main: #0b0f19;
        --card-bg: rgba(20, 27, 45, 0.65);
        --card-border: rgba(255, 255, 255, 0.08);
        --text-dark: #f1f5f9;
        --text-muted: #94a3b8;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        background: linear-gradient(125deg, #070a12 0%, #0f172a 40%, #1e1b4b 70%, #090d16 100%);
        background-size: 200% 200%;
        animation: cyberGlow 15s ease infinite;
        color: var(--text-dark); 
        padding: 24px; 
        line-height: 1.5; 
        min-height: 100vh;
      }

      @keyframes cyberGlow {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }

      .container { max-width: 1280px; margin: 0 auto; padding-bottom: 100px; }
      
      header { 
        display: flex; justify-content: space-between; align-items: center; 
        background: linear-gradient(135deg, rgba(30, 58, 138, 0.8), rgba(37, 99, 235, 0.6)); 
        backdrop-filter: blur(12px);
        padding: 20px 28px; border-radius: 16px; color: white; 
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(59, 130, 246, 0.3); 
        margin-bottom: 25px; 
      }
      header h1 { font-size: 22px; font-weight: 700; text-shadow: 0 0 10px rgba(255,255,255,0.5); }
      
      .reminder-box { display: flex; flex-direction: column; gap: 14px; margin-bottom: 25px; }
      .reminder-item { display: flex; gap: 16px; padding: 16px 24px; border-radius: 12px; font-size: 14px; align-items: flex-start; backdrop-filter: blur(10px); }
      .reminder-item.urgent { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; }
      .reminder-item.warning { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fde047; }
      .reminder-item .icon { font-size: 20px; }
      .badge-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .remind-tag { background: rgba(0,0,0,0.3); padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid rgba(255,255,255,0.1); }

      .tools-container { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 25px; }
      @media (max-width: 768px) { .tools-container { grid-template-columns: 1fr; } }
      .tool-card { 
        background: var(--card-bg); 
        backdrop-filter: blur(16px);
        padding: 18px 24px; border-radius: 14px; 
        border: 1px solid var(--card-border); 
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2); 
        display: flex; align-items: center; gap: 12px; 
      }
      .tool-card input { 
        flex: 1; padding: 11px 16px; 
        background: rgba(15, 23, 42, 0.7); color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; font-size: 14px; outline: none; transition: all 0.3s; 
      }
      .tool-card input:focus { border-color: #3b82f6; box-shadow: 0 0 12px rgba(59, 130, 246, 0.4); }
      .tool-card button { 
        background: linear-gradient(90deg, #2563eb, #3b82f6); color: white; border: none; padding: 11px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; white-space: nowrap; transition: all 0.3s; box-shadow: 0 0 12px rgba(37, 99, 235, 0.4);
      }
      .tool-card button:hover { box-shadow: 0 0 20px rgba(37, 99, 235, 0.7); }

      h2 { font-size: 18px; font-weight: 700; color: #cbd5e1; margin: 30px 0 14px 0; display: flex; align-items: center; gap: 8px; text-shadow: 0 0 8px rgba(255,255,255,0.2); }
      
      .table-responsive { 
        background: var(--card-bg); 
        backdrop-filter: blur(16px);
        border-radius: 14px; 
        border: 1px solid var(--card-border); 
        overflow: hidden; 
        box-shadow: 0 10px 30px rgba(0,0,0,0.3); 
        margin-bottom: 10px; 
      }
      table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
      th { background: rgba(15, 23, 42, 0.8); padding: 16px; font-weight: 600; color: #94a3b8; border-bottom: 1px solid var(--card-border); }
      td { padding: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); color: var(--text-dark); vertical-align: middle; }
      tr.domain-data-row:hover { background: rgba(255, 255, 255, 0.03); }
      .domain-name { font-weight: 600; color: #38bdf8; font-size: 15px; text-shadow: 0 0 8px rgba(56, 189, 248, 0.3); }
      .empty-cell { text-align: center; color: var(--text-muted); padding: 40px 0; font-style: italic; }
      .error-inline { color: #f87171; font-size: 12px; font-weight: 500; display: block; margin-top: 4px; }

      .status-pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 50px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
      .badge-green { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
      .badge-yellow { background: rgba(234, 179, 8, 0.2); color: #fde047; border: 1px solid rgba(234, 179, 8, 0.3); }
      .badge-orange { background: rgba(245, 158, 11, 0.2); color: #fb923c; border: 1px solid rgba(245, 158, 11, 0.3); }
      .badge-red { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
      .badge-gray { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }
      .sys-tag { background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid rgba(59, 130, 246, 0.3); }

      .progress-bar-wrapper { background-color: rgba(255,255,255,0.1); height: 8px; border-radius: 50px; overflow: hidden; width: 100px; }
      .progress-bar-inner { height: 100%; border-radius: 50px; transition: width 0.3s ease; box-shadow: 0 0 8px currentColor; }

      .btn-group { display: flex; gap: 8px; }
      .btn { padding: 6px 14px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; white-space: nowrap; }
      .btn-edit { background: rgba(255,255,255,0.1); color: #e2e8f0; border-color: rgba(255,255,255,0.15); }
      .btn-edit:hover { background: rgba(255,255,255,0.2); color: #fff; }
      .btn-secondary { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); }
      .btn-secondary:hover { background: rgba(56, 189, 248, 0.3); }
      .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.3); }
      .btn-danger:hover { background: rgba(239, 68, 68, 0.3); }
      
      .admin-form-container { 
        background: var(--card-bg); 
        backdrop-filter: blur(16px);
        padding: 28px; border-radius: 14px; 
        border: 1px solid var(--card-border); 
        box-shadow: 0 10px 30px rgba(0,0,0,0.3); 
        margin-top: 30px; 
      }
      .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
      .form-grid input { 
        padding: 11px 14px; 
        background: rgba(15, 23, 42, 0.7); color: #f8fafc;
        border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; font-size: 14px; outline: none; transition: border 0.2s; width: 100%; 
      }
      .form-grid input:focus { border-color: #3b82f6; }
      .btn-submit-form { 
        background: linear-gradient(90deg, #10b981, #059669); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
      }
      .btn-submit-form:hover { box-shadow: 0 0 20px rgba(16, 185, 129, 0.7); }

      .editable-cell input { width: 100%; padding: 4px 8px; background: rgba(15,23,42,0.9); color: #fff; border: 1px solid #3b82f6; border-radius: 4px; font-size: 13px; box-sizing: border-box; }

      footer { position: fixed; left: 0; bottom: 0; width: 100%; background: rgba(11, 15, 25, 0.85); backdrop-filter: blur(12px); color: var(--text-muted); text-align: center; padding: 16px 0; font-size: 13px; border-top: 1px solid var(--card-border); z-index: 100; }
    </style>
  </head>
  <body>
    <div class="container">

<header style="width: 100%; background: linear-gradient(135deg, rgba(30, 58, 138, 0.8), rgba(37, 99, 235, 0.6)); padding: 12px 24px; box-sizing: border-box;">
  <div style="max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;">
    
    <div style="display: flex; align-items: center; gap: 12px; color: white; font-size: 0.85rem;">
      <a href="/" style="color: white; text-decoration: none;">🏠 首页</a>
      <span style="background: #22c55e; width: 8px; height: 8px; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px #22c55e;"></span>
      <span style="opacity: 0.9;">系统正常运行</span>
    </div>

    <h1 style="margin: 0; font-size: 1.25rem; color: white; white-space: nowrap;">
      🐀🐂🐅🐇🐉🐍 「域梦🌐天守」 🐎🐐🐒🐓🐕🐖
    </h1>

    <div style="display: flex; justify-content: flex-end; align-items: center; gap: 12px;">
      <a href="${isAdmin ? '/' : '/admin'}" style="background: rgba(255,255,255,0.15); color: white; padding: 6px 16px; border-radius: 50px; text-decoration: none; font-size: 0.9rem; border: 1px solid rgba(255,255,255,0.2);">
        ${isAdmin ? '返回前台' : '🔒 进入后台管理'}
      </a>
    </div>

  </div>
</header>

      ${noticeBannerHTML}

      <div class="tools-container">
        <div class="tool-card">
          <span>🔍</span>
          <input type="text" id="searchBar" onkeyup="filterLocalDomains()" placeholder="在当前列表中秒级搜索域名、系统或注册商...">
        </div>
        <div class="tool-card">
          <span>🌍</span>
          <input type="text" id="quickWhoisInput" placeholder="直接输入任意域名快速查询 WHOIS 详情 (如: example.com)...">
          <button onclick="executeQuickWhois()">全球查询</button>
        </div>
      </div>

      <h2>📦 Cloudflare 顶级域名资产</h2>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th width="110">状态</th>
              <th>域名</th>
              <th>系统</th>
              <th>注册商</th>
              <th>注册日期</th>
              <th>到期日期</th>
              <th>剩余时间</th>
              <th width="120">生命进度</th>
              ${isAdmin ? '<th width="180">操作控制</th>' : ''}
            </tr>
          </thead>
          <tbody id="cfTopTableBody">
            ${cfTopLevelTable}
          </tbody>
        </table>
      </div>

      <h2>🔗 二级域名 / 外部自定义资产</h2>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th width="110">状态</th>
              <th>域名</th>
              <th>系统</th>
              <th>注册商</th>
              <th>注册日期</th>
              <th>到期日期</th>
              <th>剩余时间</th>
              <th width="120">生命进度</th>
              ${isAdmin ? '<th width="180">操作控制</th>' : ''}
            </tr>
          </thead>
          <tbody id="customTableBody">
            ${cfSecondLevelAndCustomTable}
          </tbody>
        </table>
      </div>

      ${isAdmin ? `
        <div class="admin-form-container">
          <h2 style="margin-top:0; margin-bottom:16px;">➕ 添加二级域名或外部自定义资产</h2>
          <form id="addCustomDomainForm">
            <div class="form-grid">
              <input type="text" id="newDomain" placeholder="域名 (如 sub.domain.com 或 domain.net)" required>
              <input type="text" id="newSystem" placeholder="所属系统 (如 腾讯云/阿里云/Custom)" required>
              <input type="text" id="newRegistrar" placeholder="域名注册商" required>
              <input type="date" id="newRegistrationDate" title="注册日期" required>
              <input type="date" id="newExpirationDate" title="到期日期" required>
            </div>
            <button type="submit" class="btn-submit-form">确认添加资产</button>
          </form>
        </div>
      ` : ''}
    </div>

    ${footerHTML}

    <script>
      const ADMIN_SECRET = "${adminPassword}";

      function filterLocalDomains() {
        const keyword = document.getElementById('searchBar').value.toLowerCase().trim();
        const rows = document.querySelectorAll('.domain-data-row');
        rows.forEach(row => {
          const content = row.innerText.toLowerCase();
          row.style.display = content.includes(keyword) ? "" : "none";
        });
      }

      function executeQuickWhois() {
        const value = document.getElementById('quickWhoisInput').value.trim();
        if(!value) {
          alert('请输入想要查询的任意有效域名！');
          return;
        }
        const cleanedDomain = value.replace(/^(https?:\\/\\/)?(www\\.)?/, '');
        window.open('https://www.whois.com/whois/' + cleanedDomain, '_blank');
      }

      async function editDomain(domain, button) {
        const row = button.closest('tr');
        const cells = row.querySelectorAll('.editable-cell');
        
        if (button.textContent.includes('编辑')) {
          button.innerHTML = '💾 保存';
          button.style.backgroundColor = '#10b981';
          button.style.color = '#fff';
          
          cells.forEach(cell => {
            const currentText = cell.textContent.split('⚠️')[0].trim();
            const input = document.createElement('input');
            input.type = cell.getAttribute('data-field').includes('Date') ? 'date' : 'text';
            input.value = currentText === 'Unknown' || currentText === '未知' ? '' : currentText;
            cell.innerHTML = '';
            cell.appendChild(input);
          });
        } else {
          const inputs = row.querySelectorAll('.editable-cell input');
          const updatedData = {
            action: 'edit',
            domain: domain,
            system: row.querySelector('.sys-tag').textContent,
            registrar: inputs[0].value || 'Cloudflare',
            registrationDate: inputs[1].value || 'Unknown',
            expirationDate: inputs[2].value || 'Unknown'
          };

          try {
            const response = await fetch('/api/update', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + ADMIN_SECRET)
              },
              body: JSON.stringify(updatedData)
            });

            if (response.ok) {
              cells.forEach((cell, idx) => {
                cell.textContent = inputs[idx].value || (idx === 0 ? 'Cloudflare' : 'Unknown');
              });
              button.innerHTML = '⚙️ 编辑';
              button.removeAttribute('style');
              alert('资产配置保存成功！');
              location.reload();
            } else {
              throw new Error('云端网络响应错误');
            }
          } catch (error) {
            alert('同步失败: ' + error.message);
            location.reload();
          }
        }
      }

      async function triggerManualQuery(domain) {
        if(!confirm('确定现在立即强制向外部服务器拉取 ' + domain + ' 的最新 WHOIS 缓存数据吗？')) return;
        try {
          const response = await fetch('/api/manual-query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: domain })
          });
          if(response.ok) {
            alert('WHOIS 数据更新同步成功！');
            location.reload();
          } else {
            alert('拉取失败，请检查自建 WHOIS 代理接口状态。');
          }
        } catch(e) {
          alert('请求异常: ' + e.message);
        }
      }

      async function deleteDomain(domain) {
        if (!confirm('警告：此操作不可逆！确认要从系统中彻底删除域名 ' + domain + ' 的自定义资产记录吗？')) return;
        try {
          const response = await fetch('/api/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Basic ' + btoa(':' + ADMIN_SECRET)
            },
            body: JSON.stringify({ action: 'delete', domain: domain })
          });
          const resData = await response.json();
          if (resData.success) {
            alert('该自定义资产已安全删除。');
            location.reload();
          } else {
            alert('删除失败: ' + resData.error);
          }
        } catch (error) {
          alert('网络通信异常，删除未果: ' + error.message);
        }
      }

      if(document.getElementById('addCustomDomainForm')) {
        document.getElementById('addCustomDomainForm').addEventListener('submit', function(e) {
          e.preventDefault();
          const domain = document.getElementById('newDomain').value.trim();
          const system = document.getElementById('newSystem').value.trim();
          const registrar = document.getElementById('newRegistrar').value.trim();
          const registrationDate = document.getElementById('newRegistrationDate').value;
          const expirationDate = document.getElementById('newExpirationDate').value;

          fetch('/api/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Basic ' + btoa(':' + ADMIN_SECRET)
            },
            body: JSON.stringify({
              action: 'add',
              domain: domain,
              system: system,
              registrar: registrar,
              registrationDate: registrationDate,
              expirationDate: expirationDate
            })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert('新资产记录成功载入！');
              location.reload();
            } else {
              alert('录入失败: ' + data.error);
            }
          })
          .catch(error => {
            alert('请求故障，录入失败');
          });
        });
      }
    </script>
  </body>
  </html>`;
}

function categorizeDomains(domains) {
  if (!domains || !Array.isArray(domains)) {
    return { cfTopLevel: [], cfSecondLevelAndCustom: [] };
  }
  return domains.reduce((acc, domain) => {
    // 只要是 Cloudflare 来源的资产，均纳入主表管理
    if (domain.system === 'Cloudflare') {
      acc.cfTopLevel.push(domain);
    } else {
      acc.cfSecondLevelAndCustom.push(domain);
    }
    return acc;
  }, { cfTopLevel: [], cfSecondLevelAndCustom: [] });
}