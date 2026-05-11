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

const SYSTEM = [
  'You are a Turkish woman in her early thirties chatting with a colleague over coffee about a product you actually use and like.',
  'Speak the way real people talk in a relaxed work conversation -- NOT like a voice-over, narrator, or TV commercial.',
  'Pacing: brisk and natural, around 165-175 words per minute. Glide from one sentence into the next; do NOT leave noticeable gaps between sentences. Treat full stops as a tiny breath, not a pause.',
  'Sentences should feel connected -- string them together with the same energy, the way someone telling a story does.',
  'Prosody: light, smiling, slightly upward energy. Lift on questions, gentle drop on the closing line. No dramatic pauses, no over-articulation.',
  'Treat "..." as the briefest natural beat (just a comma-length breath). Treat "—" as a soft connector, not a long stop.',
  'Soften consonants like casual conversational Turkish (e.g. natural elision between words). Do not sound formal.',
  'Read the Turkish text verbatim. Do not add or remove words.',
].join(' ');

// Casual, "talking to a friend" copy. Pause markers ("..." and "—") are kept
// minimal so the model glides through sentences instead of stopping.
const SCRIPTS = {
  situation: `Türkiye'de beyaz eşya pazarı her hafta yeniden kuruluyor. Hepsiburada, Trendyol, Akakçe, n11, hepsinde binlerce fiyat gün içinde oynuyor. Ve her pazartesi sabahı ekibiniz aynı soruyla uyanıyor: bugün rakipler nerede?`,
  complication: `Bir analist oturup veriyi toparlayana kadar rakip çoktan kampanyaya girmiş oluyor. Sonuç ortada, marj eriyor, bayilerin telefonu susmuyor, kararlar hep bir adım geriden geliyor. Açıkçası fiyatlandırma artık ekipten hızlı.`,
  resolution1: `İşte tam burada Maven AI işin içine giriyor. Pazartesi sabahı saat altıyı çeyrek geçiyor, siz daha kahveyi almadan Fiyat İzleme Ajanı gece olanları çoktan görmüş. Vestel İstanbul'da buzdolabı fiyatlarını yüzde yedi düşürmüş, bildirim ekranınızda hazır.`,
  resolution2: `Altı uzman ajan var ve hepsi tek bir orkestra gibi çalışıyor. Talebi tahmin ediyor, rakibi okuyor, kampanyayı kuruyor, bayiyle konuşuyor, hepsi saniyeler içinde. Siz onayla dediğinizde üç bin bayiye yeni liste anında düşüyor, POS görselleri kendiliğinden güncelleniyor.`,
  closing: `Beş günlük döngü iki saate indi. Yirmi şehir, üç bin bayi, tek bir karar odası. Maven AI, Arçelik için fiyat istihbaratı.`,
};

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
