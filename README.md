# ForgeQA GitHub Action

Runs a [ForgeQA](https://forgeqa.io) test or suite in real browsers and fails the job unless it passes.

## Set up

1. In ForgeQA open **Integrations → GitHub Actions** and choose what to run.
2. Copy the key into a repository secret named `FORGEQA_WEBHOOK_KEY`:
   **Repo → Settings → Secrets and variables → Actions → New repository secret**.
3. Download `forgeqa.yml` from the same page and save it as `.github/workflows/forgeqa.yml`:

```yaml
name: ForgeQA
on:
  push:
  workflow_dispatch:
  # Or run after each deployment instead of on push:
  # deployment_status:
permissions: {}
jobs:
  forgeqa:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)) ||
      github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: ShopLab-Team/forgeqa-action@v1
        with:
          trigger-url: https://app.forgeqa.io/api/triggers/<trigger id>/run
          webhook-key: ${{ secrets.FORGEQA_WEBHOOK_KEY }}
```

## Inputs

| Input | Required | |
|---|---|---|
| `trigger-url` | yes | The trigger URL from ForgeQA |
| `webhook-key` | yes | The trigger's key, from a secret |
| `timeout-seconds` | no | How long to wait, 10 to 7200 (default 1800). Runs keep going in ForgeQA after a timeout. |

## Outputs

| Output | |
|---|---|
| `execution-id` | The ForgeQA execution |
| `status` | `passed`, `failed` or `canceled` |

CI triggers are part of the ForgeQA Professional and Agency plans.
