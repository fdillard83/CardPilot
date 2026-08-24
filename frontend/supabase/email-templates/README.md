# CardPilot authentication email

## Deferred production setup

As of June 3, 2026, new Supabase Free projects using Supabase's default email provider cannot customize authentication email templates. CardPilot can continue using the default confirmation email during limited internal testing, but this must be revisited before broader beta registration or public launch.

There are two supported paths:

1. Keep the Supabase Free plan and connect a custom SMTP provider such as Resend, Postmark, SendGrid, or Amazon SES. Supabase currently includes custom SMTP support on Free, and connecting it re-enables template customization.
2. Upgrade the Supabase project to Pro and customize the template while using Supabase's hosted email service.

**CardPilot launch checklist:** configure production SMTP, set the sender name and address to a recognizable CardPilot identity, apply the subject and HTML below, send a test registration to a non-team email address, and verify delivery, links, spam placement, and mobile rendering.

Supabase's default SMTP service is intended for limited testing, is heavily rate-limited, and may restrict delivery to project-team addresses. Do not rely on it for public CardPilot registration.

Supabase sends registration mail, so its hosted Auth template must match the application template.

In the production Supabase project, open **Authentication → Email Templates → Confirm signup** and set:

- Subject: `Verify your CardPilot email address`
- Body: the contents of `confirm-signup.html`

Also set the sender name to `CardPilot` under the production SMTP settings. Keep `{{ .ConfirmationURL }}` unchanged so Supabase can insert the secure, single-use verification link.
