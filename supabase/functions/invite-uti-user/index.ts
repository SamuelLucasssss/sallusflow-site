import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SITE_URL = "https://www.sallusflow.com.br/imec-uti/";
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
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Sessão inválida.");
    // Authorization must be decided with the caller's JWT at the database boundary.
    // This validates session_id, active/admin and the configured MFA policy.
    const { data: secureAdminSession, error: secureAdminError } = await userClient
      .rpc("is_uti_admin_secure_session");

    if (secureAdminError || secureAdminSession !== true) {
      return new Response(JSON.stringify({ error: "Sessão administrativa inválida, encerrada ou sem permissão." }), { status: 403, headers: cors });
    }

    const adminClient = createClient(url, service, { auth: { persistSession: false } });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const displayName = String(body?.display_name || "").trim();
    const role = String(body?.role || "operator").trim();
    const delivery = String(body?.delivery || "email");

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
    if (displayName.length < 2 || displayName.length > 120) throw new Error("Informe o nome do usuário (2 a 120 caracteres).");
    if (!["admin", "operator", "commercial", "referral"].includes(role)) throw new Error("Perfil inválido.");
    if (!["email", "link"].includes(delivery)) throw new Error("Escolha como entregar o primeiro acesso.");

    const options = { redirectTo: SITE_URL, data: { display_name: displayName } };
    const { data: invited, error: inviteError } = delivery === "link"
      ? await adminClient.auth.admin.generateLink({ type: "invite", email, options })
      : await adminClient.auth.admin.inviteUserByEmail(email, options);
    if (inviteError) {
      const message = /already|registered/i.test(inviteError.message || "")
        ? "Já existe um usuário com este e-mail. Confira o acesso na lista da equipe."
        : delivery === "email"
        ? "Não foi possível enviar o e-mail. Tente a opção Link de primeiro acesso."
        : "Não foi possível criar o primeiro acesso. Tente novamente.";
      throw new Error(message || "Não foi possível enviar o convite.");
    }

    if (!invited?.user?.id) throw new Error("O serviço não confirmou a criação do usuário.");
    let actionLink: string | null = null;
    if (delivery === "link") {
      const generated = String("properties" in invited ? invited.properties?.action_link || "" : "");
      let parsed: URL;
      try { parsed = new URL(generated); } catch { throw new Error("O serviço não retornou um link de primeiro acesso válido."); }
      if (parsed.origin !== new URL(url).origin || parsed.pathname !== "/auth/v1/verify" || parsed.searchParams.get("type") !== "invite") {
        throw new Error("O serviço não retornou um link de primeiro acesso válido.");
      }
      actionLink = generated;
    }

    // One administrative approval: activate and audit atomically using the REAL caller.
    // A revoked administrator cannot activate the invitation after the first guard.
    const { error: activationError } = await userClient.rpc("admin_update_uti_member", {
      p_user_id: invited.user.id, p_active: true, p_role: role,
    });
    if (activationError) throw new Error("O convite foi criado, mas a liberação não foi concluída. Confira a conta na equipe antes de tentar novamente.");

    return new Response(JSON.stringify({
      ok: true,
      activated: true,
      delivery,
      user_id: invited.user.id,
      email,
      action_link: actionLink,
      redirect_to: SITE_URL,
    }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro inesperado." }), { status: 400, headers: cors });
  }
});
