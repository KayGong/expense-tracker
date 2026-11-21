# 个人记账应用架构与数据模型（v1）

## 一、顶层 JSON 数据模型（`ExpenseTracker/expenses.json`）

```json
{
  "schemaVersion": 1,
  "appSettings": {
    "startMonth": "2026-11",
    "alertThresholds": {
      "monthlyRegularHkd": "10000.00",
      "dailyRegularHkd": "300.00"
    },
    "updatedAt": "2026-11-21T07:33:00.000Z",
    "updatedByDeviceId": "device-uuid-1"
  },
  "categories": [
    {
      "id": "cat_fixed_monthly",
      "name": "每月固定支出",
      "kind": "system_fixed",
      "active": true,
      "sortOrder": 0,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "cat_dining",
      "name": "吃饭",
      "kind": "normal",
      "active": true,
      "sortOrder": 1,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    }
  ],
  "payees": [
    {
      "id": "payee_me",
      "name": "我",
      "splitRole": "me",
      "active": true,
      "sortOrder": 1,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "payee_dog",
      "name": "小狗",
      "splitRole": "dog",
      "active": true,
      "sortOrder": 2,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "payee_me_and_dog",
      "name": "我&小狗",
      "splitRole": "me_and_dog",
      "active": true,
      "sortOrder": 3,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "payee_friend",
      "name": "朋友",
      "splitRole": "other",
      "active": true,
      "sortOrder": 4,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "payee_family",
      "name": "家人",
      "splitRole": "other",
      "active": true,
      "sortOrder": 5,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    },
    {
      "id": "payee_relative",
      "name": "亲戚",
      "splitRole": "other",
      "active": true,
      "sortOrder": 6,
      "updatedAt": "2026-11-21T07:33:00.000Z"
    }
  ],
  "fixedRules": [
    {
      "ruleKey": "rent",
      "defaultTitle": "住宿-香港",
      "categoryId": "cat_fixed_monthly",
      "payeeId": "payee_me",
      "currency": "HKD",
      "dueDayRule": "last_day_of_month",
      "endDate": null,
      "updatedAt": "2026-11-21T07:33:00.000Z",
      "versions": [
        {
          "versionId": "ver_rent_1",
          "effectiveFrom": "2026-11-01",
          "amountHkd": "14000.00",
          "dueDayRule": "last_day_of_month",
          "endDate": null,
          "createdAt": "2026-11-21T07:33:00.000Z"
        }
      ]
    },
    {
      "ruleKey": "itunes",
      "defaultTitle": "订阅 iTunes",
      "categoryId": "cat_fixed_monthly",
      "payeeId": "payee_me",
      "currency": "HKD",
      "dueDayRule": "day_of_month:15",
      "endDate": null,
      "updatedAt": "2026-11-21T07:33:00.000Z",
      "versions": [
        {
          "versionId": "ver_itunes_1",
          "effectiveFrom": "2026-11-01",
          "amountHkd": "8.00",
          "dueDayRule": "day_of_month:15",
          "endDate": null,
          "createdAt": "2026-11-21T07:33:00.000Z"
        }
      ]
    },
    {
      "ruleKey": "loan1",
      "defaultTitle": "贷款一",
      "categoryId": "cat_fixed_monthly",
      "payeeId": "payee_me",
      "currency": "HKD",
      "dueDayRule": "day_of_month:20",
      "endDate": "2027-11-20",
      "updatedAt": "2026-11-21T07:33:00.000Z",
      "versions": [
        {
          "versionId": "ver_loan1_1",
          "effectiveFrom": "2026-11-01",
          "amountHkd": "5905.60",
          "dueDayRule": "day_of_month:20",
          "endDate": "2027-11-20",
          "createdAt": "2026-11-21T07:33:00.000Z"
        }
      ]
    },
    {
      "ruleKey": "loan2",
      "defaultTitle": "贷款二",
      "categoryId": "cat_fixed_monthly",
      "payeeId": "payee_me",
      "currency": "HKD",
      "dueDayRule": "day_of_month:20",
      "endDate": "2029-12-20",
      "updatedAt": "2026-11-21T07:33:00.000Z",
      "versions": [
        {
          "versionId": "ver_loan2_1",
          "effectiveFrom": "2026-11-01",
          "amountHkd": "8654.63",
          "dueDayRule": "day_of_month:20",
          "endDate": "2029-12-20",
          "createdAt": "2026-11-21T07:33:00.000Z"
        }
      ]
    }
  ],
  "expenses": [
    {
      "id": "exp_uuid_1",
      "expenseDate": "2026-11-21",
      "title": "午餐",
      "categoryId": "cat_dining",
      "payeeId": "payee_me",
      "currency": "HKD",
      "originalAmount": "68.00",
      "exchangeRate": "1",
      "amountHkd": "68.00",
      "isIrregular": false,
      "reimbursement": {
        "status": "unreimbursed",
        "amountHkd": "0.00"
      },
      "note": "",
      "createdAt": "2026-11-21T07:33:00.000Z",
      "updatedAt": "2026-11-21T07:33:00.000Z",
      "recordType": "normal",
      "fixedRuleKey": null,
      "fixedInstanceKey": null,
      "billingMonth": null,
      "deleted": false,
      "deletedAt": null
    }
  ],
  "tombstones": {
    "expenses": {},
    "fixedInstances": {}
  },
  "syncMetadata": {
    "lastSyncedAt": null,
    "remoteRevision": null,
    "accountEmailHint": null
  }
}
```

## 二、模块划分与职责

- `js/domain/hkTime.js`：统一按 `Asia/Hong_Kong` 计算今天、昨天、上月、当前年月、某月最后一天、闰年与合法日历日期；严禁因浏览器本地时区造成日期字符串偏移。
- `js/domain/money.js`：十进制金额与汇率换算（`HKD = 外币 / 汇率`，人民币默认 `0.85`，HKD 固定 `1`，校验正有限数、非负金额、舍入到分，报销净额与负净额保留符号，分摊奇数分确定性分配）。
- `js/domain/fixedEngine.js`：管理 `rent`、`itunes`、`loan1`、`loan2` 四项固定规则及生效版本历史；按 `startMonth` 与滚动 12 个月窗口、到期日规则、截止日期生成实例；尊重 `fixedInstances` 墓碑与同月同规则唯一键，历史缺漏按对应日期生效版本补录。
- `js/domain/analytics.js`：计算 Home 六张汇总卡、超支预警（仅常规净额严格大于阈值，上月/昨天，月预警在上且字号更大）、月记录筛选与排序、月度分类汇总与饼图降级（存在负类别净额时改用带符号分类表+原因提示，全零显示暂无支出）、年度 12 月合计柱状图数据。
- `js/domain/merge.js`：按实体 ID / `fixedInstanceKey` / `updatedAt` / `tombstones` / `appSettings` 合并本地与云端状态；校验 JSON 结构完整性，损坏时拒绝覆盖并提示恢复。
- `js/storage/localStore.js`：封装 IndexedDB 持久化、按 Google 账号隔离缓存、维护待同步操作队列（离线可记账，浏览器清理可能导致本地缓存丢失）。
- `js/storage/driveClient.js`：封装 Google Identity Services（`drive.file` 权限）、定位/复用 `ExpenseTracker/expenses.json`、检测同名多文件并提示、区分授权失败/网络错误/文件不存在、串行化读写与写后复核重试。
- `js/ui/*`：PIN 锁屏、固定导航、Home、月记录、图表展示、支出设定修改（含 XLSX 导出与防公式注入）。
- `sw.js`：静态资源缓存与离线兜底。
- `tests/*.test.js`：纯逻辑自动化测试。