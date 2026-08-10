import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { textCompletion } from './_lib/ai.js';
import { supabaseUrl, serviceRoleKey, notifyEmailTo } from './_lib/env.js';

interface ExpenseRow {
  title: string;
  category: string;
  amount: number;
  quantity: number | null;
  type: string;
  date: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    console.error('[weekly-summary] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  const supabase = createClient(url, key);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expenses, error } = await supabase
    .from('expenses')
    .select('title, category, amount, quantity, type, date')
    .gte('date', sevenDaysAgo)
    .order('date', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rows = (expenses ?? []) as ExpenseRow[];

  // Nothing happened this week: don't spend AI quota writing "you spent nothing"
  // and don't send a mail that says it. A quiet week should be quiet.
  if (rows.length === 0) {
    return res.status(200).json({ ok: true, skipped: 'no expenses' });
  }

  // Resend is only needed once we know there's something to send, but check it
  // before paying for the summary — generating text we then can't deliver just
  // burns quota. Missing config is 503 across this project, never 500.
  if (!process.env.RESEND_API_KEY) {
    console.error('[weekly-summary] missing RESEND_API_KEY');
    return res.status(503).json({ error: 'Resend not configured' });
  }

  const lines = rows
    .map(e => `- ${e.date.slice(0, 10)} ${e.type === 'Income' ? '收入' : '支出'} ${e.title} x${e.quantity ?? 1} ¥${Number(e.amount) * (e.quantity ?? 1)}（${e.category}）`)
    .join('\n');

  let summary = '本週摘要產生失敗。';
  try {
    const result = await textCompletion({
      prompt: `你是寶可夢集換式卡牌遊戲（PTCG）玩家的個人記帳助手。根據以下過去 7 天的消費/收入記錄，寫一段簡短、口語化的中文摘要（3-5 句話），內容包含：
- 這週總支出與總收入（自己加總金額）
- 花最多錢的分類或商品
- 一句輕鬆的評論或建議

記錄：
${lines}

只回傳摘要文字，不要加標題或標點符號以外的格式。`,
    });
    summary = result.data;
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'summary failed' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: notifyEmailTo(),
    subject: `PTCG Vault 週報 — ${new Date().toISOString().slice(0, 10)}`,
    text: summary,
  });

  if (sendError) {
    return res.status(500).json({ error: sendError.message });
  }

  return res.status(200).json({ ok: true, summary });
}
