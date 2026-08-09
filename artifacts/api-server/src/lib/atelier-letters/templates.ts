/**
 * Task #845 — Letter templates (EN / AR / TR).
 *
 * Pure functions: LetterContext in → structured letter content out. No
 * DB, no I/O — the PDF generator (pdf.ts) renders the structure onto the
 * Cognirise letterhead. Salary-bearing types state the TOTAL salary
 * (monthly + annual) only; never a component breakdown (user decision).
 *
 * Arabic strings are logical-order; the PDF layer handles RTL rendering.
 */

import { letterTypeById, type LetterLanguage } from "./catalog.js";

export interface LetterContext {
  letterType: string;
  language: LetterLanguage;
  refNumber: string;
  issueDateIso: string; // yyyy-mm-dd
  employeeName: string;
  gender?: "female" | "male" | "unspecified";
  jobTitle: string | null;
  startDateIso: string | null;
  idNumber: string | null;
  idKind: "passport" | "national_id" | null;
  nationality: string | null;
  entityName: string;
  entityAddress: string;
  salaryMonthly: number | null;
  salaryAnnual: number | null;
  currency: string | null;
  addresseeName: string | null;
  addresseeInstitution: string | null;
  purpose: string | null;
  travelStartIso: string | null;
  travelEndIso: string | null;
  destination: string | null;
  hrEmail: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

export interface LetterContent {
  /** Document title line, e.g. "SALARY CERTIFICATE". */
  title: string;
  /** Addressee block lines (may be empty → generic salutation only). */
  addresseeLines: string[];
  /** Salutation, e.g. "Dear Sir/Madam,". */
  salutation: string;
  paragraphs: string[];
  /** Closing line, e.g. "Yours faithfully,". */
  closing: string;
  /** Reference + issue-date labels for the header strip. */
  refLabel: string;
  dateLabel: string;
  /** HR verification footer line. */
  verificationLine: string;
  /** Label above the blank signature block for wet-signature letters. */
  signatureLabel: string;
}

// ------------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------------

const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const MONTHS_TR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

export function formatLetterDate(iso: string | null, lang: LetterLanguage): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  const day = Number(d);
  if (lang === "ar") return `${day} ${MONTHS_AR[mi]} ${y}`;
  if (lang === "tr") return `${day} ${MONTHS_TR[mi]} ${y}`;
  return `${day} ${MONTHS_EN[mi]} ${y}`;
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  const grouped = rounded.toLocaleString("en-US");
  return `${currency} ${grouped}`;
}

function moneyPair(ctx: LetterContext, lang: LetterLanguage): { monthly: string; annual: string } {
  const cur = ctx.currency || "AED";
  return {
    monthly: ctx.salaryMonthly != null ? formatMoney(ctx.salaryMonthly, cur) : "",
    annual: ctx.salaryAnnual != null ? formatMoney(ctx.salaryAnnual, cur) : "",
  };
}

function idClause(ctx: LetterContext, lang: LetterLanguage): string {
  if (!ctx.idNumber) return "";
  if (lang === "ar") {
    return ctx.idKind === "national_id"
      ? `، بطاقة هوية رقم ${ctx.idNumber}`
      : `، جواز سفر رقم ${ctx.idNumber}`;
  }
  if (lang === "tr") {
    return ctx.idKind === "national_id"
      ? `, kimlik numarası ${ctx.idNumber}`
      : `, pasaport numarası ${ctx.idNumber}`;
  }
  return ctx.idKind === "national_id"
    ? `, holder of national ID No. ${ctx.idNumber}`
    : `, holder of passport No. ${ctx.idNumber}`;
}

// ------------------------------------------------------------------
// Language blocks
// ------------------------------------------------------------------

type Lang = {
  salutationGeneric: string;
  toWhom: string;
  closing: string;
  refLabel: string;
  dateLabel: string;
  verification: (hrEmail: string, ref: string) => string;
  signatureLabel: string;
  titles: Record<string, string>;
  base: (ctx: LetterContext) => string; // employment statement paragraph
  salary: (ctx: LetterContext) => string;
  bodies: Record<string, (ctx: LetterContext) => string[]>;
  purposeLine: (purpose: string) => string;
  final: string; // "issued upon request..." paragraph
};

