import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

/** Shell-only screen for sections whose data flows land in later features. */
export function Placeholder({
  title,
  topbar,
  note,
}: {
  title: string;
  topbar?: string;
  note: string;
}) {
  return (
    <>
      <Topbar title={topbar ?? title} />
      <div className="mx-auto max-w-5xl px-8 pb-16">
        <PageHeader title={title} />
        <Card className="flex flex-col items-center gap-2 py-14 text-center">
          <span className="text-2xl">🚧</span>
          <p className="max-w-md text-sm text-text-muted">{note}</p>
        </Card>
      </div>
    </>
  );
}
