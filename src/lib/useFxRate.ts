import { useState, useEffect } from 'react';
import { fetchFxJpyToTwd } from './pricing';

// The JPY -> TWD rate used to show the collection's value in TWD. Fetched once
// on mount from /api/fx (cached at the edge), with a sensible static fallback so
// values render immediately even before the rate resolves.
export function useFxRate(): number {
  const [rate, setRate] = useState(0.2);
  useEffect(() => {
    fetchFxJpyToTwd().then(setRate).catch(() => {});
  }, []);
  return rate;
}
