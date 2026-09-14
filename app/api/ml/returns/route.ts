import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";

async function getSellerId() {
  const envSellerId = process.env.ML_SELLER_ID;
  if (envSellerId) return envSellerId;

  const db = getAdminDb();
  const doc = await db.collection("ml_tokens").doc("main").get();

  if (!doc.exists) return null;
  const data = doc.data();
  return data?.user_id ? String(data.user_id) : null;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();

    if (!token) {
      return NextResponse.json(
        { error: "No Mercado Livre token found" },
        { status: 401 }
      );
    }

    const sellerId = await getSellerId();

    if (!sellerId) {
      return NextResponse.json(
        { error: "ML_SELLER_ID not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.status=cancelled`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch returns", details: text },
        { status: 500 }
      );
    }

    const data = await response.json();
    const orders = data.results ?? [];
    const db = getAdminDb();

    const returns = orders.map((order: any) => ({
      id: String(order.id),
      date_created: order.date_created ?? null,
      status: order.status ?? null,
      total_amount: order.total_amount ?? 0,
      currency_id: order.currency_id ?? "BRL",
      buyer: order.buyer ?? null,
      shipping: order.shipping ?? null,
      raw: order,
      updatedAt: new Date().toISOString(),
    }));

    const batch = db.batch();

    returns.forEach((item: any) => {
      const ref = db.collection("ml_returns").doc(item.id);
      batch.set(ref, item, { merge: true });
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      count: returns.length,
      data: returns,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Unexpected error syncing returns",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}