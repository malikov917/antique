import { Redirect } from "expo-router";
import { useAuthSession } from "../src/auth/session";

export default function IndexRoute() {
  const { hasAccessToken, isAuthenticated, loadingUser } = useAuthSession();
  if (hasAccessToken && loadingUser) {
    return null;
  }
  return <Redirect href={(isAuthenticated ? "/(tabs)/feed" : "/auth") as never} />;
}
