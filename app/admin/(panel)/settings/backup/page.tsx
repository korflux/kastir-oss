import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { BackupWorkspace } from "@/lib/Modules/Backup/Components/BackupWorkspace";
import { backupService } from "@/lib/Modules/Backup/Service";

/** Aba Backup — antiga /admin/backup (reskin na Task 6). */
export default async function SetupBackupPage() {
  await requirePanelAccess("/admin/settings/backup");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const [snapshots, schedule] = await Promise.all([
    backupService.listSnapshots(),
    backupService.getAutoSchedule(),
  ]);

  return (
    <BackupWorkspace
      copy={dictionary.backup}
      initialSchedule={schedule}
      initialSnapshots={snapshots}
    />
  );
}
