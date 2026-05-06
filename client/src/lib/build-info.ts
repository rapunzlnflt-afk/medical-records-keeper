declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "unknown";
