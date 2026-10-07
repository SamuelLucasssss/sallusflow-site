import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const PROD_ORIGIN = "https://www.sallusflow.com.br";
const PREVIEW_ORIGIN = /^https:\/\/sallusflow-site(?:-[a-z0-9-]+)?\.vercel\.app$/i;
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = origin === PROD_ORIGIN || PREVIEW_ORIGIN.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : PROD_ORIGIN,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método não permitido." }), { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sessão ausente.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const publishable = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, publishable, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Sessão inválida.");

    const body = await req.json();
    const prefix = String(body?.prefix || "").trim().toUpperCase();
    if (!/^[A-F0-9]{5}$/.test(prefix)) throw new Error("Prefixo inválido.");

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "IMEC-UTI-Security/2.0",
      },
    });
    if (!response.ok) throw new Error("Não foi possível consultar a proteção de senhas vazadas.");

    const range = await response.text();
    return new Response(JSON.stringify({ ok: true, range }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro inesperado." }), {
      status: 400,
      headers: cors,
    });
  }
});
