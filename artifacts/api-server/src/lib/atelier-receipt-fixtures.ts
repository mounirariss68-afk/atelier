/**
 * Deterministic OCR-receipt fixtures (Task #259).
 *
 * The Expense Auditor never hits a real OCR provider in this build —
 * instead it looks up the expense's `receiptFixtureKey` here. Each
 * fixture mimics the fields a Tesseract/Textract response would expose:
 * merchant, date, total, tax, currency, line-items, and a stub
 * confidence band. Seed data points expenses at these keys so the
 * Auditor produces stable proposals across runs.
 */

export interface OcrFixture {
  merchant: string;
  date: string; // YYYY-MM-DD (relative dates resolved at runtime)
  total: number;
  tax: number;
  currency: string;
  country: string;
  category:
    | "flight"
    | "hotel"
    | "meal"
    | "gift"
    | "software"
    | "mileage"
    | "per_diem"
    | "taxi"
    | "other";
  lineItems: string[];
  confidence: "green" | "amber" | "red";
  rawText: string;
}

export const RECEIPT_FIXTURES: Record<string, OcrFixture> = {
  riyadh_taxi_01: {
    merchant: "Careem KSA",
    date: "",
    total: 84.5,
    tax: 11.02,
    currency: "SAR",
    country: "KSA",
    category: "taxi",
    lineItems: ["Trip Riyadh KAFD → DQ"],
    confidence: "green",
    rawText: "Careem Receipt\nTrip 84.50 SAR\nVAT 15% 11.02",
  },
  riyadh_hotel_01: {
    merchant: "Four Seasons Riyadh",
    date: "",
    total: 2875.0,
    tax: 375.0,
    currency: "SAR",
    country: "KSA",
    category: "hotel",
    lineItems: ["1 night Deluxe Room"],
    confidence: "green",
    rawText: "Four Seasons\nRoom 2,500.00\nVAT 15% 375.00\nTotal 2,875.00 SAR",
  },
  riyadh_dinner_clientmeal: {
    merchant: "Najd Village",
    date: "",
    total: 690.0,
    tax: 90.0,
    currency: "SAR",
    country: "KSA",
    category: "meal",
    lineItems: ["Client dinner — 4 covers (Tasama exec team)"],
    confidence: "green",
    rawText: "Najd Village\nFood 600.00\nVAT 15% 90.00",
  },
  dubai_taxi_01: {
    merchant: "Careem UAE",
    date: "",
    total: 64.0,
    tax: 3.05,
    currency: "AED",
    country: "UAE",
    category: "taxi",
    lineItems: ["DXB Airport → Burj Plaza"],
    confidence: "green",
    rawText: "Careem AE\n64.00 AED\nVAT 5% 3.05",
  },
  dubai_hotel_01: {
    merchant: "Address Downtown",
    date: "",
    total: 2730.0,
    tax: 130.0,
    currency: "AED",
    country: "UAE",
    category: "hotel",
    lineItems: ["2 nights"],
    confidence: "green",
    rawText: "Address Downtown\nRoom 2,600.00\nVAT 5% 130.00",
  },
  dubai_dinner_01: {
    merchant: "Zuma Dubai",
    date: "",
    total: 1260.0,
    tax: 60.0,
    currency: "AED",
    country: "UAE",
    category: "meal",
    lineItems: ["Working dinner DM team — 3 covers"],
    confidence: "green",
    rawText: "Zuma DXB\nFood 1,200.00\nVAT 5% 60.00",
  },
  flight_riyadh_dubai_business: {
    merchant: "Saudia",
    date: "",
    total: 4900.0,
    tax: 0,
    currency: "SAR",
    country: "KSA",
    category: "flight",
    lineItems: ["RUH → DXB Business class"],
    confidence: "amber",
    rawText: "Saudia Airlines\nRUH-DXB Business\n4,900.00 SAR",
  },
  flight_dubai_london_first: {
    merchant: "Emirates",
    date: "",
    total: 22500.0,
    tax: 0,
    currency: "AED",
    country: "UAE",
    category: "flight",
    lineItems: ["DXB → LHR First class"],
    confidence: "red",
    rawText: "Emirates\nDXB-LHR FIRST\n22,500.00 AED",
  },
  software_chatgpt_team: {
    merchant: "OpenAI",
    date: "",
    total: 30.0,
    tax: 0,
    currency: "USD",
    country: "US",
    category: "software",
    lineItems: ["ChatGPT Team — monthly seat"],
    confidence: "green",
    rawText: "OpenAI Inc.\nChatGPT Team\n$30.00 USD",
  },
  software_figma_org: {
    merchant: "Figma",
    date: "",
    total: 75.0,
    tax: 0,
    currency: "USD",
    country: "US",
    category: "software",
    lineItems: ["Figma Organization seat"],
    confidence: "green",
    rawText: "Figma Inc.\nOrg seat\n$75.00 USD",
  },
  gift_client_riyadh: {
    merchant: "Patchi",
    date: "",
    total: 480.0,
    tax: 62.61,
    currency: "SAR",
    country: "KSA",
    category: "gift",
    lineItems: ["Premium chocolate gift box — Tasama COO welcome"],
    confidence: "green",
    rawText: "Patchi\n480.00 SAR\nVAT 15%",
  },
  gift_excessive_dubai: {
    merchant: "Cartier Dubai",
    date: "",
    total: 8800.0,
    tax: 419.05,
    currency: "AED",
    country: "UAE",
    category: "gift",
    lineItems: ["Watch — DGE chairman"],
    confidence: "red",
    rawText: "Cartier\n8,800.00 AED\nVAT 5%",
  },
};

export function resolveFixtureDate(key: string, fallback: string): string {
  const fx = RECEIPT_FIXTURES[key];
  if (fx?.date) return fx.date;
  return fallback;
}
