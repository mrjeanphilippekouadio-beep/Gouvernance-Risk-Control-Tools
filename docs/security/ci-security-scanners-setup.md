# CI Security Scanners — setup and operating notes

This repository now defines workflows for CodeQL, SonarCloud/SonarQube, Snyk, and OWASP ZAP. Third-party GitHub Actions are pinned to full commit SHAs. The existing CI, Gitleaks, Semgrep, Trivy, and Dependabot workflows remain in place.

## 1. CodeQL

- Scans JavaScript and TypeScript on pushes and pull requests targeting `main` and `staging`, and on a weekly schedule.
- Uses GitHub's `security-extended` and `security-and-quality` query suites.
- Does not require an additional API token. Findings are published to GitHub Code Scanning when that feature is available for the repository.

## 2. SonarCloud or SonarQube Server

Provision the project in SonarCloud or SonarQube Server first. In **Settings → Secrets and variables → Actions**, configure:

| Name | Type | Required for |
| --- | --- | --- |
| `SONAR_TOKEN` | Secret | Both products |
| `SONAR_PROJECT_KEY` | Variable | Both products; exact project key created in Sonar |
| `SONAR_ORGANIZATION` | Variable | SonarCloud |
| `SONAR_HOST_URL` | Variable | SonarQube Server; the reachable server base URL |

Do not commit a Sonar token. The workflow is intentionally skipped until a token, project key, and platform-specific organization/host setting are configured.

The workflow currently reports analysis results; it does not wait for or enforce a Quality Gate. Enable gate enforcement only after agreeing and testing the project's quality profile and gate thresholds.

## 3. Snyk

Add `SNYK_TOKEN` as an Actions repository secret. The workflow installs a pinned Snyk CLI release, tests detected npm projects (including the root workspace and backend lockfiles), and uploads a SARIF report to GitHub Code Scanning when one is produced.

- A missing token results in an explicit skipped scan, not a false successful security scan.
- High and critical findings cause the Snyk job to fail.
- Snyk's policy and organization access follow the account associated with the token.

## 4. OWASP ZAP Baseline

Add `ZAP_TARGET_URL` as an Actions **variable**, set to the HTTPS URL of the authorized staging deployment. Do not point it at production without explicit approval and a separate operational review.

The workflow runs manually or weekly (Monday, 04:31 UTC). It uses ZAP Baseline, which performs passive checks and is not a substitute for an authenticated DAST test or an active penetration test. Findings are initially non-blocking so the first report can be triaged without unexpectedly stopping delivery. Reports are published as the `zap-baseline-staging` artifact by the action.

## 5. Rollout checklist

- [ ] Review and merge the scanner workflow PR.
- [ ] Configure `SONAR_TOKEN` plus the variables for the chosen Sonar platform.
- [ ] Configure `SNYK_TOKEN` and confirm the Snyk organization/policy.
- [ ] Set `ZAP_TARGET_URL` to the authorized staging URL and manually run **OWASP ZAP Baseline (staging)** after deployment.
- [ ] Review the first reports before deciding whether Sonar Quality Gate or ZAP findings should become blocking checks.
- [ ] Confirm branch protection requires successful checks before merge; workflow files alone do not enforce branch protection.
