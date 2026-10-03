import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashLocalPassword } from "../infrastructure/identity/LocalIdentityProvider.js";

const rl = createInterface({ input, output });
try {
  const password = await rl.question("Password: ", { hideEchoBack: true });
  if (!password) {
    console.error("Password is required.");
    process.exitCode = 1;
  } else {
    console.log(hashLocalPassword(password));
  }
} finally {
  rl.close();
}
