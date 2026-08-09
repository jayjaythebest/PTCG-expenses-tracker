import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { visionJson, enabledProviders, type VisionAttempt } from './_lib/ai.js';
import { getKnownSetCodes, canonicalSetCode } from './_lib/setcodes.js';
import { lookupJaCardIdentity } from './_lib/pricing.js';
import { requireUser } from './_lib/auth.js';

// Vision OCR of a Pokémon card. The client posts a (downscaled) base64 image;
// we read only the reliably-printed identifiers and return them. Authoritative
// name/rarity/set + artwork are resolved afterwards on the client via TCGdex /
// the TW image proxy. Runs across the provider fallback chain (see _lib/ai.ts).
//
// Japanese reads are confirmed against Huca here, before answering, because a
// brand-new set is absent from the client's catalog and a misread set code would
// go unchallenged the rest of the way. `verified: 'huca'` marks such a read.

interface ScanShape {
  setCode: string;
  localId: string;
  name: string;
  rarity: string;
  language: 'ja' | 'zh-tw' | '';
  // Grading slab label, when the card is encased in a graded holder. Empty
  // strings for a raw (ungraded) card. `gradingCompany` is the raw label text
  // (e.g. "PSA", "BGS"); the client normalizes it to its psa/bgs/other enum.
  gradingCompany: string;
  grade: string;
  gradingCert: string;
}

const EMPTY: ScanShape = {
  setCode: '', localId: '', name: '', rarity: '', language: '',
  gradingCompany: '', grade: '', gradingCert: '',
};

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
    gradingCompany: { type: Type.STRING },
    grade: { type: Type.STRING },
    gradingCert: { type: Type.STRING },
  },
  required: ['language', 'setCode', 'localId', 'name', 'rarity', 'gradingCompany', 'grade', 'gradingCert'],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireUser(req, res))) return;

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
- 日文卡的系列代號印在卡面左下角那一小排：先是規則標記字母（J、H、G…），緊接著就是系列代號，然後才是卡號與稀有度，例如「J M6 080/076 AR」。繁中卡的代號同樣在左下或右下角。
- 系列代號通常是短英數（例如 M4、SV8a、SC2a），可能印在角落或很小，請仔細看。
- **只能讀，不能猜**：新發售的系列你很可能沒看過，卡片本身才是唯一依據。嚴禁靠「這張卡我印象中屬於哪個系列」來推測代號。

務必只回傳一個 JSON 物件，欄位如下（所有值皆為字串，看不清楚就回空字串 ""）：
1. language：先判斷這張卡是哪種語言版本。回傳 "ja"（日文版，卡名為日文假名/漢字）或 "zh-tw"（繁體中文版，卡名為繁體中文）。若無法確定，回空字串。
2. localId：卡號斜線「前面」的數字（例如卡號是 001/165，localId 就是 001；120/083 則是 120）。只要數字部分，可保留前導零。
3. setCode：卡片左下或右下角的擴充包代號（英數，如 M4、SV8a）。**一律照卡面實際印刷的字樣回傳**（卡面印 M6 就回 M6）。下面的清單只是「拼寫參考」，用來修正大小寫或易混淆字元（0/O、1/I/l、5/S）——只有在你讀到的字樣與清單中某個代號幾乎一致時，才採用清單的寫法。
   **嚴禁**因為清單裡沒有你讀到的代號，就改回清單中的其他代號：清單會落後新系列，讀到清單外的代號是正常的，照實回傳即可。看不到明確代號才回空字串。
   【日文版 已知代號 (ja)】：
   ${codes.ja.join(', ')}
   【繁體中文版 已知代號 (zh-tw)】：
   ${codes['zh-tw'].join(', ')}
4. name：卡片名稱，**必須照抄卡面「最上方」實際印刷的文字**，用卡片本身的語言，嚴禁翻譯或轉寫成別種語言。
   - 繁體中文版：回繁體中文字（如 噴火龍 ex、起源帕路奇亞VSTAR）。**絕對不可**回日文假名（如把繁中卡寫成 オリジンパルキアVSTAR 就是錯的）。
   - 日文版：回日文假名/漢字（如 リザードン ex、メガゲッコウガex）。
   - 若 language 判為 zh-tw，name 就一定要是中文字；若 language 判為 ja，name 才會是日文。兩者要一致。看不清楚就回空字串。
