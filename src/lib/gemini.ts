import { GoogleGenAI, Type } from '@google/genai';
import { PTCG_PRODUCTS } from '../data/ptcg-products';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const KNOWN_SET_CODES = Array.from(new Set(PTCG_PRODUCTS.map(p => p.code))).join(', ');

// What Gemini reads off the card — only the reliably-printed identifiers.
// Authoritative name / rarity / set are resolved afterwards via TCGdex (lib/tcgdex.ts).
export interface CardScanResult {
  setCode: string;   // e.g. "sv2a" (read from the bottom set code / expansion mark)
  localId: string;   // e.g. "001" (the number before the slash in 001/165)
  name: string;      // best-effort name, used as fallback when lookup misses
  rarity: string;    // best-effort rarity guess — used only when TCGdex has none (JP API often omits high rarities)
}

export async function recognizeCardFromPhoto(file: File): Promise<CardScanResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
              data: base64,
            },
          },
          {
            text: `你是日版寶可夢集換式卡牌遊戲（PTCG）專家。請只讀取這張卡牌上「印刷得最清楚、最可靠」的兩項識別資訊，不要自己推測稀有度或系列：

1. localId：卡號斜線「前面」的數字（例如卡號是 001/165，localId 就是 001；076/078 則是 076）。只要數字部分。
2. setCode：卡片左下或右下角的擴充包代號（小寫英數，例如 sv2a、sv7、m1L、s12a）。
   這是本資料庫已知的代號清單，請盡量對應到其中之一：
   ${KNOWN_SET_CODES}
   如果卡面看不到明確代號，setCode 回傳空字串。
3. name：卡片日文名稱（例如 リザードン ex），看不清楚就回空字串。
4. rarity：稀有度，從這些選一個最接近的（看不出來就回空字串）：SAR、AR、SR、HR、CSR、SER、RR、R、U、C、ACE SPEC、Promo。
   參考：SAR=全圖特殊插畫(卡號常超出總數)、AR=全圖插畫、SR=金框特殊加工、HR=彩虹金、RR=一般 ex/V、R=閃卡、U/C=一般非閃卡。

務必只根據卡面實際印刷的內容作答，不確定的欄位一律回空字串。`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          setCode: { type: Type.STRING },
          localId: { type: Type.STRING },
          name:    { type: Type.STRING },
          rarity:  { type: Type.STRING },
        },
        required: ['setCode', 'localId', 'name', 'rarity'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '').trim());
    return {
      setCode: String(parsed.setCode ?? ''),
      localId: String(parsed.localId ?? ''),
      name:    String(parsed.name ?? ''),
      rarity:  String(parsed.rarity ?? ''),
    };
  } catch {
    return { setCode: '', localId: '', name: '', rarity: '' };
  }
}

export async function detectPtcgSeries(title: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `你是寶可夢集換式卡牌遊戲（日版 PTCG）專家。

根據以下消費記錄標題，判斷它屬於哪個 PTCG 系列或世代。
標題可能包含數量（例如「*10」「×3」）或其他符號，請忽略它們，只看商品名稱。

標題：「${title}」

請只回傳最簡短的系列代號或名稱（例如：sv6、sv2a、s12a、スカーレット＆バイオレット、ソード＆シールド 等）。
不要加任何解釋或標點。如果完全無法判斷，只回傳「不明」。`,
  });
  return (response.text ?? '不明').trim().replace(/[。、\.]/g, '');
}
