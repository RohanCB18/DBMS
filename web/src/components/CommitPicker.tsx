import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { inputCls } from "./ui";

/** Select a commit from the log (newest first). `allowWorking` adds the live database. */
export function CommitPicker({ value, onChange, allowWorking, className }: {
  value: string; onChange: (v: string) => void; allowWorking?: boolean; className?: string;
}) {
  const { data } = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  return (
    <select className={inputCls + " font-mono " + (className ?? "")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>choose a commit…</option>
      {allowWorking && <option value="WORKING">WORKING (live database)</option>}
      {data?.map((c, i) => (
        <option key={c.commit_id} value={c.commit_id}>
          {c.commit_id.slice(0, 10)} · v{data.length - i} · {c.message.slice(0, 48)}
        </option>
      ))}
    </select>
  );
}

/** Commits oldest → newest give "v1, v2…" labels used across the UI. */
export function useVersionLabels() {
  const { data } = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const labels: Record<string, string> = {};
  data?.forEach((c, i) => { labels[c.commit_id] = `v${data.length - i}`; });
  return labels;
}
