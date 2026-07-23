---
name: Production deployment runtime dependencies
description: Which packages must survive the build cleanup and how to strip them for size
---

## The Problem

The api-server esbuild bundle has several packages as **top-level static ESM imports** (externalized, not bundled). These must exist in `node_modules` at runtime or Node.js refuses to load the bundle.

## Externalized packages with static imports (MUST be in node_modules at runtime)

From `grep "^import " artifacts/api-server/dist/index.mjs`:

| Package | Why external |
|---|---|
| `@google-cloud/storage` | object storage |
| `heic-convert` | HEIC image conversion |
| `mammoth` | .docx parsing |
| `exceljs` | .xlsx parsing |
| `unpdf` | PDF extraction |
| `@huggingface/transformers` | embedding model |
| `pdfkit` | PDF generation |
| `pdfjs-dist` | PDF text layer (dynamic import, but keep for feature correctness) |

`libheif-js` is a transitive dep of `heic-convert`; npm installs it automatically.  
`onnxruntime-node` is a transitive dep of `@huggingface/transformers`; npm installs it automatically.

## Build cleanup strategy (mobile artifact.toml build command)

1. Run mobile build
2. `rm -rf node_modules "$(pnpm store path)" .git` — clears 1.3 GB
3. `npm install` of the 8 packages above in `/tmp/pkgs`
4. Strip unnecessary binary blobs from onnxruntime-node:
   - `bin/napi-v3/linux/x64/libonnxruntime_providers_cuda.so` (327 MB — GPU, not needed)
   - `bin/napi-v3/linux/x64/libonnxruntime_providers_tensorrt.so` (TensorRT GPU)
   - `bin/napi-v3/linux/arm64/` (34 MB — wrong platform)
   - `bin/napi-v3/win32/` (68 MB — wrong platform)
   - `bin/napi-v3/darwin/` (65 MB — wrong platform)
   - `node_modules/onnxruntime-web/` (92 MB — WASM fallback, native works)
5. Move trimmed `node_modules` to workspace root

## Resulting sizes

- Raw npm install (8 packages + deps): 878 MB
- After binary stripping: **293 MB**
- Expected total image: Nix (~7 GB) + source (~200 MB) + node_modules (293 MB) ≈ 7.5 GiB ✓

**Why:** Nix layer is ~7 GB. With the full 1.3 GB pnpm node_modules the image exceeded 8 GiB. With no node_modules the bundle's static imports failed. The selective reinstall + strip hits the sweet spot.
