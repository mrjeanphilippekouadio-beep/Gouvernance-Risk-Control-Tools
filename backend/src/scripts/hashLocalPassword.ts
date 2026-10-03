import { hashLocalPassword } from "../infrastructure/identity/LocalIdentityProvider.js";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive TTY is required to enter the password securely.");
  }

  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return await new Promise((resolve, reject) => {
    let password = "";

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Password input cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(password);
          return;
        }
        if (char === "\u007f") {
          if (password.length > 0) password = password.slice(0, -1);
          continue;
        }
        password += char;
      }
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };

    process.stdin.on("data", onData);
  });
}

try {
  const password = await readPassword();
  if (!password) {
    throw new Error("Password is required.");
  }
  console.log(hashLocalPassword(password));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to read password.");
  process.exitCode = 1;
}
