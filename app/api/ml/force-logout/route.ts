import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

/**
 * O motivo, de qualquer coisa que tenha sido lançada.
 *
 * Era `catch (error: any)` com `error?.message`. Em `any` esse `?.` não é
 * checagem nenhuma — só desliga o compilador. Aqui a checagem é de verdade.
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
    
    // Limpa todos os dados do ML do Firestore
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

    // Cria resposta com cookie de logout
    const response = NextResponse.json({ success: true });
    
    // Define cookie para indicar que está desconectado
    response.cookies.set('ml_session_cleared', 'true', {
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      path: '/'
    });
    
    return response;
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "force_logout_failed", details: motivoDoErro(error) },
      { status: 500 }
    );
  }
}
