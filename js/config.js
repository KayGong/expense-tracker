// 集中配置：后续替换为实际值，切勿提交真实 Client Secret 或云端 Token
export const APP_CONFIG = {
  appName: '个人记账',
  timezone: 'Asia/Hong_Kong',
  // 4 位数字 PIN 的 SHA-256 小写十六进制字符串（后续本地生成后填入）
  passwordSha256: '',
  googleDrive: {
    folderName: 'ExpenseTracker',
    fileName: 'expenses.json',
    clientId: '403531307257-u2vmin9ppqak3lg5lcqri07o12oi5o68.apps.googleusercontent.com',
    scope: 'https://www.googleapis.com/auth/drive.file'
  }
};