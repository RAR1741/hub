import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "1741 Hub",
    short_name: "Hub",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f2ee", // --canvas (globals.css)
    theme_color: "#e01926", // --red, Red Alert Robotics red (globals.css)
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
