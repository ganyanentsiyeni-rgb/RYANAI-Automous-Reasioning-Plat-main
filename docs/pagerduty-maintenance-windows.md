# PagerDuty maintenance windows

RyanAI provides an importable PagerDuty maintenance-window context manager for reviewed CI/CD orchestration.

## Required CI environment

Configure these as protected CI secrets/variables. Do not commit or print their values:

- `PAGERDUTY_TOKEN`
- `PAGERDUTY_USER_EMAIL`
- `PAGERDUTY_SERVICE_IDS` — comma-separated service IDs

The implementation supports one or multiple services in the same maintenance window.

## Example

```python
import subprocess
from scripts.pagerduty_manager import pagerduty_maintenance_block

with pagerduty_maintenance_block(
    duration_minutes=45,
    description="Reviewed production release",
):
    subprocess.run(["your-reviewed-deploy-command"], check=True)
```

The context manager always attempts to terminate the maintenance window when the block exits. If the deployment raises an exception, that exception is preserved unless cleanup itself is the only failure.

## Safety boundary

This change does **not** create PagerDuty credentials, modify GitHub secrets, or add an automatic production deployment trigger. A deployment workflow must explicitly opt into this helper and provide protected credentials.

The offline contract test uses mocked HTTP responses and never contacts PagerDuty.

Run:

```bash
python3 -m unittest discover -s scripts -p 'test-pagerduty-manager.py'
```
