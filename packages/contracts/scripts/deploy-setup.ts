import dotenv from "dotenv";
import { deploySetup } from "../helpers/deploy-setup.js";

dotenv.config();

deploySetup()
  .then(() => {
    console.log("✅ Deploy:Setup completed");
  })

  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ Deploy:Setup failed");
  });
