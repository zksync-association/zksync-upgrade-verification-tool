async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("No url");
    process.exit(1);
  }

  const options = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "net_version", params: [] }),
  };

  const data = await fetch(url, options);
  if (!data.ok) {
    process.exit(1);
  }
}

await main();
