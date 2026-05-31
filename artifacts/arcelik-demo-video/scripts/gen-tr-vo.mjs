#!/usr/bin/env node
// Regenerate Turkish narration MP3s for the Arçelik demo video.
//
// Why it lives here: it's small, self-contained, and lets anyone reproduce
// the voice-over without poking around in commit history.
//
// How to run (from repo root):
//   pnpm --filter @workspace/api-server exec node \
//     ../arcelik-demo-video/scripts/gen-tr-vo.mjs
//
// Requires the OpenAI Replit AI Integration env vars:
//   - AI_INTEGRATIONS_OPENAI_BASE_URL
//   - AI_INTEGRATIONS_OPENAI_API_KEY
//
// Notes:
//   - Uses chat completions with model `gpt-audio` (the Replit AI Integrations
//     proxy does NOT expose `/audio/speech`, so we go through chat).
//   - Voice `nova` (warm female). System prompt asks for friendly, smiling,
//     conversational delivery at ~140 wpm.
//   - Output is mp3 (base64-decoded from the audio.data field) written to
//     `artifacts/arcelik-demo-video/public/audio/<key>.mp3`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/audio');
mkdirSync(OUT_DIR, { recursive: true });

const client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Character direction, not numerical wpm. Anchor: a confident Turkish SaaS
// sales rep doing a smooth product demo on a video call. She knows the
// material cold, has presented it many times, and is walking the prospect
// through it without selling hard.
const SYSTEM_BASE = [
  'You are a Turkish woman in her early thirties doing a smooth, confident product demo to a prospective customer over a video call.',
  'You know this material cold. You have presented it many times. You are not selling hard, you are walking the prospect through what the product does, in your own natural voice.',
  'Speak as one continuous thought per scene. Do NOT pause for emphasis between sentences -- let meaning land through tone and word choice, not silence.',
  'Do not over-articulate. Soften consonants the way real Turkish business people speak on calls.',
  'Read the text once, verbatim. Do not add filler, do not add intro/outro sounds, do not pause at the very start or very end of the audio.',
].join(' ');

// Two micro-variants of energy. We generate both per scene and pick the
// take whose chars/sec lands closest to ~13.5 (natural conversational rate).
const VARIANTS = {
  measured: 'Energy: warm, grounded, slightly measured -- the way she would explain a feature she really likes.',
  upbeat: 'Energy: warm, engaged, with a touch of forward momentum -- the way she would explain something the prospect is going to find interesting.',
};

// Pause-triggering punctuation (..., —, :, ;) removed. Comma-separated lists
// rewritten into flowing phrases so the model glides through them instead of
// pausing per item.
const SCRIPTS = {
  situation: `Türkiye'de beyaz eşya pazarı her hafta yeniden kuruluyor. Hepsiburada'dan Trendyol'a, Akakçe'den n11'e kadar her platformda binlerce fiyat gün içinde oynuyor durmadan. Ve her pazartesi sabahı ekipleriniz aynı soruyla başlıyor güne, bugün rakipler nerede.`,
  complication: `Sorun şu, bir analist oturup veriyi toparlayana kadar rakip çoktan kampanyaya girmiş oluyor. Sonuç ortada, marj eriyor, bayilerin telefonu susmuyor, kararlar hep bir adım geriden geliyor. Açıkçası fiyatlandırma artık ekipten hızlı.`,
  resolution1: `İşte tam burada Cognirise işin içine giriyor. Pazartesi sabahı saat altıyı çeyrek geçiyor, siz daha kahveyi almadan Fiyat İzleme Ajanı gece olanları çoktan görmüş. Vestel İstanbul'da buzdolabı fiyatlarını yüzde yedi düşürmüş, bildirim ekranınızda hazır bekliyor.`,
  resolution2: `Altı uzman ajan var ve hepsi tek bir orkestra gibi çalışıyor. Talebi tahmin ediyor, rakibi okuyor, kampanyayı kuruyor, bayiyle konuşuyor, hepsi saniyeler içinde. Siz onayla dediğinizde üç bin bayiye yeni liste anında düşüyor, POS görselleri kendiliğinden güncelleniyor.`,
  closing: `Beş günlük döngü iki saate indi. Yirmi şehir, üç bin bayi, tek bir karar odası. Cognirise, Arçelik için fiyat istihbaratı.`,
};

// Generation strategy used: produce both VARIANTS per scene, measure
// chars/sec on each take with ffprobe, keep the take closest to 13.5 cps
// (natural Turkish conversational rate). See _gen-tr-vo-v3.mjs in commit
// history for the full picker script.
const SYSTEM = `${SYSTEM_BASE} ${VARIANTS.upbeat}`;

async function generate(key, text) {
  console.log(`[${key}] generating (${text.length} chars)`);
  const completion = await client.chat.completions.create({
    model: 'gpt-audio',
    modalities: ['text', 'audio'],
    audio: { voice: 'nova', format: 'mp3' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ],
  });
  const audio = completion.choices?.[0]?.message?.audio;
  if (!audio?.data) {
    throw new Error(`[${key}] no audio.data in response`);
  }
  const buf = Buffer.from(audio.data, 'base64');
  const out = resolve(OUT_DIR, `${key}.mp3`);
  writeFileSync(out, buf);
  console.log(`[${key}] wrote ${buf.length} bytes -> ${out}`);
}

for (const [key, text] of Object.entries(SCRIPTS)) {
  await generate(key, text);
}
console.log('done.');
