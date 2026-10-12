# IMEC UTI — Security Architecture

## Authentication

The application is invite-only. There is no public signup flow. Administrators invite users through the protected `invite-uti-user` Edge Function.

Current operation uses email + password and an authenticated Supabase session that still exists server-side. Active profile and role authorization remain mandatory. TOTP is optional according to the database policy.

The database can enforce AAL2 through `app_settings.mfa_required`. The current authorized value is `false`; never re-enable it as an automatic audit or deployment step. The old mandatory-MFA descriptions describe historical Package 3 behavior.

## Password policy

All password creation/change flows inside IMEC UTI require:
- at least 12 characters;
- at least three character classes;
- a k-anonymous HaveIBeenPwned range check through `password-pwned-range`.

Only the first five SHA-1 characters are sent to the HIBP range service. The complete password and complete hash never leave the browser.

Supabase's native leaked-password toggle remains recommended as defense in depth. The current connector cannot change hosted Auth configuration.

## MFA

TOTP is implemented and configurable, and required only when the policy enables it. The app supports:
- first-factor login;
- enrollment by QR code/manual secret;
- challenge and verification;
- AAL2 session refresh;
- MFA gate before operational/financial data is loaded.

Server-side enforcement is implemented in `private.security_mfa_ok()`, used by `private.is_active_member()` and `private.is_admin()`.

## Session control

Client inactivity timeout: 20 minutes.

The backend additionally validates the JWT `session_id` against `auth.sessions`. Therefore a revoked/deleted session cannot continue to pass the application membership guard.

## Password recovery and invitations

Invitation and recovery callbacks are handled by the application. Tokens present in the URL fragment are consumed, stored as a session, and immediately removed from the browser address/history before operational data is shown.

First access and recovery require the user to define a strong, non-leaked password before continuing under the current authentication policy.

## Browser security

`vercel.json` applies security headers to `/imec-uti/*`, including:
- Content-Security-Policy;
- HSTS;
- frame-ancestors none / X-Frame-Options DENY;
- nosniff;
- no-referrer;
- restrictive Permissions-Policy;
- no-store cache policy;
- same-origin COOP/CORP.

The route is also marked `noindex,nofollow,noarchive`.

## Edge Functions

Both Edge Functions require a valid JWT and use a pinned Supabase client version.

`invite-uti-user` additionally requires:
- valid user token;
- JWT AAL2;
- an active `auth.sessions` row matching the JWT `session_id`;
- active profile;
- admin role.

The privileged invitation path must re-check authorization through `is_uti_admin_secure_session()` using the caller's JWT before the Edge Function creates a service-role client. The audit fix explicitly supplies that JWT in `global.headers.Authorization`: `getUser(token)` alone does not install it as the client's RPC session. Revoked sessions remain blocked. Native invitation delivery and optional administrator step-up require human homologation.

Allowed browser origins are restricted to the production domain and legitimate Vercel previews.

## Database and audit

All financial tables remain RLS protected and direct authenticated writes stay revoked. Financial mutations continue through audited RPCs.

Security onboarding completion is auditable through `mark_uti_security_onboarding_complete()`.

## External hosted-auth controls

Two defense-in-depth settings require Supabase Dashboard/Auth administrative configuration and are intentionally not represented as secrets in Git:
- native Leaked Password Protection;
- institutional SMTP credentials/sender and optional security-notification email templates.

Do not store SMTP passwords, service-role keys, activation hashes, or user passwords in this repository.
