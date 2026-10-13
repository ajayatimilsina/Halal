# Halal Grocery / ハラール食料品店

Japanese-first, responsive HTML/CSS/vanilla JS. No frontend framework or build step. Static files work on GitHub Pages or Firebase Hosting. **Cloud Functions is not used.** The app uses Firebase Auth (Google for the owner, anonymous for customers), Realtime Database and EmailJS. Google One and reCAPTCHA are not required.

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

Staff pages use Google sign-in only, restricted to the configured owner UID. The old `1234` password gate is removed. Firebase Authentication and database rules, not browser session flags, authorize access.

## Language and Theme

Choose **日本語** or **English** in the header. The selected language persists across pages and reloads; `?lang=en` / `?lang=ja` also works. The existing light/dark toggle remains independent of language. Switching languages preserves the cart, checkout fields, product drafts and settings input. Product/category/option names and customer addresses/notes remain as entered; only interface labels, status displays, dialogs and known errors are translated. Database status/shipping values and yen amounts do not change. Browser-generated validation and third-party Firebase messages may follow the browser/provider language.

## Quick Preview

Node is needed only for local tools/tests; customers use ordinary browser JavaScript. Local tests were run on Node 24.

```powershell
npm install
npm run serve
```

Open http://localhost:8080/customer.html. Without Firebase configuration this is clearly marked preview mode: browsing/cart work, but ordering and staff access do not. Do not open through `file://`; ES modules require HTTP.

## Firebase Setup

1. Open project `kiranahibino`; register a Web app and paste its public configuration into `FIREBASE_CONFIG` in [firebase-sync.js](firebase-sync.js). The database URL is already set.
2. Enable Anonymous and Google providers in Firebase Authentication. Verify the supplied `OWNER_UID` in [firebase-sync.js](firebase-sync.js) belongs to your intended Google user and matches both owner expressions in [database.rules.json](database.rules.json). No backend environment file or service-account key is needed.
3. Add localhost and your hosting domains to Authentication authorized domains. Leave `APP_CHECK_SITE_KEY` empty. If Realtime Database App Check enforcement was previously enabled in the console, change it to monitoring/not enforced for the no-reCAPTCHA setup. Never make database writes public to bypass errors.
4. Firebase Spark/free quotas can be used for this configuration; Google One and a Functions-related Blaze upgrade are not needed. Usage/connection/hosting quotas still apply. Authentication alone does not prevent bots, fake orders or anonymous-account abuse: monitor usage, order volume and storage. No server-side rate-limiter remains. Existing deployed Cloud Functions are not automatically deleted by this code migration; check your console before changing billing or deleting services.
5. Authenticate Firebase CLI and deploy only after reviewing the settings:

```powershell
npx firebase login
npx firebase deploy --project kiranahibino --only database,hosting
```

The Firebase CLI may require service/API permissions to deploy. Do not switch the database into public-write/test mode to work around authorization errors.

### Rules and Orders

[database.rules.json](database.rules.json) is ready to paste after verifying the owner UID. Menu, stock and the two public settings paths are readable. Only the owner can read/write the database root. Customers can create a pending order atomically with its request record, read only their own individual order, report payment and record operational email results. They cannot read the order list or other customers' records, write stock/settings, confirm payment, ship or delete orders.

**Approved static-only tradeoff:** orders can be received while staff are offline, but stock is not reserved until a signed-in staff page is open. Pending/shortage orders show no payment QR/app link and cannot be reported as paid. Once stock is confirmed, the payment screen updates live. Multiple staff processors use an owner-only root transaction: the processed marker and all deductions commit together, so retries do not double-deduct and shortages never create negative stock. Concurrent customers can both submit requests for the last unit; only one will be confirmed. Do not promise availability before confirmation.

`/menu`, `/stock`, `/orders`, `/settings` retain the requested data model. `/catalog` is an owner-managed, image-free price/option index used by rules; menu saves maintain it and a staff page initializes it for existing menus. `/customerRequests/<uid>/<id>` records prevent request reuse after deletion. Keep these records when deleting orders. Orders add `stockStatus: pending | applied | shortage`, chosen options, Auth UID and processing timestamps. Existing orders without stockStatus are treated as already reserved, avoiding double deductions during migration.

Rules validate item unit prices/options against the catalog, quantity bounds, initial unpaid/new/pending state, ownership and paid-before-shipping. RTDB rules cannot generally sum arbitrary item arrays or classify configurable address lists, so submitted aggregates/shipping remain provisional: the trusted owner browser recomputes totals and shipping before enabling payment. Staff must keep a page open to process orders. A crashed/closed browser delays processing. Root transactions include base64 photos and retained orders, so this remains a small-shop design; plan retention/scaling before growth. No customer receives the root snapshot.

## Initial Products and Payment

Sign in on the menu page, add the Mutton sample, review the reference photo, then save. Product uploads become JPEG data URLs, at most 600px wide, quality 0.7. Inventory is untracked until a staff member sets an actual count; tracked zero means unavailable, 1-4 means 残りわずか. Restocking does not override a manual 欠品 toggle.

On the payment page, use **承認済みQRを読込** to resize the approved [image.jpg](image.jpg) to at most 500px and save it in `/settings/payment`. PayPal is disabled until a QR is actually saved. Verify the QR scans after resizing. No Firebase Storage is used.

