# Beta Test Credentials (Local)

These users are deterministic and re-seeded by `scripts/run-ios-role-screen-audit.sh`.

## Phones
- Buyer: `+4915123400011`
- Buyer2: `+4915123400014`
- Seller: `+4915123400012`
- Admin: `+4915123400013`

## Where credentials are saved
- Latest seeded token snapshot (local, overwritten each run):
  - `state/seed-users-latest.env`
- Run-specific token snapshot:
  - `state/runs/ios-role-screen-audit/<timestamp>/tokens.env`

## OTP in local beta
The local API uses a logging SMS provider. OTP codes are written to API logs with `OTP issued`.

Example (latest run log):
```bash
rg -n 'OTP issued|phoneE164' state/runs/ios-role-screen-audit/*/logs/api.log | tail -n 50
```

## Persistence
Local DB is persistent by default at:
- `apps/api/data/antique.sqlite`

Do not run with `RESET_DB=1` if you want to keep existing data.
