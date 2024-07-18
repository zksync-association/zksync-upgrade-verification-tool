import { json } from "@remix-run/node";
import { createRemixStub } from "@remix-run/testing";
import { render, screen, waitFor } from "@testing-library/react";
import { test } from "vitest";

test("renders loader data", async () => {
  function MyComponent() {
    // const data = useLoaderData() as { message: string };

    const data = { message: "hello", name: "world" };
    return <p>Message: {data.message}</p>;
  }

  const RemixStub = createRemixStub([
    {
      path: "/",
      Component: MyComponent,
      loader() {
        return json({ message: "hello" });
      },
    },
  ]);

  render(<RemixStub />);

  await waitFor(() => screen.findByText("Message: hello"));
});
