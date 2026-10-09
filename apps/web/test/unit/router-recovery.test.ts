import { recoverRouter } from "@/utils/router-recovery";

beforeEach(() => sessionStorage.clear());

it("reloads stale modules once, including across component remounts", () => {
  const reload = vi.fn();
  const browser = {
    sessionStorage,
    location: { pathname: "/app/proposals", search: "", reload },
  };
  recoverRouter(browser);
  recoverRouter(browser);
  expect(reload).toHaveBeenCalledTimes(1);
  browser.location.pathname = "/settings";
  recoverRouter(browser);
  expect(reload).toHaveBeenCalledTimes(2);
});

it("keeps manual recovery available when storage is blocked", () => {
  const reload = vi.fn();
  const browser = {
    get sessionStorage(): Storage {
      throw new Error("Storage blocked");
    },
    location: { pathname: "/app/proposals", search: "", reload },
  };
  expect(() => recoverRouter(browser)).not.toThrow();
  expect(reload).not.toHaveBeenCalled();
});
