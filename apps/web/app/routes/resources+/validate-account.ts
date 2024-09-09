import { getUserAuthRole } from "@/.server/service/authorized-users";
import { checkConnection } from "@/.server/service/clients";
import { getUserFromRequest } from "@/utils/auth-headers";
import { badRequest } from "@/utils/http";
import { type ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { createUserRoleCookie } from "@server/utils/user-role-cookie";
import { $path } from "remix-routes";

export async function action({ request }: ActionFunctionArgs) {
  const user = getUserFromRequest(request);
  if (!user.address) {
    throw badRequest("User not connected");
  }

  // Check if connection is up and running
  const isUp = await checkConnection();
  if (!isUp) {
    throw redirect($path("/app/down"));
  }

  // Get user role and save it in a cookie
  const role = await getUserAuthRole(user.address);
  const cookie = createUserRoleCookie({ role, revalidate: false });
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
