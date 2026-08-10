import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { PTCG_PRODUCTS } from '../src/data/ptcg-products.js';
import { fetchWithTimeout } from '../src/lib/fetchTimeout.js';
import { notifyEmailTo } from './_lib/env.js';

// Weekly cron: has a new expansion shipped that src/data/ptcg-products.ts
// doesn't know about yet?
//
// Why this exists: the set catalog is hand-maintained, and being out of date
// fails SILENTLY. A set that's missing simply doesn't appear in the expense
// form's 系列/世代 dropdown or the collection's 系列包名 dropdown, and a card
// filed under a set we don't carry shows no price. We only found out about M6
// 綠寶石風暴 because the user went looking for it and it wasn't there. This job
// turns that into a push: an email the evening a new pack shows up.
//
// It deliberately does NOT edit the catalog — a serverless function can't
// commit, and the ja name needs a human's eye anyway. It emails a ready-to-paste
// PTCG_PRODUCTS line instead, with every field already resolved from the real
// sources.
//
//   Cron: /api/new-set-check, Fridays 11:00 UTC = 19:00 Taiwan (see vercel.json)

const KP_PACKS = 'https://trade.kapaipai.tw/api/card/getCardPackList?game=pkmtw';
const HUCA_API = 'https://huca.tw/api/api.php';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';

// How far around today a pack's publish date may sit and still count as "news".
//
// The back window is what makes this usable at all: kapaipai lists ~70 packs in
// the 擴充包 category going back years, and we deliberately carry only a subset
// (SV, the MEGA era, and a handful of popular SWSH sets). Diffing the whole list
// against the catalog would report ~50 sets we've chosen not to carry, every
// single week, and the alert would be ignored inside a month.
//
// The forward window exists because kapaipai lists a pack BEFORE it goes on
// sale — M6's publishDate was tomorrow's date when this was written — and
// knowing a week early is the point of a Friday-evening check.
const LOOKBACK_DAYS = 120;
const LOOKAHEAD_DAYS = 60;

interface KpPack {
  packId?: string;
  packName?: string;
  category?: string;
  publishDate?: string | number;
}

interface Candidate {
  code: string;
  nameZh: string;
  publishDate: string;
  nameJa: string | null;
  series: string;
}

// kapaipai's publishDate is a plain YYYYMMDD string. Returns null when it isn't
// parseable, so an odd row is skipped rather than treated as "today".
function parseYmd(raw: string | number | undefined): Date | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{8}$/.test(s)) return null;
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Best-guess series for the email's paste-ready line, from the code prefix.
// Only a suggestion — the human confirms it against the other rows.
function guessSeries(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith('M')) return 'ポケモンカードゲーム MEGA';
  if (c.startsWith('SV')) return 'スカーレット＆バイオレット';
  if (c.startsWith('S')) return 'ソード＆シールド';
  return '（請確認）';
}

// A set's Japanese name, read off any one of its Huca card titles — they end in
// 拡張パック「<ja name>」. Huca is the ja price source, so this is the name the
// catalog has to store for pricing to resolve. null when Huca doesn't have the
// set yet (common for a zh-tw-first listing), which the email reports honestly
// rather than papering over with a guess.
async function hucaJaSetName(code: string): Promise<string | null> {
  const url = `${HUCA_API}?search=&set_code=${encodeURIComponent(code)}`
    + '&card_number=1&promo=0&accuracy=1&limit=1';
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const json = (await r.json()) as { data?: { title?: string }[] };
    const title = json?.data?.[0]?.title;
    if (!title) return null;
    return title.match(/拡張パック「([^」]+)」/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function catalogLine(c: Candidate): string {
  const ja = c.nameJa ?? '（Huca 尚無此 set，日文名待確認）';
  return `  { code: '${c.code.toLowerCase()}', name: '${ja}', series: '${c.series}', nameZh: '${c.nameZh}' },`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let packs: KpPack[];
  try {
    const r = await fetchWithTimeout(KP_PACKS, { headers: { 'User-Agent': UA } });
    const json = (await r.json()) as { data?: { list?: KpPack[] } | KpPack[] };
    const data = json?.data;
    packs = (Array.isArray(data) ? data : data?.list) ?? [];
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'kapaipai fetch failed' });
  }
  if (packs.length === 0) {
    // An empty list means the source changed shape or is down. Say so loudly —
    // reporting "no new sets" here would be a false all-clear, which is the one
    // failure mode that defeats the whole point of this job.
    return res.status(502).json({ error: 'kapaipai returned no packs' });
  }

  const known = new Set(PTCG_PRODUCTS.map(p => p.code.toUpperCase()));
  const now = Date.now();
  const from = now - LOOKBACK_DAYS * 86_400_000;
  const to = now + LOOKAHEAD_DAYS * 86_400_000;

  const unknown = packs.filter(p => {
    if (p.category !== '擴充包') return false;
    const id = String(p.packId ?? '').toUpperCase();
    if (!id || known.has(id)) return false;
    const d = parseYmd(p.publishDate);
    if (!d) return false;
    return d.getTime() >= from && d.getTime() <= to;
  });

  const candidates: Candidate[] = [];
  for (const p of unknown) {
    const code = String(p.packId);
    candidates.push({
      code,
      nameZh: String(p.packName ?? '').trim(),
      publishDate: String(p.publishDate ?? ''),
      nameJa: await hucaJaSetName(code),
      series: guessSeries(code),
    });
  }

  // Quiet when there's nothing to say — a weekly "still nothing" email trains
  // you to ignore the one that matters. The count is in the JSON response, so
  // Vercel's cron logs still show the job ran and what it saw.
  if (candidates.length === 0) {
    return res.status(200).json({ ok: true, found: 0, scanned: packs.length });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[new-set-check] missing RESEND_API_KEY');
    return res.status(503).json({ error: 'Resend not configured', found: candidates.length, candidates });
  }

  const body = [
    `偵測到 ${candidates.length} 個 src/data/ptcg-products.ts 還沒收錄的擴充包：`,
    '',
    ...candidates.map(c => [
      `● ${c.code}　${c.nameZh}　（kapaipai 上市日 ${c.publishDate}）`,
      `   日文名：${c.nameJa ?? '× Huca 還沒有這個 set，暫時無法確認'}`,
      '   可貼上 PTCG_PRODUCTS 的一行：',
      catalogLine(c),
      '',
    ].join('\n')),
    '加進目錄後請務必執行 `npm run verify:sets`，綠燈才代表名字對得上定價來源。',
    'Huca 若還查不到日文名，代表日版尚未在 Huca 上架 — 可以先只加 zh-tw，或下週再看。',
  ].join('\n');

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: notifyEmailTo(),
    subject: `PTCG 新商品偵測 — ${candidates.length} 個未收錄擴充包`,
    text: body,
  });

  if (sendError) {
    return res.status(500).json({ error: sendError.message, found: candidates.length, candidates });
  }

  return res.status(200).json({ ok: true, found: candidates.length, scanned: packs.length, candidates });
}
