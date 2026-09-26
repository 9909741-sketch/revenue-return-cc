---
name: Express session test timing
description: Response completion and persistence timing in session-store integration tests.
---

For Express session integration tests, consume the response body before checking whether a session write reached PostgreSQL. `fetch()` resolves when response headers arrive; session middleware may still be saving the session before ending the response.

**Why:** Checking the database or tearing down an isolated session table immediately after receiving headers can race the pending store write and produce misleading missing-row failures.

**How to apply:** Await `response.json()` or `response.arrayBuffer()` after session-changing requests and before database assertions or teardown. For coordinated races, release the held request and consume its full response before checking persistence.