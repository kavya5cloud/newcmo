import { db } from "@/lib/db";
import { AgentBoard } from "./board";
import { AgentRunner } from "./runner";
import { InMemoryTeamStateRepo, NeonTeamStateRepo, type TeamStateRepo } from "./store";

// One process-wide AI Team platform, wired to the live stores.

export type TeamPlatform = {
  runner: AgentRunner;
  board: AgentBoard;
  state: TeamStateRepo;
};

let platform: TeamPlatform | null = null;

export function teamPlatform(): TeamPlatform {
  if (!platform) {
    const sql = db();
    platform = {
      runner: new AgentRunner(Date.now),
      board: new AgentBoard(),
      state: sql ? new NeonTeamStateRepo(sql) : new InMemoryTeamStateRepo(),
    };
  }
  return platform;
}
