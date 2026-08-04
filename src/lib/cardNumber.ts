// The collector number a photo scan should store.
//
// The scan endpoint returns `localId` as the bare number printed before the
// slash — "198" for a card printed 198/SV-P — because that is the form TCGdex
// and the image CDNs key on. For a catalogued card that is enough: pricing
// resolves the Huca / kapaipai set code from the stored set NAME.
//
// Promos, tournament prizes and campaign cards have no catalog entry, so no set
// name gets stored for them and their set code survives nowhere but the
// collector number itself, whose denominator is the set CODE instead of the set
// size. `promoSetCodeFromNumber` in api/_lib/pricing.ts reads it back out, so
// keep the printed "198/SV-P" form — exactly what the add form asks the user to
// type by hand when they pick 其他 as the set. Storing a bare "198" makes the
// card permanently unpriceable.
export function scanCardNumber(localId: string, setCode: string, setName: string): string {
  const num = localId.trim();
  // A set name identifies the set on its own, and an already-slashed number is
  // whatever was printed — appending to either is wrong.
  if (!num || setName.trim() || num.includes('/')) return num;
  const code = setCode.trim().toUpperCase();
  // Only append what promoSetCodeFromNumber will accept back: an all-digit tail
  // reads as a set size, and anything longer/odder reads as nothing at all.
  if (!/^[A-Z0-9-]{1,8}$/.test(code) || /^\d+$/.test(code)) return num;
  return `${num}/${code}`;
}
