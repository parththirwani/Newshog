interface ResendResponse {
  id?: string;
  error?: { message?: string };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
}

export function emailFrom(): string | null {
  return process.env.AUTH_EMAIL_FROM || null;
}

export async function sendEmail({ to, subject, text }: SendEmailOptions): Promise<void> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Auth email is not configured.");
    }
    console.log(`\n[email] To: ${to}\n[email] Subject: ${subject}\n\n${text}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM,
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
    to: email,
    subject: "Your Newshog login code",
    text: `Your Newshog login code is ${code}. It expires in 15 minutes.`,
  });
}

export async function sendBillingEmail(email: string, subject: string, text: string): Promise<void> {
  await sendEmail({ to: email, subject, text });
}
