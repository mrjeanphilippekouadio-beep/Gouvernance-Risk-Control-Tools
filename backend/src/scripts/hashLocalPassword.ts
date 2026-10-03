import { hashLocalPassword } from "../infrastructure/identity/LocalIdentityProvider.js";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run auth:hash-password -- <password>");
  process.exit(1);
}

console.log(hashLocalPassword(password));
