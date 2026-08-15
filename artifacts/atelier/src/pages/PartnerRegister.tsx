import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";

/**
 * Task #874 / Task #1172 — public, token-gated partner registration.
 *
 * A signed partner firm's invited user follows a single-use, 72-hour
 * registration link from their email to this page. It is a multi-step wizard:
 *  1. confirm the firm's company legal details,
 *  2. declare their own contact people (name/role/email),
 *  3. upload firm documents (trade license, certificates, insurance, VAT/TRN,
 *     signatory ID, other) — uploaded immediately and resumable across refresh,
 *  4. submit bank details for payments (PENDING until finance approves), and
 *  5. choose their own password and complete registration.
 *
 * Rendered pre-auth (the AuthGate special-cases /partner-register). The page
 * itself validates the token via /api/auth/partner-register-info. Document
 * uploads and deletes validate the token WITHOUT consuming it.
 */

/** Wire doc shape shared with the portal + internal review surfaces. */
type Doc = {
  id: string;
  kind: string;
  title: string | null;
  fileName: string;
  sizeBytes: number;
  issuedDate: string | null;
  expiryDate: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
  createdAt: string;
};

type Contact = { id?: string; name: string; role?: string | null; email?: string | null };

const DOC_KINDS: { value: string; label: string }[] = [
  { value: "trade_license", label: "Trade license" },
  { value: "certificate", label: "Certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "vat_trn", label: "VAT / TRN registration" },
  { value: "signatory_id", label: "Signatory ID" },
  { value: "other", label: "Other" },
];

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MIME_ALLOW = ["application/pdf", "image/png", "image/jpeg"];

function docKindLabel(kind: string): string {
  return DOC_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a File to a bare base64 string (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") return reject(new Error("Could not read the file."));
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.readAsDataURL(file);
  });
}

