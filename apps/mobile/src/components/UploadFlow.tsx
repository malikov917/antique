import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { CreateUploadResponse, UploadStatusResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function UploadFlow({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState("Pick a video to upload");
  const [busy, setBusy] = useState(false);

  const pickAndUpload = async () => {
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus("Media permission denied");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1
      });
      if (result.canceled || result.assets.length === 0) {
        setStatus("Upload canceled");
        return;
      }
      setStatus("Creating upload session...");
      const createResponse = await fetch(`${API_BASE_URL}/v1/uploads`, {
        method: "POST"
      });
      if (!createResponse.ok) {
        throw new Error(`Create upload failed (${createResponse.status})`);
      }

      const uploadData = (await createResponse.json()) as CreateUploadResponse;
      setStatus("Uploading video...");

      const localFile = await fetch(result.assets[0].uri);
      const blob = await localFile.blob();
      const uploadResponse = await fetch(uploadData.uploadUrl, {
        method: "PUT",
        body: blob
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`);
      }

      setStatus("Processing video...");
      for (let attempt = 0; attempt < 30; attempt++) {
        const poll = await fetch(`${API_BASE_URL}/v1/uploads/${uploadData.uploadId}`);
        if (!poll.ok) {
          throw new Error("Status check failed");
        }
        const body = (await poll.json()) as UploadStatusResponse;
        if (body.status === "ready") {
          setStatus("Video ready in feed");
          onDone();
          return;
        }
        if (body.status === "errored") {
          throw new Error("Video processing failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setStatus("Still processing, check back in a moment");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container} testID="upload-flow">
      <Text style={styles.title}>Upload antique reel</Text>
      <Text style={styles.status}>{status}</Text>
      <Pressable disabled={busy} style={styles.button} onPress={() => void pickAndUpload()}>
        {busy ? <ActivityIndicator color="#111111" /> : <Text style={styles.buttonText}>Pick + Upload</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 14
  },
  title: {
    color: "#f8f8f8",
    fontSize: 20,
    fontWeight: "700"
  },
  status: {
    color: "#d8d8d8",
    fontSize: 14
  },
  button: {
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44
  },
  buttonText: {
    color: "#111111",
    fontWeight: "700"
  }
});
