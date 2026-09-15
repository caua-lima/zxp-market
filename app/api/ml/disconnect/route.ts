import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

/**
 * O motivo, de qualquer coisa que tenha sido lançada.
 *
 * Era `catch (error: any)` com `error?.message || String(error)`. Em `any`
 * o `?.` não é checagem nenhuma: se o lançado for uma string — e
 * `throw "x"` acontece — `.message` é undefined, `||` cai no String() e
 * sai certo por acidente. Se for um objeto com `message: null`, sai
 * `details: "null"`. Aqui a checagem é de verdade.
 */
function motivoDoErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return String(e);
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const db = getAdminDb();
    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: null,
        refresh_token: null,
        expires_in: null,
        user_id: null,
        user_profile: null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: "disconnect_failed", details: motivoDoErro(error) }, { status: 500 });
  }
}
