// Traditional Chinese (Taiwan) catalog. Typed against the English source, so a
// missing or misnamed key fails the build. First-pass translation — dive
// terminology should get a native review before a shop ships with it. See
// docs/i18n.md.
import type { Messages } from './en'

export const zhTW: Messages = {
  nav: {
    calendar: '行事曆',
    records: '紀錄',
    profile: '個人資料',
    contact: '聯絡',
    duty: '值班',
    logistics: '後勤',
    divers: '潛水員',
    manage: '管理',
  },
  common: {
    signOut: '登出',
  },
  shell: {
    trustedPartners: '合作夥伴',
    packages: '套裝行程',
    scheduledTrips: '預定行程',
    home: '首頁',
    radio: (shop: string) => `${shop} 電台`,
    installApp: '安裝 App',
    adminHome: '管理首頁',
    pending: (n: number) => `${n} 件待處理`,
    pendingApplications: (n: number) => `${n} 件待審核申請`,
  },
}
