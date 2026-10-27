/* DefiLlama fee-audit storefront — on-chain payment verification.
 * Works in the browser (window.DefiAudit) and in Node (module.exports) so the
 * same code that unlocks the page is the code that gets tested. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DefiAudit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIG = {
    USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    PAY_TO: "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a",
    CHAIN_ID: "0x2105",
    RPCS: [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.llamarpc.com",
      "https://1rpc.io/base"
    ],
    PRICES: { "29": 29000000n, "99": 99000000n }
  };

  const TRANSFER =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const pad32 = h => "0x" + h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

  async function rpc(method, params, opts) {
    const urls = (opts && opts.rpcs) || CONFIG.RPCS;
    let lastErr;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        const j = await res.json();
        if (j.error) { lastErr = new Error(j.error.message); continue; }
        return j.result;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("all RPC endpoints failed");
  }

  /** Sum every native-USDC Transfer into `to` inside the receipt's logs. */
  function sumUsdcIn(receipt, to) {
    const want = pad32(to);
    const usdc = CONFIG.USDC.toLowerCase();
    let total = 0n;
    for (const l of receipt.logs || []) {
      if (String(l.address).toLowerCase() !== usdc) continue;
      if (String(l.topics && l.topics[0]).toLowerCase() !== TRANSFER) continue;
      if (String(l.topics[2]).toLowerCase() !== want) continue;
      total += BigInt(l.data);
    }
    return total;
  }

  /**
   * Verify a Base tx hash and decide which tier it unlocks.
   * Returns {receipt, received, tier, hash} or throws an Error with a
   * human-readable reason (the page prints it verbatim).
   */
  async function verify(hash, opts) {
    const o = opts || {};
    const cfg = Object.assign({}, CONFIG, o.config || {});
    const clean = String(hash || "").trim();
    if (!HASH_RE.test(clean))
      throw new Error("That is not a transaction hash — a Base hash is 0x followed by 64 hex characters.");
    const h = clean.toLowerCase();
    if (o.usedHashes && o.usedHashes.includes(h))
      throw new Error("This hash was already redeemed in this browser. Re-open the download link, or mail us the hash for a re-issue.");

    const receipt = await rpc("eth_getTransactionReceipt", [h], { rpcs: o.rpcs });
    if (!receipt)
      throw new Error("No receipt yet. The transaction is unknown or still pending — wait for a confirmation and retry.");
    if (receipt.status !== "0x1")
      throw new Error("That transaction reverted (status 0). Nothing was transferred, so nothing unlocks.");

    const received = sumUsdcIn(receipt, cfg.PAY_TO);
    if (received === 0n)
      throw new Error("No USDC transfer to " + cfg.PAY_TO.slice(0, 6) + "…" + cfg.PAY_TO.slice(-4) +
        " in that transaction. If you paid from an exchange, the withdrawal hash is the exchange's — find the transfer it produced, or pay directly from a wallet.");

    let tier = null;
    if (received >= cfg.PRICES["99"]) tier = "99";
    else if (received >= cfg.PRICES["29"]) tier = "29";
    else throw new Error("Amount is " + Number(received) / 1e6 + " USDC — under the $29 minimum. Send the difference and verify the second hash, or mail us both hashes.");

    return { receipt, received, tier, hash: h };
  }

  /** Build the EIP-155 calldata for USDC.transfer(payTo, amount). */
  function transferCalldata(amountUnits, payTo) {
    const to = (payTo || CONFIG.PAY_TO).replace(/^0x/, "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(to)) throw new Error("bad payTo");
    return "0xa9059cbb" + to.padStart(64, "0") + BigInt(amountUnits).toString(16).padStart(64, "0");
  }

  return { CONFIG, verify, sumUsdcIn, transferCalldata, rpc, TRANSFER, pad32 };
});
