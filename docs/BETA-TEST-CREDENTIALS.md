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
1. Tap `Send code` in the app.
2. Run:
```bash
./scripts/get-latest-otp.sh
```
This prints the latest `otpCode` automatically (no tmux session name required).

Fallback: list API tmux windows first, then inspect one manually.
```bash
tmux list-windows -a -F '#S:#I:#W' | rg ':api$'
tmux capture-pane -p -t <session>:api -S -300 | rg 'OTP issued|otpCode' | tail -n 5
```

## Persistence
Local DB is persistent by default at:
- `apps/api/data/antique.sqlite`

Do not run with `RESET_DB=1` if you want to keep existing data.
