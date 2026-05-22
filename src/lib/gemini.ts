import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

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