5. rarity：稀有度，從這些選一個最接近的（看不出來就回空字串）：UR、MUR、MA、SAR、AR、SR、HR、CSR、SER、RR、R、U、C、ACE SPEC、Promo。
   參考：UR/MUR=全金卡(整張金色反光，字壓印在金箔上)、MA=メガ系列專屬標記(卡面印 MA)、SAR=全圖特殊插畫(卡號常超出總數)、AR=全圖插畫、SR=金框特殊加工、HR=彩虹金、RR=一般 ex/V、R=閃卡、U/C=一般非閃卡。卡面右下若印有 UR / MUR / MA / SAR 等英文縮寫，請優先採用。
   MA 是獨立的稀有度，**不要**因為它是全圖插畫就改回 AR/SAR；卡面印什麼就回什麼。

【鑑定卡（評級卡 / slab）辨識】
如果這張卡被「封在透明硬殼鑑定盒裡、且盒子上方有一條評級標籤（label）」，它就是「鑑定卡」，請額外讀取標籤資訊填入下面三個欄位；若只是一般裸卡、卡磚、卡包（沒有評級標籤），這三個欄位一律回空字串 ""。
6. gradingCompany：鑑定公司。依標籤外觀 / logo 判斷，回傳英文縮寫（PSA、BGS、CGC、ARS、PGA 等）。各家外觀差異：
   - PSA：上方細長標籤，右側常有紅色區塊與大大的分數（如「GEM MT 10」「MINT 9」），左側是紅字「PSA」logo＋白底，底部有一長串數字編號。→ 回 "PSA"
   - BGS（Beckett）：黑底銀字，頂級為金色標籤；右側常列出四項子分數（Centering／Corners／Edges／Surface）加一個大的總分（可能含 .5，如 9.5、Pristine 10），有「BGS」logo。→ 回 "BGS"
   - CGC：藍色系標籤，有「CGC」logo。→ 回 "CGC"
   - ARS：日系鑑定公司，常見於日文卡。→ 回 "ARS"
   看不出是哪家或不是鑑定卡就回 ""。
7. grade：評級分數（PSA／CGC 多為整數 10、9；BGS 可能含半分 9.5、10）。只回數字本身（可含小數點），例如 "10"、"9.5"；看不清楚回 ""。
8. gradingCert：標籤上的編號／流水號／條碼號碼（例如 134848377）；看不清楚回 ""。
提示：鑑定盒的標籤常以「英文」印出卡片資訊（年份、系列如 SV2D、卡號 #072、卡名、稀有度如 ART RARE=AR）。你可用它輔助判讀 setCode／localId／rarity，但 name 請優先使用「卡面本身語言」的名稱（例如卡面上的日文 ヘラクロス）；卡面看不到名稱時才退而使用標籤上的英文名。

只根據卡面與鑑定標籤實際印刷的內容作答，不確定的欄位一律回空字串。只輸出 JSON，不要額外文字。`;

    const { data, provider, model } = await visionJson<ScanShape>({
      imageBase64,
      mimeType: mimeType || 'image/jpeg',
      prompt,
      schema: scanSchema,
      validate: isScanShape,
    });

    const lang = data.language === 'ja' || data.language === 'zh-tw' ? data.language : '';
    const localId = String(data.localId ?? '');
    let setCode = canonicalSetCode(String(data.setCode ?? ''), lang === 'zh-tw' ? codes['zh-tw'] : codes.ja);
    let name = String(data.name ?? '');
    let rarity = String(data.rarity ?? '');
    let setName = '';
    let verified = '';

    // Check a Japanese read against Huca before answering. A card whose set is
    // too new for TCGdex (the app's catalog) has nothing downstream to correct a
    // misread set code, so the wrong set silently becomes the stored set name,
    // the artwork and the price — an M6 カイオーガ came back as SV7a that way.
    // Huca carries a set from release day and confirms the code, name and rarity
    // against the collector number, or recovers the code from the name.
    if (lang !== 'zh-tw' && localId) {
      const id = await lookupJaCardIdentity(setCode, localId, name);
      if (id) {
        setCode = id.setCode;
        name = id.name || name;
        rarity = id.rarity || rarity;
        setName = id.setName;
        verified = 'huca';
      }
    }

    return res.status(200).json({
      setCode,
      localId,
      name,
      rarity,
      setName,
      verified,
      language: lang,
      gradingCompany: String(data.gradingCompany ?? ''),
      grade: String(data.grade ?? ''),
      gradingCert: String(data.gradingCert ?? ''),
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
