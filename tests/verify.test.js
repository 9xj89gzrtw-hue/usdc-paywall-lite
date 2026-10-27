/* Tests for the storefront payment verifier, run against real Base mainnet data.
 * node tests/verify.test.js
 */
const A = require("../assets/verify.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}
async function throws(name, fn, re) {
  try { await fn(); fail++; console.log("  FAIL " + name + " (no error thrown)"); }
  catch (e) {
    const good = !re || re.test(e.message);
    if (good) { pass++; console.log("  ok   " + name + "  → \"" + e.message.slice(0, 70) + "…\""); }
    else { fail++; console.log("  FAIL " + name + " (wrong message: " + e.message + ")"); }
  }
}

/* A real Base mainnet transaction: USDC.transferWithAuthorization inside a
 * smart-account call. Recipient and amount are read from the chain below, so
 * this test fails loudly if the fixture stops being a USDC transfer. */
const FIXTURE_TX = "0xd27af909788e20f66ac57e2e4f49c0c610fdbf5d6ff20066669076e770945527";

(async () => {
  console.log("calldata");
  const cd = A.transferCalldata(29000000n, "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a");
  ok("selector is transfer(address,uint256)", cd.slice(0, 10) === "0xa9059cbb");
  ok("length is 4+32+32 bytes", cd.length === 10 + 64 + 64, cd.length);
  ok("recipient is left-padded", cd.slice(10, 74) === "0".repeat(24) + "72aa6edde71b94f6b99c8e52edc02b5c75f74d1a");
  ok("amount is 29e6 in hex", BigInt("0x" + cd.slice(74)) === 29000000n);
  ok("99 tier encodes as 99e6", BigInt("0x" + A.transferCalldata(99000000n).slice(74)) === 99000000n);

  console.log("input validation");
  await throws("rejects a non-hash", () => A.verify("hello"), /64 hex/);
  await throws("rejects a 64-char hash without 0x", () => A.verify("a".repeat(64)), /64 hex/);
  await throws("rejects a hash that was already redeemed",
    () => A.verify("0x" + "a".repeat(64), { usedHashes: ["0x" + "a".repeat(64)] }), /already redeemed/);

  console.log("live chain: " + FIXTURE_TX.slice(0, 12) + "…");
  const receipt = await A.rpc("eth_getTransactionReceipt", [FIXTURE_TX]);
  ok("receipt fetched from a public Base RPC", !!receipt);
  ok("fixture transaction succeeded", receipt.status === "0x1");

  const transfers = (receipt.logs || []).filter(l =>
    l.address.toLowerCase() === A.CONFIG.USDC &&
    (l.topics[0] || "").toLowerCase() === A.TRANSFER);
  ok("fixture contains a native-USDC Transfer log", transfers.length > 0);

  const recipient = "0x" + transfers[0].topics[2].slice(-40);
  const amount = BigInt(transfers[0].data);
  console.log("       recipient " + recipient + " · " + Number(amount) / 1e6 + " USDC");

  const sum = A.sumUsdcIn(receipt, recipient);
  ok("sumUsdcIn finds the transfer to that recipient", sum === amount, String(sum));

  const other = A.sumUsdcIn(receipt, "0x000000000000000000000000000000000000dEaD");
  ok("sumUsdcIn returns 0 for an uninvolved address", other === 0n, String(other));

  const ours = await A.verify(FIXTURE_TX, {
    config: { PAY_TO: recipient, PRICES: { "29": 1n, "99": amount + 1n } }
  });
  ok("verify() unlocks for the real recipient at the $29 tier", ours.tier === "29", ours.tier);
  ok("verify() reports the exact on-chain amount", ours.received === amount, String(ours.received));

  await throws("verify() refuses our own address on someone else's tx",
    () => A.verify(FIXTURE_TX), /No USDC transfer to 0x72Aa…4d1a/);

  await throws("undersized payment is rejected",
    () => A.verify(FIXTURE_TX, { config: { PAY_TO: recipient, PRICES: { "29": amount + 1n, "99": amount + 2n } } }),
    /under the \$29 minimum/);

  await throws("unknown hash gives a clear message",
    () => A.verify("0x" + "b".repeat(64)), /No receipt yet|unknown or still pending/);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("harness error:", e); process.exit(2); });
