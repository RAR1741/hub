// Client-safe: kept out of cron-jobs.ts, whose lazy ./db import is server-only and breaks the client bundle.
const DOUBLE_SEND = " If a scheduled run overlaps this one, reminders can be sent twice.";
/** Jobs with outward side effects get a confirm() before "Run now". */
export const RUN_CONFIRM_MESSAGES: Record<string, string> = {
  "slack-whats-new-weekly": "This posts the What's New digest to Slack. Run now?",
  "slack-mentor-reminders-weekly": "This DMs mentors their reminders." + DOUBLE_SEND + " Run now?",
  "push-reminders": "This sends push reminders." + DOUBLE_SEND + " Run now?",
  "push-clocked-in-late": "This sends clocked-in-late pushes." + DOUBLE_SEND + " Run now?",
  "close-stale-sessions": "This closes open stale sessions. Run now?",
};
