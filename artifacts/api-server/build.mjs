import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir, copyFile, stat } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@huggingface/transformers",
      "unpdf",
      // pdfjs-dist legacy build breaks when bundled (PDFDocumentLoadingTask
      // is not a constructor) — keep it external so the dynamic import in
      // atelier-merchant/pdf.ts resolves the real package at runtime.
      "pdfjs-dist",
      // heic-convert pulls in libheif-js (WASM loaded via runtime path
      // resolution) — keep it external so the WASM assets resolve from
      // node_modules at runtime (Task #554).
      "heic-convert",
      "libheif-js",
      "mammoth",
      "exceljs",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "pdfkit",
      "fontkit",
      "brotli",
      "playwright",
      "playwright-core",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Task #969 — runtime assets the bundled server reads from disk. The boot
  // NEP-template ingestion loads this docx via `./assets/...` relative to
  // dist/index.mjs, so it MUST ship alongside the bundle. Fail the build
  // loudly if it can't be packaged — a silent miss would make the prod
  // boot seed a no-op.
  const runtimeAssets = [
    { source: "scripts/assets/non-equity-partner-agreement-template-v3.docx", destination: "assets/non-equity-partner-agreement-template-v3.docx" },
    // Task #1007 — approved Cognirise backdrop artwork for the PDF brand kit.
    { source: "assets/pdf-bg-light.jpg", destination: "assets/pdf-bg-light.jpg" },
    { source: "assets/pdf-bg-dark.jpg", destination: "assets/pdf-bg-dark.jpg" },
    { source: "assets/pdf-logo-white.png", destination: "assets/pdf-logo-white.png" },
    { source: "assets/pdf-riser-avatar.png", destination: "assets/pdf-riser-avatar.png" },
    // Navy Statement email renderer reads this from disk at send/package time.
    { source: "src/lib/email-assets/cognirise-logo.png", destination: "email-assets/cognirise-logo.png" },
    // The template ZIP embeds the exact canonical TypeScript source.
    { source: "src/lib/cognirise-email-templates.ts", destination: "cognirise-email-templates.ts" },
  ];
  for (const { source, destination } of runtimeAssets) {
    const src = path.resolve(artifactDir, source);
    const dest = path.resolve(distDir, destination);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    if ((await stat(dest)).size === 0) throw new Error(`Runtime asset copied empty: ${source}`);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
