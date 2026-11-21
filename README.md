# 个人记账（Expense Tracker Tool）

一款面向香港本地时间与日常记账场景的纯前端个人记账 Web 应用，采用原生 HTML / CSS / JavaScript 构建，结合 Chart.js、SheetJS、Service Worker 与 IndexedDB 实现本地优先存储、多币种与报销净额计算、固定支出版本与墓碑回溯、XLSX 导出以及 Google Drive 单文件合并同步。

---

## 一、 核心特性与业务规则

### 1. 时区与金额精度
- **统一香港日历时间**：日历日期、归属月份（`YYYY-MM`）与到期日判定统一以 `Asia/Hong_Kong` 为准。
- **高精度金额计算**：金额按“分（cents）”及高精度字符串/定点规则处理，避免浮点数二进制舍入误差；多币种记录支持原币、汇率与折算 HKD 金额计算。
- **报销净额与负净额降级**：结合报销状态与报销金额计算实际净额，并在报销超过原支出（负净额）时按规则降级展示与汇总。
- **超支预警**：支持在设定中配置预算阈值，并在录入或汇总时触发超支提示。

### 2. 固定支出与历史版本 / 墓碑机制
- 内置固定支出规则引擎（如房租/住宿、订阅 iTunes、贷款一、贷款二等），支持：
  - **版本化配置（`versions`）**：每次修改金额、到期日规则（如每月指定日或每月最后一天）或截止日期可保存新版本，并按版本生效日期与对应到期日匹配，未生效版本不提前生成实例。
  - **到期日拦截**：未到达对应到期日的当期固定支出不会提前补录。
  - **墓碑回溯（`tombstones`）**：用户删除已生成的固定支出实例后记录墓碑，后续补录或同步合并时不会将其重新生成。

### 3. 数据存储、锁屏、导出与云同步
- **IndexedDB 本地存储**：按账号/本地状态隔离存储支出明细、固定规则、类别、支付对象与墓碑等数据。
- **4 位 PIN 本地锁屏**：通过比对 `js/config.js` 中配置的 64 位小写 SHA-256 哈希（`passwordSha256`）进行本地界面解锁；页面刷新后需重新验证。
- **XLSX 导出**：基于 SheetJS 生成 `.xlsx` 表格文件，方便本地归档与对账。
- **Google Drive 单文件合并同步**：通过 `js/storage/driveClient.js` 连接 Google Drive（`drive.file` 作用域），对目标 JSON 文件执行拉取、合并与回写。

---

## 二、 目录结构说明

```text
.
├── index.html                  # 应用入口与视图容器
├── sw.js                       # Service Worker 静态缓存与配置/入口网络优先策略
├── css/
│   └── style.css               # 抹茶草莓马卡龙视觉体系与响应式布局样式
├── js/
│   ├── config.js               # 应用名称、时区、PIN SHA-256 与 Google Drive 配置
│   ├── app.js                  # 应用状态编排、路由/视图切换、事件绑定与同步触发
│   ├── domain/
│   │   ├── hkTime.js           # 香港时区日期/月份格式化与历法辅助
│   │   ├── money.js            # 金额分值换算、高精度运算与汇率/报销净额计算
│   │   ├── fixedEngine.js      # 固定支出规则版本匹配、到期日解析与补录引擎
│   │   ├── analytics.js        # 汇总统计、预算预警与图表聚合数据
│   │   └── merge.js            # 单文件合并与墓碑冲突处理逻辑
│   ├── storage/
│   │   ├── localStore.js       # IndexedDB 读写封装与账号隔离
│   │   └── driveClient.js      # Google OAuth 与 Google Drive 单文件读写
│   └── ui/
│       ├── pinLock.js          # 4 位数字 PIN 锁屏与解锁交互
│       ├── homeView.js         # 首页汇总卡、快捷录入与当月简表
│       ├── recordsView.js      # 记录列表/卡片渲染辅助
│       ├── recordsPage.js      # 月记录多维度筛选、编辑与删除
│       ├── chartsView.js       # Chart.js 图表渲染
│       └── settingsView.js     # 固定支出版本管理、类别/对象/预算与同步设置
└── tests/
    └── domain.test.mjs       # 核心领域逻辑单元测试
```