const TITLES_EN: Record<string, string> = {
  salary_cert_bank_loan: "SALARY CERTIFICATE",
  salary_cert_mortgage: "SALARY CERTIFICATE",
  salary_cert_credit_card: "SALARY CERTIFICATE",
  salary_cert_generic: "SALARY CERTIFICATE",
  employment_verification: "EMPLOYMENT VERIFICATION LETTER",
  noc_business_travel_visa: "NO OBJECTION LETTER",
  noc_personal_travel_visa: "NO OBJECTION LETTER",
  salary_transfer_letter: "SALARY TRANSFER LETTER",
  employment_salary_government: "EMPLOYMENT AND SALARY CERTIFICATE",
};

const EN: Lang = {
  salutationGeneric: "Dear Sir/Madam,",
  toWhom: "To Whom It May Concern",
  closing: "Yours faithfully,",
  refLabel: "Ref",
  dateLabel: "Date",
  verification: (hr, ref) =>
    `To verify this letter, please contact our HR department at ${hr} quoting reference ${ref}.`,
  signatureLabel: "Authorised signature and company stamp",
  titles: TITLES_EN,
  base: (ctx) => {
    const since = ctx.startDateIso
      ? ` since ${formatLetterDate(ctx.startDateIso, "en")}`
      : "";
    const title = ctx.jobTitle ? ` in the position of ${ctx.jobTitle}` : "";
    return (
      `This is to certify that ${ctx.employeeName}${idClause(ctx, "en")} is a full-time employee of ` +
      `${ctx.entityName}${title}, employed${since} and currently active on our payroll.`
    );
  },
  salary: (ctx) => {
    const m = moneyPair(ctx, "en");
    return (
      `The employee's total gross salary amounts to ${m.monthly} per month ` +
      `(${m.annual} per annum).`
    );
  },
  purposeLine: (p) => `This letter is issued in connection with: ${p}.`,
  final:
    "This letter is issued at the employee's request without any liability on the company and does not constitute a guarantee or an undertaking of any kind.",
  bodies: {
    salary_cert_bank_loan: () => [
      "This certificate is issued to support the employee's bank loan application.",
    ],
    salary_cert_mortgage: () => [
      "This certificate is issued to support the employee's mortgage / home finance application.",
    ],
    salary_cert_credit_card: () => [
      "This certificate is issued to support the employee's credit card application.",
    ],
    salary_cert_generic: () => [],
    employment_verification: () => [
      "This letter is issued to confirm the employee's employment status with us.",
    ],
    noc_business_travel_visa: (ctx) => [
      `We confirm that the employee will travel on official company business${ctx.destination ? ` to ${ctx.destination}` : ""} ` +
        `from ${formatLetterDate(ctx.travelStartIso, "en")} to ${formatLetterDate(ctx.travelEndIso, "en")}. ` +
        `The company sponsors this trip and bears all related travel expenses.`,
      "We have no objection to the issuance of the required visa. We guarantee that the employee will return to their post with us upon completion of the trip and will continue their employment under the existing contract.",
    ],
    noc_personal_travel_visa: (ctx) => [
      `We confirm that the employee has been granted approved leave for personal travel${ctx.destination ? ` to ${ctx.destination}` : ""} ` +
        `from ${formatLetterDate(ctx.travelStartIso, "en")} to ${formatLetterDate(ctx.travelEndIso, "en")}. ` +
        `The trip is entirely self-funded by the employee.`,
      "We have no objection to the issuance of the required visa. The employee will resume their duties with us at the end of the approved leave and remains employed under the existing contract.",
    ],
    salary_transfer_letter: (ctx) => [
      `We hereby undertake to transfer the employee's monthly salary to their account with ${ctx.addresseeInstitution || "your bank"} ` +
        "for as long as the employee remains in our service.",
      "Should the employee's service with us end for any reason, we will notify the bank and transfer any end-of-service entitlements to the same account, subject to the applicable laws.",
    ],
    employment_salary_government: () => [
      "This certificate is issued for submission to the competent government / immigration authorities.",
    ],
  },
};

