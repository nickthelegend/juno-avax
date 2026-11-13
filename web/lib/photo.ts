import { Buffer } from "buffer";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";
import type { Hex } from "viem";

/**
 * A photo for a post, made small enough to live on Fuji.
 *
 * Juno has no upload server. The photo is cropped square, shrunk and saved as a JPEG of at most {@link MAX_BYTES}
 * (JunoMedia allows 120 kB), and its bytes become the calldata of one `JunoMedia.store` transaction. The post's
 * mediaUrl then points at Juno's API, which reads that transaction back from Fuji. Fuji's gas price makes the
 * store cost a tiny fraction of the starter AVAX.
 */
export const MAX_BYTES = 110_000;

export type Photo = { uri: string; hex: Hex; size: number; width: number; height: number };

/** Steps from sharp to small: the first that fits wins. */
const LADDER: readonly (readonly [number, number])[] = [
  [720, 0.72],
  [640, 0.62],
  [560, 0.55],
  [480, 0.5],
  [400, 0.45],
];

export class PhotoError extends Error {}

export async function pickPhoto(from: "library" | "camera"): Promise<Photo | null> {
  if (from === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PhotoError("Juno needs the camera to take a photo. Allow it in Settings, or choose one from your photos.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false };
  const result =
    from === "camera"
      ? await ImagePicker.launchCameraAsync(options).catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          throw new PhotoError(/simulator|not available|unavailable/i.test(text) ? "This device has no camera. Choose a photo instead." : text);
        })
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  return shrink(result.assets[0]);
}

async function shrink(asset: { uri: string; width: number; height: number }): Promise<Photo> {
  const side = Math.min(asset.width, asset.height);
  const crop: Action[] =
    asset.width !== asset.height && side > 0
      ? [{ crop: { originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side } }]
      : [];
  for (const [px, quality] of LADDER) {
    const width = side > 0 ? Math.min(px, side) : px;
    const out = await manipulateAsync(asset.uri, [...crop, { resize: { width } }], { compress: quality, format: SaveFormat.JPEG, base64: true });
    if (!out.base64) continue;
    const bytes = Buffer.from(out.base64.replace(/^data:[^,]*,/, ""), "base64");
    if (bytes.length <= MAX_BYTES) {
      return { uri: out.uri, hex: `0x${bytes.toString("hex")}` as Hex, size: bytes.length, width: out.width, height: out.height };
    }
  }
  throw new PhotoError(`That photo is too detailed to fit in one Fuji transaction (${Math.round(MAX_BYTES / 1000)} kB). Try another.`);
}
