"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";

export type AgentReadyTaskFilterValue =
  | "all"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const options: { value: AgentReadyTaskFilterValue; label: string }[] = [
  { value: "all", label: "All tasks" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export function AgentReadyTaskFilter({
  value,
  onChange,
}: {
  value: AgentReadyTaskFilterValue;
  onChange: (value: AgentReadyTaskFilterValue) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onChange(nextValue as AgentReadyTaskFilterValue);
      }}
      items={options}
    >
      <SelectLabel className="sr-only">Filter tasks</SelectLabel>
      <SelectTrigger
        aria-label="Filter tasks"
        className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
