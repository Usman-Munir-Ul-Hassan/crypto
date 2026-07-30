// scripts/test-fetch.ts (temporary, delete later)
async function testFetch() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
  );
  console.log("HTTP status:", res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
testFetch();
