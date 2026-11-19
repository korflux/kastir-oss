import {
  Archive,
  Circle,
  Code2,
  FileText,
  GitBranch,
  House,
  Image,
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  home: House,
  layoutDashboard: LayoutDashboard,
  fileText: FileText,
  image: Image,
  code2: Code2,
  plug: Plug,
  gitBranch: GitBranch,
  users: Users,
  scrollText: ScrollText,
  settings: Settings,
  archive: Archive,
};

export function PanelIcon({
  iconKey,
  className,
}: {
  iconKey: string;
  className?: string;
}) {
  const Icon = icons[iconKey] ?? Circle;

  return <Icon aria-hidden="true" className={className} focusable="false" />;
}
