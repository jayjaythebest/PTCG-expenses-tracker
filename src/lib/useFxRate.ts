import { useState, useEffect } from 'react';
import { fetchFxJpyToTwd } from './pricing';

// The JPY -> TWD rate used to show the collection's value in TWD. Fetched once
// on mount from /api/fx (cached at the edge), with a sensible static fallback so
// values render immediately even before the rate resolves.
export function useFxRate(): number {
  return useFxRateWithMeta().rate;
}

// Same as useFxRate, but also reports when the rate resolved (client-side fetch
// time) so the UI can show a "更新於 …" note. updatedAt is null until it lands.
export function useFxRateWithMeta(): { rate: number; updatedAt: string | null } {
  const [rate, setRate] = useState(0.2);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    fetchFxJpyToTwd()
      .then(r => { setRate(r); setUpdatedAt(new Date().toISOString()); })
      .catch(() => {});
  }, []);
  return { rate, updatedAt };
}
