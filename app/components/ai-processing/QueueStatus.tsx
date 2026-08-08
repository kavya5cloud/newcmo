"use client";
import Icon from "@/app/components/Icon";
import { formatWait } from "./stages";

// High-demand experience — shown when a request is queued or providers are busy. Never an
// error: it reassures, frames the wait as a quality signal, and shows the ETA / position.
export default function QueueStatus({ estimatedTime, queuePosition }: { estimatedTime?: number; queuePosition?: number }) {
  return (
    <div className="aip-queue">
      <div className="aip-queue-ic" aria-hidden="true"><Icon name="queue" size={26} /></div>
      <h3 className="aip-queue-title">Populr is experiencing high demand</h3>
      <p className="aip-queue-body">
        We&apos;re currently processing a large number of creative requests to maintain quality.
        Your request has been safely queued.
      </p>
      <div className="aip-queue-stats">
        {typeof estimatedTime === "number" && (
          <div className="aip-queue-stat">
            <span className="aip-queue-k">Estimated wait</span>
            <span className="aip-queue-v">{formatWait(estimatedTime)}</span>
          </div>
        )}
        {typeof queuePosition === "number" && queuePosition > 0 && (
          <div className="aip-queue-stat">
            <span className="aip-queue-k">Queue position</span>
            <span className="aip-queue-v">#{queuePosition}</span>
          </div>
        )}
      </div>
      <div className="aip-queue-track" aria-hidden="true"><span /></div>
    </div>
  );
}
