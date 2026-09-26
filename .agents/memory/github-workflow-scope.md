---
name: GitHub Actions workflow write permission
description: Permission constraint when uploading GitHub Actions workflow files through the Replit GitHub connector.
---

The GitHub connector used for this project has repository write access but does not expose the OAuth `workflow` scope. GitHub REST writes that include `.github/workflows/*` are rejected, while ordinary repository files can be written. The available reauthorization scopes do not include `workflow`.

**Why:** GitHub treats Actions workflow files as a separately protected write surface, even when the connection can edit other repository content.

**How to apply:** Before relying on the connector to publish workflow files, confirm it grants workflow write access. If it does not, ask the repository owner to add the workflow file manually; do not activate required-check rules until the workflow is present and its check runs are verified.