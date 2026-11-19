export const GUIDED_TOUR_VERSION = 1;
export const GUIDED_TOUR_STORAGE_KEY = "kastir.panel.guided-tour.v1";

type GuidedTourStorage = {
  status: "completed" | "dismissed";
  version: number;
};

export function shouldShowGuidedTour(value: string | null): boolean {
  if (!value) return true;

  try {
    const parsed = JSON.parse(value) as Partial<GuidedTourStorage>;
    return (
      parsed.version !== GUIDED_TOUR_VERSION ||
      (parsed.status !== "completed" && parsed.status !== "dismissed")
    );
  } catch {
    return true;
  }
}

export function guidedTourStorageValue(
  status: GuidedTourStorage["status"],
): string {
  return JSON.stringify({ status, version: GUIDED_TOUR_VERSION });
}
