interface ResendResponse {
  id?: string;
  error?: { message?: string };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  from?: string;
}

function defaultFrom(): string | null {
  return process.env.AUTH_EMAIL_FROM || null;
}

function billingFrom(): string | null {
  return process.env.BILLING_EMAIL_FROM || defaultFrom();
}

function emailConfigured(from?: string | null): boolean {
  return Boolean(process.env.RESEND_API_KEY && (from || defaultFrom()));
}

export function emailFrom(): string | null {
  return defaultFrom();
}

export function billingEmailFrom(): string | null {
  return billingFrom();
}

export async function sendEmail({ to, subject, text, from }: SendEmailOptions): Promise<void> {
  const sender = from || defaultFrom();
  if (!emailConfigured(sender)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Auth email is not configured.");
    }
    console.log(`\n[email] From: ${sender}\n[email] To: ${to}\n[email] Subject: ${subject}\n\n${text}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null) as ResendResponse | null;
    throw new Error(body?.error?.message || `Auth email failed with status ${res.status}`);
  }
}

export async function sendLoginCode(email: string, code: string): Promise<void> {
  await sendEmail({
    from: defaultFrom() ?? undefined,
    to: email,
    subject: "Your Newshog login code",
    text: `Your Newshog login code is ${code}. It expires in 15 minutes.`,
  });
}

export async function sendBillingEmail(email: string, subject: string, text: string): Promise<void> {
  await sendEmail({ from: billingFrom() ?? undefined, to: email, subject, text });
}
