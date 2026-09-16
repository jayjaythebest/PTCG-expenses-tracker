// Gallery tile image. Every card gets a picture: use the item's own image when
// present, otherwise auto-resolve a representative set image from its set code
// (TCGdex card art / Bulbagarden logo). Falls back to a placeholder only when
// nothing at all can be resolved or the resolved URL fails to load.
import { useState, useEffect } from 'react';
import { CollectionItem } from '../../types';
import { cn } from '../../lib/utils';
import { lookupCard, lookupSetImage, lookupBoxImage, lookupTwCardImage, lookupJpCardImage, resolveJaSetCode, jpCardImageUrl } from '../../lib/tcgdex';
import { SET_CODE_BY_NAME, collectorNo, editionToLang, ItemTypeIcon } from './constants';

// SNKRDUNK's background-removed scans are 1000x730 landscape canvases with the
// card centred on transparency (card box ~434x610 at y 60-670, same on every
// image checked). Under object-cover that card fills only ~79% of the tile's
// width, so these tiles looked smaller than the full-bleed art beside them.
// Scaling by 1000/434 * 0.75 brings the card edge to the tile edge, cropping
// its top and bottom by the same few percent as the other sources.
const SNKRDUNK_BG_REMOVED = 'cdn.snkrdunk.com/upload_bg_removed/';
const SNKRDUNK_CARD_ZOOM = 1.26;

// Their sealed-box photos sit on the same padded canvases, letterboxed here, so
// the box would fill barely half the tile. Measured box extents: on 1000x730
// canvases ~520 wide (a tall high-class box ~350), on 1000x1000 ones ~700. The
// zoom is picked from the loaded canvas shape so either lands near full width.
const snkrdunkBoxZoom = (w: number, h: number): number => (w / h > 1.2 ? 1.75 : 1.3);

// Hosts that only ever serve Japanese card art.
const JA_ART_HOSTS = ['cdn.snkrdunk.com', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com', 'assets.tcgdex.net/ja/'];

export function GalleryImage({ item }: { item: CollectionItem }) {
  // An ordered list of candidate image URLs; the <img> advances to the next one
  // on load error, so a missing per-card scan degrades to the set logo (and
  // finally a placeholder) rather than a blank tile.
  // Each candidate carries a `cover` flag: real card art fills the tile edge-to-
  // edge (object-cover) so it looks crisp and large; set-logo / box fallbacks are
  // letterboxed (object-contain) so their wide artwork isn't cropped.
  const [candidates, setCandidates] = useState<{ url: string; cover: boolean }[]>([]);
  const [idx, setIdx] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

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
    // The reverse: a zh-tw card whose stored art is Japanese. The scan saves the
    // JP illustration as a stand-in when the TW site hasn't listed the card yet
    // (and editing a card's 版本 keeps its old picture), so once the TW art
    // exists it should win — the Japanese picture stays as the fallback.
    const storedIsJa = !!stored && JA_ART_HOSTS.some(h => stored.includes(h));
    const preferTwOverStored = lang === 'zh-tw' && storedIsJa;
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
        if (!preferTwOverStored) push(storedUsable); // genuine scanned/uploaded art first
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
        push(storedUsable); // no-op unless the JP stand-in was deferred above
        if (sc) push((await lookupSetImage(sc, lang))?.imageUrl, false); // set logo last (letterboxed)
        return out;
      }

      // Boxes (incl. legacy 'pack'): the box's own photo in its language when we
      // have one, else official set art, then the stored image — all letterboxed
      // (box/logo art is wide and shouldn't be cropped).
      if (sc) push(await lookupBoxImage(sc, lang), false);
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
  const snkrdunk = cand.url.includes(SNKRDUNK_BG_REMOVED);
  const zoom = !snkrdunk ? null
    : cand.cover ? SNKRDUNK_CARD_ZOOM
    : natural ? snkrdunkBoxZoom(natural.w, natural.h)
    : null;
  return (
    <div className="w-full h-full overflow-hidden">
      <img
        src={cand.url}
        alt={item.name}
        referrerPolicy="no-referrer"
        onError={() => setIdx(i => i + 1)}
        onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={zoom ? { transform: `scale(${zoom})` } : undefined}
        className={cn(
          'w-full h-full',
          cand.cover ? 'object-cover' : 'object-contain p-2',
        )}
      />
    </div>
  );
}
