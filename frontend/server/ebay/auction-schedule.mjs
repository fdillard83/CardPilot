export const AUCTION_DURATIONS = [1, 3, 5, 7, 10];

export function calculateAuctionSchedule({ desiredEndAt, durationDays, now = new Date() }) {
  if (!AUCTION_DURATIONS.includes(durationDays)) throw new TypeError("Choose a supported eBay auction length.");
  const endAt = new Date(desiredEndAt);
  if (!Number.isFinite(endAt.getTime())) throw new TypeError("Choose a valid auction ending date and time.");
  const publishAt = new Date(endAt.getTime() - durationDays * 86_400_000);
  if (publishAt.getTime() < now.getTime() + 5 * 60_000) throw new TypeError("Choose an ending time that leaves at least five minutes before publication.");
  return { publishAt: publishAt.toISOString(), endAt: endAt.toISOString() };
}
