// Slack channel IDs. Same workspace across all environments, so these are
// identical everywhere and live in code (a typo'd name fails typecheck).
export const CHANNELS = {
  bot_test: "C072BAED43B", // #bot-test — all non-prod sends land here
  "hub-admin-alerts": "C0BTB9TMAE8", // #hub-admin-alerts — invite the prod bot once
} as const;
export type ChannelName = keyof typeof CHANNELS;
