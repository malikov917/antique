import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import type { CreateUploadResponse, UploadStatusResponse } from "@antique/types";
import { prepareVideoForUpload, type UploadRuntimeContext } from "../upload/prepareVideo";
import { logUploadPrepCompleted, logUploadPrepFailed } from "../upload/uploadPrepTelemetry";
import { runUploadPipeline, type SelectedVideoAsset } from "../upload/uploadPipeline";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function UploadFlow({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState("Pick a video to upload");
  const [busy, setBusy] = useState(false);

  const pickAndUpload = async () => {
    setBusy(true);
    const runtime: UploadRuntimeContext = {
      platform: Platform.OS === "ios" ? "ios" : "android",
      isExpoGo: Constants.appOwnership === "expo",
      executionEnvironment: Constants.executionEnvironment ?? null
    };

    await runUploadPipeline({
      requestMediaPermission: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      pickVideo: async () => {
        const pickerOptions: ImagePicker.ImagePickerOptions = {
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          quality: 1
        };

        if (runtime.platform === "ios" && runtime.isExpoGo) {
          pickerOptions.videoExportPreset = ImagePicker.VideoExportPreset.H264_1920x1080;
          pickerOptions.videoQuality = ImagePicker.UIImagePickerControllerQualityType.Medium;
        }

        const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
        if (result.canceled || result.assets.length === 0) {
          return null;
        }

        const selectedAsset = result.assets[0];
        if (!selectedAsset) {
          return null;
        }

        return {
          uri: selectedAsset.uri,
          width: selectedAsset.width,
          height: selectedAsset.height,
          duration: selectedAsset.duration,
          fileSize: selectedAsset.fileSize,
          mimeType: selectedAsset.mimeType
        } satisfies SelectedVideoAsset;
      },
      prepareVideo: async (asset) => {
        const startedAtMs = Date.now();
        try {
          const prepared = await prepareVideoForUpload({
            asset: asset as ImagePicker.ImagePickerAsset,
            runtime
          });
          logUploadPrepCompleted({
            runtime,
            artifact: prepared
          });
          return prepared;
        } catch (error) {
          logUploadPrepFailed({
            runtime,
            startedAtMs,
            originalSizeBytes: asset.fileSize ?? undefined,
            error
          });
          throw error;
        }
      },
      createUploadSession: async () => {
        const createResponse = await fetch(`${API_BASE_URL}/v1/uploads`, {
          method: "POST"
        });
        if (!createResponse.ok) {
          throw new Error(`Create upload failed (${createResponse.status})`);
        }
        return (await createResponse.json()) as CreateUploadResponse;
      },
      uploadPreparedVideo: async (uploadUrl, prepared) => {
        const localFile = await fetch(prepared.preparedUri);
        const blob = await localFile.blob();
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": prepared.mimeType
          },
          body: blob
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (${uploadResponse.status})`);
        }
      },
      pollUploadStatus: async (uploadId) => {
        const poll = await fetch(`${API_BASE_URL}/v1/uploads/${uploadId}`);
        if (!poll.ok) {
          throw new Error("Status check failed");
        }
        return (await poll.json()) as UploadStatusResponse;
      },
      setStatus,
      onDone
    });

    setBusy(false);
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
