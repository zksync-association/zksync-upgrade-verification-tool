import { TestApp } from "../helpers/test-app.js";

async function main() {
  const testApp = new TestApp();
  await testApp.down();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
