一份标准的 Cloudflare Worker 部署 `README.md`，涵盖了项目说明、环境变量配置、KV 绑定及部署步骤：

---

# 🌐「域梦·天守」域名监控看板 (DomainKeeper)

基于 Cloudflare Worker 开发的轻量级多账号域名监控仪表盘。支持同时自动同步多个 Cloudflare 账号下的顶级域名，支持手动录入第三方资产，自动计算剩余天数并提供科幻炫彩视觉交互界面。

---

## ✨ 核心特性

* **多账号同步**：支持配置多个 Cloudflare API Token，自动合并多个账号资产。
* **混合资产管理**：支持 Cloudflare 托管域名与第三方自定义资产统一管理。
* **到期倒计时提醒**：自动按剩余天数分类（正常、注意、警告、紧急），并支持顶部横幅预警。
* **免敏感信息硬编码**：核心凭据（API Token、管理员密码等）完全依赖 Worker 环境变量与机密管理。
* **炫彩科技界面**：深色流动极光背景与毛玻璃拟态设计。

---

## 🛠️ 部署前准备

1. **Cloudflare 账号**：准备好需要运行 Worker 的主账号，以及需要拉取域名信息的各个子账号。
2. **Cloudflare API Token**：
* 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) -> 右上角头像 -> **我的个人资料 (My Profile)** -> **API 令牌 (API Tokens)**。
* 创建具有 **区域 (Zone) - 读取 (Read)** 权限的令牌，记录下每个账号的 Token。



---

## 🚀 部署步骤

### 第一步：创建 Worker

1. 登录 Cloudflare 控制台，进入 **Workers & Pages** -> **Overview**。
2. 点击 **Create Application** -> 选择 **Worker**。
3. 输入 Worker 名称（如 `domain-keeper`），点击 **Deploy**。
4. 部署完成后点击 **Edit code**，将项目中的 `domainkeeper.js` 全部代码粘贴进去，点击 **Deploy** 保存。

---

### 第二步：创建并绑定 KV 命名空间（必选）

KV 用于持久化缓存 WHOIS 信息以及手动录入的第三方域名数据：

1. 进入 **Workers & Pages** -> **KV**。
2. 点击 **Create a namespace**，名称填入（例如：`DOMAIN_KEEPER_KV`）。
3. 回到你的 Worker 控制台，点击 **Settings (设置)** -> **Bindings (绑定)** 或 **Variables and Secrets**。
4. 找到 **KV Namespace Bindings**，点击 **Add binding**：
* **Variable name（变量名称，必须完全一致）**：`DOMAIN_INFO`
* **KV namespace**：选择刚才创建的 `DOMAIN_KEEPER_KV`


5. 点击 **Save and Deploy**。

---

### 第三步：配置环境变量与机密（Secrets）

进入 Worker 的 **Settings** -> **Variables and Secrets** -> 点击 **Add** 添加以下变量：

| 变量名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `CF_API_KEYS` | **Secret (加密)** | 是 | 多个 Cloudflare API Token，用**英文逗号**隔开，例如：`token1,token2` |
| `ADMIN_PASSWORD` | **Secret (加密)** | 是 | 进入后台管理模式（`/admin`）的访问密码 |
| `ACCESS_PASSWORD` | **Secret / 文本** | 否 | 前台首页密码保护。若允许所有人查看首页，可**不填或留空** |
| `WHOIS_PROXY_URLS` | **文本** | 否 | 自定义 WHOIS 代理接口，逗号隔开（默认内置 RDAP 与 NetworkCalc 接口） |

> ⚠️ **提示**：配置完成后，记得点击 **Deploy** 使变量生效。

---

## 📖 页面使用说明

### 1. 访问前台

访问 Worker 分配的域名（例如 `https://domain-keeper.<your-subdomain>.workers.dev`）。

* 若配置了 `ACCESS_PASSWORD`，会提示输入前台密码。
* 系统会自动从各 Cloudflare 账号拉取域名并展示。

### 2. 进入后台管理

* 访问 `https://domain-keeper.<your-subdomain>.workers.dev/admin`。
* 输入配置的 `ADMIN_PASSWORD` 登录。
* **管理功能**：
* **⚙️ 编辑**：修改任意域名的注册商、注册日期、到期日期（修改后保存在 KV 中）。
* **🔄 更新WHOIS**：向接口重新拉取该域名的最新 WHOIS 缓存。
* **➕ 添加自定义资产**：手动添加非 Cloudflare 托管或二级子域名资产。
* **🗑️ 删除**：删除手动添加的自定义资产。



---

## 常见问题

1. **为什么部分子域名（如 `sub.domain.com`）的到期时间显示为 `Unknown`？**
* Cloudflare API 官方接口不返回 DNS 接入域名的到期时间，且全球 RDAP/WHOIS 协议只针对根顶级域名。
* **解决方法**：在 `/admin` 后台找到该域名，点击 **⚙️ 编辑**，手动填入一次真实的到期时间保存即可。


2. **如何增加第 3 个或更多 Cloudflare 账号？**
* 只需在环境变量 `CF_API_KEYS` 中以逗号继续追加 Token：`token1,token2,token3`，无需改动任何代码。