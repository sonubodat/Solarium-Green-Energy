import { useState } from 'react';
import { loadLanguage, saveLanguage, translate } from './vendor-i18n';

// Selected language (English by default), remembered in this browser. `t('key', { name })` looks the
// text up in ./vendor-i18n. Shared by the Solar Mitra portal and the public "Apply for Solar Mitra" page,
// so a choice made on one is already applied on the other.
export function useVendorLanguage() {
  const [language, setLanguageState] = useState(loadLanguage);
  const setLanguage = (code) => {
    setLanguageState(code);
    saveLanguage(code);
  };
  const t = (key, params) => translate(language, key, params);
  return { language, setLanguage, t };
}
