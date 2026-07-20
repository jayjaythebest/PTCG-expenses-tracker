import { GoogleGenAI, Type } from '@google/genai';
import { getKnownSetCodes, type ScanLanguage } from './tcgdex';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// What Gemini reads off the card — only the reliably-printed identifiers.
// Authoritative name / rarity / set are resolved afterwards via TCGdex (lib/tcgdex.ts).
export interface CardScanResult {
  setCode: string;   // e.g. "sv2a" (JP) / "SC2a" (zh-tw) — from the bottom set code / expansion mark
  localId: string;   // e.g. "001" (the number before the slash in 001/165)
  name: string;      // best-effort name, used as fallback when lookup misses
  rarity: string;    // best-effort rarity guess — used only when TCGdex has none (JP API often omits high rarities)
  language: ScanLanguage | ''; // detected card language; '' when undetermined
}

export async function recognizeCardFromPhoto(file: File): Promise<CardScanResult> {
  const [base64, codes] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }),
    getKnownSetCodes(),
  ]);

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
            text: `你是寶可夢集換式卡牌遊戲（PTCG）專家，同時精通「日文版」與「繁體中文版」卡牌。請只讀取這張卡牌上「印刷得最清楚、最可靠」的識別資訊，不要自己推測稀有度或系列：

1. language：先判斷這張卡是哪種語言版本。回傳 "ja"（日文版，卡名為日文假名/漢字）或 "zh-tw"（繁體中文版，卡名為繁體中文）。若無法確定，回空字串。
2. localId：卡號斜線「前面」的數字（例如卡號是 001/165，localId 就是 001；076/078 則是 076）。只要數字部分。
3. setCode：卡片左下或右下角的擴充包代號（英數）。請依你判斷的 language，從「對應語言」的已知代號清單中挑選最接近的一個：
   【日文版 已知代號 (ja)】：
   ${codes.ja.join(', ')}
   【繁體中文版 已知代號 (zh-tw)】：
   ${codes['zh-tw'].join(', ')}
   若卡面代號不在清單中，就照卡面實際印刷的字樣回傳；若看不到明確代號，setCode 回傳空字串。
4. name：卡片名稱，使用卡片本身的語言（日文版回日文如 リザードン ex，繁中版回繁體中文如 噴火龍 ex），看不清楚就回空字串。
5. rarity：稀有度，從這些選一個最接近的（看不出來就回空字串）：SAR、AR、SR、HR、CSR、SER、RR、R、U、C、ACE SPEC、Promo。
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
          language: { type: Type.STRING },
          setCode:  { type: Type.STRING },
          localId:  { type: Type.STRING },
          name:     { type: Type.STRING },
          rarity:   { type: Type.STRING },
        },
        required: ['language', 'setCode', 'localId', 'name', 'rarity'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '').trim());
    const lang = parsed.language === 'ja' || parsed.language === 'zh-tw' ? parsed.language : '';
    return {
      language: lang as ScanLanguage | '',
      setCode: String(parsed.setCode ?? ''),
      localId: String(parsed.localId ?? ''),
      name:    String(parsed.name ?? ''),
      rarity:  String(parsed.rarity ?? ''),
    };
  } catch {
    return { language: '', setCode: '', localId: '', name: '', rarity: '' };
  }
}

export interface WeeklySummaryExpense {
  title: string;
  category: string;
  amount: number;
  quantity: number;
  type: 'Expense' | 'Income';
  date: string;
}

export async function generateWeeklySummary(expenses: WeeklySummaryExpense[]): Promise<string> {
  if (expenses.length === 0) {
    return '本週沒有任何支出或收入記錄，繼續保持荷包扎實！';
  }

  const lines = expenses
    .map(e => `- ${e.date.slice(0, 10)} ${e.type === 'Income' ? '收入' : '支出'} ${e.title} x${e.quantity} ¥${e.amount * e.quantity}（${e.category}）`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `你是寶可夢集換式卡牌遊戲（PTCG）玩家的個人記帳助手。根據以下本週的消費/收入記錄，寫一段簡短、口語化的中文摘要（3-5 句話），內容包含：
- 本週總支出與總收入（自己加總金額）
- 花最多錢的分類或商品
- 一句輕鬆的評論或建議

記錄：
${lines}

只回傳摘要文字，不要加標題或標點符號以外的格式。`,
  });

  return (response.text ?? '').trim();
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