const TITLES_AR: Record<string, string> = {
  salary_cert_bank_loan: "شهادة راتب",
  salary_cert_mortgage: "شهادة راتب",
  salary_cert_credit_card: "شهادة راتب",
  salary_cert_generic: "شهادة راتب",
  employment_verification: "شهادة عمل",
  noc_business_travel_visa: "خطاب عدم ممانعة",
  noc_personal_travel_visa: "خطاب عدم ممانعة",
  salary_transfer_letter: "خطاب تحويل راتب",
  employment_salary_government: "شهادة عمل وراتب",
};

const AR: Lang = {
  salutationGeneric: "تحية طيبة وبعد،",
  toWhom: "إلى من يهمه الأمر",
  closing: "وتفضلوا بقبول فائق الاحترام والتقدير،",
  refLabel: "المرجع",
  dateLabel: "التاريخ",
  verification: (hr, ref) =>
    `للتحقق من صحة هذا الخطاب، يرجى التواصل مع إدارة الموارد البشرية عبر البريد الإلكتروني ${hr} مع ذكر الرقم المرجعي ${ref}.`,
  signatureLabel: "التوقيع المعتمد وختم الشركة",
  titles: TITLES_AR,
  base: (ctx) => {
    const since = ctx.startDateIso
      ? ` منذ تاريخ ${formatLetterDate(ctx.startDateIso, "ar")}`
      : "";
    const title = ctx.jobTitle ? ` بوظيفة ${ctx.jobTitle}` : "";
    const honorific = ctx.gender === "female" ? "السيدة" : "السيد";
    return (
      `نشهد نحن ${ctx.entityName} بأن ${honorific}/ ${ctx.employeeName}${idClause(ctx, "ar")} ` +
      `يعمل لدينا بدوام كامل${title}${since}، وما زال على رأس عمله حتى تاريخه.`
    );
  },
  salary: (ctx) => {
    const m = moneyPair(ctx, "ar");
    // No parentheses in Arabic strings — pdfkit's rtla flip does not
    // mirror brackets, so they render backwards. Use a dash clause.
    return `ويتقاضى راتباً إجمالياً شهرياً قدره ${m.monthly}، أي ما يعادل ${m.annual} سنوياً.`;
  },
  purposeLine: (p) => `وقد صدر هذا الخطاب بخصوص: ${p}.`,
  final:
    "وقد أُعطيت هذه الشهادة بناءً على طلب الموظف دون أدنى مسؤولية على الشركة، ولا تُعد ضماناً أو تعهداً من أي نوع.",
  bodies: {
    salary_cert_bank_loan: () => ["وقد صدرت هذه الشهادة لتقديمها ضمن طلب قرض مصرفي."],
    salary_cert_mortgage: () => ["وقد صدرت هذه الشهادة لتقديمها ضمن طلب تمويل عقاري / سكني."],
    salary_cert_credit_card: () => ["وقد صدرت هذه الشهادة لتقديمها ضمن طلب بطاقة ائتمان."],
    salary_cert_generic: () => [],
    employment_verification: () => ["وقد صدر هذا الخطاب لتأكيد قيام علاقة العمل بين الموظف والشركة."],
    noc_business_travel_visa: (ctx) => [
      `نفيدكم بأن الموظف سيسافر في مهمة عمل رسمية${ctx.destination ? ` إلى ${ctx.destination}` : ""} ` +
        `خلال الفترة من ${formatLetterDate(ctx.travelStartIso, "ar")} إلى ${formatLetterDate(ctx.travelEndIso, "ar")}، ` +
        `وتتحمل الشركة كافة نفقات هذه الرحلة.`,
      "وليس لدينا أي مانع من منح الموظف التأشيرة المطلوبة، ونؤكد عودته إلى عمله لدينا فور انتهاء المهمة واستمراره في عمله بموجب عقد العمل الساري.",
    ],
    noc_personal_travel_visa: (ctx) => [
      `نفيدكم بأن الموظف حاصل على إجازة معتمدة لسفر شخصي${ctx.destination ? ` إلى ${ctx.destination}` : ""} ` +
        `خلال الفترة من ${formatLetterDate(ctx.travelStartIso, "ar")} إلى ${formatLetterDate(ctx.travelEndIso, "ar")}، ` +
        `وتكون نفقات الرحلة على حسابه الخاص بالكامل.`,
      "وليس لدينا أي مانع من منح الموظف التأشيرة المطلوبة، وسيستأنف عمله لدينا فور انتهاء الإجازة المعتمدة وفقاً لعقد العمل الساري.",
    ],
    salary_transfer_letter: (ctx) => [
      `نتعهد بتحويل الراتب الشهري للموظف إلى حسابه لدى ${ctx.addresseeInstitution || "مصرفكم"} طوال مدة عمله لدينا.`,
      "وفي حال انتهاء خدمة الموظف لدينا لأي سبب، سنقوم بإخطار المصرف وتحويل مستحقات نهاية الخدمة إلى الحساب ذاته وفقاً للقوانين المعمول بها.",
    ],
    employment_salary_government: () => [
      "وقد صدرت هذه الشهادة لتقديمها إلى الجهات الحكومية / سلطات الإقامة والهجرة المختصة.",
    ],
  },
};

