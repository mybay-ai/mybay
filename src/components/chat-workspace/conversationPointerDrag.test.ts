import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useEffect: vi.fn(), useState: (value: unknown) => [value, vi.fn()], useRef: (current: unknown) => ({ current }) }));
import { useConversationSidebarDrag } from "./useConversationSidebarDrag";
function setup() {
  const save = vi.fn(), expand = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- callback harness, no React renderer involved.
  const drag = useConversationSidebarDrag("agent", false, save, expand);
  const element: any = { dataset: { conversationDropKind: "project", conversationDropProject: "project", conversationDropId: "target" },
    getBoundingClientRect: () => ({ top: 100, height: 40 }) };
  element.closest = () => element;
  const hit = vi.fn(() => element); vi.stubGlobal("document", { elementFromPoint: hit });
  drag.scrollRef.current = { contains: (node: unknown) => node === element, getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 280 }) } as any;
  const event = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } }) as any;
  return { drag, save, expand, element, hit, event };
}
afterEach(() => vi.unstubAllGlobals());
describe("conversation pointer drag", () => {
  it("does not turn a click or small movement into an ordering mutation", () => {
    const { drag, save, event } = setup(); drag.pointerStart(event(10, 100), "source"); drag.pointerMove(event(12, 102)); drag.pointerEnd(event(12, 102));
    expect(save).not.toHaveBeenCalled();
  });
  it("places once at the final pointer position and opens the destination group", () => {
    const { drag, save, expand, event } = setup(); drag.pointerStart(event(10, 80), "source"); drag.pointerMove(event(30, 110)); drag.pointerEnd(event(30, 130)); drag.pointerEnd(event(30, 130));
    expect(save).toHaveBeenCalledExactlyOnceWith({ conversationId: "source", targetId: "target", section: { kind: "project", projectId: "project" }, position: "after" });
    expect(expand).toHaveBeenCalledWith("project:project");
  });
  it("cancels safely outside the sidebar, on the source row or after pointer cancellation", () => {
    for (const scenario of ["outside", "self", "cancel"]) {
      const { drag, save, element, hit, event } = setup(); drag.pointerStart(event(10, 80), "source"); drag.pointerMove(event(30, 110));
      if (scenario === "outside") hit.mockReturnValue(null);
      if (scenario === "self") element.dataset.conversationDropId = "source";
      if (scenario === "cancel") drag.reset();
      drag.pointerEnd(event(30, 130)); expect(save).not.toHaveBeenCalled();
    }
  });
});
