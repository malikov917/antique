import { useLocalSearchParams } from "expo-router";
import { ChatDetailScreen } from "../../src/screens/ChatDetailScreen";

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatDetailScreen chatId={id} />;
}
