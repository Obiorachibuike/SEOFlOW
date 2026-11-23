"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { label: string; score: number; pages: number };

export function ScoreChart({ data }: { data: Point[] }) {
  if (data.length === 0) return <div className="flex h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/30 text-center">
    <div className="h-2 w-2 rounded-full bg-accent/50" /><p className="mt-3 text-sm font-medium">No audit history yet</p><p className="mt-1 max-w-[260px] text-xs leading-5 text-muted">Your diagnostic score trend will appear after a completed crawl.</p>
  </div>;
  return <div className="h-[220px] w-full">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 5" vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted))", fontSize: 10 }} dy={8} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted))", fontSize: 10 }} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--foreground))", fontSize: 12 }} formatter={(value, name) => [value, name === "score" ? "Diagnostic score" : "Pages"]} />
        <Line type="monotone" dataKey="score" stroke="#39ff14" strokeWidth={2.5} dot={{ fill: "#39ff14", r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