const TITLES_TR: Record<string, string> = {
  salary_cert_bank_loan: "MAAŞ BELGESİ",
  salary_cert_mortgage: "MAAŞ BELGESİ",
  salary_cert_credit_card: "MAAŞ BELGESİ",
  salary_cert_generic: "MAAŞ BELGESİ",
  employment_verification: "ÇALIŞMA BELGESİ",
  noc_business_travel_visa: "MUVAFAKATNAME",
  noc_personal_travel_visa: "MUVAFAKATNAME",
  salary_transfer_letter: "MAAŞ TRANSFER YAZISI",
  employment_salary_government: "ÇALIŞMA VE MAAŞ BELGESİ",
};

const TR: Lang = {
  salutationGeneric: "Sayın Yetkili,",
  toWhom: "İlgili Makama",
  closing: "Saygılarımızla,",
  refLabel: "Referans",
  dateLabel: "Tarih",
  verification: (hr, ref) =>
    `Bu belgenin doğruluğunu teyit etmek için ${ref} referans numarasını belirterek İnsan Kaynakları departmanımızla ${hr} adresinden iletişime geçebilirsiniz.`,
  signatureLabel: "Yetkili imza ve şirket kaşesi",
  titles: TITLES_TR,
  base: (ctx) => {
    const since = ctx.startDateIso
      ? `${formatLetterDate(ctx.startDateIso, "tr")} tarihinden bu yana `
      : "";
    const title = ctx.jobTitle ? `${ctx.jobTitle} pozisyonunda ` : "";
    return (
      `${ctx.employeeName}${idClause(ctx, "tr")}, ${since}şirketimiz ${ctx.entityName} bünyesinde ` +
      `${title}tam zamanlı olarak çalışmakta olup halen görevine devam etmektedir.`
    );
  },
  salary: (ctx) => {
    const m = moneyPair(ctx, "tr");
    return `Çalışanın toplam brüt maaşı aylık ${m.monthly} (yıllık ${m.annual}) tutarındadır.`;
  },
  purposeLine: (p) => `Bu belge şu amaçla düzenlenmiştir: ${p}.`,
  final:
    "Bu belge, çalışanın talebi üzerine ve şirketimize herhangi bir yükümlülük doğurmaksızın düzenlenmiş olup hiçbir şekilde kefalet veya taahhüt niteliği taşımaz.",
  bodies: {
    salary_cert_bank_loan: () => ["Bu belge, çalışanın banka kredisi başvurusunda kullanılmak üzere düzenlenmiştir."],
    salary_cert_mortgage: () => ["Bu belge, çalışanın konut kredisi / mortgage başvurusunda kullanılmak üzere düzenlenmiştir."],
    salary_cert_credit_card: () => ["Bu belge, çalışanın kredi kartı başvurusunda kullanılmak üzere düzenlenmiştir."],
    salary_cert_generic: () => [],
    employment_verification: () => ["Bu belge, çalışanın şirketimizdeki istihdam durumunu teyit etmek amacıyla düzenlenmiştir."],
    noc_business_travel_visa: (ctx) => [
      `Çalışanımız, ${formatLetterDate(ctx.travelStartIso, "tr")} – ${formatLetterDate(ctx.travelEndIso, "tr")} tarihleri arasında ` +
        `şirketimiz adına resmi iş seyahati${ctx.destination ? ` (${ctx.destination})` : ""} gerçekleştirecektir. ` +
        `Seyahat şirketimiz tarafından desteklenmekte olup tüm masraflar şirketimizce karşılanacaktır.`,
      "Gerekli vizenin verilmesinde herhangi bir sakınca görmediğimizi, çalışanın seyahat sonunda görevine döneceğini ve mevcut iş sözleşmesi kapsamında çalışmaya devam edeceğini beyan ederiz.",
    ],
    noc_personal_travel_visa: (ctx) => [
      `Çalışanımıza, ${formatLetterDate(ctx.travelStartIso, "tr")} – ${formatLetterDate(ctx.travelEndIso, "tr")} tarihleri arasında ` +
        `kişisel seyahati${ctx.destination ? ` (${ctx.destination})` : ""} için onaylı izin verilmiştir. ` +
        `Seyahat masrafları tamamen çalışanın kendisi tarafından karşılanacaktır.`,
      "Gerekli vizenin verilmesinde herhangi bir sakınca görmediğimizi, çalışanın izin bitiminde görevine döneceğini ve iş sözleşmesinin devam ettiğini beyan ederiz.",
    ],
    salary_transfer_letter: (ctx) => [
      `Çalışanımız şirketimizde görev yaptığı sürece aylık maaşının ${ctx.addresseeInstitution || "bankanız"} nezdindeki hesabına aktarılacağını taahhüt ederiz.`,
      "Çalışanın işten ayrılması halinde bankanız bilgilendirilecek ve kıdem/ihbar dahil hak edişleri, yürürlükteki mevzuata uygun olarak aynı hesaba aktarılacaktır.",
    ],
    employment_salary_government: () => [
      "Bu belge, ilgili resmi kurumlara / göç ve ikamet makamlarına sunulmak üzere düzenlenmiştir.",
    ],
  },
};

