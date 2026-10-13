# Halal Grocery / ハラール食料品店

Japanese-first, responsive HTML/CSS/vanilla JS. No frontend framework or build step. Static files work on GitHub Pages or Firebase Hosting. The approved secure backend uses Firebase Auth, Realtime Database and callable Cloud Functions.

## Pages

| Page | Purpose |
| --- | --- |
| [index.html](index.html) | Shop and staff links |
| [customer.html](customer.html) | Catalogue, cart, delivery details, checkout and QR payment |
| [menu.html](menu.html) | Product/option/photo drafts, category availability, save/cancel |
| [inventory.html](inventory.html) | Actual counts, differences, reconciliation and untracking |
| [orders.html](orders.html) | Live orders, payment confirmation, print, email retries and status flow |
| [shipping.html](shipping.html) | Paid packing orders, tracking, address copy and delivery settings |
| [payment.html](payment.html) | PayPay link/name and PayPal QR/link/name |

Staff pages use the requested SHA-256 gate (password `1234`), followed by Google sign-in for the fixed owner UID. The password is only a convenience gate, not database authorization.

## Quick Preview

Use Node 22 for development/deployment. The current machine has Node 24; local tests were run on it, while deployed functions specify Node 22.

```powershell
npm install
npm --prefix functions install
npm run serve
```

Open http://localhost:8080/customer.html. Without Firebase configuration this is clearly marked preview mode: browsing/cart work, but ordering and staff access do not. Do not open through `file://`; ES modules require HTTP.

## Firebase Setup

1. Open project `kiranahibino`; register a Web app and paste its public configuration into `FIREBASE_CONFIG` in [firebase-sync.js](firebase-sync.js). The database URL is already set.
2. Enable Anonymous and Google providers in Firebase Authentication. Obtain the owner's Google user's UID. Replace `OWNER_UID_NOT_CONFIGURED` in both [firebase-sync.js](firebase-sync.js) and [database.rules.json](database.rules.json). Set the same UID as `OWNER_UID` in an untracked `functions/.env.kiranahibino` file; use [functions/.env.example](functions/.env.example) as the reference. No service-account key belongs in this repository.
3. Add localhost and the actual hosting domains to Authentication authorized domains. Register the web app with App Check/reCAPTCHA v3, put its public site key in `APP_CHECK_SITE_KEY`, and register the intended domains. Production callable commands enforce App Check. Never use a production App Check debug token on a public site.
4. Cloud Functions deployment requires the Blaze billing plan. Set budget alerts and review quotas; alerts are not hard spending caps. Callable commands use `asia-northeast1`, at most three instances, per-UID throttling and server validation. Anonymous-account abuse still needs monitoring.
5. Authenticate Firebase CLI and deploy only after reviewing the settings:

```powershell
npx firebase login
npx firebase deploy --project kiranahibino --only database,functions,hosting
```

The Firebase CLI may require service/API permissions to deploy. Do not switch the database into public-write/test mode to work around authorization errors.

### Rules and Orders

[database.rules.json](database.rules.json) is ready to paste once the owner UID is replaced. Menu, stock and the two public settings paths are readable. Only the owner can read all orders and menu revision. All direct database writes are denied, including owner writes: trusted backend commands perform validated mutations.

**Deliberate approved change:** customer create-only `/orders` rules would allow bypassing price/stock validation, and cannot support payment reports. Customers therefore create orders through the authenticated callable backend, not direct database writes. Customers never read `/orders` directly or write stock, payment confirmation or order status.

`/menu`, `/stock`, `/orders`, `/settings` retain the requested data model. Private `/requestReceipts` records prevent duplicate deductions, even after deletion; `/rateLimits` tracks request limits. Orders additionally store customer Auth UID, token hash, chosen option, frozen payment instructions and status timestamps.

Checkout validates current product prices/options, aggregates variant quantities, checks stock and commits order plus deductions in one Admin root transaction. This is suitable for a small shop, but base64 photos and retained orders increase root-transaction payload/contention. Establish an order retention policy before scaling. Preserve idempotency records when removing old orders. No customer client receives the root snapshot.

## Initial Products and Payment

Sign in on the menu page, add the Mutton sample, review the reference photo, then save. Product uploads become JPEG data URLs, at most 600px wide, quality 0.7. Inventory is untracked until a staff member sets an actual count; tracked zero means unavailable, 1-4 means 残りわずか. Restocking does not override a manual 欠品 toggle.

On the payment page, use **承認済みQRを読込** to resize the approved [image.jpg](image.jpg) to at most 500px and save it in `/settings/payment`. PayPal is disabled until a QR is actually saved. Verify the QR scans after resizing. No Firebase Storage is used.

PayPay defaults to `https://qr.paypay.ne.jp/p2p01_M2QLOAUSh8VcxFGt`. Check this account and the PayPal QR on a phone before accepting orders. Neither link guarantees a prefilled amount; the customer must send the exact displayed yen total and order number. Check PayPay's eligibility/terms for commercial use of this personal transfer link.

