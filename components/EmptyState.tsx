export function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-8 max-w-xl">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      {children && <div className="mt-4 flex gap-2">{children}</div>}
    </div>
  );
}
