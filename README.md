# n8n-nodes-goodsender

An [n8n](https://n8n.io) community node for [GoodSender](https://goodsender.com) — a consent-based transactional email API that's free for the first 100,000 emails/month.

This node lets your workflows:

- **Send Template Email** — fire a predefined transactional template (OTP, order receipt, new-device login, …) instantly to anyone. No consent required.
- **Send Custom Email** — send your own markdown/HTML/text email. **Consent-gated** (see the caveat below).
- **Request Consent** — ask a recipient to approve future custom email.
- **Get Consent Status** / **List Consents** — read where recipients stand in the Permission Loop.
- **List Domains** — list your sender domains and their DNS verification state.

It is a **declarative** node, built and verified against the live GoodSender API.

API reference: <https://goodsender.com/docs/api-reference/>

---

## Installation

### Community Nodes (recommended)

On self-hosted n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-goodsender`, and confirm. The **GoodSender** node then appears in the node panel.

### Manual

```bash
# in your n8n custom extensions directory (default: ~/.n8n/custom)
npm install n8n-nodes-goodsender
```

Or to develop/test from source:

```bash
git clone <this repo> && cd n8n-nodes-goodsender
npm install
npm run build
npm link
# then, inside ~/.n8n/custom:
npm link n8n-nodes-goodsender
# restart n8n
```

---

## Credentials

1. Create an API key in the GoodSender dashboard.
2. In n8n, add a **GoodSender API** credential and paste the key.
3. (Optional) Override **Base URL** only for dev/staging (`https://api.dev.goodsender.com`). Defaults to `https://api.goodsender.com`.

The key is sent as `Authorization: Bearer <key>` on every request. The credential's **test** button calls `GET /v1/domains`, so a bad key fails immediately with `401`.

---

## Operations

All operations live under the single **Email** resource.

| Operation | Method & path | Notes |
|---|---|---|
| Send Template Email | `POST /v1/emails/template` | Instant. Bypasses consent. Always returns `{"status":"sent"}`. |
| Send Custom Email | `POST /v1/emails/send` | **Consent-gated** — see caveat. |
| Request Consent | `POST /v1/emails/consent` | Starts the Permission Loop for a recipient. |
| Get Consent Status | `GET /v1/emails/{email}` | One recipient's consent state. |
| List Consents | `GET /v1/emails` | Paginated/filterable; `Domain` is required. |
| List Domains | `GET /v1/domains` | Sender domains + DNS verification. |

### Send Template Email

Fields: **From Email** (required, on a verified domain), **From Name**, **To Email** (required), **To Name**, **Subject** (required), **Template**, **Variables** (key/value).

Built-in template IDs and their variables:

| Template ID | Variables |
|---|---|
| `otp_code` | `app_name`, `otp_code`, `expiry_minutes`, `purpose`, `anti_phishing_notice` |
| `mfa_enrollment` | `app_name`, `mfa_method`, `enrolled_at` |
| `new_device_login` | `app_name`, `login_time`, `additional_info` |
| `order_completed` | `app_name`, `order_id`, `order_total`, `completed_at` |
| `order_receipt` | `app_name`, `description`, `receipt_number`, `purchase_date`, `payment_method`, `total` |
| `email_changed` | `app_name`, `new_email`, `changed_at`, `additional_info` |
| `password_changed` | `app_name`, `changed_at`, `additional_info` |

The catalogue grows over time. Pick **Custom (By ID)** in the **Template** dropdown to send any other template ID (e.g. a newly added one) without waiting for a node update. All variables are optional; omitted ones render as empty strings. URL-type variables must point to the sender's domain.

### Send Custom Email

> **Consent caveat.** Custom email is gated by GoodSender's Permission Loop. A recipient who has not yet **approved** is held/declined — delivery is **not** guaranteed to be immediate. The call returns `{ "sent": n, "declined": m }`: `sent` are recipients with granted, active consent; `declined` are everyone else (never approved, rejected, or inactive for 120+ days under the Engagement Check). Use **Request Consent** first, or **Get Consent Status** to check, before relying on a custom send.

Fields: **From Email**/**Name**, **To Email**/**Name**, **Subject**, **Content Type** (`markdown` / `html` / `text`), **Content**, and **Additional Fields** (reply-to, tag, send-at, open/click/unsubscribe tracking).

### Request Consent

Fields: **Domain** (your verified sender domain — the consent is *for* this domain), **Recipient Email**, **Recipient Name** (optional), **Redirect URL** (optional; `{email}` is substituted).

### Get Consent Status / List Consents / List Domains

Read endpoints for branching on consent state and inspecting domains. `List Consents` requires a **Domain**; both list operations support `Limit`/`Cursor` paging.

### Screenshots

_(placeholder — add UI screenshots of the credential dialog and the Send Template Email node here)_

## Example workflow

A minimal **Manual Trigger → GoodSender (Send Template Email)** workflow. In n8n, open a new
workflow, press `Ctrl/Cmd+V` to paste this JSON onto the canvas, then open the GoodSender node and
select your **GoodSender API** credential. Edit `fromEmail` to an address on a domain you've
verified in GoodSender.

```json
{
  "name": "GoodSender — Send OTP",
  "nodes": [
    {
      "parameters": {},
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "When clicking Test",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "email",
        "operation": "sendTemplate",
        "fromEmail": "you@your-domain.com",
        "toEmail": "recipient@example.com",
        "subject": "Your verification code",
        "templateId": "otp_code",
        "app_name": "MyApp",
        "otp_code": "482916",
        "expiry_minutes": "10"
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000002",
      "name": "GoodSender",
      "type": "n8n-nodes-goodsender.goodSender",
      "typeVersion": 1,
      "position": [240, 0],
      "credentials": {
        "goodSenderApi": { "id": "1", "name": "GoodSender account" }
      }
    }
  ],
  "connections": {
    "When clicking Test": {
      "main": [[{ "node": "GoodSender", "type": "main", "index": 0 }]]
    }
  }
}
```

---

## API notes & corrections

This node was built against the live API. The following differ from older/internal docs — captured here so the node's behavior is clear:

| Topic | What this node does (verified) |
|---|---|
| Custom-send path | `POST /v1/emails/send` (not `/v1/emails`), batch body `{ "emails": [ … ] }`. |
| Sender field | There is no `sender_identity`. Sender is a required `from: { email, name? }` on template and custom sends. |
| Template body | `from`, `to` (object), `subject` are all required; the template goes under `template: { template_id, variables }`. |
| Template result | The template endpoint bypasses the Permission Loop and **always** returns `{"status":"sent"}` (it reaches denied/unknown recipients too). |
| Consent body | `{ "domain", "emails": [ … ], "redirect_url"? }` — needs your sender **domain** plus a recipients array, not a single `email`. |
| Templates | 7 built-in IDs verified (table above). `welcome` is **not** currently in the catalogue — use **Custom (By ID)** if/when it ships. |

### Webhooks (future)

Custom sends accept `tracking` and `webhook_data`, which implies GoodSender emits delivery/open/click events. A webhook event schema isn't part of the public API reference yet, so there is no Trigger node here — it's a natural future addition once the event payloads are documented.

---

## Publishing

Two tiers (commands shown; do not run without the right npm credentials):

**1. Unverified — any self-hosted n8n can install it by name.**

```bash
npm run build
npm publish        # zero review; installable via Community Nodes immediately
```

**2. Verified — in-app discoverability on n8n Cloud.**

Submit through the [n8n Creator Portal](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/). Since **2026-05-01**, verified submissions must be published from CI with **npm provenance** — not from a local machine. This repo ships `.github/workflows/publish.yml` for that:

```yaml
npm publish --provenance --access public   # runs in GitHub Actions with id-token: write
```

It triggers on a GitHub Release and needs an `NPM_TOKEN` secret. It is a scaffold and is **not** wired to run automatically.

---

## Development

```bash
npm install
npm run build      # tsc + copy icon into dist/
npm run lint       # eslint-plugin-n8n-nodes-base (must be clean for verification)
npm pack           # validate the publishable tarball
```

## License

[MIT](LICENSE)
