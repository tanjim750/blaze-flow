import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Krewsys",
    short_name: "Krewsys",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b10",
    theme_color: "#0b0b10",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
