# Test Fixtures — `packages/connectors/__tests__/__fixtures__/`

PII-redacted minimal channel payloads. Real-shape but synthetic values.

**Do NOT commit raw channel responses.** Raw responses (especially from
Mercado Libre or WordPress) may contain real buyer data — emails,
phone numbers, document IDs, shipping addresses, IP addresses. Always
strip / redact before adding to this directory.

## Redaction conventions

- Emails → `redacted@example.com`
- Nicknames / usernames → `TESTBUYER` (ML) or `testbuyer` (WC)
- Phone numbers → Colombian fake `3000000000` (or `+57 300 000 0000`)
- Document numbers → `0000000000`
- Receiver / shipping names → `Test Buyer`
- Street addresses → `Calle Falsa 123` + zip `110111` (Bogotá)
- Real seller IDs → `1234567890` (numeric) / `FAKA_TEST_SELLER` (nickname)

## Mercado Libre fixtures (F2.1)

- `ml-order-paid.json` — orders v2 GET response for a `paid` MCO order
  with one `order_item` carrying `variation_attributes` (Color/Talla).
  Currency `COP`. Used by W2 normalize-order tests + W4 cascade smoke.
- `ml-order-cancelled-seller.json` — same shape with
  `status: "cancelled"` and `cancel_detail: "seller_cancelled"`. Used
  by the state-mapper to assert refund/cancel paths.
- `ml-item-with-variations.json` — items GET response with three
  `variations[]` differing by Color × Talla. Used by variant-mapper
  to assert SKU + attribute extraction.
- `ml-token-response.json` — `/oauth/token` POST response with
  `access_token`, `refresh_token`, `expires_in=21600` (6h),
  `scope="offline_access read write"`, and a numeric `user_id`. Used
  by oauth.ts code-exchange + rotating-refresh tests.
- `ml-webhook-notification.json` — POST body of a `topic=orders_v2`
  webhook notification including the `_query_params` block that the
  HMAC-SHA256 canonical-string verifier reconstructs.

## WordPress fixtures

Pre-F2.1 WP fixtures live alongside these and follow the same
PII-redaction conventions.

## Negative-control PII scan

A test guard (Plan 2.1.4.1) greps the fixture directory for patterns
suggesting un-redacted PII (gmail/hotmail/yahoo addresses, `+57` phone
prefixes, etc.). If you add a fixture and the guard fails, your fixture
contains real PII — redact it.
