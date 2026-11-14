"use client";

import type { RecallStatus } from "../../lib/models";

export default function RecallControls({
  status,
  onChange,
}: {
  status?: RecallStatus;
  onChange: (status: RecallStatus) => void;
}) {
  return (
    <div className="recall-controls" role="group" aria-label="単語の暗記ステータス">
      <button
        className={`recall-button learned${status === "learned" ? " active" : ""}`}
        type="button"
        aria-pressed={status === "learned"}
        onClick={() => onChange(status === "learned" ? "unsure" : "learned")}
      >
        <span aria-hidden="true">✓</span> 覚えた
      </button>
      <button
        className={`recall-button unsure${status === "unsure" ? " active" : ""}`}
        type="button"
        aria-pressed={status === "unsure"}
        onClick={() => onChange(status === "unsure" ? "learned" : "unsure")}
      >
        <span aria-hidden="true">!</span> まだ不安
      </button>
    </div>
  );
}
