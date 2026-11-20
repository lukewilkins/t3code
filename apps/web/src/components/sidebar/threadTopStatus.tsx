import type { useGT } from "gt-react";
import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import type { SidebarThreadStatus } from "../Sidebar.logic";

const TOP_STATUS_ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  done: CircleCheckIcon,
  woke: AlarmClockIcon,
} as const;

export interface ThreadTopStatus {
  readonly label: string;
  readonly icon: keyof typeof TOP_STATUS_ICONS;
  readonly className: string;
}

export function TopStatusIcon(props: { icon: keyof typeof TOP_STATUS_ICONS; className: string }) {
  const Icon = TOP_STATUS_ICONS[props.icon];
  return <Icon aria-hidden className={cn("shrink-0", props.className)} />;
}

/** The status a thread row (or lobby card) leads with; null when there is nothing to call out. */
export function resolveThreadTopStatus(
  input: {
    readonly status: SidebarThreadStatus;
    readonly isWoke: boolean;
    readonly isUnread: boolean;
    readonly goalActive: boolean;
  },
  gt: ReturnType<typeof useGT>,
): ThreadTopStatus | null {
  const { status } = input;
  if (status === "preparing" || status === "working") {
    return {
      label:
        status === "preparing"
          ? gt("Setting up")
          : input.goalActive
            ? gt("Goal", { $context: "thread status: working on a goal" })
            : gt("Working", { $context: "thread status" }),
      icon: "working",
      className: "text-info-foreground",
    };
  }
  switch (status) {
    case "waiting":
      return {
        label: gt("Waiting", { $context: "thread status" }),
        icon: "waiting",
        className: "text-muted-foreground",
      };
    case "approval":
      return {
        label: gt("Approval", { $context: "thread status: needs approval" }),
        icon: "approval",
        className: "text-warning-foreground",
      };
    case "input":
      return {
        label: gt("Input", { $context: "thread status: needs user input" }),
        icon: "input",
        className: "text-indigo-600 dark:text-indigo-300",
      };
    case "request":
      return {
        label: gt("Request", { $context: "thread status: guest request" }),
        icon: "request",
        className: "text-guest-foreground",
      };
    case "limited":
      return {
        label: gt("Limited", { $context: "thread status: usage limited" }),
        icon: "failed",
        className: "text-warning-foreground",
      };
    case "failed":
      return {
        label: gt("Failed", { $context: "thread status" }),
        icon: "failed",
        className: "text-error-foreground",
      };
  }
  if (input.isWoke) {
    return {
      label: gt("Woke", { $context: "thread status: woke from snooze" }),
      icon: "woke",
      className: "text-warning-foreground",
    };
  }
  if (input.isUnread) {
    return {
      label: gt("Done", { $context: "thread status" }),
      icon: "done",
      className: "text-success-foreground",
    };
  }
  return null;
}
