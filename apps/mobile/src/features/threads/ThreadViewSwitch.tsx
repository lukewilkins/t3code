import { useGT } from "gt-react-native";
import { View } from "react-native";

import { SegmentedControl } from "../../components/ui/SegmentedControl";

export type ThreadView = "thread" | "spec";

/** Space the floating switch takes under the header, for content that must start below it. */
export const THREAD_VIEW_SWITCH_CLEARANCE = 48;

export function ThreadViewSwitch(props: {
  readonly view: ThreadView;
  readonly onChange: (view: ThreadView) => void;
  /** Distance from the top of the thread screen, below the header. */
  readonly top: number;
}) {
  const gt = useGT();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: props.top + 8, left: 0, right: 0, alignItems: "center" }}
    >
      <SegmentedControl
        className="w-48"
        options={[
          { value: "thread", label: gt("Thread") },
          { value: "spec", label: gt("Spec") },
        ]}
        selected={props.view}
        onSelect={props.onChange}
        role="tab"
        size="compact"
      />
    </View>
  );
}
