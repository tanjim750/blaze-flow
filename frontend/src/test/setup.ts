import "@testing-library/jest-dom/vitest";

// jsdom ships no object-URL implementation, and the upload and download paths
// both call it, so give tests an inert stand-in.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
}



