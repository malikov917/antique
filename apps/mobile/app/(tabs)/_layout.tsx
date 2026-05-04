import { Redirect, Tabs } from "expo-router";
import { useAuthSession } from "../../src/auth/session";
import { Ionicons } from "@expo/vector-icons";

export default function TabsLayout() {
  const { hasAccessToken, isAuthenticated, loadingUser } = useAuthSession();
  if (hasAccessToken && loadingUser) {
    return null;
  }
  if (!isAuthenticated) {
    return <Redirect href={"/auth" as never} />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#f8f8f8",
        tabBarInactiveTintColor: "#9a9a9a",
        tabBarStyle: {
          backgroundColor: "#101010",
          borderTopColor: "#1b1b1b"
        }
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarButtonTestID: "tab-feed",
          tabBarAccessibilityLabel: "Feed tab",
          tabBarIcon: ({ color, size }) => <Ionicons name="play-circle-outline" size={size} color={color} />
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarButtonTestID: "tab-inbox",
          tabBarAccessibilityLabel: "Inbox tab",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-outline" size={size} color={color} />
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarButtonTestID: "tab-activity",
          tabBarAccessibilityLabel: "Activity tab",
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarButtonTestID: "tab-profile",
          tabBarAccessibilityLabel: "Profile tab",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />
        }}
      />
    </Tabs>
  );
}
