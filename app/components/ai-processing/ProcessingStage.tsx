"use client";
import Icon from "@/app/components/Icon";
import type { Stage } from "./stages";

export type StageState = "done" | "active" | "pending";

// One stage row: icon, title, hint, and a state-driven animation. No spinner — active
// stages breathe; completed stages check off; pending stages sit quietly dimmed.
export default function ProcessingStage({ stage, state }: { stage: Stage; state: StageState }) {
  return (
    <div className={"aip-stage aip-stage-" + state}>
      <span className="aip-stage-mark" aria-hidden="true">
        {state === "done"
          ? <span className="aip-check"><Icon name="check" size={13} /></span>
          : <span className="aip-stage-ic"><Icon name={stage.icon} size={15} /></span>}
      </span>
      <span className="aip-stage-text">
        <span className="aip-stage-title">{stage.title}</span>
        <span className="aip-stage-hint">{stage.hint}</span>
      </span>
      {state === "active" && (
        <span className="aip-stage-dots" aria-hidden="true"><i /><i /><i /></span>
      )}
    </div>
  );
}
