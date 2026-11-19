# Secret Management

## Rules

- Never commit real secrets (private keys, API tokens, passwords) to the repository.
- `.env.example` files contain placeholders only; copy them to an untracked `.env` and fill in values locally.
- Test fixtures that contain key-like strings must be clearly marked as tests and allowlisted in `.gitleaks.toml` with a short justification.
- The CI **Secret Scan (Gitleaks)** job scans the full history with the default rule set plus the project allowlist. Keep that job green before merging.

## Handling a leaked secret

1. Revoke/rotate the credential at the provider immediately.
2. Remove it from the working tree and add an allowlist entry only if it is a genuine test vector.
3. If a real secret was committed, replace it everywhere and rewrite the affected history (the scan reads all commits, not just the latest one).
4. Record the rotation in the incident log and verify `gitleaks detect .` passes locally.

## Local verification

```bash
gitleaks detect --no-banner -v .
```

The command must exit `0` with no leaks before a pull request is opened.
