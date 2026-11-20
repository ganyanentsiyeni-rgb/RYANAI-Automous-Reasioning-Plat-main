# EU.org domain and DNS readiness

## Current registration evidence

The EU.org request for `ryanai.eu.org` was saved as
`20261120101521-arf-16099`. The submitted validator output showed that both
`ns1.desec.io` and `ns2.desec.org` returned SOA and NS answers over their
resolved IPv4 and IPv6 addresses. This is registration-request evidence, not
proof that EU.org approved or delegated the domain.

## Free DNS delegation

The intended DNS provider is deSEC. The EU.org nameserver fields are:

- `ns1.desec.io`
- `ns2.desec.org`

No glue IPs are required because these nameservers are outside the
`ryanai.eu.org` zone. Keep deSEC's automatically managed SOA record; do not
create a manual SOA record.

Run the read-only verification after any DNS/delegation change:

```sh
npm run dns:verify:eu-org
```

It queries each resolved address for each nameserver directly and requires
both expected NS records plus a valid SOA response. A failure is a blocker,
not a warning to bypass.

## Post-approval hosting plan (not applied)

Only after EU.org approval and delegation are confirmed:

| Hostname | Intended target | Service |
| --- | --- | --- |
| `www.ryanai.eu.org` | CNAME to `ryanai-web-u2eb.onrender.com` | Render static frontend |
| `api.ryanai.eu.org` | CNAME to `ryanai-api-u2eb.onrender.com` | Render API |

Before adding records, register each custom hostname in its corresponding
Render service and follow the exact DNS target Render presents. Do not assume
the CNAME targets above are final until Render displays them for these
hostnames. Do not create an apex CNAME at `ryanai.eu.org` unless the DNS
provider and Render explicitly support the required flattening/alias behavior.

After records propagate, verify Render domain ownership and managed TLS for
both hosts, then test frontend navigation, login redirect/callback URLs, API
health, CORS, and browser-to-API connectivity. Login testing must use a
non-production/test account. Do not alter auth provider settings or production
services without separate owner approval.

## Safety boundaries

- Free services only; no Cloudflare, subscriptions, paid trials, or upgrades.
- This change adds read-only verification and documentation only.
- No DNS records, Render custom domains, redirects, certificates, auth
  settings, deployment triggers, secrets, or production infrastructure are
  changed by the script.
- Domain approval, DNS propagation, TLS issuance, and application login are
  separate states and must be evidenced independently.
