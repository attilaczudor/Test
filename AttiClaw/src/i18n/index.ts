import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en/common.json";
import enModels from "./locales/en/models.json";
import enSettings from "./locales/en/settings.json";
import enSkills from "./locales/en/skills.json";
import jaCommon from "./locales/ja/common.json";
import jaModels from "./locales/ja/models.json";
import jaSettings from "./locales/ja/settings.json";
import jaSkills from "./locales/ja/skills.json";
import zhCommon from "./locales/zh/common.json";
import zhModels from "./locales/zh/models.json";
import zhSettings from "./locales/zh/settings.json";
import zhSkills from "./locales/zh/skills.json";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      models: enModels,
      settings: enSettings,
      skills: enSkills,
    },
    zh: {
      common: zhCommon,
      models: zhModels,
      settings: zhSettings,
      skills: zhSkills,
    },
    ja: {
      common: jaCommon,
      models: jaModels,
      settings: jaSettings,
      skills: jaSkills,
    },
  },
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "models", "settings", "skills"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
