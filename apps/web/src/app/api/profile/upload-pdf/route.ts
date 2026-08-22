import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File must be under 10 MB." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const data = await parser.getText();
    const text = data.text?.trim();
    await parser.destroy();
    if (!text) {
      return NextResponse.json({ error: "Could not extract text from PDF." }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[api/profile/upload-pdf] error:", err);
    return NextResponse.json({ error: "Failed to parse PDF." }, { status: 500 });
  }
}
