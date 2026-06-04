export type RunEventType =
  | "run_started"
  | "run_finished"
  | "inner_prompt_submitted"
  | "inner_turn_started"
  | "inner_turn_finished"
  | "inner_context_snapshot"
  | "assistant_message_started"
  | "assistant_message_delta"
  | "assistant_message_finished"
  | "tool_call_started"
  | "tool_call_updated"
  | "tool_call_finished"
  | "checkpoint_created"
  | "outer_invocation_started"
  | "outer_invocation_finished"
  | "outer_decision_parsed"
  | "outer_decision_validation_failed"
  | "rewrite_applied"
  | "rewrite_application_failed"
  | "rollback_applied"
  | "rollback_application_failed"
  | "termination_requested"
  | "guardrail_triggered"
  | "error";

export interface RunEventRecord {
  timestamp: string;
  type: RunEventType;
  [key: string]: unknown;
}
