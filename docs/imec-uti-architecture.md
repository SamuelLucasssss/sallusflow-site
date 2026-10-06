# IMEC UTI — Architecture

## Runtime

- Astro static route: `/imec-uti/`
- Client entrypoint: `src/imec-uti/app.ts`
- Typed business/date helpers: `src/imec-uti/domain.ts`
- Public Supabase client configuration: `src/imec-uti/config.ts`
- UI styles: `src/imec-uti/styles.css`
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

## Non-negotiable invariants

- No duplicate active billing cycle per admission.
- Discharge uses the account version checked in the settlement preview.
- Credits to the patient are explicit and require refund handling.
- The discharge day is not billed.
- Financial corrections preserve the original record through cancellation/reversal.
- Direct authenticated writes to financial tables remain revoked.
