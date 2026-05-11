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
  'You are a warm, friendly Turkish female narrator for a B2B product demo.',
  'Speak with a smile -- conversational, confident, never robotic.',
  'Pacing: ~140 words per minute, with natural micro-pauses at commas and full stops.',
  'Address the listener as "siz". Use contractions. Keep energy gently rising into the closing line.',
  'Do not add filler, do not change the words. Read the user message verbatim in Turkish.',
].join(' ');

const SCRIPTS = {
  situation: `Türkiye'de beyaz eşya pazarı her hafta yeniden şekilleniyor. Hepsiburada, Trendyol, Akakçe, n11... Her platformda binlerce fiyat hareketi. Ve her hafta, ekipleriniz aynı soruyla başlıyor güne: "Bugün rakipler nerede?"`,
  complication: `Manuel raporlar geç kalıyor. Çünkü bir analist veriyi toparlayana kadar, rakip çoktan kampanyaya girmiş oluyor. Sonuç? Marj eriyor, bayi telefonları yanıyor, kararlar geç alınıyor. Fiyatlandırma döngüsü artık ekipten daha hızlı.`,
  resolution1: `İşte tam burada Maven AI devreye giriyor. Pazartesi sabahı, saat 06:14. Fiyat İzleme Ajanı, gece yaşanan hareketleri çoktan tespit etmiş. Vestel İstanbul'da buzdolabı fiyatlarını yüzde yedi düşürmüş. Ekibiniz daha kahvesini almadan, bildirim ekranınızda.`,
  resolution2: `Altı uzman ajan, tek bir orkestra gibi çalışıyor. Talep tahminini, rekabet analizini, kampanya stratejisini ve bayi iletişimini saniyeler içinde hazırlıyor. Tek tıkla onayladığınızda, üç bin bayiye yeni fiyat listesi anında iniyor. POS kreatifleri otomatik güncelleniyor.`,
  closing: `Beş günlük döngü, iki saate düştü. Yirmi şehir, üç bin bayi, tek bir karar odası. Maven AI: Arçelik için fiyat istihbaratı.`,
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
