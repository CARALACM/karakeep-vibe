import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useShareIntentContext, type ShareIntent } from "expo-share-intent";
import ErrorAnimation from "@/components/sharing/ErrorAnimation";
import LoadingAnimation from "@/components/sharing/LoadingAnimation";
import SuccessAnimation from "@/components/sharing/SuccessAnimation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { triggerSync } from "@/lib/backgroundSync";
import { enqueue } from "@/lib/offlineQueue";
import useAppSettings from "@/lib/settings";
import { useUploadAsset } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { z } from "zod";

import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";

type Mode =
  | { type: "idle" }
  | { type: "editing"; intent: ShareIntent }
  | { type: "saving"; title?: string; tags?: string[] }
  | { type: "success"; bookmarkId?: string }
  | { type: "alreadyExists"; bookmarkId: string }
  | { type: "savedLocally" }
  | { type: "error" };

const FIXED_TAGS = [
  "just",
  "diy",
  "fit",
  "3d",
  "home",
  "bike",
  "electronics",
  "science",
];

function SharingForm({
  initialTitle,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  onSave: (title: string, tags: string[]) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSave = () => {
    onSave(title, selectedTags);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="w-full max-w-sm gap-8 px-6"
    >
      <View className="gap-2">
        <Text
          variant="title1"
          className="text-center font-bold text-foreground"
        >
          Save to Karakeep
        </Text>
        <Text variant="body" className="text-center text-muted-foreground">
          Add a title and pick your tags.
        </Text>
      </View>

      <View className="gap-5">
        <Input
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="What's the title?"
          autoFocus
        />

        <View className="gap-2">
          <Text className="text-base text-foreground">Tags</Text>
          <View className="flex-row flex-wrap gap-2">
            {FIXED_TAGS.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggleTag(tag)}
                  className={cn(
                    "rounded-full border px-4 py-2 transition-all",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-input bg-background",
                  )}
                >
                  <Text
                    className={cn(
                      "text-sm font-medium",
                      isSelected
                        ? "text-primary-foreground"
                        : "text-foreground",
                    )}
                  >
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View className="flex-row gap-3 pt-2">
        <Button
          onPress={handleSave}
          androidRootClassName="flex-1"
          className="rounded-xl"
          variant="primary"
          size="lg"
        >
          <Text>Save</Text>
        </Button>
        <Button
          onPress={onCancel}
          androidRootClassName="flex-1"
          className="rounded-xl"
          variant="secondary"
          size="lg"
        >
          <Text>Cancel</Text>
        </Button>
      </View>
    </Animated.View>
  );
}

function SaveBookmark({
  mode,
  setMode,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
}) {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const { settings, isLoading } = useAppSettings();

  const onSaved = (d: ZBookmark & { alreadyExists: boolean }) => {
    setMode({
      type: d.alreadyExists ? "alreadyExists" : "success",
      bookmarkId: d.id,
    });
  };

  const { uploadAsset } = useUploadAsset(settings, {
    onSuccess: onSaved,
    onError: () => {
      setMode({ type: "error" });
    },
  });

  useEffect(() => {
    if (isLoading || !hasShareIntent) {
      return;
    }

    if (mode.type === "idle") {
      if (shareIntent.files && shareIntent.files.length > 0) {
        // Assets require binary upload – can't queue offline easily.
        // We skip the form for assets for now as per original flow.
        setMode({ type: "saving" });
      } else {
        setMode({ type: "editing", intent: shareIntent });
      }
      return;
    }

    if (mode.type !== "saving") {
      return;
    }

    const save = async () => {
      try {
        const title = mode.title;
        const tags = mode.tags;

        if (shareIntent.webUrl) {
          await enqueue({
            type: BookmarkTypes.LINK,
            url: shareIntent.webUrl,
            title,
            tags,
            source: "mobile",
          });
          setMode({ type: "savedLocally" });
        } else if (shareIntent?.text) {
          const val = z.string().url();
          if (val.safeParse(shareIntent.text).success) {
            await enqueue({
              type: BookmarkTypes.LINK,
              url: shareIntent.text,
              title,
              tags,
              source: "mobile",
            });
          } else {
            await enqueue({
              type: BookmarkTypes.TEXT,
              text: shareIntent.text,
              title,
              tags,
              source: "mobile",
            });
          }
          setMode({ type: "savedLocally" });
        } else if (shareIntent?.files) {
          uploadAsset({
            type: shareIntent.files[0].mimeType,
            name: shareIntent.files[0].fileName ?? "",
            uri: shareIntent.files[0].path,
          });
        }
      } catch {
        setMode({ type: "error" });
      }

      resetShareIntent();
      triggerSync().catch(() => {});
    };

    save();
  }, [isLoading, hasShareIntent, mode.type]);

  return null;
}

export default function Sharing() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ type: "idle" });

  const autoCloseTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto dismiss the modal after saving.
  useEffect(() => {
    if (
      mode.type === "idle" ||
      mode.type === "editing" ||
      mode.type === "saving"
    ) {
      return;
    }

    autoCloseTimeoutId.current = setTimeout(
      () => {
        BackHandler.exitApp();
      },
      mode.type === "error" ? 3000 : 1000,
    );

    return () => {
      if (autoCloseTimeoutId.current) {
        clearTimeout(autoCloseTimeoutId.current);
      }
    };
  }, [mode.type]);

  const handleManage = () => {
    if (
      (mode.type === "success" || mode.type === "alreadyExists") &&
      mode.bookmarkId
    ) {
      router.replace(`/dashboard/bookmarks/${mode.bookmarkId}/info`);
      if (autoCloseTimeoutId.current) {
        clearTimeout(autoCloseTimeoutId.current);
      }
    }
  };

  const handleDismiss = () => {
    if (autoCloseTimeoutId.current) {
      clearTimeout(autoCloseTimeoutId.current);
    }
    BackHandler.exitApp();
  };

  return (
    <View className="flex-1 items-center justify-center bg-background">
      {/* Hidden component that handles the save logic */}
      <SaveBookmark mode={mode} setMode={setMode} />

      {/* Editing State (Form) */}
      {mode.type === "editing" && (
        <SharingForm
          initialTitle=""
          onSave={(title, tags) => setMode({ type: "saving", title, tags })}
          onCancel={handleDismiss}
        />
      )}

      {/* Loading/Saving State */}
      {(mode.type === "idle" || mode.type === "saving") && <LoadingAnimation />}

      {/* Saved Locally State (Offline-first) */}
      {mode.type === "savedLocally" && (
        <Animated.View
          entering={FadeIn.duration(200)}
          className="items-center gap-6"
        >
          <SuccessAnimation isAlreadyExists={false} />

          <Animated.View
            entering={FadeIn.delay(400).duration(300)}
            className="items-center gap-2"
          >
            <Text variant="title1" className="font-semibold text-foreground">
              Hoarded!
            </Text>
            <Text variant="body" className="text-muted-foreground">
              Saved locally — will sync when server is available
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(600).duration(300)}
            className="items-center gap-3 pt-2"
          >
            <Pressable
              onPress={handleDismiss}
              className="px-4 py-2 active:opacity-60"
            >
              <Text className="text-muted-foreground">Dismiss</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* Success State (online sync completed) */}
      {(mode.type === "success" || mode.type === "alreadyExists") && (
        <Animated.View
          entering={FadeIn.duration(200)}
          className="items-center gap-6"
        >
          <SuccessAnimation isAlreadyExists={mode.type === "alreadyExists"} />

          <Animated.View
            entering={FadeIn.delay(400).duration(300)}
            className="items-center gap-2"
          >
            <Text variant="title1" className="font-semibold text-foreground">
              {mode.type === "alreadyExists" ? "Already Hoarded!" : "Hoarded!"}
            </Text>
            <Text variant="body" className="text-muted-foreground">
              {mode.type === "alreadyExists"
                ? "This item was saved before"
                : "Saved to your collection"}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(600).duration(300)}
            className="items-center gap-3 pt-2"
          >
            <Button onPress={handleManage} variant="primary" size="lg">
              <Text className="font-medium text-primary-foreground">
                Manage
              </Text>
            </Button>
            <Pressable
              onPress={handleDismiss}
              className="px-4 py-2 active:opacity-60"
            >
              <Text className="text-muted-foreground">Dismiss</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* Error State */}
      {mode.type === "error" && (
        <Animated.View
          entering={FadeIn.duration(200)}
          className="items-center gap-6"
        >
          <ErrorAnimation />

          <Animated.View
            entering={FadeIn.delay(300).duration(300)}
            className="items-center gap-2"
          >
            <Text variant="title1" className="font-semibold text-foreground">
              Oops!
            </Text>
            <Text variant="body" className="text-muted-foreground">
              Something went wrong
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(500).duration(300)}
            className="items-center gap-3 pt-2"
          >
            <Pressable
              onPress={handleDismiss}
              className="px-4 py-2 active:opacity-60"
            >
              <Text className="text-muted-foreground">Dismiss</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}
