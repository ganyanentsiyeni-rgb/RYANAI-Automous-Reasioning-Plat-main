# EU.org domain and DNS readiness

## Current registration evidence

The EU.org request for `ryanai.eu.org` was saved as
`20261120101521-arf-16099`. The submitted validator output showed that both
`ns1.desec.io` and `ns2.desec.org` returned SOA and NS answers over their
resolved IPv4 and IPv6 addresses.

That is evidence that the submitted nameservers answered the validator. It is
not evidence that EU.org approved the request or published the delegation in
the `eu.org` parent zone. Those remain separate external states.

## Read-only verifier

Run:

```sh
npm run test:dns:verify:eu-org
npm run dns:verify:eu-org
```

The verifier:

- resolves all addresses returned for each configured nameserver;
- checks every returned IPv4 and IPv6 address directly;
- requires a valid SOA primary within the expected nameserver set;
- requires the exact expected NS set (missing and unexpected NS records fail);
- reports address lookup errors, malformed addresses, DNS response failures,
  and query timeouts with the affected endpoint;
- cancels the resolver when a query times out.

A successful result from this first verifier means the configured child
nameserver endpoints answered with consistent SOA and NS data at the time of
the check. It does not query the `eu.org` parent zone, and therefore it keeps
`registrationApproval` and `parentZoneDelegation` as `not-verified`. Do not
convert a successful child-zone endpoint check into a claim of EU.org approval
or parent-zone delegation.

EU.org approval must be established from its confirmation/validation
communication. Parent delegation can be checked separately with:

```sh
npm run test:dns:verify:eu-org:parent
npm run dns:verify:eu-org:parent
```

That verifier discovers `eu.org` nameservers, resolves each IPv4/IPv6
endpoint, and sends a raw non-recursive DNS NS query directly to every parent
endpoint. It inspects the answer and authority sections without following a
referral, records the DNS AA bit, and fails closed on missing or unexpected
child nameservers. EU.org registration approval remains a separate,
unverified state.

## Post-approval hosting plan (not applied)

Only after EU.org approval and parent-zone delegation are independently
confirmed:

| Hostname | Intended service |
| --- | --- |
| `www.ryanai.eu.org` | Render static frontend |
| `api.ryanai.eu.org` | Render API |

Register each exact custom hostname in its corresponding Render service and
use the DNS target Render presents. Do not assume a CNAME target from an
`onrender.com` service URL; use the target displayed by Render for that
custom hostname. Do not create an apex CNAME unless the DNS provider and
Render explicitly support the required flattening/alias behavior.

After records propagate, verify domain ownership and managed TLS for both
hosts, then test frontend navigation, login redirect/callback URLs, API
health, CORS, and browser-to-API connectivity. Login testing must use a
non-production/test account. Do not alter auth provider settings or production
services without separate owner approval.

## Safety boundaries

- Free services only; no subscriptions, paid trials, or upgrades.
- The verifier is read-only. It does not change DNS records, Render custom
  domains, redirects, certificates, auth settings, deployment triggers,
  secrets, or production infrastructure.
- Approval, parent delegation, DNS propagation, TLS issuance, and application
  login are separate states and require independent evidence.
