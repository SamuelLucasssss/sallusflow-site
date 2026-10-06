# IMEC UTI — Supabase migrations

This directory mirrors the applied Supabase migration history for the IMEC UTI application.

## Security sanitization

Two historical bootstrap/auth migrations originally contained credential-derived hashes or activation hashes. Those literal values are intentionally redacted in Git:

- `20261004014750_internal_app_auth.sql` — temporary custom-auth password salts/hashes. This auth model was removed by a later migration.
- `20261004021349_one_time_admin_bootstrap.sql` — one-time activation hash. New environments must provision the first administrator with an environment-specific secret/process.

No production password, activation code, service-role key, API secret, patient data, or session token belongs in this repository.

## Workflow

All future database changes must be committed here before production application. CI validates naming, ordering, and credential patterns.
