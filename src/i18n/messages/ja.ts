// Japanese catalog. Typed against the English source, so a missing or misnamed
// key fails the build. First-pass translation — dive terminology should get a
// native review before a shop ships with it. See docs/i18n.md.
import type { Messages } from './en'

export const ja: Messages = {
  nav: {
    calendar: 'カレンダー',
    records: '記録',
    profile: 'プロフィール',
    contact: 'お問い合わせ',
    duty: '当番',
    logistics: '準備',
    divers: 'ダイバー',
    manage: '管理',
  },
  common: {
    signOut: 'ログアウト',
  },
  shell: {
    trustedPartners: '提携ショップ',
    packages: 'パッケージ',
    scheduledTrips: '予定ツアー',
    home: 'ホーム',
    radio: (shop: string) => `${shop} ラジオ`,
    installApp: 'アプリをインストール',
    adminHome: '管理ホーム',
    pending: (n: number) => `${n}件保留中`,
    pendingApplications: (n: number) => `${n}件の申請待ち`,
  },
}
