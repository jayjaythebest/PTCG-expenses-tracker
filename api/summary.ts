import type { VercelRequest, VercelResponse } from '@vercel/node';
import { textCompletion } from './_lib/ai.js';

// On-demand weekly spending summary for the Dashboard. Server-side so the AI
// key never ships to the browser. Runs the provider fallback chain.

interface SummaryExpense {
  title: string;
  category: string;
  amount: number;
  quantity: number;
  type: 'Expense' | 'Income';
  date: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ summary: '', error: 'method not allowed' });
  }

  const { expenses } = (req.body ?? {}) as { expenses?: SummaryExpense[] };
  const rows = Array.isArray(expenses) ? expenses : [];

  if (rows.length === 0) {
    return res.status(200).json({ summary: '本週沒有任何支出或收入記錄，繼續保持荷包扎實！' });
  }

  const lines = rows
    .map(e => `- ${e.date.slice(0, 10)} ${e.type === 'Income' ? '收入' : '支出'} ${e.title} x${e.quantity} ¥${e.amount * e.quantity}（${e.category}）`)
    .join('\n');

  try {
    const prompt = `你是寶可夢集換式卡牌遊戲（PTCG）玩家的個人記帳助手。根據以下本週的消費/收入記錄，寫一段簡短、口語化的中文摘要（3-5 句話），內容包含：
- 本週總支出與總收入（自己加總金額）
- 花最多錢的分類或商品
- 一句輕鬆的評論或建議

記錄：
${lines}

只回傳摘要文字，不要加標題或標點符號以外的格式。`;

    const { data, provider } = await textCompletion({ prompt });
    return res.status(200).json({ summary: data, provider });
  } catch {
    return res.status(500).json({ summary: '', error: 'summary failed' });
  }
}
