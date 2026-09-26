# Required pull request checks

Configure an active GitHub ruleset named **Require CI checks** for the
repository's default branch. Require these GitHub Actions checks before a pull
request can merge:

- `typecheck-and-build`
- `server-postgres-tests`

Require checks to pass against the latest base branch commit.

The check names are the job IDs in
`.github/workflows/postgres-integration.yml`. If either job is renamed, update
the ruleset in GitHub under **Settings → Rules → Rulesets** to match. The ruleset
settings are repository-level and must be applied in GitHub.