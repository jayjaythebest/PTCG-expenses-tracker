import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

export interface CardRecognitionResult {
  name: string;
  setName: string;
  cardNumber: string;
  rarity: string;
}

export async function recognizeCardFromPhoto(file: File): Promise<CardRecognitionResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
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
            text: `你是寶可夢集換式卡牌遊戲（PTCG）專家。請仔細看這張卡牌圖片，提取以下資訊並以 JSON 格式回傳：

- name: 卡片名稱（日文原名，例如：リザードン ex）
- setName: 擴充包名稱（例如：スターターセット、黒炎の支配者、ポケモンカード151）
- cardNumber: 卡號（底部數字，例如：199/165 或 076/078）
- rarity: 稀有度（從以下選一個最接近的：SAR、AR、SR、HR、CSR、SER、RR、R、U、C、ACE SPEC、Promo）

稀有度判斷參考：
- SAR（Special Art Rare）：全圖特殊插畫，通常卡號超出 set 總數
- AR（Art Rare）：全圖插畫
- SR（Super Rare）：金色卡框或特殊加工
- HR（Hyper Rare）：彩虹金色特殊加工
- RR（Double Rare）：一般 ex/V 卡
- R（Rare）：全圖閃卡
- U（Uncommon）、C（Common）：一般非閃卡

只回傳 JSON，不要加任何說明文字。格式：
{"name":"...","setName":"...","cardNumber":"...","rarity":"..."}

如果某個欄位看不清楚，該欄位回傳空字串。`,
          },
        ],
      },
    ],
  });

  const text = (response.text ?? '').trim();
  const jsonMatch = text.match(/\{.*\}/s);
  if (!jsonMatch) return { name: '', setName: '', cardNumber: '', rarity: '' };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      name:       String(parsed.name       ?? ''),
      setName:    String(parsed.setName    ?? ''),
      cardNumber: String(parsed.cardNumber ?? ''),
      rarity:     String(parsed.rarity     ?? ''),
    };
  } catch {
    return { name: '', setName: '', cardNumber: '', rarity: '' };
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
