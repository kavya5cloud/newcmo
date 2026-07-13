import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    user: session ? { email: session.email } : null,
    accountsEnabled: !!db(),
  });
}
