import type { VercelRequest, VercelResponse } from '@vercel/node';
import { textCompletion } from './_lib/ai';

// Classify an expense title into a PTCG series/generation code. Server-side so
// the AI key never ships to the browser. Runs the provider fallback chain.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ series: '不明', error: 'method not allowed' });
  }

  const { title } = (req.body ?? {}) as { title?: string };
  if (!title) {
    return res.status(200).json({ series: '不明' });
  }

  try {
    const prompt = `你是寶可夢集換式卡牌遊戲（日版 PTCG）專家。

根據以下消費記錄標題，判斷它屬於哪個 PTCG 系列或世代。
標題可能包含數量（例如「*10」「×3」）或其他符號，請忽略它們，只看商品名稱。

標題：「${title}」

請只回傳最簡短的系列代號或名稱（例如：sv6、sv2a、s12a、スカーレット＆バイオレット、ソード＆シールド 等）。
不要加任何解釋或標點。如果完全無法判斷，只回傳「不明」。`;

    const { data, provider } = await textCompletion({ prompt });
    const series = data.replace(/[。、.]/g, '').trim() || '不明';
    return res.status(200).json({ series, provider });
  } catch {
    return res.status(200).json({ series: '不明' });
  }
}
