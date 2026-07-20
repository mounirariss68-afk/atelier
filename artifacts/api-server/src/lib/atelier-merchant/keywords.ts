/**
 * Task #396 — keyword-based category inference (adapted from the kit's
 * categoryKeywords.ts, remapped onto the Task #383 taxonomy pairs and
 * trimmed to business-expense-relevant entries).
 *
 * Entries are checked in priority order (lower first); keywords match on
 * word boundaries against the normalized merchant/receipt text.
 */

import type { TaxonomyPair } from "./aliasMap";

export interface KeywordEntry extends TaxonomyPair {
  priority: number;
  keywords: string[];
}

export const KEYWORD_ENTRIES: KeywordEntry[] = [
  {
    categoryCode: "travel",
    subCategoryCode: "flights",
    priority: 1,
    keywords: [
      "airline", "airlines", "airways", "air france", "klm", "lufthansa",
      "emirates", "qatar airways", "etihad", "turkish airlines", "pegasus",
      "british airways", "ryanair", "easyjet", "wizz air", "saudia",
      "flynas", "flydubai", "gulf air", "oman air", "kuwait airways",
      "royal jordanian", "egyptair", "delta air", "united air", "american air",
      "swiss air", "austrian air", "iberia", "vueling", "tap portugal",
      "aegean", "norwegian air", "sas ", "finnair", "airasia", "singapore air",
    ],
  },
  {
    categoryCode: "travel",
    subCategoryCode: "lodging",
    priority: 1,
    keywords: [
      "hotel", "hotels", "hostel", "resort", "motel", "aparthotel",
      "hilton", "marriott", "hyatt", "radisson", "ibis", "novotel", "accor",
      "sheraton", "westin", "intercontinental", "kempinski", "rotana",
      "four seasons", "ritz carlton", "fairmont", "sofitel", "pullman",
      "holiday inn", "crowne plaza", "best western", "premier inn",
      "travelodge", "airbnb", "booking com", "bookingcom", "agoda", "expedia",
    ],
  },
  {
    categoryCode: "travel",
    subCategoryCode: "ground_transport",
    priority: 1,
    keywords: [
      "uber", "careem", "bolt", "lyft", "taxi", "cab ", "grab",
      "metro", "tram", "railway", "rail ", "train", "tfl", "transport for london",
      "parking", "car park", "parkmobile", "toll", "salik", "darb",
      "hertz", "avis", "sixt", "europcar", "budget rent", "enterprise rent",
      "car rental", "rent a car", "petrol", "fuel", "gas station", "shell",
      "aral", "adnoc", "enoc", "eppco", "opet", "petrol ofisi", "bp ", "esso",
    ],
  },
  {
    categoryCode: "technology",
    subCategoryCode: "software_subscriptions",
    priority: 1,
    keywords: [
      "aws", "amazon web services", "azure", "google cloud", "gcp",
      "github", "gitlab", "slack", "zoom", "notion", "figma", "miro",
      "openai", "anthropic", "chatgpt", "claude ai", "microsoft 365",
      "office 365", "adobe", "atlassian", "jira", "confluence", "dropbox",
      "salesforce", "hubspot", "mailchimp", "zapier", "airtable", "asana",
      "monday com", "linear app", "vercel", "netlify", "heroku", "digitalocean",
      "netflix", "spotify", "youtube premium", "linkedin premium",
      "saas", "subscription", "software license",
    ],
  },
  {
    categoryCode: "technology",
    subCategoryCode: "telecom_connectivity",
    priority: 1,
    keywords: [
      "vodafone", "etisalat", "stc ", "mobily", "zain", "ooredoo",
      "turkcell", "turk telekom", "o2 ", "ee ", "three uk", "giffgaff",
      "t mobile", "verizon", "at t", "orange ", "telekom", "telecom",
      "broadband", "internet service", "sim card", "roaming", "du ",
    ],
  },
  {
    categoryCode: "meals_entertainment",
    subCategoryCode: "team_meals",
    priority: 2,
    keywords: [
      "supermarket", "hypermarket", "grocery", "groceries", "carrefour",
      "spinneys", "lulu", "waitrose", "tesco", "sainsbury", "asda",
      "aldi", "lidl", "migros", "sok ", "bim ", "a101", "whole foods",
      "trader joe", "kroger", "walmart", "costco", "panda ", "tamimi",
    ],
  },
  {
    categoryCode: "meals_entertainment",
    subCategoryCode: "client_meals",
    priority: 3,
    keywords: [
      "restaurant", "cafe", "coffee", "starbucks", "costa", "caffe nero",
      "bistro", "brasserie", "grill", "steakhouse", "sushi", "pizzeria",
      "mcdonald", "kfc", "burger king", "subway", "nando", "shake shack",
      "five guys", "deliveroo", "talabat", "uber eats", "just eat",
      "hungerstation", "jahez", "zomato", "doordash", "bakery", "patisserie",
      "catering", "dining", "eatery", "kitchen", "shawarma", "kebab",
    ],
  },
  {
    categoryCode: "people",
    subCategoryCode: "training_development",
    priority: 1,
    keywords: [
      "udemy", "coursera", "linkedin learning", "pluralsight", "skillshare",
      "training", "certification", "bootcamp", "workshop fee", "edx",
      "masterclass", "conference ticket", "seminar",
    ],
  },
  {
    categoryCode: "people",
    subCategoryCode: "wellbeing",
    priority: 2,
    keywords: [
      "pharmacy", "pharmacie", "eczane", "chemist", "drugstore", "clinic",
      "hospital", "medical", "dental", "optician", "gym", "fitness",
      "boots pharmacy", "cvs", "walgreens", "nahdi", "al dawaa", "life pharmacy",
    ],
  },
  {
    categoryCode: "office_admin",
    subCategoryCode: "office_supplies",
    priority: 2,
    keywords: [
      "staples", "office depot", "ryman", "stationery", "stationers",
      "office supplies", "paperchase", "viking direct",
    ],
  },
  {
    categoryCode: "office_admin",
    subCategoryCode: "printing_postage",
    priority: 2,
    keywords: [
      "fedex", "dhl", "ups ", "aramex", "royal mail", "post office",
      "postage", "courier", "printing", "print shop", "vistaprint", "smsa",
    ],
  },
  {
    categoryCode: "professional_services",
    subCategoryCode: "legal_fees",
    priority: 2,
    keywords: ["law firm", "legal services", "solicitors", "attorneys", "notary"],
  },
  {
    categoryCode: "professional_services",
    subCategoryCode: "accounting_audit",
    priority: 2,
    keywords: ["accounting", "accountants", "audit ", "bookkeeping", "tax advisors"],
  },
  {
    categoryCode: "government_compliance",
    subCategoryCode: "government_fees",
    priority: 1,
    keywords: [
      "ministry", "municipality", "immigration", "passport office",
      "visa fee", "government", "amer center", "tasheel", "gdrfa",
      "chamber of commerce", "notary public",
    ],
  },
  {
    categoryCode: "financial",
    subCategoryCode: "insurance",
    priority: 2,
    keywords: ["insurance", "takaful", "axa ", "allianz", "zurich insurance", "metlife", "bupa"],
  },
  {
    categoryCode: "financial",
    subCategoryCode: "bank_charges",
    priority: 3,
    keywords: ["bank fee", "service charge", "account fee", "card fee", "annual fee", "maintenance fee"],
  },
];

export interface KeywordMatch extends TaxonomyPair {
  keyword: string;
}

/** Word-boundary keyword scan over normalized text. Lower priority wins. */
export function matchByKeyword(rawText: string): KeywordMatch | null {
  if (!rawText) return null;
  const text = ` ${rawText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

  const sorted = [...KEYWORD_ENTRIES].sort((a, b) => a.priority - b.priority);
  for (const entry of sorted) {
    for (const kw of entry.keywords) {
      const needle = kw.endsWith(" ") ? ` ${kw}` : ` ${kw} `;
      const inner = kw.trim();
      if (needle.endsWith(" ") && !kw.endsWith(" ")) {
        if (text.includes(` ${inner} `)) {
          return { categoryCode: entry.categoryCode, subCategoryCode: entry.subCategoryCode, keyword: inner };
        }
      } else if (text.includes(` ${inner} `) || text.includes(` ${inner}`)) {
        return { categoryCode: entry.categoryCode, subCategoryCode: entry.subCategoryCode, keyword: inner };
      }
    }
  }
  return null;
}
