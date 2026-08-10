// Gallery tile image. Every card gets a picture: use the item's own image when
// present, otherwise auto-resolve a representative set image from its set code
// (TCGdex card art / Bulbagarden logo). Falls back to a placeholder only when
// nothing at all can be resolved or the resolved URL fails to load.
import { useState, useEffect } from 'react';
import { CollectionItem } from '../../types';
import { cn } from '../../lib/utils';
import { lookupCard, lookupSetImage, lookupTwCardImage, lookupJpCardImage, resolveJaSetCode, jpCardImageUrl } from '../../lib/tcgdex';
import { SET_CODE_BY_NAME, collectorNo, editionToLang, ItemTypeIcon } from './constants';

export function GalleryImage({ item }: { item: CollectionItem }) {
  // An ordered list of candidate image URLs; the <img> advances to the next one
  // on load error, so a missing per-card scan degrades to the set logo (and
  // finally a placeholder) rather than a blank tile.
  // Each candidate carries a `cover` flag: real card art fills the tile edge-to-
  // edge (object-cover) so it looks crisp and large; set-logo / box fallbacks are
  // letterboxed (object-contain) so their wide artwork isn't cropped.
  const [candidates, setCandidates] = useState<{ url: string; cover: boolean }[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    setCandidates([]);
    setIdx(0);

    const code = SET_CODE_BY_NAME[item.setName];
    const stored = item.imageUrl || undefined;
    const lang = editionToLang(item.edition ?? '');
    // A ja card that stored a Traditional-Chinese image (from the TW proxy, back
    // when resolution was language-agnostic) is wrong: drop it so it re-resolves
    // in ja below. Genuine ja/other stored art is kept.
    const storedUsable =
      stored && !(lang === 'ja' && stored.includes('asia.pokemon-card.com'))
        ? stored
        : undefined;
    const num = collectorNo(item.cardNumber);

    const build = async (): Promise<{ url: string; cover: boolean }[]> => {
      const out: { url: string; cover: boolean }[] = [];
      // cover=true for real card art (fills the tile); cover=false for set-logo
      // fallbacks and box art (letterboxed so nothing important is cropped).
      const push = (u?: string | null, cover = true) => {
        if (u && !out.some(c => c.url === u)) out.push({ url: u, cover });
      };

      // The setName of a brand-new set (e.g. M4) isn't in local products, so fall
      // back to TCGdex's ja set-name → code map to recover its code.
      let sc = code;
      if (!sc && lang === 'ja') sc = (await resolveJaSetCode(item.setName)) ?? undefined;

      if (item.itemType === 'single') {
        push(storedUsable); // genuine scanned/uploaded art first
        if (sc && num) {
          if (lang === 'zh-tw') {
            push(await lookupTwCardImage(sc, num)); // TW proxy is zh-tw only
          } else {
            const card = await lookupCard(sc, num, lang); // TCGdex ja official art (older sets)
            push(card?.imageUrl);
            push(await lookupJpCardImage(sc, num)); // SNKRDUNK / Limitless (newest sets)
            push(jpCardImageUrl(sc, num)); // direct Limitless URL (dev / proxy-down fallback)
          }
        }
        if (sc) push((await lookupSetImage(sc, lang))?.imageUrl, false); // set logo last (letterboxed)
        return out;
      }

      // Boxes (incl. legacy 'pack'): prefer official set art, then stored logo —
      // both letterboxed (box/logo art is wide and shouldn't be cropped).
      if (sc) push((await lookupSetImage(sc, lang))?.imageUrl, false);
      push(storedUsable, false);
      return out;
    };

    build()
      .then(list => { if (alive) setCandidates(list); })
      .catch(() => { if (alive) setCandidates(storedUsable ? [{ url: storedUsable, cover: false }] : []); });
    return () => { alive = false; };
  }, [item.imageUrl, item.setName, item.edition, item.itemType, item.cardNumber]);

  const cand = candidates[idx];
  if (!cand) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-600">
        <div className="scale-[2.2]"><ItemTypeIcon type={item.itemType} /></div>
        <span className="text-[10px] font-bold mt-2">無圖片</span>
      </div>
    );
  }
  return (
    <img
      src={cand.url}
      alt={item.name}
      referrerPolicy="no-referrer"
      onError={() => setIdx(i => i + 1)}
      className={cn(
        'w-full h-full',
        cand.cover ? 'object-cover' : 'object-contain p-2',
      )}
    />
  );
}
