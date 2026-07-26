import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { visionJson, enabledProviders, type VisionAttempt } from './_lib/ai.js';
import { getKnownSetCodes } from './_lib/setcodes.js';

// Vision OCR of a Pokémon card. The client posts a (downscaled) base64 image;
// we read only the reliably-printed identifiers and return them. Authoritative
// name/rarity/set + artwork are resolved afterwards on the client via TCGdex /
// the TW image proxy. Runs across the provider fallback chain (see _lib/ai.ts).

interface ScanShape {
  setCode: string;
  localId: string;
  name: string;
  rarity: string;
  language: 'ja' | 'zh-tw' | '';
}

const EMPTY: ScanShape = { setCode: '', localId: '', name: '', rarity: '', language: '' };

function isScanShape(o: unknown): o is ScanShape {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  // Require an actual signal: a card name, or a set code + collector number.
  // A blank result (all empty strings) is treated as a miss so visionJson falls
  // through to the next provider in the chain instead of accepting nothing.
  return !!str('name') || (!!str('setCode') && !!str('localId'));
}

const scanSchema = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING },
    setCode: { type: Type.STRING },
    localId: { type: Type.STRING },
    name: { type: Type.STRING },
    rarity: { type: Type.STRING },
  },
  required: ['language', 'setCode', 'localId', 'name', 'rarity'],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ...EMPTY, error: 'method not allowed' });
  }

  const { imageBase64, mimeType } = (req.body ?? {}) as { imageBase64?: string; mimeType?: string };
  if (!imageBase64) {
    return res.status(400).json({ ...EMPTY, error: 'missing imageBase64' });
  }

  try {
    const codes = await getKnownSetCodes();
    const prompt = `你是寶可夢集換式卡牌遊戲（PTCG）專家，同時精通「日文版」與「繁體中文版」卡牌。請只讀取這張卡牌上「印刷得最清楚、最可靠」的識別資訊，不要自己推測稀有度或系列。

重要辨識技巧（尤其是高稀有度卡）：
- 金卡 / 全金 UR、MUR、SAR、HR 等特殊卡的字是「壓印在反光箔面上」的，對比很低、又常有反光光斑。請放大注意卡面「最上方的卡名」與「左下或右下角落的小字」（系列代號與卡號），即使反光也要盡力辨認每個字元。
- 卡號常「超出系列總數」（例如 120/083、200/165）——這是特殊/隱藏稀有卡，屬正常，請照實回傳斜線前的數字（此例為 120）。
- 系列代號通常是短英數（例如 M4、SV8a、SC2a），可能印在角落或很小，請仔細看。

務必只回傳一個 JSON 物件，欄位如下（所有值皆為字串，看不清楚就回空字串 ""）：
1. language：先判斷這張卡是哪種語言版本。回傳 "ja"（日文版，卡名為日文假名/漢字）或 "zh-tw"（繁體中文版，卡名為繁體中文）。若無法確定，回空字串。
2. localId：卡號斜線「前面」的數字（例如卡號是 001/165，localId 就是 001；120/083 則是 120）。只要數字部分，可保留前導零。
3. setCode：卡片左下或右下角的擴充包代號（英數，如 M4、SV8a）。請依你判斷的 language，從「對應語言」的已知代號清單中挑選最接近的一個：
   【日文版 已知代號 (ja)】：
   ${codes.ja.join(', ')}
   【繁體中文版 已知代號 (zh-tw)】：
   ${codes['zh-tw'].join(', ')}
   若卡面代號不在清單中，就照卡面實際印刷的字樣回傳；若看不到明確代號，setCode 回傳空字串。
4. name：卡片名稱，使用卡片本身的語言（日文版回日文如 リザードン ex、メガゲッコウガex，繁中版回繁體中文如 噴火龍 ex），看不清楚就回空字串。
5. rarity：稀有度，從這些選一個最接近的（看不出來就回空字串）：UR、MUR、SAR、AR、SR、HR、CSR、SER、RR、R、U、C、ACE SPEC、Promo。
   參考：UR/MUR=全金卡(整張金色反光，字壓印在金箔上)、SAR=全圖特殊插畫(卡號常超出總數)、AR=全圖插畫、SR=金框特殊加工、HR=彩虹金、RR=一般 ex/V、R=閃卡、U/C=一般非閃卡。卡面右下若印有 UR / MUR / SAR 等英文縮寫，請優先採用。

只根據卡面實際印刷的內容作答，不確定的欄位一律回空字串。只輸出 JSON，不要額外文字。`;

    const { data, provider, model } = await visionJson<ScanShape>({
      imageBase64,
      mimeType: mimeType || 'image/jpeg',
      prompt,
      schema: scanSchema,
      validate: isScanShape,
    });

    const lang = data.language === 'ja' || data.language === 'zh-tw' ? data.language : '';
    return res.status(200).json({
      setCode: String(data.setCode ?? ''),
      localId: String(data.localId ?? ''),
      name: String(data.name ?? ''),
      rarity: String(data.rarity ?? ''),
      language: lang,
      provider,
      model,
      providers: enabledProviders(),
    });
  } catch (e) {
    // Every provider errored or returned an unreadable/blank result (quota
    // exhausted, all providers down, or the photo couldn't be OCR'd). Flag it so
    // the client can say "AI unavailable" rather than "card not found". We also
    // report which providers are configured + the last error, so the UI can hint
    // (e.g. only one provider set up → a single quota wall breaks the whole chain).
    const providers = enabledProviders();
    // Per-provider outcomes from visionJson (if it was the thrower). Turn them
    // into short, human-readable lines so the client banner can show exactly
    // which provider failed and why ("gemini:error API key not valid", etc.).
    const attempts = (e as { attempts?: VisionAttempt[] }).attempts;
    const debug = attempts?.map(a =>
      `${a.provider}:${a.outcome}${a.detail ? ' ' + a.detail : ''}`.slice(0, 160),
    );
    // Detect a quota wall across ALL attempt details (not just the last error).
    const haystack = [
      e instanceof Error ? e.message : String(e ?? ''),
      ...(attempts?.map(a => a.detail ?? '') ?? []),
    ].join(' ');
    const quotaHit = /\b429\b|quota|rate.?limit|exhausted|insufficient/i.test(haystack);
    return res.status(200).json({
      ...EMPTY,
      error: 'ai_failed',
      providers,
      reason: quotaHit ? 'quota' : (providers.length === 0 ? 'no_provider' : 'unreadable'),
      debug,
    });
  }
}
