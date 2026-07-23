# Apple App Store Submission — Prepared Answers

**App:** Atelier (Cognirise employee portal companion)
**Platform:** iOS, built with Expo (submitted via Replit's Expo Launch flow / App Store Connect)
**Last updated:** July 23, 2026

This document lists every question Apple asks during App Store submission, in the order you encounter it, with a ready-to-paste answer for each. Answers are based on an audit of what the app actually does — see "App Audit Summary" at the end.

---

## ☑️ Checklist: things only YOU can provide

Before starting, gather these — Apple will ask for them and they cannot be prepared for you:

- [x] **Apple Developer account** (paid, $99/yr) — ✅ decision made: launching under Mounir's personal (Individual) Apple Developer account, with a planned **app transfer** to a Cognirise Organization account later. Notes: the app will initially show the individual's name as the seller on the App Store; app transfer between accounts is supported by Apple (App Store Connect → App Information → Transfer App) and keeps ratings/downloads, but both accounts must be in good standing and the Organization enrollment needs a D-U-N-S number for Cognirise — worth starting that enrollment early since D-U-N-S verification can take weeks.
- [x] **Bundle identifier** — ✅ `com.cognirise.atelier` (set in `app.json` under `ios.bundleIdentifier`; still needs to be registered in your Apple Developer account).
- [x] **Support URL** — ✅ built into the Atelier app itself: `https://<your published Atelier domain>/support` (public, no login required). Replace `<your published Atelier domain>` with the domain of your published Atelier deployment (e.g. `atelier-xyz.replit.app` or a custom domain).
- [x] **Marketing URL** — ✅ `https://cognirise.ai`.
- [x] **Privacy Policy URL** (required) — ✅ built into the Atelier app itself: `https://<your published Atelier domain>/privacypolicy` (public, no login required; source text in `docs/atelier-privacy-policy.md`).
- [ ] **Company contact info for the DSA trader declaration** — legal business address, phone number, and email (published on your EU App Store page).
- [x] **App Review contact** — ✅ Mounir Ariss, `mounir@cognirise.ai`, +971 50 650 4416.
- [x] **Demo account** — ✅ ready: `demo@cognirise.ai` / `demoact!23` (read-only; see Section 8).
- [x] **Copyright line** — ✅ `Copyright © Cognirise AI. All Rights Protected and Reserved.`
- [ ] **Screenshots** — 6.9" iPhone screenshots (out of scope for this document, but required to submit).

---

## 1. App Information

| Field | Answer |
|---|---|
| **App Name** (30 chars) | `Atelier by Cognirise` — "Atelier" alone is likely taken/too generic; the suffix also disambiguates. Alternative: `Cognirise Atelier`. |
| **Subtitle** (30 chars) | `Cognirise employee portal` |
| **Primary Language** | English (U.S.) or English (U.K.) — your choice. |
| **Bundle ID** | Your registered bundle ID (see checklist). |
| **SKU** | `atelier-mobile-001` (internal only, never shown to users). |
| **Primary Category** | **Business** — it is an internal business/CRM tool for firm partners and staff. |
| **Secondary Category** (optional) | **Productivity** |
| **Content Rights** — "Does your app contain, show, or access third-party content?" | **No** — all content is the firm's own business data entered by its own users. The app does not display licensed or scraped third-party content. |
| **License Agreement** | Use Apple's standard EULA (default) unless you have your own. |

### Promotional / description text (ready to paste)

**Promotional text** (170 chars):
> The Atelier companion app for Cognirise partners and staff — chat with your firm's AI assistant, capture expenses, and manage your day from anywhere.

**Description**:
> Atelier is the mobile companion to The Atelier, Cognirise's internal employee portal. It is intended exclusively for Cognirise partners, employees, and contractors with an existing account issued by the firm.
>
> With Atelier you can:
> • Chat with the firm's AI assistant about accounts, opportunities, meetings, and tasks
> • Capture expense receipts with your camera and submit claims on the go — even offline
> • See your meetings and calendar, with optional local reminders before each meeting
> • View your profile, personal documents, and payslips, and share your digital business card via QR code
> • Contractors can review and manage self-billing invoices
>
> A Cognirise account is required. Accounts are provisioned by the firm — there is no public sign-up.

**Keywords** (100 chars):
> `cognirise,employee,portal,crm,expenses,receipts,consulting,firm,assistant,business`

---

## 2. Age Rating Questionnaire

Apple's updated (July 2025) questionnaire uses tiers **4+, 9+, 13+, 16+, 18+**. Answer **None / No** to every content question — the app contains only business data:

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Contests | None |
| **Unrestricted Web Access** | **No** — the app has no built-in general-purpose browser. |
| **Gambling** (real money) | No |
| **User-Generated Content / user communication** | Answer **No** for public UGC. The chat is a private 1:1 assistant within a closed workforce, not user-to-user public content. |
| **In-app purchases** | No |
| **Does the app include AI chat?** (newer question about generative AI) | Yes — an AI assistant, but restricted to business data and available only to authenticated employees. If asked whether the AI can produce mature content: No (business-scoped assistant). |
| **Minimum age requirement** (optional override) | You may voluntarily set a higher rating. Recommendation: leave the computed rating, or set **18+** since it is a workplace tool for employed adults — cosmetic either way for an unlisted/business app. |

**Expected computed rating: 4+** (no objectionable content). Setting it higher is optional.

---

## 3. App Privacy ("Nutrition Labels")

**Privacy Policy URL:** `https://<your published Atelier domain>/privacypolicy` — served publicly by the Atelier web app itself (no login required). Verify it loads in a logged-out browser after the next Publish.

### Step 1 — "Do you or your third-party partners collect data from this app?"
**Answer: Yes** (the app sends login credentials, profile data, expenses, receipts, documents, and chat content to Cognirise's own server).

There are **no third-party analytics, advertising, or tracking SDKs** in the app — only Cognirise's own API.

### Step 2 — Data types collected

Declare the following. For **every** type below, the follow-up answers are the same:

- **Usage purposes:** App Functionality (only)
- **Linked to the user's identity:** **Yes** (everything is tied to the employee's account)
- **Used for tracking:** **No** (nothing is shared with data brokers or used for cross-app advertising)

| Category | Sub-type | Why (what the app actually does) |
|---|---|---|
| Contact Info | **Name** | Employee profile, business-card QR code |
| Contact Info | **Email Address** | Login identity, profile, business card |
| Contact Info | **Phone Number** | Profile / business card (if the employee has one on file) |
| User Content | **Photos or Videos** | Receipt photos, profile photo, chat image attachments |
| User Content | **Other User Content** | Chat messages with the AI assistant; documents attached in chat and expenses (PDFs) |
| Identifiers | **User ID** | Account/session identifier used to authenticate API calls |
| Financial Info | **Other Financial Info** | Expense claims, receipt amounts, payslip/pay info viewed in the app; contractors' self-billing invoices |
| Sensitive Info *(optional but safest to declare)* | | Personal identity documents (passport/visa/national ID) can be viewed/shared through the app. If you prefer a narrower label, these are only *displayed* (fetched to service the user's own request) — but declaring is the conservative choice since documents can be uploaded through the web portal ecosystem. **Recommendation: declare.** |

**Data types NOT collected — do not declare:**

- **Location** — `expo-location` is present in dependencies but **never used** in the app; there is no location permission prompt and no location data collected. *(Recommended: remove the `expo-location` package before building, so the binary carries no location capability at all — Apple's automated scan flags declared-but-unexplained frameworks.)*
- Health & Fitness, Contacts (address book), Browsing History, Search History, Purchases, Diagnostics/crash data (no crash SDK), Usage/analytics data (no analytics SDK), Advertising Data.

### Step 3 — Tracking
**"Is any data used to track users across apps and websites owned by other companies?" → No.**
The app therefore does **not** need the App Tracking Transparency (ATT) prompt.

### Privacy manifest / permission strings (build-time, not questions, but Apple checks them)
Make sure `app.json` → `ios.infoPlist` includes purpose strings before building:
- `NSCameraUsageDescription`: "Atelier uses the camera to capture photos of expense receipts."
- `NSPhotoLibraryUsageDescription`: "Atelier accesses your photo library so you can attach receipt photos, chat images, and a profile photo."
- (Notifications are local-only; the standard notification permission prompt covers meeting reminders.)

---

## 4. Export Compliance (Encryption)

**Question:** "Does your app use encryption?" / `ITSAppUsesNonExemptEncryption`

**Answer:** The app uses **only standard, exempt encryption** — HTTPS/TLS provided by the operating system for API calls, and the OS keychain (secure store) for the session token. It implements no proprietary or non-standard cryptography.

- In App Store Connect: answer **Yes, uses encryption → Yes, it qualifies for the exemption** (standard encryption per category 5, part 2 exemptions).
- Best practice: add `"ITSAppUsesNonExemptEncryption": false` under `ios.infoPlist` in `app.json` so the question never blocks a build upload.
- No French import declaration or annual self-classification report is needed for exempt-only apps under current rules.

---

## 5. Government / News

- **"Is your app a government app / developed on behalf of a government entity?"** → **No.**
- **News-related questions** (if the Business category triggers them): the app is not a news app → **No / Not applicable**.

---

## 6. EU Digital Services Act — Trader Status

Apple asks every submitter to declare trader status, even if you don't target the EU.

**Answer: Yes, I am a trader** — Cognirise distributes this app in connection with its commercial activity. (Answering "not a trader" is only for hobbyists/non-commercial developers.)

You will need to supply and verify (Apple sends verification codes):
- Legal business **address** — *(you supply)*
- **Phone number** — *(you supply)*
- **Email address** — *(you supply)*

This contact info is **published on your EU App Store product page**. Use a business address/phone/email, not personal ones. If you don't want the app available in the EU at all, you can deselect all 27 EU territories under Pricing & Availability, but you must still answer the trader question.

---

## 7. Pricing & Availability

| Question | Answer |
|---|---|
| **Price** | **Free** (internal tool; employees never pay). |
| **Availability** | Your choice. Simplest: all territories. If you want to minimize exposure, limit to the countries where Cognirise staff are based (e.g. UAE, UK, Turkey, plus travel destinations). |
| **Pre-order** | No. |
| **App distribution method** — consider **"Unlisted App Distribution"** | ⚠️ **Recommended decision point:** Since Atelier is only for Cognirise staff, Apple's **Unlisted Distribution** is a strong fit — the app is approved via normal App Review but only reachable via a direct link, never in search results. You request it via a short form ([developer.apple.com/support/unlisted-app-distribution](https://developer.apple.com/support/unlisted-app-distribution/)) **after** creating the app record, ideally before first submission. If you prefer a normal public listing, no action needed. |

---

## 8. Sign-In Requirement & Demo Account for App Review

**Question:** "Sign-in required?" → **Yes.** Apple requires working credentials so reviewers can see past the login screen.

✅ **Ready — a dedicated read-only review account exists.** It is created automatically on every server boot (so it will exist in production after the next Publish) and is production-safe by design:

- **Restricted persona:** an "employee" self-service role — the reviewer sees only the demo account's own Me-lens surfaces (profile, expenses, calendar, documents). No firm CRM, client, or financial data is visible.
- **Strictly read-only:** every create/change/delete attempt (any POST/PATCH/PUT/DELETE, including chat messages and uploads) is rejected server-side with a clear "demo account is read-only" error. Only logging in and out works.
- **Cannot be bricked:** the password never rotates (password changes are blocked for this account, and the boot seed repairs the credential on every restart), and no forced password-change screen ever triggers.

**Demo credentials to enter in App Store Connect:**
- Username: `demo@cognirise.ai`
- Password: `demoact!23`

Note: because the account is read-only and there is no seeded demo data, its screens are mostly empty — that is expected and consistent with the review notes below (internal business tool). If you prefer richer screens, you can instead provision a normal employee account through the HR flow, but the read-only demo account is the safe default.

---

## 9. App Review Information & Notes

**Contact:** Mounir Ariss · `mounir@cognirise.ai` · +971 50 650 4416

**Notes for App Review (ready to paste):**

> Atelier is an internal business tool: the mobile companion to Cognirise's employee portal. It is intended solely for Cognirise partners, employees, and contractors; accounts are provisioned by the firm and there is no public registration.
>
> Please sign in with the demo credentials provided. The demo account is a restricted, read-only employee account: you can browse every screen an employee sees (profile, expenses, calendar, documents, the AI assistant surface), but for data-safety reasons all write actions (submitting expenses, sending chat messages, editing the profile) return a clear "demo account is read-only" message. Real employee accounts have full write access to their own data.
>
> Notes:
> • The AI assistant answers questions about the signed-in user's own work data only. It calls our own backend; no third-party accounts are needed.
> • Notifications are local-only reminders for the user's meetings; there are no push notifications.
> • The camera and photo library are used only for expense receipts, chat attachments, and the profile photo.
> • There are no in-app purchases, ads, analytics, or tracking.

---

## 10. Version Release & Other Final Screens

| Question | Answer |
|---|---|
| **Version number** | `1.0.1` (matches `app.json`). |
| **Copyright** | `Copyright © Cognirise AI. All Rights Protected and Reserved.` |
| **Release option** | **Manually release this version** — recommended for a first release so you control the go-live moment. |
| **Phased release** | Not applicable/off for a first release. |
| **Reset iOS app summary rating** (updates only) | N/A for v1. |
| **Sign in with Apple requirement** | **Not required.** Apple's rule only forces Sign in with Apple when an app offers *third-party* social logins (Google/Facebook). Atelier uses only its own enterprise email+password login, which is explicitly exempt. |
| **Account deletion requirement (Guideline 5.1.1(v))** | Apps with account *creation* must offer in-app account deletion. Atelier has **no in-app account creation** (accounts are employer-provisioned), which falls under Apple's enterprise-account exception. If a reviewer asks, respond: "Accounts are created and managed by the employer (Cognirise) for its workforce; there is no consumer sign-up. Employees can request account removal through the firm per Guideline 5.1.1(v)'s exception for accounts tied to an organization." |

---

## Replit Expo Launch flow — specifics

When publishing via Replit's mobile flow you'll additionally be asked for (all covered above or in the checklist):
- Apple Developer account login / App-Specific Password or API key for upload.
- **Bundle identifier** — ✅ set in `app.json` (`ios.bundleIdentifier: com.cognirise.atelier`); still needs to be registered to your Apple team before the build.
- **ASC App ID** — created automatically when you make the app record in App Store Connect.
- App icon: already present and alpha-free (App Store requirement) ✅.
- Version/build number: `1.0.1`; the flow manages `ios.buildNumber` increments.

---

## Appendix: App Audit Summary (what the answers are based on)

Audited July 23, 2026 against the mobile codebase:

- **Login:** email + password to Cognirise's own API; session token stored in the iOS keychain via secure store. No third-party or social login.
- **Camera / photos:** receipt capture in expense creation; profile photo picker; image attachments in chat.
- **Documents:** PDF picker for expense invoices and chat attachments; viewing/sharing of personal documents (passport/visa/ID, payslips) fetched from the portal.
- **Notifications:** local-only meeting reminders (opt-in, off by default). No push notification registration.
- **Location:** `expo-location` is in dependencies but **unused** — no location code anywhere. Recommend removing the package before the store build.
- **Offline:** expenses queue locally when offline and sync when connectivity returns (network-state check only).
- **Sharing / QR:** system share sheet for the user's own documents and invoices; vCard QR code of the user's own business contact details.
- **No** analytics, ads, tracking, crash-reporting SDKs, in-app purchases, or third-party data sharing. All data goes only to Cognirise's own backend.
- **No** in-app account creation or deletion (employer-managed accounts).