export default function PartnerRegister() {
  const token = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("token") ?? "";
    } catch {
      return "";
    }
  }, []);

  const [info, setInfo] = React.useState<{
    email: string;
    firm: {
      name: string;
      legalName: string | null;
      registrationNumber: string | null;
      taxId: string | null;
      registeredAddress: string | null;
      defaultCurrency: string | null;
    };
  } | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Wizard step (1..5)
  const [step, setStep] = React.useState(1);

  // Company details
  const [legalName, setLegalName] = React.useState("");
  const [registrationNumber, setRegistrationNumber] = React.useState("");
  const [taxId, setTaxId] = React.useState("");
  const [registeredAddress, setRegisteredAddress] = React.useState("");
  // Contacts
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  // Documents
  const [documents, setDocuments] = React.useState<Doc[]>([]);
  // Bank details
  const [iban, setIban] = React.useState("");
  const [swift, setSwift] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  // Password
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const refreshDocuments = React.useCallback(() => {
    if (!token) return;
    fetch(`/api/auth/partner-register-documents?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { documents?: Doc[] } | null;
        if (r.ok && Array.isArray(j?.documents)) setDocuments(j!.documents);
      })
      .catch(() => {
        /* documents endpoint may 404 until the server lands — ignore */
      });
  }, [token]);

  React.useEffect(() => {
    if (!token) {
      setInvalid("This registration link is missing its token.");
      setLoading(false);
      return;
    }
    fetch(`/api/auth/partner-register-info?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | {
              ok?: boolean;
              email?: string;
              message?: string;
              firm?: {
                name: string;
                legalName: string | null;
                registrationNumber: string | null;
                taxId: string | null;
                registeredAddress: string | null;
                defaultCurrency: string | null;
              };
              documents?: Doc[];
              contacts?: Contact[];
            }
          | null;
        if (r.ok && j?.email && j.firm) {
          setInfo({ email: j.email, firm: j.firm });
          setLegalName(j.firm.legalName ?? j.firm.name ?? "");
          setRegistrationNumber(j.firm.registrationNumber ?? "");
          setTaxId(j.firm.taxId ?? "");
          setRegisteredAddress(j.firm.registeredAddress ?? "");
          setCurrency(j.firm.defaultCurrency ?? "");
          if (Array.isArray(j.documents)) setDocuments(j.documents);
          if (Array.isArray(j.contacts) && j.contacts.length > 0) {
            setContacts(j.contacts.map((c) => ({ ...c })));
          }
        } else {
          setInvalid(j?.message ?? "This registration link is invalid, expired, or already used.");
        }
      })
      .catch(() => setInvalid("Could not reach the server. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  // ---- contacts helpers ----
  const addContact = () => setContacts((cs) => [...cs, { name: "", role: "", email: "" }]);
  const removeContact = (i: number) => setContacts((cs) => cs.filter((_, idx) => idx !== i));
  const setContact = (i: number, patch: Partial<Contact>) =>
    setContacts((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  // ---- document upload ----
  const [upKind, setUpKind] = React.useState("trade_license");
  const [upTitle, setUpTitle] = React.useState("");
  const [upIssued, setUpIssued] = React.useState("");
  const [upExpiry, setUpExpiry] = React.useState("");
  const [upFile, setUpFile] = React.useState<File | null>(null);
  const [upBusy, setUpBusy] = React.useState(false);
  const [upErr, setUpErr] = React.useState<string | null>(null);
  const upFileRef = React.useRef<HTMLInputElement>(null);

  const uploadDoc = async () => {
    setUpErr(null);
    if (!upFile) return setUpErr("Choose a file to upload.");
    if (!MIME_ALLOW.includes(upFile.type)) {
      return setUpErr("Only PDF, PNG or JPEG files are accepted.");
    }
    if (upFile.size > MAX_BYTES) {
      return setUpErr("File is larger than 10MB.");
    }
    setUpBusy(true);
    try {
      const base64 = await fileToBase64(upFile);
      const r = await fetch("/api/auth/partner-register-upload", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          kind: upKind,
          fileName: upFile.name,
          mime: upFile.type,
          base64,
          title: upTitle.trim() || null,
          issuedDate: upIssued || null,
          expiryDate: upExpiry || null,
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; document?: Doc; message?: string } | null;
      if (r.ok && j?.ok && j.document) {
        setDocuments((ds) => [...ds, j.document as Doc]);
        setUpTitle("");
        setUpIssued("");
        setUpExpiry("");
        setUpFile(null);
        if (upFileRef.current) upFileRef.current.value = "";
      } else {
        setUpErr(
          r.status === 429
            ? "Too many uploads. Please wait a moment and try again."
            : (j?.message ?? "Upload failed. Please try again."),
        );
      }
    } catch {
      setUpErr("Could not upload the file. Please try again.");
    } finally {
      setUpBusy(false);
    }
  };

  const deleteDoc = async (id: string) => {
    const prev = documents;
    setDocuments((ds) => ds.filter((d) => d.id !== id));
    try {
      const r = await fetch("/api/auth/partner-register-document", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, documentId: id }),
      });
      if (!r.ok) {
        setDocuments(prev);
        refreshDocuments();
      }
    } catch {
      setDocuments(prev);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!legalName.trim()) {
      setStep(1);
      return setError("Company legal name is required.");
    }
    const ibanNorm = iban.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{8,34}$/.test(ibanNorm)) {
      setStep(4);
      return setError("Enter a valid IBAN (8–34 characters, letters and digits).");
    }
    if (!bankName.trim()) {
      setStep(4);
      return setError("Bank name is required.");
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      setStep(4);
      return setError("Currency must be a 3-letter code (e.g. AED, USD).");
    }
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const cleanContacts = contacts
        .map((c) => ({
          name: c.name.trim(),
          role: (c.role ?? "").trim() || null,
          email: (c.email ?? "").trim() || null,
        }))
        .filter((c) => c.name.length > 0);
      const r = await fetch("/api/auth/partner-register", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: password,
          company: {
            legalName: legalName.trim(),
            registrationNumber: registrationNumber.trim() || null,
            taxId: taxId.trim() || null,
            registeredAddress: registeredAddress.trim() || null,
          },
          bank: {
            iban: ibanNorm,
            swift: swift.trim() || null,
            bankName: bankName.trim(),
            currency: currency.trim().toUpperCase(),
          },
          contacts: cleanContacts,
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (r.ok && j?.ok) {
        setDone(true);
        return;
      }
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : (j?.message ?? "Registration failed. Ask your Cognirise contact for a new link."),
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full glass-surface border border-border-soft rounded px-3 py-2 text-text text-sm focus:outline-none focus:ring-1 focus:ring-gold/40";
  const labelCls = "block text-xs font-mono uppercase tracking-wider text-text-faint";
  const headCls = "text-xs font-mono uppercase tracking-widest text-gold";

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts?: { required?: boolean; placeholder?: string; hint?: string; type?: string; autoComplete?: string },
  ) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelCls}>
        {label}
        {opts?.required ? " *" : ""}
      </label>
      <input
        id={id}
        data-testid={`input-${id}`}
        type={opts?.type ?? "text"}
        required={opts?.required}
        placeholder={opts?.placeholder}
        autoComplete={opts?.autoComplete ?? "off"}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={inputCls}
      />
      {opts?.hint && <p className="text-[11px] text-text-faint">{opts.hint}</p>}
    </div>
  );

  const STEPS = [
    { n: 1, label: "Company" },
    { n: 2, label: "Contacts" },
    { n: 3, label: "Documents" },
    { n: 4, label: "Bank" },
    { n: 5, label: "Password" },
  ];

  // Per-step forward validation.
  const canAdvance = (): string | null => {
    if (step === 1 && !legalName.trim()) return "Company legal name is required.";
    if (step === 4) {
      const ibanNorm = iban.replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9]{8,34}$/.test(ibanNorm)) return "Enter a valid IBAN (8–34 characters).";
      if (!bankName.trim()) return "Bank name is required.";
      if (!/^[A-Za-z]{3}$/.test(currency.trim())) return "Currency must be a 3-letter code.";
    }
    return null;
  };

  const goNext = () => {
    const e = canAdvance();
    if (e) return setError(e);
    setError(null);
    setStep((s) => Math.min(5, s + 1));
  };
  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="min-h-screen text-text flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-md space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={<>Register your firm on the <em className="accent">partner portal</em></>}
            lede="Cognirise alliance partners"
            className="flex flex-col items-center text-center"
          />
        </div>

        {loading && (
          <p className="text-center font-mono text-xs uppercase tracking-widest text-text-faint">
            Checking your registration link…
          </p>
        )}

        {!loading && invalid && (
          <div className="space-y-4 text-center" data-testid="partner-register-invalid">
            <p className="text-sm text-text-mute">{invalid}</p>
            <a href="/sign-in" className="text-sm text-gold underline underline-offset-4">
              Go to sign in
            </a>
          </div>
        )}

        {!loading && !invalid && done && (
          <div className="space-y-4 text-center" data-testid="partner-register-done">
            <p className="text-sm text-text-mute">
              Registration complete. Your company details and documents were saved, and your bank
              details were submitted for review by the Cognirise finance team. Sign in with your
              email and the password you just chose.
            </p>
            <a
              href="/sign-in"
              className="inline-block bg-gold text-bg font-medium rounded px-6 py-2 text-sm"
              data-testid="partner-register-goto-signin"
            >
              Sign in
            </a>
          </div>
        )}

        {!loading && !invalid && !done && info && (
          <div className="space-y-6" data-testid="partner-register-form">
            <p className="text-sm text-text-mute text-center">
              Registering <span className="text-text font-medium">{info.firm.name}</span> as{" "}
              <span className="text-text font-medium">{info.email}</span>.
            </p>

            {/* Progress indicator */}
            <div className="flex items-center justify-between" data-testid="partner-register-steps">
              {STEPS.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => {
                    // allow jumping back to any earlier step freely
                    if (s.n <= step) {
                      setError(null);
                      setStep(s.n);
                    }
                  }}
                  className="flex flex-col items-center gap-1 flex-1"
                  data-testid={`step-tab-${s.n}`}
                >
                  <span
                    className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-mono border ${
                      s.n === step
                        ? "bg-gold text-bg border-gold"
                        : s.n < step
                          ? "border-gold/60 text-gold"
                          : "border-border-soft text-text-faint"
                    }`}
                  >
                    {s.n}
                  </span>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider ${
                      s.n === step ? "text-gold" : "text-text-faint"
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Step 1 — Company details */}
            {step === 1 && (
              <div className="space-y-4" data-testid="step-company">
                <div className={headCls}>Company details</div>
                {field("legal-name", "Legal name", legalName, setLegalName, { required: true })}
                {field("registration-number", "Registration number", registrationNumber, setRegistrationNumber)}
                {field("tax-id", "Tax / VAT ID", taxId, setTaxId)}
                <div className="space-y-1.5">
                  <label htmlFor="registered-address" className={labelCls}>
                    Registered address
                  </label>
                  <textarea
                    id="registered-address"
                    data-testid="input-registered-address"
                    rows={2}
                    value={registeredAddress}
                    onChange={(e) => setRegisteredAddress(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            )}

            {/* Step 2 — Contact people */}
            {step === 2 && (
              <div className="space-y-4" data-testid="step-contacts">
                <div className={headCls}>Contact people</div>
                <p className="text-[11px] text-text-faint">
                  Add the people at your firm who will work with Cognirise. You can add or remove
                  people; leave this empty if you'd rather do it later.
                </p>
                <div className="space-y-3">
                  {contacts.map((c, i) => (
                    <div
                      key={i}
                      className="glass-surface border border-border-soft rounded p-3 space-y-2"
                      data-testid={`contact-row-${i}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-text-faint">
                          Person {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeContact(i)}
                          className="text-[11px] font-mono uppercase tracking-widest text-danger hover:underline"
                          data-testid={`button-remove-contact-${i}`}
                        >
                          remove
                        </button>
                      </div>
                      <input
                        data-testid={`input-contact-name-${i}`}
                        placeholder="Full name *"
                        value={c.name}
                        onChange={(e) => setContact(i, { name: e.target.value })}
                        className={inputCls}
                      />
                      <input
                        data-testid={`input-contact-role-${i}`}
                        placeholder="Role / title"
                        value={c.role ?? ""}
                        onChange={(e) => setContact(i, { role: e.target.value })}
                        className={inputCls}
                      />
                      <input
                        data-testid={`input-contact-email-${i}`}
                        type="email"
                        placeholder="Email"
                        value={c.email ?? ""}
                        onChange={(e) => setContact(i, { email: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addContact}
                  className="w-full glass-surface border border-border-soft rounded px-3 py-2 text-sm text-gold hover:border-gold/40"
                  data-testid="button-add-contact"
                >
                  + Add a person
                </button>
              </div>
            )}

            {/* Step 3 — Documents */}
            {step === 3 && (
              <div className="space-y-4" data-testid="step-documents">
                <div className={headCls}>Firm documents</div>
                <p className="text-[11px] text-text-faint">
                  Upload your trade license, certificates, insurance, VAT/TRN registration and
                  signatory ID. PDF, PNG or JPEG, up to 10MB each. The Cognirise team reviews each
                  document before it is accepted.
                </p>

                <div className="glass-surface border border-border-soft rounded p-3 space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="doc-kind" className={labelCls}>
                      Document type
                    </label>
                    <select
                      id="doc-kind"
                      data-testid="input-doc-kind"
                      value={upKind}
                      onChange={(e) => setUpKind(e.target.value)}
                      className={inputCls}
                    >
                      {DOC_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="doc-title" className={labelCls}>
                      Title (optional)
                    </label>
                    <input
                      id="doc-title"
                      data-testid="input-doc-title"
                      value={upTitle}
                      onChange={(e) => setUpTitle(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="doc-issued" className={labelCls}>
                        Issued
                      </label>
                      <input
                        id="doc-issued"
                        data-testid="input-doc-issued"
                        type="date"
                        value={upIssued}
                        onChange={(e) => setUpIssued(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="doc-expiry" className={labelCls}>
                        Expiry
                      </label>
                      <input
                        id="doc-expiry"
                        data-testid="input-doc-expiry"
                        type="date"
                        value={upExpiry}
                        onChange={(e) => setUpExpiry(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <input
                    ref={upFileRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-text-mute"
                    data-testid="input-doc-file"
                  />
                  {upErr && <p className="text-sm text-danger" data-testid="doc-upload-error">{upErr}</p>}
                  <button
                    type="button"
                    onClick={uploadDoc}
                    disabled={upBusy || !upFile}
                    className="w-full bg-gold text-bg font-medium rounded px-4 py-2 text-sm disabled:opacity-50"
                    data-testid="button-upload-doc"
                  >
                    {upBusy ? "Uploading…" : "Upload document"}
                  </button>
                </div>

                <div className="space-y-2" data-testid="doc-list">
                  {documents.length === 0 && (
                    <p className="text-[11px] text-text-faint italic">No documents uploaded yet.</p>
                  )}
                  {documents.map((d) => (
                    <div
                      key={d.id}
                      className="glass-surface border border-border-soft rounded p-3 flex items-start justify-between gap-3"
                      data-testid={`doc-row-${d.id}`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-sm text-text truncate">
                          {d.title || docKindLabel(d.kind)}
                        </div>
                        <div className="text-[11px] text-text-faint truncate">
                          {docKindLabel(d.kind)} · {d.fileName} · {fmtBytes(d.sizeBytes)}
                        </div>
                        {d.expiryDate && (
                          <div className="text-[11px] text-text-faint">Expires {d.expiryDate}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteDoc(d.id)}
                        className="text-[11px] font-mono uppercase tracking-widest text-danger hover:underline shrink-0"
                        data-testid={`button-remove-doc-${d.id}`}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4 — Bank details */}
            {step === 4 && (
              <div className="space-y-4" data-testid="step-bank">
                <div className={headCls}>Bank details</div>
                <p className="text-[11px] text-text-faint">
                  Bank details are reviewed and approved by the Cognirise finance team before any
                  payment is made.
                </p>
                {field("iban", "IBAN", iban, setIban, { required: true })}
                {field("swift", "SWIFT / BIC", swift, setSwift)}
                {field("bank-name", "Bank name", bankName, setBankName, { required: true })}
                {field("currency", "Currency", currency, setCurrency, {
                  required: true,
                  placeholder: "e.g. AED",
                  hint: "3-letter code.",
                })}
              </div>
            )}

            {/* Step 5 — Password */}
            {step === 5 && (
              <div className="space-y-4" data-testid="step-password">
                <div className={headCls}>Choose your password</div>
                {field("password", "New password", password, setPassword, {
                  required: true,
                  type: "password",
                  autoComplete: "new-password",
                  hint: "At least 10 characters.",
                })}
                {field("confirm", "Confirm password", confirm, setConfirm, {
                  required: true,
                  type: "password",
                  autoComplete: "new-password",
                })}
              </div>
            )}

            {error && (
              <p className="text-sm text-danger" data-testid="partner-register-error">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy}
                  className="glass-surface border border-border-soft rounded px-6 py-2 text-sm text-text disabled:opacity-50"
                  data-testid="button-step-back"
                >
                  Back
                </button>
              )}
              {step < 5 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex-1 bg-gold text-bg font-medium rounded px-6 py-2 text-sm"
                  data-testid="button-step-next"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="flex-1 bg-gold text-bg font-medium rounded px-6 py-2 text-sm disabled:opacity-50"
                  data-testid="button-partner-register-submit"
                >
                  {busy ? "Submitting…" : "Complete registration"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
