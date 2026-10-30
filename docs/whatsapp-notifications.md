# WhatsApp approval messages

When a cut moves into the client review stage ("Approval" by default, or any stage named for the
client or approval, except "Approved"), every active contact of the project's client gets:

- an in-app notification,
- an email (Resend, `approval_request` template) with a **Review now** link,
- a WhatsApp template message, if the workspace switch is on, the person opted in, and the
  monthly plan cap is not reached.

**The link.** A client who can sign in and read the project gets the normal `/review?media=…` link.
Anyone else gets a fresh no-login guest review link: an expiring `GuestInvite` with the decision
permission. The expiry is set per workspace (default 7 days). Approving goes through the existing
`guest_decision` → `record_decision` flow, which moves the cut to Approved and notifies the team.

**Delivery.** Each channel is its own outbox event (`approval.requested.deliver`). Retryable
errors (network, 5xx, rate limits) are retried with backoff and then dead-lettered. Permanent
errors (bad number, template, auth) stop at once. Every attempt is logged on
`NotificationDelivery` (channel `EMAIL`/`WHATSAPP`, status, attempts, error, provider message id,
masked number, delivered/read times). The project Activity Log shows one "Approval request" row per
person, with a status pill per channel.

**Consent.** `WhatsAppContact` stores one number per client person (E.164 format), plus who
recorded consent, when, how (`agency_recorded` or `client_self`) and the exact wording. Changing
the number clears the consent. Opt-out is recorded with its method: a STOP reply via the webhook,
the client, or the agency. Consent, the switch and the cap are all checked again at send time.

## Test mode (default)

`WHATSAPP_PROVIDER=log` sends nothing. It logs the message (masked number, no link token) and
records the delivery as SENT with a `log-…` id. Email still goes through the configured backend.

## Real sending later

| Env var | What |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` to send through the Meta WhatsApp Cloud API |
| `WHATSAPP_ACCESS_TOKEN` | permanent System User token |
| `WHATSAPP_PHONE_NUMBER_ID` | the sending number's Phone Number ID |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account ID (for reference/ops) |
| `WHATSAPP_APP_SECRET` | Meta app secret; webhook signatures are checked against it |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | any secret string, also entered in Meta's webhook settings |
| `WHATSAPP_TEMPLATE_APPROVAL` | template name (default `deliverable_ready_for_approval`) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | default `en_GB` |
| `WHATSAPP_GRAPH_API_VERSION` | default `v23.0` |
| `APP_BASE_URL` | public app URL; links and the template button are built from it |
| `PLAN_FREE_WHATSAPP_MESSAGES_PER_MONTH` / `PLAN_PRO_WHATSAPP_MESSAGES_PER_MONTH` | caps (50 / 1000) |

Webhook URL for Meta: `https://<api-host>/api/webhooks/whatsapp/` (subscribe to `messages`).

Template to submit (category **Utility**, language English (UK)):

> Hi {{1}}, {{2}} for the project {{3}} from {{4}} is ready for your review. Please watch it and approve it or request changes using the button below.

Button: URL, dynamic: `https://<APP_BASE_URL host>/{{1}}`, text "Review now". Footer: "Reply STOP to turn off WhatsApp updates".
