/**
 * Live clock-in duration, shared by the dashboard pit board and the kiosk
 * on-the-clock column. m:ss while under an hour (so it ticks every second —
 * the "live" feel), h:mm from an hour onward.
 */
export function formatClockDuration(sinceIso: string, now: number = Date.now()): string {
  const elapsedMs = Math.max(0, now - new Date(sinceIso).getTime());
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);

  if (hours < 1) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
