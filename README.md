# paywall-lite — take USDC on Base from a static page, no backend

A working checkout in three files. The buyer sends USDC on Base, pastes the transaction hash, and
the page reads the receipt from a public RPC and decides for itself whether the payment happened.

No server. No Stripe account. No KYC. No webhook to keep alive. GitHub Pages is enough.

```
node tests/verify.test.js
…
18 passed, 0 failed
```

Those 18 checks run against a **real Base mainnet transaction**, and the fixture's recipient and
amount are read from the chain, so the suite fails loudly if the fixture ever stops being a USDC
transfer.

## The check, in six lines of logic

```js
const receipt = await rpc("eth_getTransactionReceipt", [hash]);   // 4 public Base RPCs, failover
if (receipt.status !== "0x1") throw new Error("reverted");
const paid = sumUsdcIn(receipt, PAY_TO);                          // native USDC Transfer logs only
if (paid === 0n) throw new Error("no USDC to the seller");
if (paid < PRICE) throw new Error("underpaid");
unlock();
```

`sumUsdcIn` matches all of:

1. log address is native USDC on Base (`0x8335…2913`) — a bridged USDC contract does not count;
2. `topics[0]` is the ERC-20 `Transfer` signature;
3. `topics[2]` is the seller address;
4. the amount is summed, not taken from the first log.

That last point matters: one transaction can contain several transfers, and a naive
"first log wins" implementation under- or over-credits.

## Run it

```bash
git clone https://github.com/9xj89gzrtw-hue/usdc-paywall-lite
cd usdc-paywall-lite
python3 -m http.server 8080      # or just open index.html
node tests/verify.test.js        # needs network: it reads Base mainnet
```

Change two constants at the top of the inline script and you are selling your own file:

```js
const PAY_TO = "0xYourAddress";
const PRICE  = 19000000n;   // 19 USDC — 6 decimals
```

## Why a static page is the right shape

A checkout that needs a backend has a backend to break, patch, and pay for. This one has none: the
entitlement *is* a transaction receipt, and receipts are permanent. The page can be a GitHub Pages
site, a Cloudflare Pages site, or a file on a USB stick.

## Where it is weak (read this before you charge money)

- **Replay protection is per-browser.** A redeemed hash is stored in `localStorage`; clearing storage
  or switching browsers re-opens the same hash. On-chain, one payment is one payment — the page
  cannot know that hash #2 was already used by someone else without a server.
- **A static page cannot enforce a licence.** If the file is publicly reachable, the URL is in the
  source. Encrypt the asset (AES-256) and reveal the passphrase only after verification, and say so
  honestly — it is payment-gated obscurity, not DRM. Real access control needs a server that mints
  signed URLs.
- **Exchange withdrawals look like failures.** If the buyer withdraws from an exchange, the hash they
  have is the exchange's internal transfer, which contains no USDC transfer to you. The page says
  exactly that instead of silently failing.
- **RPCs are rate-limited.** Four endpoints are tried in order; if all four fail the page reports it
  rather than pretending the payment was invalid.

The Pro pack turns this single-product page into the storefront it came from: a product catalog with
per-product prices, tier matching, a shared verifier, an honest delivery model, and the page's own
source as a template.

## Files

| File | Role |
|---|---|
| `index.html` | the whole checkout: markup, styles, unlock logic |
| `assets/verify.js` | RPC failover, receipt parsing, `Transfer` summing, calldata builder (UMD: browser + Node) |
| `tests/verify.test.js` | 18 checks, live Base fixture |

## Licence

MIT.
