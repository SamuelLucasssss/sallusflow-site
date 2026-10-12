# IMEC UTI — Architecture

## Runtime

- Astro static route: `/imec-uti/`
- Client entrypoint: `src/imec-uti/app.ts`
- Typed business/date helpers: `src/imec-uti/domain.ts`
- Public Supabase client configuration: `src/imec-uti/config.ts`
- UI styles: `src/imec-uti/styles.css`
- Card receipt helpers: `src/imec-uti/payment-details.ts`
- Database history: `supabase/migrations/`

## Source of truth

Financial state lives in PostgreSQL/Supabase. The browser never writes directly to financial tables; mutations go through authorized RPCs/Edge Functions.

## Release flow

1. Work on a non-production branch.
2. `npm ci && npm run check`.
3. Review the Vercel Preview deployment.
4. Merge only after CI and Preview succeed.
5. Vercel deploys `main` to production.
6. Verify production and Supabase integrity after release.

Database migrations and Edge Function fixes require their own reviewed deployment before relying on them in production. Merging frontend code does not deploy Supabase resources. Apply database changes before the dependent frontend release; keep normal password authentication unchanged.

## Regression evidence

`npm test` includes isolated PostgreSQL through pinned PGlite, real financial functions/RLS and runtime race tests. `npm run test:browser` requires `npm run build` and an installed Playwright Chromium (`npx playwright install chromium`). Auth is synthetic; browser HTTP requests are intercepted and forwarded only to isolated PostgreSQL. No test path reaches production data.

The browser journey is part of CI after the quality gate. Its synthetic artifacts stay under ignored `tmp/imec-audit/`. Multi-connection locking, Hosted Auth/SMTP, physical printing and real mobile hardware remain separate homologation requirements.

## Non-negotiable invariants

- No duplicate active billing cycle per admission.
- Discharge uses the account version checked in the settlement preview.
- Credits to the patient are explicit and require refund handling.
- The discharge day is not billed.
- Financial corrections preserve the original record through cancellation/reversal.
- Direct authenticated writes to financial tables remain revoked.
