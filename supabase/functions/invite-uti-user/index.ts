import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SITE_URL = "https://www.sallusflow.com.br/imec-uti/";
const APP_ORIGIN = "https://www.sallusflow.com.br";
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método não permitido." }), { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sessão ausente.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const publishable = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, publishable, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Sessão inválida.");

    const claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(token.split(".")[1].length / 4) * 4, "=")),
    );
    if (claims?.aal !== "aal2") {
      return new Response(JSON.stringify({ error: "Confirme o segundo fator antes de convidar usuários." }), { status: 403, headers: cors });
    }

    const { data: adminOk, error: guardError } = await userClient.rpc("is_uti_admin_secure_session");
    if (guardError || adminOk !== true) {
      return new Response(JSON.stringify({ error: "Somente administradores com sessão segura podem convidar usuários." }), { status: 403, headers: cors });
    }

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const displayName = String(body?.display_name || "").trim();
    const role = String(body?.role || "operator").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
    if (displayName.length < 2) throw new Error("Informe o nome do usuário.");
    if (!["admin", "operator", "commercial"].includes(role)) throw new Error("Perfil inválido.");

    const adminClient = createClient(url, service, { auth: { persistSession: false } });
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: SITE_URL,
      data: { display_name: displayName },
    });
    if (inviteError) {
      const message = inviteError.message?.includes("already") ? "Já existe um usuário com este e-mail." : inviteError.message;
      throw new Error(message || "Não foi possível enviar o convite.");
    }

    if (invited?.user?.id) {
      const { error: updateError } = await adminClient
        .from("profiles")
        .update({ display_name: displayName, role, active: false, security_onboarding_completed_at: null })
        .eq("id", invited.user.id);
      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({
      ok: true,
      user_id: invited?.user?.id ?? null,
      email,
      redirect_to: SITE_URL,
    }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro inesperado." }), { status: 400, headers: cors });
  }
});
