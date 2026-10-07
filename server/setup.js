// One-time: creates the agent user, the humans, and the "Ship It" group in CometChat.
// Safe to re-run; existing users/groups are left alone.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config, isConfigured } from "./config.js";
import { cc } from "./cometchat.js";

// The demo workspace keeps its own history in .pager-git (ignored by the main repo).
const gitDir = path.join(config.workspace, ".pager-git");
if (!fs.existsSync(gitDir)) {
  const g = (...a) => execFileSync("git", [`--git-dir=${gitDir}`, `--work-tree=${config.workspace}`, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "core.autocrlf", "false");
  g("add", "-A");
  g("-c", "user.name=Pager (agent)", "-c", "user.email=pager@agent.local", "commit", "-qm", "Launchpad signup page");
  console.log("  + initialised workspace history");
}

if (!isConfigured()) {
  console.error("Fill COMETCHAT_APP_ID, COMETCHAT_REGION and COMETCHAT_REST_API_KEY in .env first.");
  process.exit(1);
}

const exists = (e) => e.status === 400 || e.status === 409 || /EXIST/i.test(e.code || e.message);

async function ensureUser(uid, name, extra) {
  try {
    await cc.createUser(uid, name, extra);
    console.log(`  + user ${uid} (${name})`);
  } catch (e) {
    if (!exists(e)) throw e;
    console.log(`  = user ${uid} already exists`);
  }
}

console.log(`\nSetting up CometChat app ${config.appId} (${config.region})\n`);

await ensureUser(config.agentUid, config.agentName, {
  role: "default",
  metadata: { kind: "coding-agent", runtime: "claude-code" },
  avatar: "https://api.dicebear.com/9.x/shapes/png?seed=pager&backgroundColor=ff6b4a",
});
for (const h of config.humans) {
  await ensureUser(h.uid, h.name, {
    avatar: `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(h.uid)}&backgroundColor=c9b8ff`,
  });
}

const members = [config.agentUid, ...config.humans.map((h) => h.uid)];
try {
  await cc.createGroup(config.groupGuid, config.groupName, members, {
    owner: config.humans[0]?.uid,
    description: "Humans + a coding agent. Say @Pager to put it to work.",
  });
  console.log(`  + group ${config.groupGuid} with ${members.join(", ")}`);
} catch (e) {
  if (!exists(e)) throw e;
  console.log(`  = group ${config.groupGuid} already exists, making sure everyone is in it`);
  await cc.addMembers(config.groupGuid, members).catch((err) => console.log(`    (members: ${err.message})`));
}

console.log("\nDone. Start the server with: npm start\n");
