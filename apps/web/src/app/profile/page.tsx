"use client";

import { useState, useEffect, type FormEvent } from "react";
import { ArrowLeft, Loader2, Save, User, Building2 } from "lucide-react";
import Link from "next/link";
import type { ProfileType, ExpertiseSummary, CompanyContext } from "@newshog/shared";

interface Profile {
  id: string;
  type: ProfileType;
  ownerEmail: string;
  individual?: {
    linkedinUrl?: string;
    xHandle?: string;
    freeTextBio?: string;
    expertiseSummary?: ExpertiseSummary;
  } | null;
  enterprise?: {
    companyName: string;
    companyDescription?: string;
    websiteUrl?: string;
    docsUrl?: string;
    pdfText?: string;
    companyContext?: CompanyContext;
  } | null;
}

type Step = "auth" | "choose" | "form" | "summary";

const inputClass =
  "w-full rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40";
const textareaClass =
  "w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40 resize-none";
const btnPrimary =
  "inline-flex items-center gap-2 rounded-full bg-accent-strong px-5 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0 disabled:opacity-70";

export default function ProfilePage() {
  const [step, setStep] = useState<Step>("auth");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileType, setProfileType] = useState<ProfileType>("individual");

  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [freeTextBio, setFreeTextBio] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [docsUrl, setDocsUrl] = useState("");
  const [pdfText, setPdfText] = useState("");

  const [summary, setSummary] = useState<ExpertiseSummary | CompanyContext | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setProfile(data);
          setProfileType(data.type);
          if (data.type === "individual" && data.individual) {
            setLinkedinUrl(data.individual.linkedinUrl ?? "");
            setXHandle(data.individual.xHandle ?? "");
            setFreeTextBio(data.individual.freeTextBio ?? "");
            setSummary(data.individual.expertiseSummary ?? null);
          } else if (data.type === "enterprise" && data.enterprise) {
            setCompanyName(data.enterprise.companyName ?? "");
            setCompanyDescription(data.enterprise.companyDescription ?? "");
            setWebsiteUrl(data.enterprise.websiteUrl ?? "");
            setDocsUrl(data.enterprise.docsUrl ?? "");
            setPdfText(data.enterprise.pdfText ?? "");
            setSummary(data.enterprise.companyContext ?? null);
          }
          setStep("summary");
        }
      })
      .catch(() => {});
  }, []);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setAuthError(data.error || "Failed to send code.");
        setLoading(false);
        return;
      }
      setCodeSent(true);
    } catch {
      setAuthError("Failed to reach server.");
    }
    setLoading(false);
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const data = await res.json();
        setAuthError(data.error || "Invalid code.");
        setLoading(false);
        return;
      }
      setStep("choose");
    } catch {
      setAuthError("Failed to reach server.");
    }
    setLoading(false);
  }

  async function handleCreateProfile(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const body =
        profileType === "individual"
          ? { type: "individual", linkedinUrl, xHandle, freeTextBio }
          : { type: "enterprise", companyName, companyDescription, websiteUrl, docsUrl, pdfText };

      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setAuthError(data.error || "Failed to create profile.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProfile(data);
      if (profileType === "individual" && data.individual) {
        setSummary(data.individual.expertiseSummary ?? null);
      } else if (data.enterprise) {
        setSummary(data.enterprise.companyContext ?? null);
      }
      setStep("summary");
    } catch {
      setAuthError("Failed to reach server.");
    }
    setLoading(false);
  }

  async function handleUpdateProfile(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const body =
        profileType === "individual"
          ? { linkedinUrl, xHandle, freeTextBio }
          : { companyName, companyDescription, websiteUrl, docsUrl, pdfText };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setAuthError(data.error || "Failed to update profile.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProfile(data);
      if (profileType === "individual" && data.individual) {
        setSummary(data.individual.expertiseSummary ?? null);
      } else if (data.enterprise) {
        setSummary(data.enterprise.companyContext ?? null);
      }
    } catch {
      setAuthError("Failed to reach server.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight mb-2">Your profile</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Attach who you are so angles and pitches are grounded in real expertise.
        </p>

        {authError && (
          <div className="mb-6 rounded-2xl border border-destructive/50 bg-card px-4 py-3 text-sm text-destructive">
            {authError}
          </div>
        )}

        {/* Auth: request code */}
        {step === "auth" && !codeSent && (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </form>
        )}

        {/* Auth: verify code */}
        {step === "auth" && codeSent && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Code sent to <span className="text-foreground">{email}</span>. Check your server console.
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              required
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
            </button>
          </form>
        )}

        {/* Choose profile type */}
        {step === "choose" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">What kind of profile?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setProfileType("individual"); setStep("form"); }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm font-medium hover:border-foreground/40 transition-colors"
              >
                <User className="size-6 text-muted-foreground" />
                Individual
              </button>
              <button
                onClick={() => { setProfileType("enterprise"); setStep("form"); }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm font-medium hover:border-foreground/40 transition-colors"
              >
                <Building2 className="size-6 text-muted-foreground" />
                Enterprise
              </button>
            </div>
          </div>
        )}

        {/* Profile form */}
        {step === "form" && profileType === "individual" && (
          <form onSubmit={handleCreateProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">LinkedIn URL</label>
              <input
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/yourname"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">X / Twitter handle</label>
              <input
                value={xHandle}
                onChange={(e) => setXHandle(e.target.value)}
                placeholder="@yourhandle"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">About me</label>
              <textarea
                value={freeTextBio}
                onChange={(e) => setFreeTextBio(e.target.value)}
                placeholder="What you do, your expertise, what you write/speak about..."
                rows={5}
                className={textareaClass}
              />
            </div>
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Build my profile"}
            </button>
          </form>
        )}

        {step === "form" && profileType === "enterprise" && (
          <form onSubmit={handleCreateProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Company name</label>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Description</label>
              <textarea
                value={companyDescription}
                onChange={(e) => setCompanyDescription(e.target.value)}
                placeholder="What the company does, who it serves..."
                rows={3}
                className={textareaClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Website URL</label>
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://acme.com"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Docs URL</label>
              <input
                value={docsUrl}
                onChange={(e) => setDocsUrl(e.target.value)}
                placeholder="https://docs.acme.com"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">PDF / document text</label>
              <textarea
                value={pdfText}
                onChange={(e) => setPdfText(e.target.value)}
                placeholder="Paste extracted text from a PDF or document..."
                rows={5}
                className={textareaClass}
              />
            </div>
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Build my profile"}
            </button>
          </form>
        )}

        {/* Summary display */}
        {step === "summary" && summary && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold mb-3">
                {profileType === "individual" ? "Expertise summary" : "Company context"}
              </h2>
              {profileType === "individual" && (
                <IndividualSummary data={summary as ExpertiseSummary} />
              )}
              {profileType === "enterprise" && (
                <EnterpriseSummary data={summary as CompanyContext} />
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("form")} className={btnPrimary}>
                Edit profile
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium hover:bg-card transition-colors"
              >
                Back to analysis
              </Link>
            </div>

            {/* Edit form (inline) */}
            {profileType === "individual" && (
              <form onSubmit={handleUpdateProfile} className="space-y-4 rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Update fields &amp; re-summarize</h3>
                <div>
                  <label className="block text-sm font-medium mb-1.5">LinkedIn URL</label>
                  <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">X handle</label>
                  <input value={xHandle} onChange={(e) => setXHandle(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">About me</label>
                  <textarea value={freeTextBio} onChange={(e) => setFreeTextBio(e.target.value)} rows={5} className={textareaClass} />
                </div>
                <button type="submit" disabled={loading} className={btnPrimary}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <><Save className="size-4" /> Save &amp; re-summarize</>}
                </button>
              </form>
            )}

            {profileType === "enterprise" && (
              <form onSubmit={handleUpdateProfile} className="space-y-4 rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Update fields &amp; re-summarize</h3>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Company name</label>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Description</label>
                  <textarea value={companyDescription} onChange={(e) => setCompanyDescription(e.target.value)} rows={3} className={textareaClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Website URL</label>
                  <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Docs URL</label>
                  <input value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">PDF text</label>
                  <textarea value={pdfText} onChange={(e) => setPdfText(e.target.value)} rows={5} className={textareaClass} />
                </div>
                <button type="submit" disabled={loading} className={btnPrimary}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <><Save className="size-4" /> Save &amp; re-summarize</>}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] | undefined }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <div className="mb-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((item, i) => (
          <span key={i} className="inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-foreground">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function IndividualSummary({ data }: { data: ExpertiseSummary }) {
  return (
    <div className="space-y-1 text-sm">
      <SummaryList label="Topics" items={data.topics} />
      {data.tone && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Tone</p>
          <p>{data.tone}</p>
        </div>
      )}
      <SummaryList label="Credentials" items={data.credentials} />
      <SummaryList label="Recurring themes" items={data.recurringThemes} />
    </div>
  );
}

function EnterpriseSummary({ data }: { data: CompanyContext }) {
  return (
    <div className="space-y-1 text-sm">
      {data.whatTheyDo && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">What they do</p>
          <p>{data.whatTheyDo}</p>
        </div>
      )}
      {data.whoTheyServe && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Who they serve</p>
          <p>{data.whoTheyServe}</p>
        </div>
      )}
      <SummaryList label="Product categories" items={data.productCategories} />
      {data.positioningVoice && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Positioning / voice</p>
          <p>{data.positioningVoice}</p>
        </div>
      )}
      <SummaryList label="Areas of authority" items={data.areasOfAuthority} />
    </div>
  );
}
