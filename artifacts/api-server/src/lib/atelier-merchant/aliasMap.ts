/**
 * Task #396 — alias map from the kit CSVs' category labels onto the
 * Task #383 taxonomy (categoryCode/subCategoryCode pairs).
 *
 * Both seed formats route through here:
 *  - EU csv:  key `${category_group}|${category}`
 *  - NA csv:  key `NA|${category}` (group-level; subcategory label kept as text)
 * Unmappable labels fall back to DEFAULT_PAIR (office_admin/general_admin);
 * the seed script verifies every DISTINCT label in the CSVs is either
 * explicitly mapped or counted as a reported fallback.
 */

export interface TaxonomyPair {
  categoryCode: string;
  subCategoryCode: string;
}

export const DEFAULT_PAIR: TaxonomyPair = {
  categoryCode: "office_admin",
  subCategoryCode: "general_admin",
};

const P = (categoryCode: string, subCategoryCode: string): TaxonomyPair => ({
  categoryCode,
  subCategoryCode,
});

/** EU file: `${category_group}|${category}` → taxonomy pair. */
export const EU_LABEL_MAP: Record<string, TaxonomyPair> = {
  "Transportation|Airlines": P("travel", "flights"),
  "Transportation|Parking": P("travel", "ground_transport"),
  "Transportation|Fuel & Gas": P("travel", "ground_transport"),
  "Transportation|Car Rental": P("travel", "ground_transport"),
  "Transportation|Public Transit": P("travel", "ground_transport"),
  "Transportation|Ride Hailing & Taxis": P("travel", "ground_transport"),
  "Travel|Accommodation": P("travel", "lodging"),
  "Travel|Hotels & Lodging": P("travel", "lodging"),
  "Travel|Travel Agencies": P("travel", "flights"),
  "Travel|Attractions": P("meals_entertainment", "entertainment"),
  "Food & Drink|Restaurants": P("meals_entertainment", "client_meals"),
  "Food & Drink|Bars & Pubs": P("meals_entertainment", "client_meals"),
  "Food & Drink|Coffee & Tea": P("meals_entertainment", "client_meals"),
  "Food & Drink|Bakeries": P("meals_entertainment", "client_meals"),
  "Food & Drink|Fast Food": P("meals_entertainment", "client_meals"),
  "Food & Drink|Food Delivery": P("meals_entertainment", "client_meals"),
  "Food & Drink|Groceries": P("meals_entertainment", "team_meals"),
  "Entertainment|Streaming Services": P("technology", "software_subscriptions"),
  "Entertainment|Events & Concerts": P("meals_entertainment", "entertainment"),
  "Entertainment|Gaming": P("meals_entertainment", "entertainment"),
  "Entertainment|Movies & Cinema": P("meals_entertainment", "entertainment"),
  "Utilities|Telecom": P("technology", "telecom_connectivity"),
  "Utilities|Internet": P("technology", "telecom_connectivity"),
  "Utilities|Electricity": P("office_admin", "utilities"),
  "Utilities|Water": P("office_admin", "utilities"),
  "Financial|Banking Fees": P("financial", "bank_charges"),
  "Financial|Insurance": P("financial", "insurance"),
  "Financial|Investments": DEFAULT_PAIR,
  "Health & Wellness|Medical Services": P("people", "wellbeing"),
  "Health & Wellness|Fitness & Gym": P("people", "wellbeing"),
  "Health & Wellness|Optical": P("people", "wellbeing"),
  "Health & Wellness|Pharmacy": P("people", "wellbeing"),
  "Shopping|Electronics": P("technology", "it_equipment"),
  "Shopping|General Retail": DEFAULT_PAIR,
  "Shopping|Beauty & Personal Care": DEFAULT_PAIR,
  "Shopping|Clothing & Apparel": DEFAULT_PAIR,
  "Shopping|Home & Garden": DEFAULT_PAIR,
  "Shopping|Online Marketplaces": DEFAULT_PAIR,
  "Shopping|Department Stores": DEFAULT_PAIR,
  "Shopping|Sports": DEFAULT_PAIR,
  "Other|General": DEFAULT_PAIR,
  "Other|Uncategorized": DEFAULT_PAIR,
};

/** NA file: `NA|${category}` (group-level) → taxonomy pair. */
export const NA_LABEL_MAP: Record<string, TaxonomyPair> = {
  "NA|Supermarkets & Grocery": P("meals_entertainment", "team_meals"),
  "NA|Pharmacies & Health": P("people", "wellbeing"),
  "NA|Electronics & Tech": P("technology", "it_equipment"),
  "NA|Fashion & Apparel": DEFAULT_PAIR,
  "NA|Beauty & Cosmetics": DEFAULT_PAIR,
  "NA|Luxury & Jewellery": DEFAULT_PAIR,
  "NA|Home & Furniture": DEFAULT_PAIR,
  "NA|Sports & Outdoors": DEFAULT_PAIR,
};

export function mapEuLabel(group: string, category: string): { pair: TaxonomyPair; mapped: boolean } {
  const key = `${(group || "").trim()}|${(category || "").trim()}`;
  const pair = EU_LABEL_MAP[key];
  return pair ? { pair, mapped: true } : { pair: DEFAULT_PAIR, mapped: false };
}

export function mapNaLabel(category: string): { pair: TaxonomyPair; mapped: boolean } {
  const key = `NA|${(category || "").trim()}`;
  const pair = NA_LABEL_MAP[key];
  return pair ? { pair, mapped: true } : { pair: DEFAULT_PAIR, mapped: false };
}
