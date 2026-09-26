// Pure helpers for a Solar Mitra's referral link (VendorPage share options, PublicPage /v/:code).

// A shared link can arrive mangled: some apps glue the share text onto the URL, and the address then
// carries spaces and a `?`, like /v/V-1148%20Interested%20in%20solar?%20Get%20a%20free... A QR code
// never contains whitespace, so only the first token is the code. Also survives a stray % that makes
// decodeURIComponent throw.
export function cleanQrCodeParam(raw) {
  let decoded = String(raw || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch (error) {
    // keep the text as it came
  }
  return decoded.trim().split(/\s+/)[0] || '';
}

// Message for the direct share options (WhatsApp, SMS, email): a sentence, then the link ALONE on its
// own last line, so nothing can ever be appended to the URL and no app can fold the sentence into it.
export function shareBody(businessName, url) {
  return `Interested in solar? Get a free consultation through ${businessName || 'Solarium Energy'}:\n${url}`;
}

export const whatsappHref = (body) => `https://wa.me/?text=${encodeURIComponent(body)}`;
export const smsHref = (body) => `sms:?&body=${encodeURIComponent(body)}`;
export const mailtoHref = (body) => `mailto:?subject=${encodeURIComponent('Get a free solar consultation')}&body=${encodeURIComponent(body)}`;