const LANGS: Record<LetterLanguage, Lang> = { en: EN, ar: AR, tr: TR };

// ------------------------------------------------------------------
// Composition
// ------------------------------------------------------------------

export function buildLetterContent(ctx: LetterContext): LetterContent {
  const def = letterTypeById(ctx.letterType);
  if (!def) throw new Error(`unknown letter type: ${ctx.letterType}`);
  const L = LANGS[ctx.language];
  if (!L) throw new Error(`unknown letter language: ${ctx.language}`);

  const addresseeLines: string[] = [];
  if (ctx.addresseeName) addresseeLines.push(ctx.addresseeName);
  if (ctx.addresseeInstitution) addresseeLines.push(ctx.addresseeInstitution);
  if (addresseeLines.length === 0) addresseeLines.push(L.toWhom);

  const paragraphs: string[] = [L.base(ctx)];
  if (def.salaryBearing && ctx.salaryMonthly != null) paragraphs.push(L.salary(ctx));
  paragraphs.push(...(L.bodies[ctx.letterType]?.(ctx) ?? []));
  if (ctx.purpose) paragraphs.push(L.purposeLine(ctx.purpose));
  paragraphs.push(L.final);

  return {
    title: L.titles[ctx.letterType] ?? def.label.toUpperCase(),
    addresseeLines,
    salutation: L.salutationGeneric,
    paragraphs,
    closing: L.closing,
    refLabel: L.refLabel,
    dateLabel: L.dateLabel,
    verificationLine: L.verification(ctx.hrEmail, ctx.refNumber),
    signatureLabel: L.signatureLabel,
  };
}
