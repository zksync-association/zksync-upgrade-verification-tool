import { JsonDrop, TOO_LARGE } from "@/components/ui/json-drop";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

const files = (...list: File[]) => ({ types: ["Files"], files: list, dropEffect: "none" });
// jsdom's File has no text() (every browser's has).
const fileOf = (text: string, name: string) => {
  const file = new File([text], name);
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
};

describe("a payload file dropped on the page", () => {
  it("is read here and handed over as text, the area highlighted while it is dragged over", async () => {
    const onText = vi.fn();
    render(
      <JsonDrop onText={onText}>
        <p>Payload</p>
      </JsonDrop>
    );
    const zone = screen.getByTestId("json-drop");
    fireEvent.dragEnter(zone, { dataTransfer: files() });
    expect(screen.getByTestId("json-drop-over")).toHaveTextContent("Drop the payload JSON file");
    // Into a child and back out: still over the area.
    fireEvent.dragEnter(screen.getByText("Payload"), { dataTransfer: files() });
    fireEvent.dragLeave(screen.getByText("Payload"), { dataTransfer: files() });
    expect(screen.getByTestId("json-drop-over")).toBeInTheDocument();
    const json = '{ "salt": "0x12", "calls": [] }';
    fireEvent.drop(zone, { dataTransfer: files(fileOf(json, "payload.json")) });
    expect(screen.queryByTestId("json-drop-over")).not.toBeInTheDocument();
    await waitFor(() => expect(onText).toHaveBeenCalledWith(json));
  });

  it("refuses a file too large to be a payload, and ignores a drag of anything but files", async () => {
    const onText = vi.fn();
    const onError = vi.fn();
    render(
      <JsonDrop onText={onText} onError={onError}>
        <p>Payload</p>
      </JsonDrop>
    );
    const zone = screen.getByTestId("json-drop");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByTestId("json-drop-over")).not.toBeInTheDocument();
    const big = new File(["x"], "big.json");
    Object.defineProperty(big, "size", { value: 6_000_000 });
    fireEvent.drop(zone, { dataTransfer: files(big) });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(TOO_LARGE));
    expect(onText).not.toHaveBeenCalled();
  });

  it("while mounted, a file dropped elsewhere is not opened by the browser in place of the app", () => {
    render(
      <JsonDrop onText={() => {}}>
        <p>Payload</p>
      </JsonDrop>
    );
    const drop = createEvent.drop(window, { dataTransfer: files() });
    fireEvent(window, drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});
