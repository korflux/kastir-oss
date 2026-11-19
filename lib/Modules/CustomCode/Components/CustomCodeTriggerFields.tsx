"use client";

import { Input } from "@/components/ui/input";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { CustomCodeSelectorPicker } from "@/lib/Modules/CustomCode/Components/CustomCodeScopeSelector";
import type {
  CustomCodeCopy,
  TriggerType,
} from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";

/** Campos controlados dos quatro gatilhos; o editor continua dono do formulário. */
export function CustomCodeTriggerFields({
  dictionary,
  snippetId,
  selectClassName,
  triggerType,
  selector,
  selectorEvent,
  delaySeconds,
  percentage,
  referrerMatches,
  maxDisplays,
  displayResetDays,
  onTriggerTypeChange,
  onSelectorChange,
  onSelectorEventChange,
  onDelaySecondsChange,
  onPercentageChange,
  onReferrerMatchesChange,
  onMaxDisplaysChange,
  onDisplayResetDaysChange,
  onDirty,
}: {
  dictionary: CustomCodeCopy;
  snippetId: string;
  selectClassName: string;
  triggerType: TriggerType | "";
  selector: string;
  selectorEvent: "click" | "submit";
  delaySeconds: string;
  percentage: string;
  referrerMatches: string;
  maxDisplays: string;
  displayResetDays: string;
  onTriggerTypeChange: (value: TriggerType | "") => void;
  onSelectorChange: (value: string) => void;
  onSelectorEventChange: (value: "click" | "submit") => void;
  onDelaySecondsChange: (value: string) => void;
  onPercentageChange: (value: string) => void;
  onReferrerMatchesChange: (value: string) => void;
  onMaxDisplaysChange: (value: string) => void;
  onDisplayResetDaysChange: (value: string) => void;
  onDirty: () => void;
}) {
  return (
    <>
      <label className="block space-y-1 text-sm" htmlFor="snippet-trigger-type">
        <span>{dictionary.trigger}</span>
        <div className="relative">
          <select
            className={selectClassName}
            id="snippet-trigger-type"
            value={triggerType}
            onChange={(event) => {
              onTriggerTypeChange(event.target.value as TriggerType | "");
              onDirty();
            }}
          >
            <option value="">{dictionary.triggerNone}</option>
            <option value="SELECTOR_EVENT">
              {dictionary.triggerSelectorEvent}
            </option>
            <option value="PAGE_LOAD">{dictionary.triggerPageLoad}</option>
            <option value="SCROLL">{dictionary.triggerScroll}</option>
            <option value="REFERRER">{dictionary.triggerReferrer}</option>
          </select>
          <SelectChevron />
        </div>
      </label>

      {triggerType === "SELECTOR_EVENT" ? (
        <div className="space-y-2.5">
          <label className="block space-y-1 text-sm" htmlFor="trigger-selector">
            <span>{dictionary.triggerSelectorLabel}</span>
            <div className="flex items-center gap-2">
              <Input
                className="h-9 min-w-0 flex-1 rounded-lg"
                id="trigger-selector"
                placeholder={dictionary.triggerSelectorPlaceholder}
                value={selector}
                onChange={(event) => {
                  onSelectorChange(event.target.value);
                  onDirty();
                }}
              />
              <CustomCodeSelectorPicker
                dictionary={dictionary}
                snippetId={snippetId}
                onSelect={(value) => {
                  onSelectorChange(value);
                  onDirty();
                }}
              />
            </div>
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="trigger-selector-event"
          >
            <span>{dictionary.triggerEventLabel}</span>
            <div className="relative">
              <select
                className={selectClassName}
                id="trigger-selector-event"
                value={selectorEvent}
                onChange={(event) => {
                  onSelectorEventChange(
                    event.target.value as "click" | "submit",
                  );
                  onDirty();
                }}
              >
                <option value="click">{dictionary.triggerEventClick}</option>
                <option value="submit">{dictionary.triggerEventSubmit}</option>
              </select>
              <SelectChevron />
            </div>
          </label>
        </div>
      ) : null}

      {triggerType === "PAGE_LOAD" ? (
        <label
          className="block max-w-[8rem] space-y-1 text-sm"
          htmlFor="trigger-delay"
        >
          <span>{dictionary.triggerDelayLabel}</span>
          <Input
            className="h-9 rounded-lg"
            id="trigger-delay"
            inputMode="numeric"
            min="0"
            type="number"
            value={delaySeconds}
            onChange={(event) => {
              onDelaySecondsChange(event.target.value);
              onDirty();
            }}
          />
        </label>
      ) : null}

      {triggerType === "SCROLL" ? (
        <label
          className="block max-w-[8rem] space-y-1 text-sm"
          htmlFor="trigger-percentage"
        >
          <span>{dictionary.triggerPercentageLabel}</span>
          <Input
            className="h-9 rounded-lg"
            id="trigger-percentage"
            inputMode="numeric"
            max="100"
            min="1"
            type="number"
            value={percentage}
            onChange={(event) => {
              onPercentageChange(event.target.value);
              onDirty();
            }}
          />
        </label>
      ) : null}

      {triggerType === "REFERRER" ? (
        <label className="block space-y-1 text-sm" htmlFor="trigger-referrer">
          <span>{dictionary.triggerReferrerLabel}</span>
          <Input
            className="h-9 rounded-lg"
            id="trigger-referrer"
            placeholder={dictionary.triggerReferrerPlaceholder}
            value={referrerMatches}
            onChange={(event) => {
              onReferrerMatchesChange(event.target.value);
              onDirty();
            }}
          />
        </label>
      ) : null}

      {triggerType ? (
        <div className="grid grid-cols-2 gap-2">
          <label
            className="block min-w-0 space-y-1 text-sm"
            htmlFor="trigger-max-displays"
          >
            <span
              className="block truncate"
              title={dictionary.maxDisplaysLabel}
            >
              {dictionary.maxDisplaysLabel}
            </span>
            <Input
              className="h-9 rounded-lg"
              id="trigger-max-displays"
              inputMode="numeric"
              min="1"
              type="number"
              value={maxDisplays}
              onChange={(event) => {
                const value = event.target.value;
                onMaxDisplaysChange(value);
                if (value.trim() && !displayResetDays.trim())
                  onDisplayResetDaysChange("30");
                onDirty();
              }}
            />
          </label>
          <label
            className="block min-w-0 space-y-1 text-sm"
            htmlFor="trigger-reset-days"
          >
            <span
              className="block truncate"
              title={dictionary.displayResetDaysLabel}
            >
              {dictionary.displayResetDaysLabel}
            </span>
            <Input
              className="h-9 rounded-lg"
              disabled={!maxDisplays.trim()}
              id="trigger-reset-days"
              inputMode="numeric"
              min="1"
              type="number"
              value={displayResetDays}
              onChange={(event) => {
                onDisplayResetDaysChange(event.target.value);
                onDirty();
              }}
            />
          </label>
        </div>
      ) : null}
    </>
  );
}
