#!/usr/bin/env bash
set -euo pipefail

# Reconcile workspace dependencies and compiled output after task-agent merges.
# The running workflow restarts afterward and applies any pending development DB migrations.
npm ci --no-audit --no-fund
npm run build