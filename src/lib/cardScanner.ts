import { GoogleGenAI } from '@google/genai';

export interface CardScanResult {
  name: string | null;
  setCode: string | null;
  cardNumber: string | null;
  cardImageUrl: string | null;
}

const PROMPT = `You are looking at a photo of a Pokémon Trading Card Game (ポケモンカードゲーム) card.

Read all text on the card carefully and extract:
1. Card name — the Pokémon name as printed, in Japanese (e.g. ピカチュウ, リザードン ex, サーナイト ex). Include the suffix (ex, V, VMAX, VSTAR, GX) if present.
2. Set code — the short expansion code printed near the card number, usually at the bottom (e.g. sv6, sv7a, SV8a). Lowercase it.
3. Card number — the fraction at the very bottom of the card (e.g. 123/190, 045/198).

Return ONLY a raw JSON object, no markdown fences, no explanation:
{"name":"...","setCode":"...","cardNumber":"..."}

Use null for any field you cannot clearly read.
If this is not a Pokémon card, return {"name":null,"setCode":null,"cardNumber":null}.`;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function lookupTCG(name: string | null, setCode: string | null, cardNumber: string | null): Promise<string | null> {
  const parts: string[] = [];

  if (setCode && cardNumber) {
    const num = cardNumber.split('/')[0];
    parts.push(`set.id:${setCode}`, `number:${num}`);
  } else if (name) {
    parts.push(`name:"${name}"`);
  }

  if (parts.length === 0) return null;

  try {
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(parts.join(' '))}&pageSize=1&select=id,images`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.data?.[0]?.images?.small ?? null;
  } catch {
    return null;
  }
}

export async function scanCard(file: File): Promise<CardScanResult> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
  });

  const raw = (response.text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let parsed: { name: string | null; setCode: string | null; cardNumber: string | null } = {
    name: null, setCode: null, cardNumber: null,
  };

  try {
    parsed = JSON.parse(raw);
  } catch {
    // Gemini returned non-JSON — all null
  }

  // Normalise set code
  if (parsed.setCode) parsed.setCode = parsed.setCode.toLowerCase();

  const cardImageUrl = await lookupTCG(parsed.name, parsed.setCode, parsed.cardNumber);

  return {
    name: parsed.name,
    setCode: parsed.setCode,
    cardNumber: parsed.cardNumber,
    cardImageUrl,
  };
}