PayPay defaults to `https://qr.paypay.ne.jp/p2p01_M2QLOAUSh8VcxFGt`. Check this account and the PayPal QR on a phone before accepting orders. Neither link guarantees a prefilled amount; the customer must send the exact displayed yen total and order number. Check PayPay's eligibility/terms for commercial use of this personal transfer link.

Payment is manual: `unpaid -> reported -> paid`. Only the owner may mark paid after checking the provider app. Orders follow `new -> packing -> shipped -> done`; UI and database rules block unpaid shipping. Deletion never restores stock or refunds a payment. The owner must open a staff page before customers can pay pending orders.

## Delivery

Defaults: Nagoya City address keywords `名古屋市` / `Nagoya City`, free from item total ¥10,000, lower totals fee ¥0 until edited. Optional postal prefixes must be reviewed by the owner; not all Aichi postal codes are Nagoya City. Full-width characters, spaces and hyphens are normalized.

Elsewhere in Japan: 着払い; the carrier collects shipping on arrival, and checkout charges no shipping fee. Shipping rules and owner payment instructions are frozen when the staff processor confirms stock. If settings change before confirmation, the final amount can differ from the displayed provisional amount; customers must wait for confirmation before sending money.

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

New subject: `【新規注文】#<id> <name>`; payment-report subject: `【支払い報告】#<id>`. The centralized `sendOrderEmail(order)` records success/failure in the customer's own order under restricted database rules. A new-order email may contain provisional totals; staff must check the confirmed order before reconciling payment. Configure/test delivery separately before launch; local automated tests send no real emails.

Browser email delivery is not guaranteed if a tab closes or a network/provider fails. The accepted order remains saved with a retryable notification flag. Staff retry from the orders page. Email success is operational metadata, not payment proof or guaranteed inbox delivery. Sends are spaced to respect EmailJS's one-request-per-second rate limit. Optional automatic customer confirmation email is not enabled in this implementation.

## Payment Recovery and Privacy

Payment links use `customer.html#pay=<id>` and require the same browser's anonymous Firebase identity. A copied link/token does not grant another browser permission. Cross-device payment recovery from the old callable-token design is no longer supported; contact the store if browser data was cleared. Customers can read their own contact/address record, but not another customer's or the list. Pages set `no-referrer`; QR fallback receives only the owner's PayPay URL, not customer data.

Guarded storage persists cart/request identifiers, theme and receipt tokens, not checkout PII. When storage is blocked, retries in the same tab still reuse the request ID. A reload with blocked storage cannot recover the in-memory pending request; retain the payment link after a successful order. Establish a privacy notice and order retention policy appropriate to your store before collecting real customer data.

## Local Verification

Java 21+, Node, and Chromium are needed for the full suite. A portable Java runtime was installed on this machine under `%LOCALAPPDATA%/halal-grocery-tools`; add its `bin` directory to PATH in new terminals if Java is not found.

```powershell
npx playwright install chromium
npm test
npm run test:browser
npx firebase emulators:exec --project demo-kiranahibino --only auth,database "npm run test:integration"
npx firebase emulators:exec --project demo-kiranahibino --only auth,database "npm run test:browser:live"
```

The `demo-` project cannot reach live Firebase services. The localhost-only `?emulator=1` flag connects to Auth 9099 and Database 9000 only. Tests install equivalent rules with a demo owner UID, used only by the localhost demo browser. This does not provide a production login bypass. No Functions SDK, emulator, dependency or deploy target is needed. Do not run tests against production.

Tests cover private order ownership, pending last-unit races, idempotent stock processing, canonical unit prices/owner totals, retry/deletion records, unpaid-shipping rejection, stale inventory, Google-only gates, legacy flag rejection, mobile/desktop layouts, storage denial, real checkout/QR/recovery and staff operations.

## GitHub Pages

Publish the seven HTML pages, browser JS/CSS including [database-commands.js](database-commands.js) and [shop-domain.js](shop-domain.js), `assets/meat.jpg` and `image.jpg`. Do not publish dependency folders, tests, local environment files or credentials. Deploy Firebase database rules separately; no Functions deployment is required. Relative paths support repository subdirectories. Add the GitHub Pages domain to Firebase Auth and EmailJS allowlists.

Firebase Hosting uses [firebase.json](firebase.json) exclusions to keep backend/test/configuration files out of the static deployment. Verify hosting files before publishing. Production payments, email delivery, Google login, optional App Check and provider account destinations require manual configuration and checks; they are not claimed as tested live.

## Photo Attribution

[assets/meat.jpg](assets/meat.jpg): "Raw lamb cutlets with shredded ginger and rosemary", photo by Wikimedia Commons user Salimfadhley, [source](https://commons.wikimedia.org/wiki/File:Raw_lamb_cutlets_with_shredded_ginger_and_rosemary.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Downloaded as a reduced-size reference; the browser may resize/crop its display and recompress it for menu storage. This reference does not certify the actual store product, animal age or halal sourcing. Replace it with your own verified Mutton product photo before selling. Retain this attribution and share-alike license when redistributing the reference or derivatives.