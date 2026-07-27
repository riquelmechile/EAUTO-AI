const base = require("./app.json").expo;

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE ?? "development";
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? base.extra.apiUrl;
  const projectId = process.env.EAS_PROJECT_ID;
  if (profile === "production") {
    if (!apiUrl || !apiUrl.startsWith("https://")) {
      throw new Error("Production Android builds require EXPO_PUBLIC_API_URL over HTTPS.");
    }
    if (!projectId) {
      throw new Error("Production Android builds require EAS_PROJECT_ID.");
    }
  }
  return {
    ...config,
    ...base,
    extra: {
      ...base.extra,
      apiUrl,
      ...(projectId ? { eas: { projectId } } : {}),
    },
    android: {
      ...base.android,
      package: "cl.maustian.eautoai",
    },
  };
};
