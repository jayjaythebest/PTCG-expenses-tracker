// What happens AFTER the AI has read a card: turning the identifiers it read
// off the photo into the authoritative record (TCGdex / the official TW site /
// Huca) and the artwork to show.
//
// Lifted out of CollectionForm so the batch scan resolves each of six cards the
// exact same way a single photo does. Every branch and comment below came from
// that one place — keeping two copies is how a zh-tw card ends up labelled with
// a Japanese name again.
import type { CardScanResult } from '../../lib/gemini';
import { lookupCard, lookupTwCard, lookupTwCardImage, lookupJpCardImage } from '../../lib/tcgdex';
import { scanCardNumber } from '../../lib/cardNumber';
import { productForScanCode, normalizeGradingCompany } from './constants';
import type { FormState } from './formState';

export interface ResolvedScan {
  /** 'matched' = an authoritative record backs it; 'fallback' = the card's own print only. */
  status: 'matched' | 'fallback';
  /** What to tell the user when the catalog came up short. Null on a clean match. */
  hint: string | null;
  /** Fields to merge onto the form. Only keys the scan actually filled in. */
  patch: Partial<FormState>;
}

// Drop empty values so merging the patch never blanks a field the user typed.
function patchOf(fields: Partial<Record<keyof FormState, string | boolean>>): Partial<FormState> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null) continue;
    out[k] = v;
  }
  return out as Partial<FormState>;
}

// Is this physically a Traditional-Chinese card? Trust the AI's language read;
// a trailing-"F" MEGA/超級進化 code (M5F, M2aF) is itself a strong zh-tw signal
// even if the AI misdetects the language. JP MEGA prints the same code WITHOUT
// the F (M5, M2a), so this won't misfire on Japanese cards.
export const isZhTwScan = (scan: Pick<CardScanResult, 'language' | 'setCode'>): boolean =>
  scan.language === 'zh-tw' || /^M\d+[A-Z]*F$/i.test(scan.setCode);

// Why the AI chain couldn't run. Distinguishes "the service is down / out of
// quota / needs a key" from "the card isn't in the database", which are fixed
// in completely different places.
export function scanErrorHint(scan: Pick<CardScanResult, 'reason' | 'providers'>): string {
  const provs = scan.providers ?? [];
  switch (scan.reason) {
    // 401 from the JWT gate: the session token is missing/expired, so the fix
    // is re-logging in — waiting and retrying will never help.
    case 'unauthorized':
      return '登入已過期，請重新登入後再掃描';
    // 503: the gate itself has no Supabase credentials on the server.
    case 'auth_unconfigured':
      return '伺服器缺少 Supabase 設定（SUPABASE_URL / KEY），請在 Vercel 補上後重新部署';
    // 404: the /api/scan-card function isn't deployed on this host.
    case 'endpoint_missing':
      return '找不到掃描服務（/api/scan-card 未部署）；請確認已部署最新版本到 Vercel';
    // 5xx / crash / offline: the endpoint exists but couldn't respond.
    case 'endpoint_error':
    case 'network':
      return '掃描服務暫時無法回應；請稍後重試，或查看 Vercel Functions 記錄';
    // 200 + explicit no_provider: the server ran but has zero AI keys.
    case 'no_provider':
      return '伺服器尚未設定任何 AI 金鑰，請在 Vercel 設定 GEMINI / GROQ / OPENROUTER_API_KEY';
    default:
      if (scan.reason === 'quota' || provs.length === 1) {
        return `目前只有 ${provs.join('、') || 'gemini'} 可用，額度可能已用盡；建議在 Vercel 再補上 Groq / OpenRouter 免費金鑰`;
      }
      return '可換張更清晰、少反光的照片再試一次';
  }
}