Payment is manual: `unpaid -> reported -> paid`. Only the owner may mark paid after checking the provider app. Orders follow `new -> packing -> shipped -> done`; both UI and backend block unpaid shipping. Deletion never restores stock or refunds a payment.

## Delivery

Defaults: Nagoya City address keywords `名古屋市` / `Nagoya City`, free from item total ¥10,000, lower totals fee ¥0 until edited. Optional postal prefixes must be reviewed by the owner; not all Aichi postal codes are Nagoya City. Full-width characters, spaces and hyphens are normalized.

Elsewhere in Japan: 着払い; the carrier collects shipping on arrival, and checkout charges no shipping fee. Accepted orders freeze the shipping rule and amount used at checkout.

## EmailJS

Fill the public service ID, template ID and public key in `EMAILJS` at the top of [firebase-sync.js](firebase-sync.js). Configure the template recipient as the **fixed** `ajayatimilsina1@gmail.com`; do not make the destination an unrestricted client parameter. Allow only the hosting domains in EmailJS. Do not place private EmailJS keys in browser code.

Set template subject to `{{subject}}`. Suggested plain-text body:

```text
注文 #{{order_id}} / {{customer_name}}
{{items}}
商品合計: ¥{{items_total}}
配送: {{shipping}}
お支払い額: ¥{{total}}
支払い方法: {{payment_method}} / {{payment_status}}
お客様・配送先:
{{customer_details}}
```

New subject: `【新規注文】#<id> <name>`; payment-report subject: `【支払い報告】#<id>`. The centralized `sendOrderEmail(order)` records success/failure through a constrained backend operation. Configure/test delivery separately before launch; local automated tests send no real emails.

Browser email delivery is not guaranteed if a tab closes or a network/provider fails. The accepted order remains saved with a retryable notification flag. Staff retry from the orders page. Email success is operational metadata, not payment proof or guaranteed inbox delivery. Sends are spaced to respect EmailJS's one-request-per-second rate limit. Optional automatic customer confirmation email is not enabled in this implementation.

## Payment Recovery and Privacy

Payment links use `customer.html#pay=<id>&token=<random-token>`. Tokens are capabilities: forward only to the customer, not publicly. Only hashes are stored in the database; the protected receipt endpoint returns payment/order totals, not addresses or contacts. ID alone grants no access. Pages set `no-referrer`; QR image fallback receives only the owner's PayPay URL, never the receipt token or customer data.

Guarded storage persists cart/request identifiers, theme and receipt tokens, not checkout PII. When storage is blocked, retries in the same tab still reuse the request ID. A reload with blocked storage cannot recover the in-memory pending request; retain the payment link after a successful order. Establish a privacy notice and order retention policy appropriate to your store before collecting real customer data.

## Local Verification

Java 21+, Node, and Chromium are needed for the full suite. A portable Java runtime was installed on this machine under `%LOCALAPPDATA%/halal-grocery-tools`; add its `bin` directory to PATH in new terminals if Java is not found.

```powershell
npx playwright install chromium
npm test
npm run test:browser
npx firebase emulators:exec --project demo-kiranahibino --only auth,database,functions "npm run test:integration"
npx firebase emulators:exec --project demo-kiranahibino --only auth,database,functions "npm run test:browser:live"
```

The `demo-` project cannot reach live Firebase services. The localhost-only `?emulator=1` flag connects to Auth 9099, Database 9000 and Functions 5001. Tests use an emulator-only owner identity; this does not provide a production login bypass. Do not run the test suites against production.

Tests cover public/private rules, last-unit races, rollback, immutable canonical totals, retry/deletion tombstones, receipt authorization, unpaid-shipping rejection, stale inventory, mobile/desktop layout, storage denial, password gates, actual checkout/QR/recovery and staff operations.

## GitHub Pages

Publish the seven HTML pages, browser JS/CSS, `functions/lib/domain.js`, `assets/meat.jpg` and `image.jpg`. The shared pure domain module is public browser code; do not publish `functions/index.js`, backend environment files, dependency folders, tests or credentials. Deploy Firebase rules/functions separately. Relative paths support repository subdirectories. Add the GitHub Pages domain to Firebase Auth, App Check and EmailJS allowlists.

Firebase Hosting uses [firebase.json](firebase.json) exclusions to keep backend/test/configuration files out of the static deployment. Verify hosting files before publishing. Production payments, email delivery, Google login/App Check and provider account destinations require manual configuration and checks; they are not claimed as tested live.

## Photo Attribution

[assets/meat.jpg](assets/meat.jpg): "Raw lamb cutlets with shredded ginger and rosemary", photo by Wikimedia Commons user Salimfadhley, [source](https://commons.wikimedia.org/wiki/File:Raw_lamb_cutlets_with_shredded_ginger_and_rosemary.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Downloaded as a reduced-size reference; the browser may resize/crop its display and recompress it for menu storage. This reference does not certify the actual store product, animal age or halal sourcing. Replace it with your own verified Mutton product photo before selling. Retain this attribution and share-alike license when redistributing the reference or derivatives.