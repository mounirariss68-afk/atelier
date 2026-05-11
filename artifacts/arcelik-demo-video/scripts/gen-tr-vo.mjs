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
  'You are narrating a short product story to a colleague over coffee, in Turkish.',
  'You are a warm, smiling Turkish woman in your early thirties -- think a friendly product manager, NOT a corporate voice-over actor.',
  'Tone: casual, conversational, a little playful. Like you actually believe what you are saying.',
  'Pacing: roughly 135 words per minute. Slow down on the punchlines. Take a real breath between sentences.',
  'Use natural prosody: lift the pitch on questions, drop it on the closing line, smile audibly on the friendly bits ("kahvesini almadan", "tek bir orkestra gibi").',
  'Where you see "..." pause briefly. Where you see "—" pause a touch longer.',
  'Do NOT sound like a TV commercial. Do NOT over-articulate. Soften the consonants the way someone speaking to a friend would.',
  'Read the Turkish text verbatim. Do not add or remove words.',
].join(' ');

// Casual, "talking to a friend" rewrite. Uses contractions ("bi", "diye"),
// rhetorical asides ("biliyor musunuz", "düşünün bir"), shorter sentences,
// and softens the corporate phrasing.
const SCRIPTS = {
  situation: `Türkiye'de beyaz eşya pazarı... her hafta yeniden kurulup duruyor. Hepsiburada, Trendyol, Akakçe, n11 — binlerce fiyat, gün içinde oynayıp duruyor. Ve her pazartesi sabahı, ekibiniz aynı soruyla uyanıyor: "Bugün rakipler nerede?"`,
  complication: `Şimdi düşünün bir... Bir analist oturup veriyi toparlayana kadar, rakip çoktan kampanyaya girmiş oluyor. Sonuç ortada — marj eriyor, bayilerin telefonu susmuyor, kararlar hep bir adım geriden geliyor. Açıkçası fiyatlandırma artık ekipten hızlı.`,
  resolution1: `İşte tam burada Maven AI işin içine giriyor. Düşünün, pazartesi sabahı saat altıyı çeyrek geçiyor. Siz daha kahveyi almadan, Fiyat İzleme Ajanı gece olanları çoktan görmüş. Vestel, İstanbul'da buzdolabı fiyatlarını yüzde yedi düşürmüş — bildirim ekranınızda hazır.`,
  resolution2: `Altı tane uzman ajan var... ve hepsi tek bir orkestra gibi çalışıyor. Talebi tahmin ediyor, rakibi okuyor, kampanyayı kuruyor, bayiyle konuşuyor — saniyeler içinde. Siz "onayla" dediğinizde, üç bin bayiye yeni liste anında düşüyor. POS görselleri kendiliğinden güncelleniyor.`,
  closing: `Beş günlük döngü... iki saate indi. Yirmi şehir, üç bin bayi, tek bir karar odası. Maven AI — Arçelik için fiyat istihbaratı.`,
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