export async function resolveScan(scan: CardScanResult): Promise<ResolvedScan> {
  // Resolve authoritative data (name/rarity/series/official art) from TCGdex,
  // querying the endpoint that matches the detected language (falls back internally).
  const card = scan.setCode && scan.localId
    ? await lookupCard(scan.setCode, scan.localId, scan.language || 'ja', scan.name)
    : null;

  const isZhTw = isZhTwScan(scan);

  // TCGdex's zh-tw catalog is incomplete (e.g. brand-new sets, the whole MEGA
  // series). lookupCard cross-falls-back to the ja endpoint to find ANY data,
  // which would mislabel a Chinese card as Japanese with JP name/art. When we
  // have a confident zh-tw scan but no genuine zh-tw TCGdex hit, resolve the
  // authoritative Chinese record (name + collector number + precise art) live
  // from the official TW site via /api/tw-card — the always-current complete
  // Chinese card table.
  const twCard = scan.setCode && scan.localId && isZhTw && (!card || card.edition !== 'zh-tw')
    ? await lookupTwCard(scan.setCode, scan.localId, scan.name)
    : null;

  // Map the scanned/printed set code back to a catalog product so we can persist
  // a setName even when TCGdex has no record. Without a stored setName, price
  // lookups can't resolve the pack and the row shows no price (this was the
  // zh-tw "no price" bug — the twCard/fallback branches never set setName).
  // Prefer the code the TW proxy resolved, else the AI's read.
  const prod = productForScanCode(twCard?.setCode || scan.setCode);

  // Graded slab: the label carries the grading company + grade + cert, applied
  // on top of whichever branch resolves the card so a scan of a PSA/BGS holder
  // auto-fills the 鑑定 fields. A raw card leaves gradingCompany empty → no-op.
  const gc = normalizeGradingCompany(scan.gradingCompany);
  const grading = gc
    ? { isGraded: true, gradingCompany: gc, grade: scan.grade ?? '', gradingCert: scan.gradingCert ?? '' }
    : {};

  if (twCard) {
    // Authoritative zh-tw record from the official TW site: Chinese name +
    // precise per-card art. The site carries no rarity letter, so keep the
    // rarity the AI read off the card. Treat as a confident match.
    const setName = prod?.name || '';
    return {
      status: 'matched',
      hint: null,
      patch: patchOf({
        ...grading,
        name:       twCard.name || scan.name,
        setName,
        series:     prod?.series || '',
        rarity:     scan.rarity,
        cardNumber: scanCardNumber(scan.localId, scan.setCode, setName) || twCard.localId,
        imageUrl:   twCard.imageUrl,
        edition:    'zh-tw',
      }),
    };
  }

  if (card && !(isZhTw && card.edition !== 'zh-tw')) {
    // Only trust the TCGdex catalog record when it's NOT a Japanese record
    // standing in for a Chinese card. A zh-tw scan whose only TCGdex hit is the
    // ja catalog (the TW proxy failed to resolve the misread set/number) must
    // NOT adopt the Japanese name/set/art here — that produced the "繁體中文版
    // but shows オリジンパルキアVSTAR / VMAXクライマックス" bug on reflective
    // graded slabs. Such cards fall through to the fallback branch below, which
    // keeps the AI's own Chinese read + resolves zh-tw artwork.
    const edition = scan.language || card.edition;
    // Pick artwork in the card's OWN language. For zh-tw, the official TW proxy
    // has precise per-card art (TCGdex often lacks zh-tw images). For ja we must
    // NOT use the TW proxy (it would show the Chinese version) — use TCGdex's ja
    // image, or the SNKRDUNK/Limitless proxy for brand-new sets TCGdex hasn't
    // published art for yet.
    let img = card.imageUrl;
    if (edition === 'zh-tw') {
      const tw = await lookupTwCardImage(scan.setCode, scan.localId);
      if (tw) img = tw;
    } else if (!img) {
      const jp = await lookupJpCardImage(scan.setCode, scan.localId);
      if (jp) img = jp;
    }
    const setName = card.setName || prod?.name || '';
    return {
      status: 'matched',
      hint: null,
      patch: patchOf({
        ...grading,
        name:       card.name,
        setName,
        series:     card.series || prod?.series || '',
        // TCGdex answers '其他' for any rarity name it hasn't mapped yet (new
        // MEGA marks such as MA arrive there late), so a read off the card
        // itself beats it — it is the printing, not a guess.
        rarity:     (card.rarity === '其他' ? scan.rarity : card.rarity) || scan.rarity,
        cardNumber: scanCardNumber(scan.localId, scan.setCode, setName),
        imageUrl:   img,
        edition,
      }),
    };
  }

  if (!isZhTw && scan.verified) {
    // A Japanese card the scan endpoint confirmed against Huca's live card
    // table. TCGdex has no record — its catalog trails a release by weeks — but
    // the set code, name and rarity are authoritative, so this is a match, not
    // a "card not found". Artwork still comes from the ja proxy.
    const img = (await lookupJpCardImage(scan.setCode, scan.localId)) || '';
    // Prefer the catalog's set name (what verify:sets checks and what pricing
    // resolves against); Huca's own label covers a set so new the catalog
    // hasn't listed it either.
    const setName = prod?.name || scan.setName || '';
    return {
      status: 'matched',
      hint: null,
      patch: patchOf({
        ...grading,
        name:       scan.name,
        setName,
        series:     prod?.series || '',
        rarity:     scan.rarity,
        cardNumber: scanCardNumber(scan.localId, scan.setCode, setName),
        imageUrl:   img,
        edition:    'ja',
      }),
    };
  }

  // Fallback: TCGdex has no catalog entry for this card yet (common for
  // brand-new zh-tw sets — e.g. the MEGA/超級進化 "M#F" series isn't in TCGdex's
  // Chinese DB). The AI still read name/rarity/number reliably, so keep those
  // AND try to auto-fill the artwork so the row isn't blank.
  let img = '';
  if (scan.setCode && scan.localId) {
    if (isZhTw) {
      // Prefer genuine zh-tw art (official TW proxy).
      img = (await lookupTwCardImage(scan.setCode, scan.localId)) || '';
      // zh-tw MEGA sets print "M#F"; the JP equivalent is "M#" and shares the
      // identical illustration (only the text language differs), so use it as a
      // stand-in thumbnail when no TW art exists.
      if (!img && /^M\d+[A-Z]*F$/i.test(scan.setCode)) {
        img = (await lookupJpCardImage(scan.setCode.replace(/F$/i, ''), scan.localId)) || '';
      }
    } else {
      img = (await lookupJpCardImage(scan.setCode, scan.localId)) || '';
    }
  }
  const setName = prod?.name || '';
  return {
    status: 'fallback',
    // Show WHAT was read, not just that the catalog missed. Secret rares are the
    // usual cause (TCGdex's zh-tw data stops at the official set total, so a UR
    // numbered past it can't match) — and without these identifiers on screen
    // there's no way to tell that apart from a genuine misread.
    hint:
      `辨識為 ${scan.setCode || '?'} #${scan.localId || '?'}（${isZhTw ? '繁中' : scan.language || 'ja'}）`
      // A set the catalog knows means the code read fine and it's the card table
      // that's behind (new sets take weeks to appear) — quite different from a
      // code nothing recognises, which is usually a misread.
      + (prod
        ? '；卡片資料庫尚未收錄這個系列，已依卡面填入'
        : '；卡片資料庫查無此編號，請確認系列與卡號')
      + (img ? '' : '。找不到對應卡圖，請手動貼上圖片網址'),
    patch: patchOf({
      ...grading,
      name:       scan.name,
      setName,
      series:     prod?.series || '',
      cardNumber: scanCardNumber(scan.localId, scan.setCode, setName),
      rarity:     scan.rarity,
      edition:    isZhTw ? 'zh-tw' : scan.language,
      imageUrl:   img,
    }),
  };
}
