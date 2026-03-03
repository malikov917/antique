#!/usr/bin/env bash
set -euo pipefail

echo "[check] build shared types"
pnpm --filter @antique/types exec tsc -b tsconfig.json --force

echo "[check] lint"
pnpm lint

echo "[check] typecheck"
pnpm typecheck

echo "[check] test"
pnpm test

echo "[check] all green"
