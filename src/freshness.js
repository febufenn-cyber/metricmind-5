export function evaluateFreshness(maxInsertedAt, now, thresholdMinutes) {
  if (!maxInsertedAt) {
    return { status: 'unknown', warning: 'No ingestion timestamp was available.' };
  }
  const timestamp = new Date(maxInsertedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return { status: 'unknown', warning: 'The ingestion timestamp was invalid.' };
  }
  const ageMinutes = Math.max(0, (now.getTime() - timestamp.getTime()) / 60_000);
  if (ageMinutes > thresholdMinutes) {
    return {
      status: 'stale',
      maxInsertedAt: timestamp.toISOString(),
      ageMinutes: Math.round(ageMinutes),
      warning: `Data ingestion is ${Math.round(ageMinutes)} minutes behind the current time.`
    };
  }
  return {
    status: 'fresh',
    maxInsertedAt: timestamp.toISOString(),
    ageMinutes: Math.round(ageMinutes),
    warning: null
  };
}
