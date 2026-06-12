const { spawn } = require("child_process");

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  child.on("exit", (code) => {
    console.error(`${name} exited with code ${code}`);
    process.exit(code || 1);
  });

  return child;
}

start("api", "npm", ["run", "start"]);
start("worker", "npm", ["run", "worker"]);