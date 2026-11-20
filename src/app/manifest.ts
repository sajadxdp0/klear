import type { MetadataRoute } from "next";

/**
 * Klear ships as an installable web app on purpose (see README, "Why a
 * web app"). The manifest gives it an app identity: name, colors, icons,
 * standalone display, so a merchant (or a judge) can install it to the
 * home screen and run it fullscreen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Klear — every rupee, cleared",
    short_name: "Klear",
    description:
      "Human-gated AI back office for merchants on Cashfree: three-way reconciliation, failed-payment recovery, explainable fraud defense.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8F5",
    theme_color: "#101820",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