---

## 三、 本地开发与测试

### 1. 运行纯逻辑单元测试
在项目根目录打开终端（PowerShell / CMD / Bash）：

```bash
node --test tests/domain.test.mjs
```

### 2. 启动本地静态服务
应用为纯前端静态站点，需通过 HTTP 服务访问（不建议直接以 `file://` 协议打开）：

```powershell
npx --yes serve -l 4173 .
```

若 Windows PowerShell 执行策略禁止运行 `.ps1` 脚本，可使用 `npx.cmd` 或放宽当前用户执行策略：

```powershell
npx.cmd --yes serve -l 4173 .
```

启动后在浏览器访问 `http://localhost:4173`。

### 3. 本地生成 4 位 PIN 的 SHA-256 哈希
在本地终端运行以下命令（将 `<你的4位PIN>` 替换为实际数字，注意保留前导零）：

```powershell
node -e "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update('<你的4位PIN>').digest('hex'));"
```

将输出的 **64 位小写十六进制字符串** 填入 `js/config.js` 的 `passwordSha256` 字段并保存。

---

## 四、 Google Cloud OAuth 与静态托管部署

### 1. 配置 `js/config.js`
编辑 `js/config.js`，核对以下关键字段：

```javascript
export const APP_CONFIG = {
  appName: '个人记账',
  timezone: 'Asia/Hong_Kong',
  passwordSha256: '<64位小写SHA256哈希>',
  googleDrive: {
    folderName: 'ExpenseTracker',
    fileName: 'expenses.json',
    clientId: '<你的Google_OAuth_Web_Client_ID>',
    scope: 'https://www.googleapis.com/auth/drive.file'
  }
};
```

### 2. Google Cloud Console OAuth 配置要点
1. 在 Google Cloud Console 中创建或选择项目，启用 **Google Drive API**。
2. 配置 **OAuth 同意屏幕**（根据账号类型选择内部或测试/发布状态，测试阶段将使用的 Google 账号加入 Test users）。
3. 创建 **OAuth 客户端 ID（应用类型选择 Web application）**：
   - 在 **Authorized JavaScript origins** 中添加部署来源，例如：
     - 本地开发：`http://localhost:4173`
     - 线上托管域名：`https://<你的域名或托管地址>`
4. 将生成的 Client ID 填入 `js/config.js` 的 `googleDrive.clientId`。

### 3. 私有仓库与静态托管说明
- **仓库可见性**：记账规则、固定支出参数与个人配置建议存放在**私有仓库（Private Repository）**中，避免配置信息或个人习惯暴露。
- **静态托管**：可将静态文件部署至支持 HTTPS 的静态托管平台（如 GitHub Pages、Cloudflare Pages、Vercel 等），确保生产环境使用 `https://` 协议以保证 Service Worker 与 Google OAuth 正常运行。
- **Service Worker 缓存更新**：`sw.js` 对 `index.html`、`js/app.js`、`js/config.js` 及根路径采用网络优先（Network-First），修改配置或代码后建议通过正常刷新验证；若遇到旧缓存残留，可在浏览器执行强制刷新（`Ctrl + Shift + R`）或在开发者工具（`F12` -> Application -> Service Workers）中更新/注销旧 Worker。

---

## 五、 安全边界与注意事项

1. **PIN 锁屏定位**：本应用的 4 位 PIN 是**浏览器前端界面锁**，用于防止随手翻看屏幕，**并非服务端认证或强加密存储**；切勿将明文 PIN 发送给第三方或粘贴至不可信网站。
2. **敏感信息管理**：若将代码托管至远端仓库，建议妥善管理 `passwordSha256` 与 `googleDrive.clientId`（OAuth Web Client ID 虽属客户端标识，仍需在 Google Cloud 控制台严格限制 Authorized JavaScript origins）。
3. **数据备份习惯**：IndexedDB 存储在当前浏览器配置文件中，清理站点数据或更换设备前，建议先完成 **Google Drive 同步** 或导出 **XLSX** 备份。