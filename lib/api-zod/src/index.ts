export * from "./generated/api";
export * from "./generated/types";
// Multipart body types exist in BOTH generated modules (orval emits the
// inferred zod type in api.ts and the schema type in types/); explicit
// re-exports resolve the star-export ambiguity in favour of the schema types.
export type {
  AtelierCreateMyDocumentBody,
  AtelierReplaceMyDocumentScanBody,
  AtelierUploadMyPhotoBody,
  AtelierCreateDocumentBody,
  AtelierUpdateDocumentBody,
  AtelierUploadDocumentVersionBody,
  AtelierGrantDocumentAccessBody,
  AtelierUploadCandidateDocumentBody,
  AtelierListDocumentsParams,
  AtelierDownloadDocumentParams,
  AtelierSubmitMyExpenseBody,
  AuthLoginResponse,
} from "./generated/types";
