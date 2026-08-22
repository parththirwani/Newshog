import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await prisma.analysis.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/analyze/:id] DELETE error:", err);
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
